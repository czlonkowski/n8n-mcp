#!/usr/bin/env node
/**
 * Fetch community nodes from n8n Strapi API and npm registry.
 *
 * Usage:
 *   npm run fetch:community              # Upsert all (preserves READMEs and AI summaries)
 *   npm run fetch:community:verified     # Verified nodes only (fast)
 *   npm run fetch:community:update       # Incremental update (skip existing)
 *
 * Options:
 *   --verified-only    Only fetch verified nodes from Strapi API
 *   --update           Skip nodes that already exist in database
 *   --rebuild          Delete all community nodes first (wipes READMEs/AI summaries!)
 *   --npm-limit=N      Maximum number of npm packages to fetch (default: 100)
 *   --staging          Use staging Strapi API instead of production
 */

import path from 'path';
import { CommunityNodeService, SyncOptions } from '../community';
import { NodeRepository } from '../database/node-repository';
import { createDatabaseAdapter } from '../database/database-adapter';

interface CliOptions {
  verifiedOnly: boolean;
  update: boolean;
  rebuild: boolean;
  npmLimit: number;
  staging: boolean;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);

  const options: CliOptions = {
    verifiedOnly: false,
    update: false,
    rebuild: false,
    npmLimit: 100,
    staging: false,
  };

  for (const arg of args) {
    if (arg === '--verified-only') {
      options.verifiedOnly = true;
    } else if (arg === '--update') {
      options.update = true;
    } else if (arg === '--rebuild') {
      options.rebuild = true;
    } else if (arg === '--staging') {
      options.staging = true;
    } else if (arg.startsWith('--npm-limit=')) {
      const value = parseInt(arg.split('=')[1], 10);
      if (!isNaN(value) && value > 0) {
        options.npmLimit = value;
      }
    }
  }

  return options;
}

function printProgress(message: string, current: number, total: number): void {
  const percent = total > 0 ? Math.round((current / total) * 100) : 0;
  const bar = '='.repeat(Math.floor(percent / 2)) + ' '.repeat(50 - Math.floor(percent / 2));
  process.stdout.write(`\r[${bar}] ${percent}% - ${message} (${current}/${total})`);
  if (current === total) {
    console.log(); // New line at completion
  }
}

async function main(): Promise<void> {
  const cliOptions = parseArgs();

  console.log('='.repeat(60));
  console.log('  n8n-mcp Community Node Fetcher');
  console.log('='.repeat(60));
  console.log();

  // Print options
  console.log('Options:');
  console.log(`  - Mode: ${cliOptions.rebuild ? 'Rebuild (clean slate)' : cliOptions.update ? 'Update (skip existing)' : 'Upsert (preserves docs)'}`);
  console.log(`  - Verified only: ${cliOptions.verifiedOnly ? 'Yes' : 'No'}`);
  if (!cliOptions.verifiedOnly) {
    console.log(`  - npm package limit: ${cliOptions.npmLimit}`);
  }
  console.log(`  - API environment: ${cliOptions.staging ? 'staging' : 'production'}`);
  console.log();

  // Initialize database
  const dbPath = path.join(__dirname, '../../data/nodes.db');
  console.log(`Database: ${dbPath}`);

  const db = await createDatabaseAdapter(dbPath);
  const repository = new NodeRepository(db);

  // Create service
  const environment = cliOptions.staging ? 'staging' : 'production';
  const service = new CommunityNodeService(repository, environment);

  // Only delete existing community nodes when --rebuild is explicitly requested
  if (cliOptions.rebuild) {
    console.log('\nClearing existing community nodes (--rebuild)...');
    console.log('  WARNING: This wipes READMEs and AI summaries!');
    const deleted = service.deleteCommunityNodes();
    console.log(`  Deleted ${deleted} existing community nodes`);
  }

  // Sync options
  const syncOptions: SyncOptions = {
    verifiedOnly: cliOptions.verifiedOnly,
    npmLimit: cliOptions.npmLimit,
    skipExisting: cliOptions.update,
    environment,
  };

  // Run sync
  console.log('\nFetching community nodes...\n');

  const result = await service.syncCommunityNodes(syncOptions, printProgress);

  // Print results
  console.log('\n' + '='.repeat(60));
  console.log('  Results');
  console.log('='.repeat(60));
  console.log();

  console.log('Verified nodes (Strapi API):');
  console.log(`  - Fetched: ${result.verified.fetched}`);
  console.log(`  - Saved: ${result.verified.saved}`);
  console.log(`  - Skipped: ${result.verified.skipped}`);
  if (result.verified.errors.length > 0) {
    console.log(`  - Errors: ${result.verified.errors.length}`);
    result.verified.errors.forEach((e) => console.log(`    ! ${e}`));
  }

  if (!cliOptions.verifiedOnly) {
    console.log('\nnpm packages:');
    console.log(`  - Fetched: ${result.npm.fetched}`);
    console.log(`  - Saved: ${result.npm.saved}`);
    console.log(`  - Skipped: ${result.npm.skipped}`);
    if (result.npm.errors.length > 0) {
      console.log(`  - Errors: ${result.npm.errors.length}`);
      result.npm.errors.forEach((e) => console.log(`    ! ${e}`));
    }
  }

  // Get final stats
  const stats = service.getCommunityStats();
  console.log('\nDatabase statistics:');
  console.log(`  - Total community nodes: ${stats.total}`);
  console.log(`  - Verified: ${stats.verified}`);
  console.log(`  - Unverified: ${stats.unverified}`);

  console.log(`\nCompleted in ${(result.duration / 1000).toFixed(1)} seconds`);
  console.log('='.repeat(60));

  // Close database
  db.close();
}

// Run
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
