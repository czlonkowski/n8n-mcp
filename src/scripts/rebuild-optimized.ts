#!/usr/bin/env node
/**
 * Optimized rebuild script that extracts and stores source code at build time
 * This eliminates the need for n8n packages at runtime
 */
import { createDatabaseAdapter } from '../database/database-adapter';
import { N8nNodeLoader } from '../loaders/node-loader';
import { NodeParser } from '../parsers/node-parser';
import { DocsMapper } from '../mappers/docs-mapper';
import { NodeRepository } from '../database/node-repository';
import { assertCoreNodesPresent } from './core-node-check';
import * as fs from 'fs';
import * as path from 'path';

interface ExtractedSourceInfo {
  nodeSourceCode: string;
  credentialSourceCode?: string;
  sourceLocation: string;
}

async function extractNodeSource(NodeClass: any, packageName: string, nodeName: string): Promise<ExtractedSourceInfo> {
  try {
    // Multiple possible paths for node files
    const possiblePaths = [
      `${packageName}/dist/nodes/${nodeName}.node.js`,
      `${packageName}/dist/nodes/${nodeName}/${nodeName}.node.js`,
      `${packageName}/nodes/${nodeName}.node.js`,
      `${packageName}/nodes/${nodeName}/${nodeName}.node.js`
    ];
    
    let nodeFilePath: string | null = null;
    let nodeSourceCode = '// Source code not found';
    
    // Try each possible path
    for (const path of possiblePaths) {
      try {
        nodeFilePath = require.resolve(path);
        nodeSourceCode = await fs.promises.readFile(nodeFilePath, 'utf8');
        break;
      } catch (e) {
        // Continue to next path
      }
    }
    
    // If still not found, use NodeClass constructor source
    if (nodeSourceCode === '// Source code not found' && NodeClass.toString) {
      nodeSourceCode = `// Extracted from NodeClass\n${NodeClass.toString()}`;
      nodeFilePath = 'extracted-from-class';
    }
    
    // Try to find credential file
    let credentialSourceCode: string | undefined;
    try {
      const credName = nodeName.replace(/Node$/, '');
      const credentialPaths = [
        `${packageName}/dist/credentials/${credName}.credentials.js`,
        `${packageName}/dist/credentials/${credName}/${credName}.credentials.js`,
        `${packageName}/credentials/${credName}.credentials.js`
      ];
      
      for (const path of credentialPaths) {
        try {
          const credFilePath = require.resolve(path);
          credentialSourceCode = await fs.promises.readFile(credFilePath, 'utf8');
          break;
        } catch (e) {
          // Continue to next path
        }
      }
    } catch (error) {
      // Credential file not found, which is fine
    }
    
    return {
      nodeSourceCode,
      credentialSourceCode,
      sourceLocation: nodeFilePath || 'unknown'
    };
  } catch (error) {
    console.warn(`Could not extract source for ${nodeName}: ${(error as Error).message}`);
    return {
      nodeSourceCode: '// Source code extraction failed',
      sourceLocation: 'unknown'
    };
  }
}

