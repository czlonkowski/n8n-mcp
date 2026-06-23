#!/usr/bin/env node
import { createDatabaseAdapter } from '../database/database-adapter';
import { TemplateService } from '../templates/template-service';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import * as dotenv from 'dotenv';
import type { MetadataRequest } from '../templates/metadata-generator';

// Load environment variables
dotenv.config();

/**
 * Redact userinfo and query parameters from a URL before logging — operators
 * sometimes embed bearer tokens or signed query params in N8N_MCP_LLM_BASE_URL.
 * Returns the input unchanged if it isn't a parseable URL.
 */
function redactUrl(url: string | undefined): string {
  if (!url) return '';
  try {
    const u = new URL(url);
    const port = u.port ? `:${u.port}` : '';
    return `${u.protocol}//${u.hostname}${port}${u.pathname}`;
  } catch {
    return '<redacted>';
  }
}

/**
 * Extract node configurations from a template workflow
 */
function extractNodeConfigs(
  templateId: number,
  templateName: string,
  templateViews: number,
  workflowCompressed: string,
  metadata: any
): Array<{
  node_type: string;
  template_id: number;
  template_name: string;
  template_views: number;
  node_name: string;
  parameters_json: string;
  credentials_json: string | null;
  has_credentials: number;
  has_expressions: number;
  complexity: string;
  use_cases: string;
}> {
  try {
    // Decompress workflow
    const decompressed = zlib.gunzipSync(Buffer.from(workflowCompressed, 'base64'));
    const workflow = JSON.parse(decompressed.toString('utf-8'));

    const configs: any[] = [];

    for (const node of workflow.nodes || []) {
      // Skip UI-only nodes (sticky notes, etc.)
      if (node.type.includes('stickyNote') || !node.parameters) {
        continue;
      }

      configs.push({
        node_type: node.type,
        template_id: templateId,
        template_name: templateName,
        template_views: templateViews,
        node_name: node.name,
        parameters_json: JSON.stringify(node.parameters),
        credentials_json: node.credentials ? JSON.stringify(node.credentials) : null,
        has_credentials: node.credentials ? 1 : 0,
        has_expressions: detectExpressions(node.parameters) ? 1 : 0,
        complexity: metadata?.complexity || 'medium',
        use_cases: JSON.stringify(metadata?.use_cases || [])
      });
    }

    return configs;
  } catch (error) {
    console.error(`Error extracting configs from template ${templateId}:`, error);
    return [];
  }
}

/**
 * Detect n8n expressions in parameters
 */
function detectExpressions(params: any): boolean {
  if (!params) return false;
  const json = JSON.stringify(params);
  return json.includes('={{') || json.includes('$json') || json.includes('$node');
}

/**
 * Insert extracted configs into database and rank them
 */
