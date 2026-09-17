#!/usr/bin/env node
/**
 * CLI script for generating AI-powered documentation for community nodes.
 *
 * Usage:
 *   npm run generate:docs              # Full generation (README + AI summary)
 *   npm run generate:docs:readme-only  # Only fetch READMEs
 *   npm run generate:docs:summary-only # Only generate AI summaries
 *   npm run generate:docs:incremental  # Skip nodes with existing data
 *
 * Environment variables:
 *   N8N_MCP_LLM_PROVIDER  - Provider preset (e.g. minimax); sets base URL/model defaults
 *   N8N_MCP_LLM_REGION    - Region for the provider preset: global (default) or cn
 *   N8N_MCP_LLM_BASE_URL  - LLM server URL (default: http://localhost:1234/v1)
 *   N8N_MCP_LLM_MODEL     - LLM model name (default: qwen3-4b-thinking-2507)
 *   N8N_MCP_LLM_API_KEY   - LLM API key (falls back to preset key/OPENAI_API_KEY; default: 'not-needed')
 *   N8N_MCP_LLM_TIMEOUT   - Request timeout in ms (default: 60000)
 *   N8N_MCP_DB_PATH       - Database path (default: ./data/nodes.db)
 */

import path from 'path';
import { createDatabaseAdapter } from '../database/database-adapter';
import { NodeRepository } from '../database/node-repository';
import { CommunityNodeFetcher } from '../community/community-node-fetcher';
import {
  DocumentationBatchProcessor,
  BatchProcessorOptions,
} from '../community/documentation-batch-processor';
import { createDocumentationGenerator } from '../community/documentation-generator';

// Parse command line arguments
function parseArgs(): BatchProcessorOptions & { help?: boolean; stats?: boolean } {
  const args = process.argv.slice(2);
  const options: BatchProcessorOptions & { help?: boolean; stats?: boolean } = {};

  for (const arg of args) {
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--readme-only') {
      options.readmeOnly = true;
    } else if (arg === '--summary-only') {
      options.summaryOnly = true;
    } else if (arg === '--incremental' || arg === '-i') {
      options.skipExistingReadme = true;
      options.skipExistingSummary = true;
    } else if (arg === '--skip-existing-readme') {
      options.skipExistingReadme = true;
    } else if (arg === '--skip-existing-summary') {
      options.skipExistingSummary = true;
    } else if (arg === '--stats') {
      options.stats = true;
    } else if (arg.startsWith('--limit=')) {
      options.limit = parseInt(arg.split('=')[1], 10);
    } else if (arg.startsWith('--readme-concurrency=')) {
      options.readmeConcurrency = parseInt(arg.split('=')[1], 10);
    } else if (arg.startsWith('--llm-concurrency=')) {
      options.llmConcurrency = parseInt(arg.split('=')[1], 10);
    }
  }

  return options;
}

function printHelp(): void {
  console.log(`
============================================================
  n8n-mcp Community Node Documentation Generator
============================================================

Usage: npm run generate:docs [options]

Options:
  --help, -h              Show this help message
  --readme-only           Only fetch READMEs from npm (skip AI generation)
  --summary-only          Only generate AI summaries (requires existing READMEs)
  --incremental, -i       Skip nodes that already have data
  --skip-existing-readme  Skip nodes with existing READMEs
  --skip-existing-summary Skip nodes with existing AI summaries
  --stats                 Show documentation statistics only
  --limit=N               Process only N nodes (for testing)
  --readme-concurrency=N  Parallel npm requests (default: 5)
  --llm-concurrency=N     Parallel LLM requests (default: 3)

Environment Variables:
  N8N_MCP_LLM_PROVIDER    Provider preset (e.g. minimax); sets base URL/model defaults
  N8N_MCP_LLM_REGION      Region for the provider preset: global (default) or cn
  N8N_MCP_LLM_BASE_URL    LLM server URL (default: http://localhost:1234/v1)
  N8N_MCP_LLM_MODEL       LLM model name (default: qwen3-4b-thinking-2507)
  N8N_MCP_LLM_API_KEY     LLM API key (falls back to preset key/OPENAI_API_KEY; default: 'not-needed')
  N8N_MCP_LLM_TIMEOUT     Request timeout in ms (default: 60000)
  N8N_MCP_DB_PATH         Database path (default: ./data/nodes.db)

Examples:
  npm run generate:docs                    # Full generation
  npm run generate:docs -- --readme-only   # Only fetch READMEs
  npm run generate:docs -- --incremental   # Skip existing data
  npm run generate:docs -- --limit=10      # Process 10 nodes (testing)
  npm run generate:docs -- --stats         # Show current statistics
`);
}

