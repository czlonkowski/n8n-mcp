#!/usr/bin/env node

/**
 * Test script for release automation
 * Validates the release workflow components locally
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Color codes for output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function header(title) {
  log(`\n${'='.repeat(60)}`, 'cyan');
  log(`🧪 ${title}`, 'cyan');
  log(`${'='.repeat(60)}`, 'cyan');
}

function section(title) {
  log(`\n📋 ${title}`, 'blue');
  log(`${'-'.repeat(40)}`, 'blue');
}

function success(message) {
  log(`✅ ${message}`, 'green');
}

function warning(message) {
  log(`⚠️  ${message}`, 'yellow');
}

function error(message) {
  log(`❌ ${message}`, 'red');
}

function info(message) {
  log(`ℹ️  ${message}`, 'blue');
}

class ReleaseAutomationTester {
  constructor() {
    this.rootDir = path.resolve(__dirname, '..');
    this.errors = [];
    this.warnings = [];
  }

  /**
   * Test if required files exist
   */
  testFileExistence() {
    section('Testing File Existence');
    
    const requiredFiles = [
      'package.json',
      'package.runtime.json',
      'docs/CHANGELOG.md',
      '.github/workflows/release.yml',
      'scripts/sync-runtime-version.js',
      'scripts/publish-npm.sh'
    ];

    for (const file of requiredFiles) {
      const filePath = path.join(this.rootDir, file);
      if (fs.existsSync(filePath)) {
        success(`Found: ${file}`);
      } else {
        error(`Missing: ${file}`);
        this.errors.push(`Missing required file: ${file}`);
      }
    }
  }

  /**
   * Test version detection logic
   */
  testVersionDetection() {
    section('Testing Version Detection');
    
    try {
      const packageJson = require(path.join(this.rootDir, 'package.json'));
      const runtimeJson = require(path.join(this.rootDir, 'package.runtime.json'));
      
      success(`Package.json version: ${packageJson.version}`);
      success(`Runtime package version: ${runtimeJson.version}`);
      
      if (packageJson.version === runtimeJson.version) {
        success('Version sync: Both versions match');
      } else {
        warning('Version sync: Versions do not match - run sync:runtime-version');
        this.warnings.push('Package versions are not synchronized');
      }
      
      // Test semantic version format
      const semverRegex = /^\d+\.\d+\.\d+(?:-[\w\.-]+)?(?:\+[\w\.-]+)?$/;
      if (semverRegex.test(packageJson.version)) {
        success(`Version format: Valid semantic version (${packageJson.version})`);
      } else {
        error(`Version format: Invalid semantic version (${packageJson.version})`);
        this.errors.push('Invalid semantic version format');
      }
      
    } catch (err) {
      error(`Version detection failed: ${err.message}`);
      this.errors.push(`Version detection error: ${err.message}`);
    }
  }

  /**
   * Test changelog parsing
   */
  testChangelogParsing() {
    section('Testing Changelog Parsing');
    
    try {
      const changelogPath = path.join(this.rootDir, 'docs/CHANGELOG.md');
      
      if (!fs.existsSync(changelogPath)) {
        error('Changelog file not found');
        this.errors.push('Missing changelog file');
        return;
      }
      
      const changelogContent = fs.readFileSync(changelogPath, 'utf8');
      const packageJson = require(path.join(this.rootDir, 'package.json'));
      const currentVersion = packageJson.version;
      
      // Check if current version exists in changelog
      const versionRegex = new RegExp(`^## \\[${currentVersion.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]`, 'm');
      
      if (versionRegex.test(changelogContent)) {
        success(`Changelog entry found for version ${currentVersion}`);
        
        // Test extraction logic (simplified version of the GitHub Actions script)
        const lines = changelogContent.split('\n');
        let startIndex = -1;
        let endIndex = -1;
        
        for (let i = 0; i < lines.length; i++) {
          if (versionRegex.test(lines[i])) {
            startIndex = i;
            break;
          }
        }
        
        if (startIndex !== -1) {
          // Find the end of this version's section
          for (let i = startIndex + 1; i < lines.length; i++) {
            if (lines[i].startsWith('## [') && !lines[i].includes('Unreleased')) {
              endIndex = i;
              break;
            }
          }
          
          if (endIndex === -1) {
            endIndex = lines.length;
          }
          
          const sectionLines = lines.slice(startIndex + 1, endIndex);
          const contentLines = sectionLines.filter(line => line.trim() !== '');
          
          if (contentLines.length > 0) {
            success(`Changelog content extracted: ${contentLines.length} lines`);
            info(`Preview: ${contentLines[0].substring(0, 100)}...`);
          } else {
            warning('Changelog section appears to be empty');
            this.warnings.push(`Empty changelog section for version ${currentVersion}`);
          }
        }
        
      } else {
        warning(`No changelog entry found for current version ${currentVersion}`);
        this.warnings.push(`Missing changelog entry for version ${currentVersion}`);
      }
      
      // Check changelog format
      if (changelogContent.includes('## [Unreleased]')) {
        success('Changelog format: Contains Unreleased section');
      } else {
        warning('Changelog format: Missing Unreleased section');
      }
      
      if (changelogContent.includes('Keep a Changelog')) {
        success('Changelog format: Follows Keep a Changelog format');
      } else {
        warning('Changelog format: Does not reference Keep a Changelog');
      }
      
    } catch (err) {
      error(`Changelog parsing failed: ${err.message}`);
      this.errors.push(`Changelog parsing error: ${err.message}`);
    }
  }

  /**
   * Test build process
   */
  testBuildProcess() {
    section('Testing Build Process');
    
    try {
      // Check if dist directory exists
      const distPath = path.join(this.rootDir, 'dist');
      if (fs.existsSync(distPath)) {
        success('Build output: dist directory exists');
        
        // Check for key build files
        const keyFiles = [
          'dist/index.js',
          'dist/mcp/index.js',
          'dist/mcp/server.js'
        ];
        
        for (const file of keyFiles) {
          const filePath = path.join(this.rootDir, file);
          if (fs.existsSync(filePath)) {
            success(`Build file: ${file} exists`);
          } else {
            warning(`Build file: ${file} missing - run 'npm run build'`);
            this.warnings.push(`Missing build file: ${file}`);
          }
        }
        
      } else {
        warning('Build output: dist directory missing - run "npm run build"');
        this.warnings.push('Missing build output');
      }
      
      // Check database
      const dbPath = path.join(this.rootDir, 'data/nodes.db');
      if (fs.existsSync(dbPath)) {
        const stats = fs.statSync(dbPath);
        success(`Database: nodes.db exists (${Math.round(stats.size / 1024 / 1024)}MB)`);
      } else {
        warning('Database: nodes.db missing - run "npm run rebuild"');
        this.warnings.push('Missing database file');
      }
      
    } catch (err) {
      error(`Build process test failed: ${err.message}`);
      this.errors.push(`Build process error: ${err.message}`);
    }
  }

  /**
   * Test npm publish preparation
   */
  testNpmPublishPrep() {
    section('Testing NPM Publish Preparation');
    
    try {
      const packageJson = require(path.join(this.rootDir, 'package.json'));
      const runtimeJson = require(path.join(this.rootDir, 'package.runtime.json'));
      
      // Check package.json fields
      const requiredFields = ['name', 'version', 'description', 'main', 'bin'];
      for (const field of requiredFields) {
        if (packageJson[field]) {
          success(`Package field: ${field} is present`);
        } else {
          error(`Package field: ${field} is missing`);
          this.errors.push(`Missing package.json field: ${field}`);
        }
      }
      
      // Check runtime dependencies
      if (runtimeJson.dependencies) {
        const depCount = Object.keys(runtimeJson.dependencies).length;
        success(`Runtime dependencies: ${depCount} packages`);
        
        // List key dependencies
        const keyDeps = ['@modelcontextprotocol/sdk', 'express', 'sql.js'];
        for (const dep of keyDeps) {
          if (runtimeJson.dependencies[dep]) {
            success(`Key dependency: ${dep} (${runtimeJson.dependencies[dep]})`);
          } else {
            warning(`Key dependency: ${dep} is missing`);
            this.warnings.push(`Missing key dependency: ${dep}`);
          }
        }
        
      } else {
        error('Runtime package has no dependencies');
        this.errors.push('Missing runtime dependencies');
      }
      
      // Check files array
      if (packageJson.files && Array.isArray(packageJson.files)) {
        success(`Package files: ${packageJson.files.length} patterns specified`);
        info(`Files: ${packageJson.files.join(', ')}`);
      } else {
        warning('Package files: No files array specified');
        this.warnings.push('No files array in package.json');
      }
      
    } catch (err) {
      error(`NPM publish prep test failed: ${err.message}`);
      this.errors.push(`NPM publish prep error: ${err.message}`);
    }
  }

  /**
   * Test Docker configuration
   */
  testDockerConfig() {
    section('Testing Docker Configuration');
    
    try {
      const dockerfiles = ['Dockerfile', 'Dockerfile.railway'];
      
      for (const dockerfile of dockerfiles) {
        const dockerfilePath = path.join(this.rootDir, dockerfile);
        if (fs.existsSync(dockerfilePath)) {
          success(`Dockerfile: ${dockerfile} exists`);
          
          const content = fs.readFileSync(dockerfilePath, 'utf8');
          
          // Check for key instructions
          if (content.includes('FROM node:')) {
            success(`${dockerfile}: Uses Node.js base image`);
          } else {
            warning(`${dockerfile}: Does not use standard Node.js base image`);
          }
          
          if (content.includes('COPY dist')) {
            success(`${dockerfile}: Copies build output`);
          } else {
            warning(`${dockerfile}: May not copy build output correctly`);
          }
          
        } else {
          warning(`Dockerfile: ${dockerfile} not found`);
          this.warnings.push(`Missing Dockerfile: ${dockerfile}`);
        }
      }
      
      // Check docker-compose files
      const composeFiles = ['docker-compose.yml', 'docker-compose.n8n.yml'];
      for (const composeFile of composeFiles) {
        const composePath = path.join(this.rootDir, composeFile);
        if (fs.existsSync(composePath)) {
          success(`Docker Compose: ${composeFile} exists`);
        } else {
          info(`Docker Compose: ${composeFile} not found (optional)`);
        }
      }
      
    } catch (err) {
      error(`Docker config test failed: ${err.message}`);
      this.errors.push(`Docker config error: ${err.message}`);
    }
  }

  /**
   * Test workflow file syntax
   */
  testWorkflowSyntax() {
    section('Testing Workflow Syntax');
    
    try {
      const workflowPath = path.join(this.rootDir, '.github/workflows/release.yml');
      
      if (!fs.existsSync(workflowPath)) {
        error('Release workflow file not found');
        this.errors.push('Missing release workflow file');
        return;
      }
      
      const workflowContent = fs.readFileSync(workflowPath, 'utf8');
      
      // Basic YAML structure checks
      if (workflowContent.includes('name: Automated Release')) {
        success('Workflow: Has correct name');
      } else {
        warning('Workflow: Name may be incorrect');
      }
      
      if (workflowContent.includes('on:') && workflowContent.includes('push:')) {
        success('Workflow: Has push trigger');
      } else {
        error('Workflow: Missing push trigger');
        this.errors.push('Workflow missing push trigger');
      }
      
      if (workflowContent.includes('branches: [main]')) {
        success('Workflow: Configured for main branch');
      } else {
        warning('Workflow: May not be configured for main branch');
      }
      
      // Check for required jobs
      const requiredJobs = [
        'detect-version-change',
        'extract-changelog',
        'create-release',
        'publish-npm',
        'build-docker'
      ];
      
      for (const job of requiredJobs) {
        if (workflowContent.includes(`${job}:`)) {
          success(`Workflow job: ${job} defined`);
        } else {
          error(`Workflow job: ${job} missing`);
          this.errors.push(`Missing workflow job: ${job}`);
        }
      }
      
      // Check for npm Trusted Publisher (OIDC) configuration — scoped to the publish-npm job
      // Slice from "  publish-npm:" to the next job at the same indent (2 spaces, non-space char)
      const publishNpmMatch = workflowContent.match(/^ {2}publish-npm:\n([\s\S]*?)(?=^ {2}\S|\Z)/m);
      const publishNpmBlock = publishNpmMatch ? publishNpmMatch[1] : '';

      if (!publishNpmBlock) {
        error('Workflow: could not locate publish-npm job block for OIDC checks');
        this.errors.push('publish-npm job not found in workflow');
      } else {
        if (/\bid-token:\s*write\b/.test(publishNpmBlock)) {
          success('Workflow: publish-npm has id-token: write permission (OIDC)');
        } else {
          error('Workflow: publish-npm is missing id-token: write permission');
          this.errors.push('Trusted Publishing requires id-token: write on publish-npm job');
        }

        if (/\benvironment:\s*npm-publish\b/.test(publishNpmBlock)) {
          success('Workflow: publish-npm uses npm-publish environment');
        } else {
          error('Workflow: publish-npm is missing environment: npm-publish');
          this.errors.push('Trusted Publishing requires environment: npm-publish on publish-npm job');
        }
      }

      if (workflowContent.includes('${{ secrets.NPM_TOKEN }}')) {
        warning('Workflow: stale NPM_TOKEN reference found — Trusted Publishing makes this unnecessary');
        this.warnings.push('Remove ${{ secrets.NPM_TOKEN }} from workflow now that OIDC is used');
      }

      if (workflowContent.includes('${{ secrets.GITHUB_TOKEN }}')) {
        success('Workflow: GITHUB_TOKEN secret configured');
      } else {
        warning('Workflow: GITHUB_TOKEN secret may be missing');
      }
      
    } catch (err) {
      error(`Workflow syntax test failed: ${err.message}`);
      this.errors.push(`Workflow syntax error: ${err.message}`);
    }
  }

  /**
   * Test environment and dependencies
   */
  testEnvironment() {
    section('Testing Environment');
    
    try {
      // Check Node.js version
      const nodeVersion = process.version;
      success(`Node.js version: ${nodeVersion}`);
      
      // Check if npm is available
      try {
        const npmVersion = execSync('npm --version', { encoding: 'utf8', stdio: 'pipe' }).trim();
        success(`NPM version: ${npmVersion}`);
      } catch (err) {
        error('NPM not available');
        this.errors.push('NPM not available');
      }
      
      // Check if git is available
      try {
        const gitVersion = execSync('git --version', { encoding: 'utf8', stdio: 'pipe' }).trim();
        success(`Git available: ${gitVersion}`);
      } catch (err) {
        error('Git not available');
        this.errors.push('Git not available');
      }
      
      // Check if we're in a git repository
      try {
        execSync('git rev-parse --git-dir', { stdio: 'pipe' });
        success('Git repository: Detected');
        
        // Check current branch
        try {
          const branch = execSync('git branch --show-current', { encoding: 'utf8', stdio: 'pipe' }).trim();
          info(`Current branch: ${branch}`);
        } catch (err) {
          info('Could not determine current branch');
        }
        
      } catch (err) {
        warning('Not in a git repository');
        this.warnings.push('Not in a git repository');
      }
      
    } catch (err) {
      error(`Environment test failed: ${err.message}`);
      this.errors.push(`Environment error: ${err.message}`);
    }
  }

  /**
   * Run all tests
   */
  async runAllTests() {
    header('Release Automation Test Suite');
    
    info('Testing release automation components...');
    
    this.testFileExistence();
    this.testVersionDetection();
    this.testChangelogParsing();
    this.testBuildProcess();
    this.testNpmPublishPrep();
    this.testDockerConfig();
    this.testWorkflowSyntax();
    this.testEnvironment();
    
    // Summary
    header('Test Summary');
    
    if (this.errors.length === 0 && this.warnings.length === 0) {
      log('🎉 All tests passed! Release automation is ready.', 'green');
    } else {
      if (this.errors.length > 0) {
        log(`\n❌ ${this.errors.length} Error(s):`, 'red');
        this.errors.forEach(err => log(`   • ${err}`, 'red'));
      }
      
      if (this.warnings.length > 0) {
        log(`\n⚠️  ${this.warnings.length} Warning(s):`, 'yellow');
        this.warnings.forEach(warn => log(`   • ${warn}`, 'yellow'));
      }
      
      if (this.errors.length > 0) {
        log('\n🔧 Please fix the errors before running the release workflow.', 'red');
        process.exit(1);
      } else {
        log('\n✅ No critical errors found. Warnings should be reviewed but won\'t prevent releases.', 'yellow');
      }
    }
    
    // Next steps
    log('\n📋 Next Steps:', 'cyan');
    log('1. Ensure GitHub repository settings are configured:', 'cyan');
    log('   • Secrets: DOCKERHUB_USERNAME, DOCKERHUB_TOKEN', 'cyan');
    log('   • Environment "npm-publish" exists (Settings → Environments)', 'cyan');
    log('   • npm Trusted Publisher configured on npmjs.com (no NPM_TOKEN secret needed)', 'cyan');
    log('   • GITHUB_TOKEN is provided automatically', 'cyan');
    log('\n2. To trigger a release:', 'cyan');
    log('   • Update version in package.json', 'cyan');
    log('   • Update changelog in docs/CHANGELOG.md', 'cyan');
    log('   • Commit and push to main branch', 'cyan');
    log('\n3. Monitor the release workflow in GitHub Actions', 'cyan');
    
    return this.errors.length === 0;
  }
}

// Run the tests
if (require.main === module) {
  const tester = new ReleaseAutomationTester();
  tester.runAllTests().catch(err => {
    console.error('Test suite failed:', err);
    process.exit(1);
  });
}

module.exports = ReleaseAutomationTester;