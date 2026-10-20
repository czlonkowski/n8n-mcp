#!/usr/bin/env node

/**
 * Update n8n dependencies to latest versions
 * Can be run manually or via GitHub Actions
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

class N8nDependencyUpdater {
  constructor() {
    this.packageJsonPath = path.join(__dirname, '..', 'package.json');
    // The Docker builder installs its own minimal dependency set rather than the
    // repo's, so its n8n-workflow pin has to be updated alongside package.json.
    this.dockerfilePath = path.join(__dirname, '..', 'Dockerfile');
    // Track n8n-nodes-base directly (the package our loader actually requires).
    // The full `n8n` meta package was dropped in favor of this leaner dep tree.
    this.mainPackage = 'n8n-nodes-base';
  }

  /**
   * Compare two semver-ish versions. Returns -1 / 0 / 1 (a<b, a==b, a>b).
   * Enough for the "don't downgrade" guard; not a full semver parser.
   */
  compareVersions(a, b) {
    const parse = (v) => v.split('.').map((p) => parseInt(p, 10) || 0);
    const [a1, a2, a3] = parse(a);
    const [b1, b2, b3] = parse(b);
    if (a1 !== b1) return a1 < b1 ? -1 : 1;
    if (a2 !== b2) return a2 < b2 ? -1 : 1;
    if (a3 !== b3) return a3 < b3 ? -1 : 1;
    return 0;
  }

  /**
   * Resolve the set of n8n sub-package versions compatible with the current
   * `n8n@latest` release. The `n8n` meta package is the source of truth for
   * which sub-package versions constitute "n8n X.Y.Z" — individual
   * sub-packages (notably n8n-nodes-base, n8n-workflow) don't keep their
   * `latest` dist-tag in sync, so querying each one's tag can return
   * versions older than what n8n itself depends on.
   */
  getN8nDependencySet() {
    try {
      const output = execSync('npm view n8n@latest dependencies --json', { encoding: 'utf8' });
      return JSON.parse(output);
    } catch (error) {
      console.error('Failed to resolve n8n@latest dependencies:', error.message);
      return null;
    }
  }

  /**
   * Get current version from package.json
   */
  getCurrentVersion(packageName) {
    const packageJson = JSON.parse(fs.readFileSync(this.packageJsonPath, 'utf8'));
    const version = packageJson.dependencies[packageName];
    return version ? version.replace(/^[\^~]/, '') : null;
  }

  /**
   * Check which packages need updates.
   *
   * Versions are resolved from `n8n@latest`'s dependency pins rather than
   * each sub-package's own `latest` dist-tag — n8n does not keep the
   * per-package tags in sync, which previously caused this script to
   * propose downgrades.
   */
  async checkForUpdates() {
    console.log('🔍 Checking for n8n dependency updates...\n');

    const trackedDeps = [
      'n8n-nodes-base',
      'n8n-core',
      'n8n-workflow',
      '@n8n/n8n-nodes-langchain',
    ];

    const metaDeps = this.getN8nDependencySet();
    if (!metaDeps) {
      console.error('Aborting: could not resolve n8n@latest dependency set');
      return [];
    }

    const updates = [];
    for (const dep of trackedDeps) {
      const currentVersion = this.getCurrentVersion(dep);
      const latestVersion = metaDeps[dep];

      if (!currentVersion) {
        console.error(`Failed to read current version for ${dep}`);
        continue;
      }
      if (!latestVersion) {
        console.error(`${dep} is not listed in n8n@latest dependencies — skipping`);
        continue;
      }

      const cmp = this.compareVersions(currentVersion, latestVersion);
      if (cmp === 0) {
        console.log(`✅ ${dep}: ${currentVersion} (up to date)`);
      } else if (cmp < 0) {
        console.log(`📦 ${dep}: ${currentVersion} → ${latestVersion} (update available)`);
        updates.push({
          package: dep,
          current: currentVersion,
          latest: latestVersion,
        });
      } else {
        console.log(`⏭️  ${dep}: ${currentVersion} is ahead of n8n@latest pin ${latestVersion} — skipping (no downgrade)`);
      }
    }

    return updates;
  }

  /**
   * Update package.json with new versions
   */
  updatePackageJson(updates) {
    if (updates.length === 0) {
      console.log('\n✨ All n8n dependencies are up to date and in sync!');
      return false;
    }
    
    console.log(`\n📝 Updating ${updates.length} packages in package.json...`);
    
    const packageJson = JSON.parse(fs.readFileSync(this.packageJsonPath, 'utf8'));
    
    for (const update of updates) {
      // Exact pin (no caret) so a fresh `npm install` after a future minor release
      // can't slip in a different node set than the database was rebuilt against.
      // The DB rebuild step assumes these versions are reproducible.
      packageJson.dependencies[update.package] = update.latest;
      console.log(`   Updated ${update.package} to ${update.latest}`);
    }
    
    fs.writeFileSync(
      this.packageJsonPath,
      JSON.stringify(packageJson, null, 2) + '\n',
      'utf8'
    );

    this.syncPeerPins(packageJson, updates);
    this.syncDockerfilePins(packageJson);

    return true;
  }

  /**
   * Align our own pins with the exact peer dependencies the new n8n packages demand.
   *
   * n8n-workflow pins `zod` to an exact version and bumps it between releases. Because the
   * repo's local .npmrc sets legacy-peer-deps, a mismatch installs fine here and fails only in
   * the Dockerfile's builder stage, which installs into a scratch directory with no .npmrc and
   * so enforces peers: `npm error ERESOLVE ... peer zod@"3.25.76" from n8n-workflow@2.34.3`.
   * That is a CI-only failure discovered after the update looked successful, so the pin is
   * brought along with the update that moved it.
   *
   * Only peers the repo already depends on directly are touched; a peer we do not declare is
   * left to npm.
   */
  syncPeerPins(packageJson, updates) {
    const updated = new Map(updates.map(update => [update.package, update.latest]));
    const synced = [];

    for (const [name, version] of updated) {
      let peers;
      try {
        const output = execSync(`npm view ${name}@${version} peerDependencies --json`, {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore']
        });
        peers = output.trim() ? JSON.parse(output) : {};
      } catch (error) {
        console.log(`   ⚠️  Could not read peer dependencies of ${name}@${version} - skipping`);
        continue;
      }

      for (const [peer, range] of Object.entries(peers || {})) {
        // Only an exact pin is safe to copy; a range is npm's to resolve.
        if (!/^\d+\.\d+\.\d+$/.test(range)) continue;
        if (updated.has(peer)) continue; // an n8n package this update already set
        const current = packageJson.dependencies?.[peer];
        if (!current || current === range) continue;

        packageJson.dependencies[peer] = range;
        synced.push(`${peer} ${current} -> ${range} (peer of ${name}@${version})`);
      }
    }

    if (!synced.length) return;

    fs.writeFileSync(
      this.packageJsonPath,
      JSON.stringify(packageJson, null, 2) + '\n',
      'utf8'
    );
    console.log(`   Synced ${synced.length} peer pin(s):`);
    for (const entry of synced) console.log(`     ${entry}`);
  }

  /**
   * Align the Dockerfile's build-dependency pins with package.json.
   *
   * The builder stage installs its own minimal dependency set instead of the
   * repo's, so every version in it is a hand-maintained copy that drifts. Two
   * ways that has broken the image: a stale n8n-workflow compiles src/ against
   * older type definitions (a type added in a newer n8n then fails only in
   * Docker), and a stale zod fails `npm install` outright, because n8n-workflow
   * declares an exact zod peer dependency.
   *
   * Every pin naming a direct dependency is rewritten; anything the repo does
   * not depend on directly (e.g. @types/uuid) is left alone.
   */
  syncDockerfilePins(packageJson) {
    if (!fs.existsSync(this.dockerfilePath)) {
      console.log('   ⚠️  Dockerfile not found - skipping build-dependency pin sync');
      return;
    }

    const declared = { ...packageJson.dependencies, ...packageJson.devDependencies };
    const dockerfile = fs.readFileSync(this.dockerfilePath, 'utf8');
    const synced = [];

    // Matches `name@version` install arguments, including scoped package names
    const updated = dockerfile.replace(
      /(^|\s)((?:@[^\s@/]+\/)?[^\s@/]+)@([^\s\\]+)/g,
      (match, lead, name, version) => {
        const declaredVersion = declared[name];
        if (!declaredVersion || declaredVersion === version) return match;

        synced.push(`${name} ${version} -> ${declaredVersion}`);
        return `${lead}${name}@${declaredVersion}`;
      }
    );

    if (!synced.length) {
      console.log('   Dockerfile build-dependency pins already match package.json');
      return;
    }

    fs.writeFileSync(this.dockerfilePath, updated, 'utf8');
    console.log(`   Synced ${synced.length} Dockerfile pin(s) with package.json:`);
    for (const entry of synced) console.log(`     ${entry}`);
  }

  /**
   * Run npm install to update lock file
   */
  runNpmInstall() {
    console.log('\n📥 Running npm install to update lock file...');
    try {
      execSync('npm install', { 
        cwd: path.join(__dirname, '..'),
        stdio: 'inherit'
      });
      return true;
    } catch (error) {
      console.error('❌ npm install failed:', error.message);
      return false;
    }
  }

  /**
   * Fail the update when n8n changed the workflowSettings schema, so a new setting is added to
   * src/constants/workflow-settings.ts deliberately instead of being silently dropped from
   * every workflow write.
   */
  checkSettingsDrift() {
    console.log('\n🔍 Checking workflow settings schema against the new n8n...');
    try {
      execSync('npm run check:settings-drift', {
        cwd: path.join(__dirname, '..'),
        stdio: 'inherit'
      });
      return true;
    } catch (error) {
      console.error('\n❌ Workflow settings schema drifted - see above.');
      console.error('   Update src/constants/workflow-settings.ts, then re-run the update.');
      return false;
    }
  }

  /**
   * Rebuild the node database
   */
  rebuildDatabase() {
    console.log('\n🔨 Rebuilding node database...');
    try {
      execSync('npm run build && npm run rebuild', { 
        cwd: path.join(__dirname, '..'),
        stdio: 'inherit'
      });
      return true;
    } catch (error) {
      console.error('❌ Database rebuild failed:', error.message);
      return false;
    }
  }

  /**
   * Run validation tests
   */
  runValidation() {
    console.log('\n🧪 Running validation tests...');
    try {
      execSync('npm run validate', {
        cwd: path.join(__dirname, '..'),
        stdio: 'inherit'
      });
      console.log('✅ All tests passed!');
      return true;
    } catch (error) {
      console.error('❌ Validation failed:', error.message);
      return false;
    }
  }

  /**
   * Generate update summary for PR/commit message
   */
  generateUpdateSummary(updates) {
    if (updates.length === 0) return '';
    
    const summary = ['Updated n8n dependencies:\n'];
    
    for (const update of updates) {
      summary.push(`- ${update.package}: ${update.current} → ${update.latest}`);
    }
    
    return summary.join('\n');
  }

  /**
   * Main update process
   */
  async run(options = {}) {
    const { dryRun = false, skipTests = false } = options;
    
    console.log('🚀 n8n Dependency Updater\n');
    console.log('Mode:', dryRun ? 'DRY RUN' : 'LIVE UPDATE');
    console.log('Skip tests:', skipTests ? 'YES' : 'NO');
    console.log('Strategy: Update n8n and sync its required dependencies');
    console.log('');
    
    // Check for updates
    const updates = await this.checkForUpdates();
    
    if (updates.length === 0) {
      process.exit(0);
    }
    
    if (dryRun) {
      console.log('\n🔍 DRY RUN: No changes made');
      console.log('\nUpdate summary:');
      console.log(this.generateUpdateSummary(updates));
      process.exit(0);
    }
    
    // Apply updates
    if (!this.updatePackageJson(updates)) {
      process.exit(0);
    }
    
    // Install dependencies
    if (!this.runNpmInstall()) {
      console.error('\n❌ Update failed at npm install step');
      process.exit(1);
    }
    
    // Check the settings schema before the rebuild - it is the cheap check of the two
    if (!this.checkSettingsDrift()) {
      console.error('\n❌ Update failed at settings drift check step');
      process.exit(1);
    }

    // Rebuild database
    if (!this.rebuildDatabase()) {
      console.error('\n❌ Update failed at database rebuild step');
      process.exit(1);
    }
    
    // Run tests
    if (!skipTests && !this.runValidation()) {
      console.error('\n❌ Update failed at validation step');
      process.exit(1);
    }
    
    // Success!
    console.log('\n✅ Update completed successfully!');
    console.log('\nUpdate summary:');
    console.log(this.generateUpdateSummary(updates));
    
    // Write summary to file for GitHub Actions
    if (process.env.GITHUB_ACTIONS) {
      fs.writeFileSync(
        path.join(__dirname, '..', 'update-summary.txt'),
        this.generateUpdateSummary(updates),
        'utf8'
      );
    }
  }
}

// CLI handling
if (require.main === module) {
  const args = process.argv.slice(2);
  const options = {
    dryRun: args.includes('--dry-run') || args.includes('-d'),
    skipTests: args.includes('--skip-tests') || args.includes('-s')
  };
  
  const updater = new N8nDependencyUpdater();
  updater.run(options).catch(error => {
    console.error('Unexpected error:', error);
    process.exit(1);
  });
}

module.exports = N8nDependencyUpdater;