function createProgressBar(current: number, total: number, width: number = 50): string {
  const percentage = total > 0 ? current / total : 0;
  const filled = Math.round(width * percentage);
  const empty = width - filled;
  const bar = '='.repeat(filled) + ' '.repeat(empty);
  const pct = Math.round(percentage * 100);
  return `[${bar}] ${pct}% - ${current}/${total}`;
}

async function main(): Promise<void> {
  const options = parseArgs();

  if (options.help) {
    printHelp();
    process.exit(0);
  }

  console.log('============================================================');
  console.log('  n8n-mcp Community Node Documentation Generator');
  console.log('============================================================\n');

  // Initialize database
  const dbPath = process.env.N8N_MCP_DB_PATH || path.join(process.cwd(), 'data', 'nodes.db');
  console.log(`Database: ${dbPath}`);

  const db = await createDatabaseAdapter(dbPath);
  const repository = new NodeRepository(db);
  const fetcher = new CommunityNodeFetcher();
  const generator = createDocumentationGenerator();

  const processor = new DocumentationBatchProcessor(repository, fetcher, generator);

  // Show current stats
  const stats = processor.getStats();
  console.log('\nCurrent Documentation Statistics:');
  console.log(`  Total community nodes: ${stats.total}`);
  console.log(`  With README: ${stats.withReadme} (${stats.needingReadme} need fetching)`);
  console.log(`  With AI summary: ${stats.withAISummary} (${stats.needingAISummary} need generation)`);

  if (options.stats) {
    console.log('\n============================================================');
    db.close();
    process.exit(0);
  }

  // Show configuration
  console.log('\nConfiguration:');
  console.log(`  LLM Base URL: ${process.env.N8N_MCP_LLM_BASE_URL || 'http://localhost:1234/v1'}`);
  console.log(`  LLM Model: ${process.env.N8N_MCP_LLM_MODEL || 'qwen3-4b-thinking-2507'}`);
  console.log(`  README concurrency: ${options.readmeConcurrency || 5}`);
  console.log(`  LLM concurrency: ${options.llmConcurrency || 3}`);
  if (options.limit) console.log(`  Limit: ${options.limit} nodes`);
  if (options.readmeOnly) console.log(`  Mode: README only`);
  if (options.summaryOnly) console.log(`  Mode: Summary only`);
  if (options.skipExistingReadme || options.skipExistingSummary) console.log(`  Mode: Incremental`);

  console.log('\n------------------------------------------------------------');
  console.log('Processing...\n');

  // Add progress callback
  let lastMessage = '';
  options.progressCallback = (message: string, current: number, total: number) => {
    const bar = createProgressBar(current, total);
    const fullMessage = `${bar} - ${message}`;
    if (fullMessage !== lastMessage) {
      process.stdout.write(`\r${fullMessage}`);
      lastMessage = fullMessage;
    }
  };

  // Run processing
  const result = await processor.processAll(options);

  // Clear progress line
  process.stdout.write('\r' + ' '.repeat(80) + '\r');

  // Show results
  console.log('\n============================================================');
  console.log('  Results');
  console.log('============================================================');

  if (!options.summaryOnly) {
    console.log(`\nREADME Fetching:`);
    console.log(`  Fetched: ${result.readmesFetched}`);
    console.log(`  Failed: ${result.readmesFailed}`);
  }

  if (!options.readmeOnly) {
    console.log(`\nAI Summary Generation:`);
    console.log(`  Generated: ${result.summariesGenerated}`);
    console.log(`  Failed: ${result.summariesFailed}`);
  }

  console.log(`\nSkipped: ${result.skipped}`);
  console.log(`Duration: ${result.durationSeconds.toFixed(1)}s`);

  if (result.errors.length > 0) {
    console.log(`\nErrors (${result.errors.length}):`);
    // Show first 10 errors
    for (const error of result.errors.slice(0, 10)) {
      console.log(`  - ${error}`);
    }
    if (result.errors.length > 10) {
      console.log(`  ... and ${result.errors.length - 10} more`);
    }
  }

  // Show final stats
  const finalStats = processor.getStats();
  console.log('\nFinal Documentation Statistics:');
  console.log(`  With README: ${finalStats.withReadme}/${finalStats.total}`);
  console.log(`  With AI summary: ${finalStats.withAISummary}/${finalStats.total}`);

  console.log('\n============================================================\n');

  db.close();

  // Exit with error code if there were failures
  if (result.readmesFailed > 0 || result.summariesFailed > 0) {
    process.exit(1);
  }
}

// Run main
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
