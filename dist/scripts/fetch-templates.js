#!/usr/bin/env node
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchTemplates = fetchTemplates;
const database_adapter_1 = require("../database/database-adapter");
const template_service_1 = require("../templates/template-service");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const zlib = __importStar(require("zlib"));
const dotenv = __importStar(require("dotenv"));
dotenv.config();
function redactUrl(url) {
    if (!url)
        return '';
    try {
        const u = new URL(url);
        const port = u.port ? `:${u.port}` : '';
        return `${u.protocol}//${u.hostname}${port}${u.pathname}`;
    }
    catch {
        return '<redacted>';
    }
}
function extractNodeConfigs(templateId, templateName, templateViews, workflowCompressed, metadata) {
    try {
        const decompressed = zlib.gunzipSync(Buffer.from(workflowCompressed, 'base64'));
        const workflow = JSON.parse(decompressed.toString('utf-8'));
        const configs = [];
        for (const node of workflow.nodes || []) {
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
    }
    catch (error) {
        console.error(`Error extracting configs from template ${templateId}:`, error);
        return [];
    }
}
function detectExpressions(params) {
    if (!params)
        return false;
    const json = JSON.stringify(params);
    return json.includes('={{') || json.includes('$json') || json.includes('$node');
}
function insertAndRankConfigs(db, configs) {
    if (configs.length === 0) {
        console.log('No configs to insert');
        return;
    }
    const templateIds = [...new Set(configs.map(c => c.template_id))];
    const placeholders = templateIds.map(() => '?').join(',');
    db.prepare(`DELETE FROM template_node_configs WHERE template_id IN (${placeholders})`).run(...templateIds);
    const insertStmt = db.prepare(`
    INSERT INTO template_node_configs (
      node_type, template_id, template_name, template_views,
      node_name, parameters_json, credentials_json,
      has_credentials, has_expressions, complexity, use_cases
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
    for (const config of configs) {
        insertStmt.run(config.node_type, config.template_id, config.template_name, config.template_views, config.node_name, config.parameters_json, config.credentials_json, config.has_credentials, config.has_expressions, config.complexity, config.use_cases);
    }
    db.exec(`
    UPDATE template_node_configs
    SET rank = (
      SELECT COUNT(*) + 1
      FROM template_node_configs AS t2
      WHERE t2.node_type = template_node_configs.node_type
        AND t2.template_views > template_node_configs.template_views
    )
  `);
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
async function extractTemplateConfigs(db, service) {
    console.log('📦 Extracting node configurations from templates...');
    const repository = service.repository;
    const allTemplates = repository.getAllTemplates();
    const allConfigs = [];
    let configsExtracted = 0;
    for (const template of allTemplates) {
        if (template.workflow_json_compressed) {
            const metadata = template.metadata_json ? JSON.parse(template.metadata_json) : null;
            const configs = extractNodeConfigs(template.id, template.name, template.views, template.workflow_json_compressed, metadata);
            allConfigs.push(...configs);
            configsExtracted += configs.length;
        }
    }
    if (allConfigs.length > 0) {
        insertAndRankConfigs(db, allConfigs);
        const configStats = db.prepare(`
      SELECT
        COUNT(DISTINCT node_type) as node_types,
        COUNT(*) as total_configs,
        AVG(rank) as avg_rank
      FROM template_node_configs
    `).get();
        console.log(`📊 Node config stats:`);
        console.log(`   - Unique node types: ${configStats.node_types}`);
        console.log(`   - Total configs stored: ${configStats.total_configs}`);
        console.log(`   - Average rank: ${configStats.avg_rank?.toFixed(1) || 'N/A'}`);
    }
    else {
        console.log('⚠️  No node configurations extracted');
    }
}
async function fetchTemplates(mode = 'rebuild', generateMetadata = false, metadataOnly = false, extractOnly = false) {
    if (extractOnly) {
        console.log('📦 Extract-only mode: Extracting node configurations from existing templates...\n');
        const db = await (0, database_adapter_1.createDatabaseAdapter)('./data/nodes.db');
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
        }
        catch (error) {
            console.error('❌ Error checking/creating template_node_configs table:', error);
            if ('close' in db && typeof db.close === 'function') {
                db.close();
            }
            process.exit(1);
        }
        const service = new template_service_1.TemplateService(db);
        await extractTemplateConfigs(db, service);
        if ('close' in db && typeof db.close === 'function') {
            db.close();
        }
        return;
    }
    if (metadataOnly) {
        console.log('🤖 Metadata-only mode: Generating metadata for existing templates...\n');
        const useLocal = !!process.env.N8N_MCP_LLM_BASE_URL;
        if (!useLocal && !process.env.OPENAI_API_KEY) {
            console.error('❌ Set OPENAI_API_KEY (cloud) or N8N_MCP_LLM_BASE_URL (local OpenAI-compatible server)');
            process.exit(1);
        }
        const db = await (0, database_adapter_1.createDatabaseAdapter)('./data/nodes.db');
        const service = new template_service_1.TemplateService(db);
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
    const dataDir = './data';
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }
    const db = await (0, database_adapter_1.createDatabaseAdapter)('./data/nodes.db');
    if (mode === 'rebuild') {
        try {
            db.exec('DROP TABLE IF EXISTS templates');
            db.exec('DROP TABLE IF EXISTS templates_fts');
            console.log('🗑️  Dropped existing templates tables (rebuild mode)\n');
            const schema = fs.readFileSync(path.join(__dirname, '../../src/database/schema.sql'), 'utf8');
            db.exec(schema);
            console.log('📋 Applied database schema\n');
        }
        catch (error) {
            console.error('❌ Error setting up database schema:', error);
            throw error;
        }
    }
    else {
        console.log('📊 Update mode: Keeping existing templates and schema\n');
        try {
            const columns = db.prepare("PRAGMA table_info(templates)").all();
            const hasMetadataColumn = columns.some((col) => col.name === 'metadata_json');
            if (!hasMetadataColumn) {
                console.log('📋 Adding metadata columns to existing schema...');
                db.exec(`
          ALTER TABLE templates ADD COLUMN metadata_json TEXT;
          ALTER TABLE templates ADD COLUMN metadata_generated_at DATETIME;
        `);
                console.log('✅ Metadata columns added\n');
            }
        }
        catch (error) {
            console.log('📋 Schema is up to date\n');
        }
    }
    const service = new template_service_1.TemplateService(db);
    let lastMessage = '';
    const startTime = Date.now();
    try {
        await service.fetchAndUpdateTemplates((message, current, total) => {
            if (lastMessage) {
                process.stdout.write('\r' + ' '.repeat(lastMessage.length) + '\r');
            }
            const progress = total > 0 ? Math.round((current / total) * 100) : 0;
            lastMessage = `📊 ${message}: ${current}/${total} (${progress}%)`;
            process.stdout.write(lastMessage);
        }, mode);
        console.log('\n');
        const stats = await service.getTemplateStats();
        const elapsed = Math.round((Date.now() - startTime) / 1000);
        console.log('✅ Template fetch complete!\n');
        console.log('📈 Statistics:');
        console.log(`   - Total templates: ${stats.totalTemplates}`);
        console.log(`   - Average views: ${stats.averageViews}`);
        console.log(`   - Time elapsed: ${elapsed} seconds`);
        console.log('\n🔝 Top used nodes:');
        stats.topUsedNodes.forEach((node, index) => {
            console.log(`   ${index + 1}. ${node.node} (${node.count} templates)`);
        });
        console.log('');
        await extractTemplateConfigs(db, service);
        if (generateMetadata && (process.env.OPENAI_API_KEY || process.env.N8N_MCP_LLM_BASE_URL)) {
            console.log('\n🤖 Generating metadata for templates...');
            await generateTemplateMetadata(db, service);
        }
        else if (generateMetadata) {
            console.log('\n⚠️  Metadata generation requested but neither OPENAI_API_KEY nor N8N_MCP_LLM_BASE_URL set');
        }
    }
    catch (error) {
        console.error('\n❌ Error fetching templates:', error);
        process.exit(1);
    }
    if ('close' in db && typeof db.close === 'function') {
        db.close();
    }
}
async function generateTemplateMetadata(db, service) {
    try {
        const repository = service.repository;
        const useLocal = !!process.env.N8N_MCP_LLM_BASE_URL;
        const limit = parseInt(process.env.METADATA_LIMIT || '0');
        const templatesWithoutMetadata = limit > 0
            ? repository.getTemplatesWithoutMetadata(limit)
            : repository.getTemplatesWithoutMetadata(999999);
        if (templatesWithoutMetadata.length === 0) {
            console.log('✅ All templates already have metadata');
            return;
        }
        console.log(`Found ${templatesWithoutMetadata.length} templates without metadata`);
        let processor;
        if (useLocal) {
            const { SequentialMetadataProcessor } = await Promise.resolve().then(() => __importStar(require('../templates/sequential-processor')));
            const raw = process.env.N8N_MCP_LLM_CONCURRENCY;
            const parsed = raw ? parseInt(raw, 10) : NaN;
            const concurrency = Number.isFinite(parsed) && parsed > 0 ? parsed : 40;
            if (raw && concurrency !== parsed) {
                console.log(`⚠️  Invalid N8N_MCP_LLM_CONCURRENCY="${raw}" — falling back to ${concurrency}`);
            }
            console.log(`🏠 Local LLM mode: ${redactUrl(process.env.N8N_MCP_LLM_BASE_URL)} (concurrency ${concurrency})`);
            processor = new SequentialMetadataProcessor({
                baseURL: process.env.N8N_MCP_LLM_BASE_URL,
                apiKey: process.env.N8N_MCP_LLM_API_KEY || 'not-needed',
                model: process.env.N8N_MCP_LLM_MODEL || 'Qwen/Qwen3.5-9B',
                concurrency
            });
        }
        else {
            const { BatchProcessor } = await Promise.resolve().then(() => __importStar(require('../templates/batch-processor')));
            const batchSize = parseInt(process.env.OPENAI_BATCH_SIZE || '50');
            console.log(`Processing in batches of ${batchSize} templates each`);
            if (batchSize > 100) {
                console.log(`⚠️  Large batch size (${batchSize}) may take longer to process`);
                console.log(`   Consider using OPENAI_BATCH_SIZE=50 for faster results`);
            }
            processor = new BatchProcessor({
                apiKey: process.env.OPENAI_API_KEY,
                model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
                batchSize: batchSize,
                outputDir: './temp/batch'
            });
        }
        const requests = templatesWithoutMetadata.map((t) => {
            let workflow = undefined;
            try {
                if (t.workflow_json_compressed) {
                    const decompressed = zlib.gunzipSync(Buffer.from(t.workflow_json_compressed, 'base64'));
                    workflow = JSON.parse(decompressed.toString());
                }
                else if (t.workflow_json) {
                    workflow = JSON.parse(t.workflow_json);
                }
            }
            catch (error) {
                console.warn(`Failed to parse workflow for template ${t.id}:`, error);
            }
            let nodes = [];
            try {
                if (t.nodes_used) {
                    nodes = JSON.parse(t.nodes_used);
                    if (!Array.isArray(nodes)) {
                        console.warn(`Template ${t.id} has invalid nodes_used (not an array), using empty array`);
                        nodes = [];
                    }
                }
            }
            catch (error) {
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
        const results = await processor.processTemplates(requests, (message, current, total) => {
            process.stdout.write(`\r📊 ${message}: ${current}/${total}`);
        });
        console.log('\n');
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
        const stats = repository.getMetadataStats();
        console.log('\n📈 Metadata Statistics:');
        console.log(`   - Total templates: ${stats.total}`);
        console.log(`   - With metadata: ${stats.withMetadata}`);
        console.log(`   - Without metadata: ${stats.withoutMetadata}`);
        console.log(`   - Outdated (>30 days): ${stats.outdated}`);
    }
    catch (error) {
        console.error('\n❌ Error generating metadata:', error);
    }
}
function parseArgs() {
    const args = process.argv.slice(2);
    let mode = 'rebuild';
    let generateMetadata = false;
    let metadataOnly = false;
    let extractOnly = false;
    const modeIndex = args.findIndex(arg => arg.startsWith('--mode'));
    if (modeIndex !== -1) {
        const modeArg = args[modeIndex];
        const modeValue = modeArg.includes('=') ? modeArg.split('=')[1] : args[modeIndex + 1];
        if (modeValue === 'update') {
            mode = 'update';
        }
    }
    if (args.includes('--update')) {
        mode = 'update';
    }
    if (args.includes('--generate-metadata') || args.includes('--metadata')) {
        generateMetadata = true;
    }
    if (args.includes('--metadata-only')) {
        metadataOnly = true;
    }
    if (args.includes('--extract-only') || args.includes('--extract')) {
        extractOnly = true;
    }
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
if (require.main === module) {
    const { mode, generateMetadata, metadataOnly, extractOnly } = parseArgs();
    fetchTemplates(mode, generateMetadata, metadataOnly, extractOnly).catch(console.error);
}
//# sourceMappingURL=fetch-templates.js.map