function insertAndRankConfigs(db: any, configs: any[]) {
  if (configs.length === 0) {
    console.log('No configs to insert');
    return;
  }

  // Clear old configs for these templates
  const templateIds = [...new Set(configs.map(c => c.template_id))];
  const placeholders = templateIds.map(() => '?').join(',');
  db.prepare(`DELETE FROM template_node_configs WHERE template_id IN (${placeholders})`).run(...templateIds);

  // Insert new configs
  const insertStmt = db.prepare(`
    INSERT INTO template_node_configs (
      node_type, template_id, template_name, template_views,
      node_name, parameters_json, credentials_json,
      has_credentials, has_expressions, complexity, use_cases
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const config of configs) {
    insertStmt.run(
      config.node_type,
      config.template_id,
      config.template_name,
      config.template_views,
      config.node_name,
      config.parameters_json,
      config.credentials_json,
      config.has_credentials,
      config.has_expressions,
      config.complexity,
      config.use_cases
    );
  }

  // Rank configs per node_type by template popularity
  db.exec(`
    UPDATE template_node_configs
    SET rank = (
      SELECT COUNT(*) + 1
      FROM template_node_configs AS t2
      WHERE t2.node_type = template_node_configs.node_type
        AND t2.template_views > template_node_configs.template_views
    )
  `);

  // Keep only top 10 per node_type
  db.exec(`
    DELETE FROM template_node_configs
    WHERE id NOT IN (
      SELECT id FROM template_node_configs
      WHERE rank <= 10
      ORDER BY node_type, rank
    )
  `);

  console.log(`✅ Extracted and ranked ${configs.length} node configurations`);
}

/**
 * Extract node configurations from existing templates
 */
async function extractTemplateConfigs(db: any, service: TemplateService) {
  console.log('📦 Extracting node configurations from templates...');
  const repository = (service as any).repository;
  const allTemplates = repository.getAllTemplates();

  const allConfigs: any[] = [];
  let configsExtracted = 0;

  for (const template of allTemplates) {
    if (template.workflow_json_compressed) {
      const metadata = template.metadata_json ? JSON.parse(template.metadata_json) : null;
      const configs = extractNodeConfigs(
        template.id,
        template.name,
        template.views,
        template.workflow_json_compressed,
        metadata
      );
      allConfigs.push(...configs);
      configsExtracted += configs.length;
    }
  }

  if (allConfigs.length > 0) {
    insertAndRankConfigs(db, allConfigs);

    // Show stats
    const configStats = db.prepare(`
      SELECT
        COUNT(DISTINCT node_type) as node_types,
        COUNT(*) as total_configs,
        AVG(rank) as avg_rank
      FROM template_node_configs
    `).get() as any;

    console.log(`📊 Node config stats:`);
    console.log(`   - Unique node types: ${configStats.node_types}`);
    console.log(`   - Total configs stored: ${configStats.total_configs}`);
    console.log(`   - Average rank: ${configStats.avg_rank?.toFixed(1) || 'N/A'}`);
  } else {
    console.log('⚠️  No node configurations extracted');
  }
}

async function fetchTemplates(
  mode: 'rebuild' | 'update' = 'rebuild',
  generateMetadata: boolean = false,
  metadataOnly: boolean = false,
  extractOnly: boolean = false
) {
  // If extract-only mode, skip template fetching and only extract configs
  if (extractOnly) {
    console.log('📦 Extract-only mode: Extracting node configurations from existing templates...\n');

    const db = await createDatabaseAdapter('./data/nodes.db');

    // Ensure template_node_configs table exists
    try {
      const tableExists = db.prepare(`
        SELECT name FROM sqlite_master
        WHERE type='table' AND name='template_node_configs'
      `).get();

      if (!tableExists) {
        console.log('📋 Creating template_node_configs table...');
        const migrationPath = path.join(__dirname, '../../src/database/migrations/add-template-node-configs.sql');
        const migration = fs.readFileSync(migrationPath, 'utf8');
        db.exec(migration);
        console.log('✅ Table created successfully\n');
      }
    } catch (error) {
      console.error('❌ Error checking/creating template_node_configs table:', error);
      if ('close' in db && typeof db.close === 'function') {
        db.close();
      }
      process.exit(1);
    }

    const service = new TemplateService(db);

    await extractTemplateConfigs(db, service);

    if ('close' in db && typeof db.close === 'function') {
      db.close();
    }
    return;
  }

  // If metadata-only mode, skip template fetching entirely
  if (metadataOnly) {
    console.log('🤖 Metadata-only mode: Generating metadata for existing templates...\n');

    const useLocal = !!process.env.N8N_MCP_LLM_BASE_URL;
    if (!useLocal && !process.env.OPENAI_API_KEY) {
      console.error('❌ Set OPENAI_API_KEY (cloud) or N8N_MCP_LLM_BASE_URL (local OpenAI-compatible server)');
      process.exit(1);
    }

    const db = await createDatabaseAdapter('./data/nodes.db');
    const service = new TemplateService(db);

    await generateTemplateMetadata(db, service);

    if ('close' in db && typeof db.close === 'function') {
      db.close();
    }
    return;
  }
  
  const modeEmoji = mode === 'rebuild' ? '🔄' : '⬆️';
  const modeText = mode === 'rebuild' ? 'Rebuilding' : 'Updating';
  console.log(`${modeEmoji} ${modeText} n8n workflow templates...\n`);
  
  if (generateMetadata) {
    const provider = process.env.N8N_MCP_LLM_BASE_URL ? `local (${redactUrl(process.env.N8N_MCP_LLM_BASE_URL)})` : 'OpenAI';
    console.log(`🤖 Metadata generation enabled (${provider})\n`);
  }
  
  // Ensure data directory exists
  const dataDir = './data';
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  
  // Initialize database
  const db = await createDatabaseAdapter('./data/nodes.db');
  
  // Handle database schema based on mode
  if (mode === 'rebuild') {
    try {
      // Drop existing tables in rebuild mode
      db.exec('DROP TABLE IF EXISTS templates');
      db.exec('DROP TABLE IF EXISTS templates_fts');
      console.log('🗑️  Dropped existing templates tables (rebuild mode)\n');
      
      // Apply fresh schema
      const schema = fs.readFileSync(path.join(__dirname, '../../src/database/schema.sql'), 'utf8');
      db.exec(schema);
      console.log('📋 Applied database schema\n');
    } catch (error) {
      console.error('❌ Error setting up database schema:', error);
      throw error;
    }
  } else {
    console.log('📊 Update mode: Keeping existing templates and schema\n');
    
    // In update mode, only ensure new columns exist (for migration)
    try {
      // Check if metadata columns exist, add them if not (migration support)
      const columns = db.prepare("PRAGMA table_info(templates)").all() as any[];
      const hasMetadataColumn = columns.some((col: any) => col.name === 'metadata_json');
      
      if (!hasMetadataColumn) {
        console.log('📋 Adding metadata columns to existing schema...');
        db.exec(`
          ALTER TABLE templates ADD COLUMN metadata_json TEXT;
          ALTER TABLE templates ADD COLUMN metadata_generated_at DATETIME;
        `);
        console.log('✅ Metadata columns added\n');
      }
    } catch (error) {
      // Columns might already exist, that's fine
      console.log('📋 Schema is up to date\n');
    }
  }
  
  // FTS5 initialization is handled by TemplateRepository
  // No need to duplicate the logic here
  
  // Create service
  const service = new TemplateService(db);
  
  // Progress tracking
  let lastMessage = '';
  const startTime = Date.now();
  
  try {
    await service.fetchAndUpdateTemplates((message, current, total) => {
      // Clear previous line
      if (lastMessage) {
        process.stdout.write('\r' + ' '.repeat(lastMessage.length) + '\r');
      }
      
      const progress = total > 0 ? Math.round((current / total) * 100) : 0;
      lastMessage = `📊 ${message}: ${current}/${total} (${progress}%)`;
      process.stdout.write(lastMessage);
    }, mode);  // Pass the mode parameter!
    
    console.log('\n'); // New line after progress
    
    // Get stats
    const stats = await service.getTemplateStats();
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    
    console.log('✅ Template fetch complete!\n');
    console.log('📈 Statistics:');
    console.log(`   - Total templates: ${stats.totalTemplates}`);
    console.log(`   - Average views: ${stats.averageViews}`);
    console.log(`   - Time elapsed: ${elapsed} seconds`);
    console.log('\n🔝 Top used nodes:');
    
    stats.topUsedNodes.forEach((node: any, index: number) => {
      console.log(`   ${index + 1}. ${node.node} (${node.count} templates)`);
    });

    // Extract node configurations from templates
    console.log('');
    await extractTemplateConfigs(db, service);

    // Generate metadata if requested
    if (generateMetadata && (process.env.OPENAI_API_KEY || process.env.N8N_MCP_LLM_BASE_URL)) {
      console.log('\n🤖 Generating metadata for templates...');
      await generateTemplateMetadata(db, service);
    } else if (generateMetadata) {
      console.log('\n⚠️  Metadata generation requested but neither OPENAI_API_KEY nor N8N_MCP_LLM_BASE_URL set');
    }

  } catch (error) {
    console.error('\n❌ Error fetching templates:', error);
    process.exit(1);
  }
  
  // Close database
  if ('close' in db && typeof db.close === 'function') {
    db.close();
  }
}

// Generate metadata for templates using OpenAI batch API or a local OpenAI-compatible server.
async function generateTemplateMetadata(db: any, service: TemplateService) {
  try {
    const repository = (service as any).repository;
    const useLocal = !!process.env.N8N_MCP_LLM_BASE_URL;

    // Get templates without metadata (0 = no limit)
    const limit = parseInt(process.env.METADATA_LIMIT || '0');
    const templatesWithoutMetadata = limit > 0
      ? repository.getTemplatesWithoutMetadata(limit)
      : repository.getTemplatesWithoutMetadata(999999); // Get all

    if (templatesWithoutMetadata.length === 0) {
      console.log('✅ All templates already have metadata');
      return;
    }

    console.log(`Found ${templatesWithoutMetadata.length} templates without metadata`);

    let processor: { processTemplates: (reqs: MetadataRequest[], cb?: any) => Promise<Map<number, any>> };

    if (useLocal) {
      const { SequentialMetadataProcessor } = await import('../templates/sequential-processor');
      const raw = process.env.N8N_MCP_LLM_CONCURRENCY;
      const parsed = raw ? parseInt(raw, 10) : NaN;
      const concurrency = Number.isFinite(parsed) && parsed > 0 ? parsed : 40;
      if (raw && concurrency !== parsed) {
        console.log(`⚠️  Invalid N8N_MCP_LLM_CONCURRENCY="${raw}" — falling back to ${concurrency}`);
      }
      console.log(`🏠 Local LLM mode: ${redactUrl(process.env.N8N_MCP_LLM_BASE_URL)} (concurrency ${concurrency})`);
      // OpenAI SDK requires a non-empty apiKey, so unset falls back to the
      // conventional 'not-needed' sentinel that vLLM/Ollama ignore. Anyone
      // running behind a gateway that validates Bearer tokens must set
      // N8N_MCP_LLM_API_KEY explicitly.
      processor = new SequentialMetadataProcessor({
        baseURL: process.env.N8N_MCP_LLM_BASE_URL!,
        apiKey: process.env.N8N_MCP_LLM_API_KEY || 'not-needed',
        model: process.env.N8N_MCP_LLM_MODEL || 'Qwen/Qwen3.5-9B',
        concurrency
      });
    } else {
      const { BatchProcessor } = await import('../templates/batch-processor');
      const batchSize = parseInt(process.env.OPENAI_BATCH_SIZE || '50');
      console.log(`Processing in batches of ${batchSize} templates each`);
      if (batchSize > 100) {
        console.log(`⚠️  Large batch size (${batchSize}) may take longer to process`);
        console.log(`   Consider using OPENAI_BATCH_SIZE=50 for faster results`);
      }
      processor = new BatchProcessor({
        apiKey: process.env.OPENAI_API_KEY!,
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        batchSize: batchSize,
        outputDir: './temp/batch'
      });
    }
    
    // Prepare metadata requests
    const requests: MetadataRequest[] = templatesWithoutMetadata.map((t: any) => {
      let workflow = undefined;
      try {
        if (t.workflow_json_compressed) {
          const decompressed = zlib.gunzipSync(Buffer.from(t.workflow_json_compressed, 'base64'));
          workflow = JSON.parse(decompressed.toString());
        } else if (t.workflow_json) {
          workflow = JSON.parse(t.workflow_json);
        }
      } catch (error) {
        console.warn(`Failed to parse workflow for template ${t.id}:`, error);
      }

      // Parse nodes_used safely
      let nodes: string[] = [];
      try {
        if (t.nodes_used) {
          nodes = JSON.parse(t.nodes_used);
          // Ensure it's an array
          if (!Array.isArray(nodes)) {
            console.warn(`Template ${t.id} has invalid nodes_used (not an array), using empty array`);
            nodes = [];
          }
        }
      } catch (error) {
        console.warn(`Failed to parse nodes_used for template ${t.id}:`, error);
        nodes = [];
      }

      return {
        templateId: t.id,
        name: t.name,
        description: t.description,
        nodes: nodes,
        workflow
      };
    });
    
    // Process in batches
    const results = await processor.processTemplates(requests, (message: string, current: number, total: number) => {
      process.stdout.write(`\r📊 ${message}: ${current}/${total}`);
    });
    
    console.log('\n');
    
    // Update database with metadata
    const metadataMap = new Map();
    for (const [templateId, result] of results) {
      if (!result.error) {
        metadataMap.set(templateId, result.metadata);
      }
    }
    
    if (metadataMap.size > 0) {
      repository.batchUpdateMetadata(metadataMap);
      console.log(`✅ Updated metadata for ${metadataMap.size} templates`);
    }
    
    // Show stats
    const stats = repository.getMetadataStats();
    console.log('\n📈 Metadata Statistics:');
    console.log(`   - Total templates: ${stats.total}`);
    console.log(`   - With metadata: ${stats.withMetadata}`);
    console.log(`   - Without metadata: ${stats.withoutMetadata}`);
    console.log(`   - Outdated (>30 days): ${stats.outdated}`);
  } catch (error) {
    console.error('\n❌ Error generating metadata:', error);
  }
}

// Parse command line arguments
function parseArgs(): { mode: 'rebuild' | 'update', generateMetadata: boolean, metadataOnly: boolean, extractOnly: boolean } {
  const args = process.argv.slice(2);

  let mode: 'rebuild' | 'update' = 'rebuild';
  let generateMetadata = false;
  let metadataOnly = false;
  let extractOnly = false;

  // Check for --mode flag
  const modeIndex = args.findIndex(arg => arg.startsWith('--mode'));
  if (modeIndex !== -1) {
    const modeArg = args[modeIndex];
    const modeValue = modeArg.includes('=') ? modeArg.split('=')[1] : args[modeIndex + 1];

    if (modeValue === 'update') {
      mode = 'update';
    }
  }

  // Check for --update flag as shorthand
  if (args.includes('--update')) {
    mode = 'update';
  }

  // Check for --generate-metadata flag
  if (args.includes('--generate-metadata') || args.includes('--metadata')) {
    generateMetadata = true;
  }

  // Check for --metadata-only flag
  if (args.includes('--metadata-only')) {
    metadataOnly = true;
  }

  // Check for --extract-only flag
  if (args.includes('--extract-only') || args.includes('--extract')) {
    extractOnly = true;
  }

  // Show help if requested
  if (args.includes('--help') || args.includes('-h')) {
    console.log('Usage: npm run fetch:templates [options]\n');
    console.log('Options:');
    console.log('  --mode=rebuild|update  Rebuild from scratch or update existing (default: rebuild)');
    console.log('  --update               Shorthand for --mode=update');
    console.log('  --generate-metadata    Generate AI metadata after fetching templates');
    console.log('  --metadata             Shorthand for --generate-metadata');
    console.log('  --metadata-only        Only generate metadata, skip template fetching');
    console.log('  --extract-only         Only extract node configs, skip template fetching');
    console.log('  --extract              Shorthand for --extract-only');
    console.log('  --help, -h             Show this help message');
    process.exit(0);
  }

  return { mode, generateMetadata, metadataOnly, extractOnly };
}

// Run if called directly
if (require.main === module) {
  const { mode, generateMetadata, metadataOnly, extractOnly } = parseArgs();
  fetchTemplates(mode, generateMetadata, metadataOnly, extractOnly).catch(console.error);
}

export { fetchTemplates };