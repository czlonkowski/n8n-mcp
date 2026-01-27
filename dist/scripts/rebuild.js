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
const database_adapter_1 = require("../database/database-adapter");
const node_loader_1 = require("../loaders/node-loader");
const node_parser_1 = require("../parsers/node-parser");
const docs_mapper_1 = require("../mappers/docs-mapper");
const node_repository_1 = require("../database/node-repository");
const tool_variant_generator_1 = require("../services/tool-variant-generator");
const template_sanitizer_1 = require("../utils/template-sanitizer");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
async function rebuild() {
    console.log('🔄 Rebuilding n8n node database...\n');
    const dbPath = process.env.NODE_DB_PATH || './data/nodes.db';
    const db = await (0, database_adapter_1.createDatabaseAdapter)(dbPath);
    const loader = new node_loader_1.N8nNodeLoader();
    const parser = new node_parser_1.NodeParser();
    const mapper = new docs_mapper_1.DocsMapper();
    const repository = new node_repository_1.NodeRepository(db);
    const toolVariantGenerator = new tool_variant_generator_1.ToolVariantGenerator();
    let schema = fs.readFileSync(path.join(__dirname, '../../src/database/schema.sql'), 'utf8');
    const fts5Supported = db.checkFTS5Support();
    if (!fts5Supported) {
        console.log('⚠️  FTS5 not supported (using sql.js fallback), skipping FTS5 tables and triggers');
        const lines = schema.split('\n');
        const filteredLines = [];
        let skipBlock = false;
        let blockType = '';
        for (const line of lines) {
            const lower = line.toLowerCase().trim();
            if (lower.includes('create virtual table') && lower.includes('fts5')) {
                skipBlock = true;
                blockType = 'virtual';
                continue;
            }
            if (lower.includes('create trigger') && lower.includes('nodes_fts')) {
                skipBlock = true;
                blockType = 'trigger';
                continue;
            }
            if (skipBlock && blockType === 'virtual' && lower.endsWith(');')) {
                skipBlock = false;
                blockType = '';
                continue;
            }
            if (skipBlock && blockType === 'trigger' && lower === 'end;') {
                skipBlock = false;
                blockType = '';
                continue;
            }
            if (lower.startsWith('--') && lower.includes('fts5')) {
                continue;
            }
            if (!skipBlock) {
                filteredLines.push(line);
            }
        }
        schema = filteredLines.join('\n');
    }
    try {
        db.exec(schema);
    }
    catch (err) {
        const errMsg = err.message;
        console.warn(`Schema execution error: ${errMsg}, trying statement-by-statement...`);
        const statements = schema.split(/;(?=\s*(?:--|CREATE|DROP|INSERT|UPDATE|DELETE|ALTER|$))/i);
        for (const stmt of statements) {
            const trimmed = stmt.trim();
            if (trimmed && !trimmed.startsWith('--')) {
                try {
                    db.exec(trimmed + ';');
                }
                catch (stmtErr) {
                    const stmtErrMsg = stmtErr.message;
                    if (!stmtErrMsg.includes('already exists')) {
                        console.warn(`Warning: Failed to execute statement: ${stmtErrMsg}`);
                    }
                }
            }
        }
    }
    db.exec('DELETE FROM nodes');
    console.log('🗑️  Cleared existing data\n');
    const nodes = await loader.loadAllNodes();
    console.log(`📦 Loaded ${nodes.length} nodes from packages\n`);
    const stats = {
        successful: 0,
        failed: 0,
        aiTools: 0,
        triggers: 0,
        webhooks: 0,
        withProperties: 0,
        withOperations: 0,
        withDocs: 0,
        toolVariants: 0
    };
    console.log('🔄 Processing nodes...');
    const processedNodes = [];
    for (const { packageName, nodeName, NodeClass } of nodes) {
        try {
            const parsed = parser.parse(NodeClass, packageName);
            if (!parsed.nodeType || !parsed.displayName) {
                throw new Error(`Missing required fields - nodeType: ${parsed.nodeType}, displayName: ${parsed.displayName}, packageName: ${parsed.packageName}`);
            }
            if (!parsed.packageName) {
                throw new Error(`Missing packageName for node ${nodeName}`);
            }
            const docs = await mapper.fetchDocumentation(parsed.nodeType);
            parsed.documentation = docs || undefined;
            if (parsed.isAITool && !parsed.isTrigger) {
                const toolVariant = toolVariantGenerator.generateToolVariant(parsed);
                if (toolVariant) {
                    parsed.hasToolVariant = true;
                    processedNodes.push({
                        parsed: toolVariant,
                        docs: undefined,
                        nodeName: `${nodeName}Tool`
                    });
                    stats.toolVariants++;
                }
            }
            processedNodes.push({ parsed, docs: docs || undefined, nodeName });
        }
        catch (error) {
            stats.failed++;
            const errorMessage = error.message;
            console.error(`❌ Failed to process ${nodeName}: ${errorMessage}`);
        }
    }
    console.log(`\n💾 Saving ${processedNodes.length} processed nodes to database...`);
    let saved = 0;
    for (const { parsed, docs, nodeName } of processedNodes) {
        try {
            repository.saveNode(parsed);
            saved++;
            stats.successful++;
            if (parsed.isAITool)
                stats.aiTools++;
            if (parsed.isTrigger)
                stats.triggers++;
            if (parsed.isWebhook)
                stats.webhooks++;
            if (parsed.properties.length > 0)
                stats.withProperties++;
            if (parsed.operations.length > 0)
                stats.withOperations++;
            if (docs)
                stats.withDocs++;
            console.log(`✅ ${parsed.nodeType} [Props: ${parsed.properties.length}, Ops: ${parsed.operations.length}]`);
        }
        catch (error) {
            stats.failed++;
            const errorMessage = error.message;
            console.error(`❌ Failed to save ${nodeName}: ${errorMessage}`);
        }
    }
    console.log(`💾 Save completed: ${saved} nodes saved successfully`);
    console.log('\n🔍 Running validation checks...');
    try {
        const validationResults = validateDatabase(repository);
        if (!validationResults.passed) {
            console.log('⚠️  Validation Issues:');
            validationResults.issues.forEach(issue => console.log(`   - ${issue}`));
        }
        else {
            console.log('✅ All validation checks passed');
        }
    }
    catch (validationError) {
        console.error('❌ Validation failed:', validationError.message);
        console.log('⚠️  Skipping validation due to database compatibility issues');
    }
    console.log('\n📊 Summary:');
    console.log(`   Total nodes: ${nodes.length}`);
    console.log(`   Successful: ${stats.successful}`);
    console.log(`   Failed: ${stats.failed}`);
    console.log(`   AI Tools: ${stats.aiTools}`);
    console.log(`   Tool Variants: ${stats.toolVariants}`);
    console.log(`   Triggers: ${stats.triggers}`);
    console.log(`   Webhooks: ${stats.webhooks}`);
    console.log(`   With Properties: ${stats.withProperties}`);
    console.log(`   With Operations: ${stats.withOperations}`);
    console.log(`   With Documentation: ${stats.withDocs}`);
    console.log('\n🧹 Checking for templates to sanitize...');
    const templateCount = db.prepare('SELECT COUNT(*) as count FROM templates').get();
    if (templateCount && templateCount.count > 0) {
        console.log(`   Found ${templateCount.count} templates, sanitizing...`);
        const sanitizer = new template_sanitizer_1.TemplateSanitizer();
        let sanitizedCount = 0;
        const templates = db.prepare('SELECT id, name, workflow_json FROM templates').all();
        for (const template of templates) {
            const originalWorkflow = JSON.parse(template.workflow_json);
            const { sanitized: sanitizedWorkflow, wasModified } = sanitizer.sanitizeWorkflow(originalWorkflow);
            if (wasModified) {
                const stmt = db.prepare('UPDATE templates SET workflow_json = ? WHERE id = ?');
                stmt.run(JSON.stringify(sanitizedWorkflow), template.id);
                sanitizedCount++;
                console.log(`   ✅ Sanitized template ${template.id}: ${template.name}`);
            }
        }
        console.log(`   Sanitization complete: ${sanitizedCount} templates cleaned`);
    }
    else {
        console.log('   No templates found in database');
    }
    console.log('\n✨ Rebuild complete!');
    db.close();
}
const MIN_EXPECTED_TOOL_VARIANTS = 200;
function validateDatabase(repository) {
    const issues = [];
    try {
        const db = repository.db;
        const nodeCount = db.prepare('SELECT COUNT(*) as count FROM nodes').get();
        if (nodeCount.count === 0) {
            issues.push('CRITICAL: Database is empty - no nodes found! Rebuild failed or was interrupted.');
            return { passed: false, issues };
        }
        if (nodeCount.count < 500) {
            issues.push(`WARNING: Only ${nodeCount.count} nodes found - expected at least 500 (both n8n packages)`);
        }
        const criticalNodes = ['nodes-base.httpRequest', 'nodes-base.code', 'nodes-base.webhook', 'nodes-base.slack'];
        for (const nodeType of criticalNodes) {
            const node = repository.getNode(nodeType);
            if (!node) {
                issues.push(`Critical node ${nodeType} not found`);
                continue;
            }
            if (node.properties.length === 0) {
                issues.push(`Node ${nodeType} has no properties`);
            }
        }
        const aiTools = repository.getAITools();
        if (aiTools.length === 0) {
            issues.push('No AI tools found - check detection logic');
        }
        const toolVariantCount = repository.getToolVariantCount();
        if (toolVariantCount === 0) {
            issues.push('No Tool variants found - check ToolVariantGenerator');
        }
        else if (toolVariantCount < MIN_EXPECTED_TOOL_VARIANTS) {
            issues.push(`Only ${toolVariantCount} Tool variants found - expected at least ${MIN_EXPECTED_TOOL_VARIANTS}`);
        }
        const fts5Supported = db.checkFTS5Support ? db.checkFTS5Support() : false;
        if (fts5Supported) {
            const ftsTableCheck = db.prepare(`
        SELECT name FROM sqlite_master
        WHERE type='table' AND name='nodes_fts'
      `).get();
            if (!ftsTableCheck) {
                issues.push('WARNING: FTS5 table (nodes_fts) does not exist - full-text searches will be slower');
            }
            else {
                const ftsCount = db.prepare('SELECT COUNT(*) as count FROM nodes_fts').get();
                if (ftsCount.count === 0) {
                    issues.push('WARNING: FTS5 index is empty - full-text searches will fall back to LIKE queries');
                }
                else if (nodeCount.count !== ftsCount.count) {
                    issues.push(`FTS5 index out of sync: ${nodeCount.count} nodes but ${ftsCount.count} FTS5 entries`);
                }
                const searchableNodes = ['webhook', 'merge', 'split'];
                for (const searchTerm of searchableNodes) {
                    const searchResult = db.prepare(`
            SELECT COUNT(*) as count FROM nodes_fts
            WHERE nodes_fts MATCH ?
          `).get(searchTerm);
                    if (searchResult.count === 0) {
                        issues.push(`WARNING: Search for "${searchTerm}" returns zero results in FTS5 index`);
                    }
                }
            }
        }
        else {
            console.log('ℹ️  FTS5 not supported - skipping FTS5 validation (searches will use LIKE queries)');
        }
    }
    catch (error) {
        const errorMessage = error.message;
        issues.push(`Validation error: ${errorMessage}`);
    }
    return {
        passed: issues.length === 0,
        issues
    };
}
if (require.main === module) {
    rebuild().catch(console.error);
}
//# sourceMappingURL=rebuild.js.map