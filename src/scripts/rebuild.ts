#!/usr/bin/env node
/**
 * Copyright (c) 2024 AiAdvisors Romuald Czlonkowski
 * Licensed under the Sustainable Use License v1.0
 */
import { createDatabaseAdapter } from '../database/database-adapter';
import { N8nNodeLoader } from '../loaders/node-loader';
import { NodeParser, ParsedNode } from '../parsers/node-parser';
import { DocsMapper } from '../mappers/docs-mapper';
import { NodeRepository } from '../database/node-repository';
import { ToolVariantGenerator } from '../services/tool-variant-generator';
import { TemplateSanitizer } from '../utils/template-sanitizer';
import * as fs from 'fs';
import * as path from 'path';

async function rebuild() {
  console.log('🔄 Rebuilding n8n node database...\n');
  
  const dbPath = process.env.NODE_DB_PATH || './data/nodes.db';
  const db = await createDatabaseAdapter(dbPath);
  const loader = new N8nNodeLoader();
  const parser = new NodeParser();
  const mapper = new DocsMapper();
  const repository = new NodeRepository(db);
  const toolVariantGenerator = new ToolVariantGenerator();
  
  // Initialize database
  let schema = fs.readFileSync(path.join(__dirname, '../../src/database/schema.sql'), 'utf8');

  // Check if FTS5 is supported
  const fts5Supported = db.checkFTS5Support();
  if (!fts5Supported) {
    console.log('⚠️  FTS5 not supported (using sql.js fallback), skipping FTS5 tables and triggers');
    // Remove FTS5-related statements line by line
    const lines = schema.split('\n');
    const filteredLines: string[] = [];
    let skipBlock = false;
    let blockType = '';

    for (const line of lines) {
      const lower = line.toLowerCase().trim();

      // Detect start of FTS5 virtual table
      if (lower.includes('create virtual table') && lower.includes('fts5')) {
        skipBlock = true;
        blockType = 'virtual';
        continue;
      }

      // Detect start of FTS5 trigger
      if (lower.includes('create trigger') && lower.includes('nodes_fts')) {
        skipBlock = true;
        blockType = 'trigger';
        continue;
      }

      // End of virtual table block (ends with );)
      if (skipBlock && blockType === 'virtual' && lower.endsWith(');')) {
        skipBlock = false;
        blockType = '';
        continue;
      }

      // End of trigger block (ends with end;)
      if (skipBlock && blockType === 'trigger' && lower === 'end;') {
        skipBlock = false;
        blockType = '';
        continue;
      }

      // Skip FTS5-related comment lines
      if (lower.startsWith('--') && lower.includes('fts5')) {
        continue;
      }

      // Include line if not in a skip block
      if (!skipBlock) {
        filteredLines.push(line);
      }
    }

    schema = filteredLines.join('\n');
  }

  // Execute schema
  try {
    db.exec(schema);
  } catch (err) {
    // If the exec fails, try executing statement by statement
    const errMsg = (err as Error).message;
    console.warn(`Schema execution error: ${errMsg}, trying statement-by-statement...`);

    const statements = schema.split(/;(?=\s*(?:--|CREATE|DROP|INSERT|UPDATE|DELETE|ALTER|$))/i);
    for (const stmt of statements) {
      const trimmed = stmt.trim();
      if (trimmed && !trimmed.startsWith('--')) {
        try {
          db.exec(trimmed + ';');
        } catch (stmtErr) {
          const stmtErrMsg = (stmtErr as Error).message;
          if (!stmtErrMsg.includes('already exists')) {
            console.warn(`Warning: Failed to execute statement: ${stmtErrMsg}`);
          }
        }
      }
    }
  }
  
  // Clear existing data
  db.exec('DELETE FROM nodes');
  console.log('🗑️  Cleared existing data\n');
  
  // Load all nodes
  const nodes = await loader.loadAllNodes();
  console.log(`📦 Loaded ${nodes.length} nodes from packages\n`);
  
  // Statistics
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
  
  // Process each node (documentation fetching must be outside transaction due to async)
  console.log('🔄 Processing nodes...');
  const processedNodes: Array<{ parsed: ParsedNode; docs: string | undefined; nodeName: string }> = [];
  
  for (const { packageName, nodeName, NodeClass } of nodes) {
    try {
      // Parse node
      const parsed = parser.parse(NodeClass, packageName);

      // Validate parsed data
      if (!parsed.nodeType || !parsed.displayName) {
        throw new Error(`Missing required fields - nodeType: ${parsed.nodeType}, displayName: ${parsed.displayName}, packageName: ${parsed.packageName}`);
      }

      // Additional validation for required fields
      if (!parsed.packageName) {
        throw new Error(`Missing packageName for node ${nodeName}`);
      }

      // Get documentation
      const docs = await mapper.fetchDocumentation(parsed.nodeType);
      parsed.documentation = docs || undefined;

      // Generate Tool variant for nodes with usableAsTool: true
      if (parsed.isAITool && !parsed.isTrigger) {
        const toolVariant = toolVariantGenerator.generateToolVariant(parsed);
        if (toolVariant) {
          // Mark base node as having a Tool variant
          parsed.hasToolVariant = true;

          // Add Tool variant to processed nodes
          processedNodes.push({
            parsed: toolVariant,
            docs: undefined, // Tool variants don't have separate docs
            nodeName: `${nodeName}Tool`
          });
          stats.toolVariants++;
        }
      }

      processedNodes.push({ parsed, docs: docs || undefined, nodeName });
    } catch (error) {
      stats.failed++;
      const errorMessage = (error as Error).message;
      console.error(`❌ Failed to process ${nodeName}: ${errorMessage}`);
    }
  }
  
  // Now save all processed nodes to database
  console.log(`\n💾 Saving ${processedNodes.length} processed nodes to database...`);
  
  let saved = 0;
  for (const { parsed, docs, nodeName } of processedNodes) {
    try {
      repository.saveNode(parsed);
      saved++;
      
      // Update statistics
      stats.successful++;
      if (parsed.isAITool) stats.aiTools++;
      if (parsed.isTrigger) stats.triggers++;
      if (parsed.isWebhook) stats.webhooks++;
      if (parsed.properties.length > 0) stats.withProperties++;
      if (parsed.operations.length > 0) stats.withOperations++;
      if (docs) stats.withDocs++;
      
      console.log(`✅ ${parsed.nodeType} [Props: ${parsed.properties.length}, Ops: ${parsed.operations.length}]`);
    } catch (error) {
      stats.failed++;
      const errorMessage = (error as Error).message;
      console.error(`❌ Failed to save ${nodeName}: ${errorMessage}`);
    }
  }
  
  console.log(`💾 Save completed: ${saved} nodes saved successfully`);
  
  // Validation check
  console.log('\n🔍 Running validation checks...');
  try {
    const validationResults = validateDatabase(repository);
    
    if (!validationResults.passed) {
      console.log('⚠️  Validation Issues:');
      validationResults.issues.forEach(issue => console.log(`   - ${issue}`));
    } else {
      console.log('✅ All validation checks passed');
    }
  } catch (validationError) {
    console.error('❌ Validation failed:', (validationError as Error).message);
    console.log('⚠️  Skipping validation due to database compatibility issues');
  }
  
  // Summary
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
  
  // Sanitize templates if they exist
  console.log('\n🧹 Checking for templates to sanitize...');
  const templateCount = db.prepare('SELECT COUNT(*) as count FROM templates').get() as { count: number };
  
  if (templateCount && templateCount.count > 0) {
    console.log(`   Found ${templateCount.count} templates, sanitizing...`);
    const sanitizer = new TemplateSanitizer();
    let sanitizedCount = 0;
    
    const templates = db.prepare('SELECT id, name, workflow_json FROM templates').all() as any[];
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
  } else {
    console.log('   No templates found in database');
  }
  
  console.log('\n✨ Rebuild complete!');
  
  db.close();
}

