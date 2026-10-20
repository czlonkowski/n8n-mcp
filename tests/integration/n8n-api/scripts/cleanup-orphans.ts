#!/usr/bin/env tsx
/**
 * Cleanup Orphaned Test Resources
 *
 * Standalone script to clean up orphaned workflows and executions
 * from failed test runs. Run this periodically in CI or manually
 * to maintain a clean test environment.
 *
 * Usage:
 *   npm run test:cleanup:orphans
 *   tsx tests/integration/n8n-api/scripts/cleanup-orphans.ts
 */

import { cleanupAllTestResources } from '../utils/cleanup-helpers';
import { getN8nCredentials, validateCredentials } from '../utils/credentials';

async function main() {
  console.log('Starting cleanup of orphaned test resources...\n');

  try {
    // Validate credentials
    const creds = getN8nCredentials();
    validateCredentials(creds);

    console.log(`n8n Instance: ${creds.url}`);
    console.log(`Cleanup Tag: ${creds.cleanup.tag}`);
    console.log(`Cleanup Prefix: ${creds.cleanup.namePrefix}\n`);

    // Run cleanup. This script only runs when no test suite is live (manual
    // or scheduled CI invocation), so the age guard that protects the
    // globalSetup sweep from racing in-flight test files doesn't apply here
    // - disable it (minAgeMs: 0) so it also clears freshly-created leaks.
    const result = await cleanupAllTestResources({ minAgeMs: 0 });

    console.log('\n✅ Cleanup complete!');
    console.log(`   Workflows deleted: ${result.workflows}`);
    console.log(`   Executions deleted: ${result.executions}`);

    process.exit(0);
  } catch (error) {
    console.error('\n❌ Cleanup failed:', error);
    process.exit(1);
  }
}

main();
