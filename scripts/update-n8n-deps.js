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
   * Get latest version of a package from npm
   */
  getLatestVersion(packageName) {
    try {
      const output = execSync(`npm view ${packageName} version`, { encoding: 'utf8' });
      return output.trim();
    } catch (error) {
      console.error(`Failed to get version for ${packageName}:`, error.message);
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
   * Each tracked package is checked independently against its own
   * `latest` dist-tag on npm. The old strategy of deriving peer versions
   * from the `n8n` meta package was removed when we dropped that dep.
   */
  async checkForUpdates() {
    console.log('🔍 Checking for n8n dependency updates...\n');

    const updates = [];
    const trackedDeps = [
      'n8n-nodes-base',
      'n8n-core',
      'n8n-workflow',
      '@n8n/n8n-nodes-langchain',
    ];

    for (const dep of trackedDeps) {
      const currentVersion = this.getCurrentVersion(dep);
      const latestVersion = this.getLatestVersion(dep);

      if (!currentVersion || !latestVersion) {
        console.error(`Failed to resolve version for ${dep}`);
        continue;
      }

      if (currentVersion !== latestVersion) {
        console.log(`📦 ${dep}: ${currentVersion} → ${latestVersion} (update available)`);
        updates.push({
          package: dep,
          current: currentVersion,
          latest: latestVersion,
        });
      } else {
        console.log(`✅ ${dep}: ${currentVersion} (up to date)`);
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
      console.log(`   Updated ${update.package} to ^${update.latest}${update.reason ? ` (${update.reason})` : ''}`);
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