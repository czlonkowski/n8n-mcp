#!/usr/bin/env tsx
/**
 * Cleanup Non-Test Workflows
 *
 * Deletes all workflows from the n8n test instance EXCEPT those
 * with "[TEST]" in the name. This helps keep the test instance
 * clean and prevents list endpoint pagination issues.
 *
 * Usage:
 *   npx tsx tests/integration/n8n-api/scripts/cleanup-non-test-workflows.ts
 *   npx tsx tests/integration/n8n-api/scripts/cleanup-non-test-workflows.ts --dry-run
 */

import { getN8nCredentials, validateCredentials } from '../utils/credentials';

const DRY_RUN = process.argv.includes('--dry-run');

interface Workflow {
  id: string;
  name: string;
  active: boolean;
}

async function fetchAllWorkflows(baseUrl: string, apiKey: string): Promise<Workflow[]> {
  const all: Workflow[] = [];
  let cursor: string | undefined;

  while (true) {
    const url = new URL('/api/v1/workflows', baseUrl);
    url.searchParams.set('limit', '100');
    if (cursor) url.searchParams.set('cursor', cursor);

    const res = await fetch(url.toString(), {
      headers: { 'X-N8N-API-KEY': apiKey }
    });

    if (!res.ok) {
      throw new Error(`Failed to list workflows: ${res.status} ${res.statusText}`);
    }

    const body = await res.json() as { data: Workflow[]; nextCursor?: string };
    all.push(...body.data);

    if (!body.nextCursor) break;
    cursor = body.nextCursor;
  }

  return all;
}

async function deleteWorkflow(baseUrl: string, apiKey: string, id: string): Promise<void> {
  const res = await fetch(`${baseUrl}/api/v1/workflows/${id}`, {
    method: 'DELETE',
    headers: { 'X-N8N-API-KEY': apiKey }
  });

  if (!res.ok) {
    throw new Error(`Failed to delete workflow ${id}: ${res.status} ${res.statusText}`);
  }
}

async function main() {
  const creds = getN8nCredentials();
  validateCredentials(creds);

  console.log(`n8n Instance: ${creds.url}`);
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE DELETE'}\n`);

  const workflows = await fetchAllWorkflows(creds.url, creds.apiKey);
  console.log(`Total workflows found: ${workflows.length}\n`);

  const toKeep = workflows.filter(w => w.name.includes('[TEST]'));
  const toDelete = workflows.filter(w => !w.name.includes('[TEST]'));

  console.log(`Keeping (${toKeep.length}):`);
  for (const w of toKeep) {
    console.log(`  ✅ ${w.id} - ${w.name}`);
  }

  console.log(`\nDeleting (${toDelete.length}):`);
  for (const w of toDelete) {
    console.log(`  🗑️  ${w.id} - ${w.name}${w.active ? ' (ACTIVE)' : ''}`);
  }

  if (DRY_RUN) {
    console.log('\nDry run complete. No workflows were deleted.');
    return;
  }

  if (toDelete.length === 0) {
    console.log('\nNothing to delete.');
    return;
  }

  console.log(`\nDeleting ${toDelete.length} workflows...`);
  let deleted = 0;
  let failed = 0;

  for (const w of toDelete) {
    try {
      await deleteWorkflow(creds.url, creds.apiKey, w.id);
      deleted++;
    } catch (err) {
      console.error(`  Failed to delete ${w.id} (${w.name}): ${err}`);
      failed++;
    }
  }

  console.log(`\nDone! Deleted: ${deleted}, Failed: ${failed}, Kept: ${toKeep.length}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