async function rebuildOptimized() {
  console.log('🔄 Building optimized n8n node database with embedded source code...\n');
  
  const dbPath = process.env.BUILD_DB_PATH || './data/nodes.db';
  const db = await createDatabaseAdapter(dbPath);
  const loader = new N8nNodeLoader();
  const parser = new NodeParser();
  const mapper = new DocsMapper();
  const repository = new NodeRepository(db);
  
  // Initialize database with optimized schema
  const schemaPath = path.join(__dirname, '../../src/database/schema-optimized.sql');
  const schema = fs.readFileSync(schemaPath, 'utf8');
  db.exec(schema);
  
  // Clear existing data.
  // NOTE: unlike rebuild.ts, this optimized path uses schema-optimized.sql, which
  // has no is_community column and no community-node support — so there are no
  // community nodes to preserve here and a full wipe is correct.
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
    withSource: 0
  };
  
  // Process each node
  for (const { packageName, nodeName, NodeClass } of nodes) {
    try {
      // Parse node
      const parsed = parser.parse(NodeClass, packageName);
      
      // Validate parsed data
      if (!parsed.nodeType || !parsed.displayName) {
        throw new Error('Missing required fields');
      }
      
      // Get documentation
      const docs = await mapper.fetchDocumentation(parsed.nodeType);
      parsed.documentation = docs || undefined;
      
      // Extract source code at build time
      console.log(`📄 Extracting source code for ${parsed.nodeType}...`);
      const sourceInfo = await extractNodeSource(NodeClass, packageName, nodeName);
      
      // Prepare the full node data with source code
      const nodeData = {
        ...parsed,
        developmentStyle: parsed.style, // Map 'style' to 'developmentStyle'
        credentialsRequired: parsed.credentials || [], // Map 'credentials' to 'credentialsRequired'
        nodeSourceCode: sourceInfo.nodeSourceCode,
        credentialSourceCode: sourceInfo.credentialSourceCode,
        sourceLocation: sourceInfo.sourceLocation,
        sourceExtractedAt: new Date().toISOString()
      };
      
      // Save to database with source code
      const stmt = db.prepare(`
        INSERT INTO nodes (
          node_type, package_name, display_name, description, category,
          development_style, is_ai_tool, is_trigger, is_webhook, is_versioned,
          version, documentation, properties_schema, operations, credentials_required,
          node_source_code, credential_source_code, source_location, source_extracted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      
      stmt.run(
        nodeData.nodeType,
        nodeData.packageName,
        nodeData.displayName,
        nodeData.description,
        nodeData.category,
        nodeData.developmentStyle,
        nodeData.isAITool ? 1 : 0,
        nodeData.isTrigger ? 1 : 0,
        nodeData.isWebhook ? 1 : 0,
        nodeData.isVersioned ? 1 : 0,
        nodeData.version,
        nodeData.documentation,
        JSON.stringify(nodeData.properties),
        JSON.stringify(nodeData.operations),
        JSON.stringify(nodeData.credentialsRequired),
        nodeData.nodeSourceCode,
        nodeData.credentialSourceCode,
        nodeData.sourceLocation,
        nodeData.sourceExtractedAt
      );
      
      // Update statistics
      stats.successful++;
      if (parsed.isAITool) stats.aiTools++;
      if (parsed.isTrigger) stats.triggers++;
      if (parsed.isWebhook) stats.webhooks++;
      if (parsed.properties.length > 0) stats.withProperties++;
      if (parsed.operations.length > 0) stats.withOperations++;
      if (docs) stats.withDocs++;
      if (sourceInfo.nodeSourceCode !== '// Source code extraction failed') stats.withSource++;
      
      console.log(`✅ ${parsed.nodeType} [Props: ${parsed.properties.length}, Ops: ${parsed.operations.length}, Source: ${sourceInfo.nodeSourceCode.length} bytes]`);
    } catch (error) {
      stats.failed++;
      console.error(`❌ Failed to process ${nodeName}: ${(error as Error).message}`);
    }
  }
  
  // Create FTS index
  console.log('\n🔍 Building full-text search index...');
  db.exec('INSERT INTO nodes_fts(nodes_fts) VALUES("rebuild")');

  // Hard completeness gate: every canonical core node must exist after a
  // rebuild (raw lookup — the optimized schema differs from NodeRepository's).
  console.log('\n🧩 Checking core node completeness...');
  try {
    assertCoreNodesPresent({
      getNode: (nodeType: string) =>
        db.prepare('SELECT node_type FROM nodes WHERE node_type = ?').get(nodeType)
    });
    console.log('✅ All canonical core nodes present');
  } catch (error) {
    console.error(`❌ ${(error as Error).message}`);
    db.close();
    process.exit(1);
  }

  // Summary
  console.log('\n📊 Summary:');
  console.log(`   Total nodes: ${nodes.length}`);
  console.log(`   Successful: ${stats.successful}`);
  console.log(`   Failed: ${stats.failed}`);
  console.log(`   AI Tools: ${stats.aiTools}`);
  console.log(`   Triggers: ${stats.triggers}`);
  console.log(`   Webhooks: ${stats.webhooks}`);
  console.log(`   With Properties: ${stats.withProperties}`);
  console.log(`   With Operations: ${stats.withOperations}`);
  console.log(`   With Documentation: ${stats.withDocs}`);
  console.log(`   With Source Code: ${stats.withSource}`);
  
  // Database size check
  const dbStats = db.prepare('SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size()').get();
  console.log(`\n💾 Database size: ${(dbStats.size / 1024 / 1024).toFixed(2)} MB`);
  
  console.log('\n✨ Optimized rebuild complete!');
  
  db.close();
}

// Run if called directly
if (require.main === module) {
  rebuildOptimized().catch(error => {
    console.error(error);
    process.exit(1);
  });
}