// Expected minimum based on n8n v1.123.4 AI-capable nodes
const MIN_EXPECTED_TOOL_VARIANTS = 200;

function validateDatabase(repository: NodeRepository): { passed: boolean; issues: string[] } {
  const issues = [];

  try {
    const db = (repository as any).db;

    // CRITICAL: Check if database has any nodes at all
    const nodeCount = db.prepare('SELECT COUNT(*) as count FROM nodes').get() as { count: number };
    if (nodeCount.count === 0) {
      issues.push('CRITICAL: Database is empty - no nodes found! Rebuild failed or was interrupted.');
      return { passed: false, issues };
    }

    // Check minimum expected node count (should have at least 500 nodes from both packages)
    if (nodeCount.count < 500) {
      issues.push(`WARNING: Only ${nodeCount.count} nodes found - expected at least 500 (both n8n packages)`);
    }

    // Check critical nodes
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

    // Check AI tools
    const aiTools = repository.getAITools();
    if (aiTools.length === 0) {
      issues.push('No AI tools found - check detection logic');
    }

    // Check Tool variants
    const toolVariantCount = repository.getToolVariantCount();
    if (toolVariantCount === 0) {
      issues.push('No Tool variants found - check ToolVariantGenerator');
    } else if (toolVariantCount < MIN_EXPECTED_TOOL_VARIANTS) {
      issues.push(`Only ${toolVariantCount} Tool variants found - expected at least ${MIN_EXPECTED_TOOL_VARIANTS}`);
    }

    // Check FTS5 table existence and population (only if FTS5 is supported)
    const fts5Supported = db.checkFTS5Support ? db.checkFTS5Support() : false;

    if (fts5Supported) {
      const ftsTableCheck = db.prepare(`
        SELECT name FROM sqlite_master
        WHERE type='table' AND name='nodes_fts'
      `).get();

      if (!ftsTableCheck) {
        issues.push('WARNING: FTS5 table (nodes_fts) does not exist - full-text searches will be slower');
      } else {
        // Check if FTS5 table is properly populated
        const ftsCount = db.prepare('SELECT COUNT(*) as count FROM nodes_fts').get() as { count: number };

        if (ftsCount.count === 0) {
          issues.push('WARNING: FTS5 index is empty - full-text searches will fall back to LIKE queries');
        } else if (nodeCount.count !== ftsCount.count) {
          issues.push(`FTS5 index out of sync: ${nodeCount.count} nodes but ${ftsCount.count} FTS5 entries`);
        }

        // Verify critical nodes are searchable via FTS5
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
    } else {
      console.log('ℹ️  FTS5 not supported - skipping FTS5 validation (searches will use LIKE queries)');
    }
  } catch (error) {
    // Catch any validation errors
    const errorMessage = (error as Error).message;
    issues.push(`Validation error: ${errorMessage}`);
  }

  return {
    passed: issues.length === 0,
    issues
  };
}

// Run if called directly
if (require.main === module) {
  rebuild().catch(console.error);
}