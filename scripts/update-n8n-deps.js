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
      packageJson.dependencies[update.package] = `^${update.latest}`;
      console.log(`   Updated ${update.package} to ^${update.latest}`);
    }
    
    fs.writeFileSync(
      this.packageJsonPath,
      JSON.stringify(packageJson, null, 2) + '\n',
      'utf8'
    );
    
    return true;
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
      execSync('npm run validate && npm run test-nodes', { 
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