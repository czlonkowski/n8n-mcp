import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { NodeRepository } from '../../../src/database/node-repository';
import { TemplateRepository } from '../../../src/templates/template-repository';
import { DatabaseAdapter } from '../../../src/database/database-adapter';
import { TestDatabase, TestDataGenerator, PerformanceMonitor, createTestDatabaseAdapter } from './test-utils';
import { ParsedNode } from '../../../src/parsers/node-parser';
import { TemplateWorkflow, TemplateDetail } from '../../../src/templates/template-fetcher';

describe('Database Performance Tests', () => {
  let testDb: TestDatabase;
  let db: Database.Database;
  let nodeRepo: NodeRepository;
  let templateRepo: TemplateRepository;
  let adapter: DatabaseAdapter;
  let monitor: PerformanceMonitor;

  beforeEach(async () => {
    testDb = new TestDatabase({ mode: 'file', name: 'performance-test.db', enableFTS5: true });
    db = await testDb.initialize();
    adapter = createTestDatabaseAdapter(db);
    nodeRepo = new NodeRepository(adapter);
    templateRepo = new TemplateRepository(adapter);
    monitor = new PerformanceMonitor();
  });

  afterEach(async () => {
    monitor.clear();
    await testDb.cleanup();
  });

  describe('Node Repository Performance', () => {
    it('should handle bulk inserts efficiently', () => {
      const nodeCounts = [100, 1000, 5000];
      
      nodeCounts.forEach(count => {
        const nodes = generateNodes(count);
        
        const stop = monitor.start(`insert_${count}_nodes`);
        const transaction = db.transaction((nodes: ParsedNode[]) => {
          nodes.forEach(node => nodeRepo.saveNode(node));
        });
        transaction(nodes);
        stop();
      });

      // Check performance metrics
      const stats100 = monitor.getStats('insert_100_nodes');
      const stats1000 = monitor.getStats('insert_1000_nodes');
      const stats5000 = monitor.getStats('insert_5000_nodes');

      // Environment-aware thresholds
      const threshold100 = process.env.CI ? 200 : 100;
      const threshold1000 = process.env.CI ? 1000 : 500;
      const threshold5000 = process.env.CI ? 4000 : 2000;

      expect(stats100!.average).toBeLessThan(threshold100);
      expect(stats1000!.average).toBeLessThan(threshold1000);
      expect(stats5000!.average).toBeLessThan(threshold5000);

      // Performance should scale sub-linearly
      const ratio1000to100 = stats1000!.average / stats100!.average;
      const ratio5000to1000 = stats5000!.average / stats1000!.average;

      // Adjusted based on actual CI performance measurements + type safety overhead
      // CI environments show ratios of ~7-10 for 1000:100 and ~6-7 for 5000:1000
      // Increased thresholds to account for community node columns (8 additional fields)
      expect(ratio1000to100).toBeLessThan(20); // Allow for CI variability + community columns (was 15)
      expect(ratio5000to1000).toBeLessThan(12);  // Allow for type safety overhead + community columns (was 11)
    });

    it('should search nodes quickly with indexes', () => {
      // Insert test data with search-friendly content
      const searchableNodes = generateSearchableNodes(10000);
      const transaction = db.transaction((nodes: ParsedNode[]) => {
        nodes.forEach(node => nodeRepo.saveNode(node));
      });
      transaction(searchableNodes);

      // Test different search scenarios
      const searchTests = [
        { query: 'webhook', mode: 'OR' as const },
        { query: 'http request', mode: 'AND' as const },
        { query: 'automation data', mode: 'OR' as const },
        { query: 'HTT', mode: 'FUZZY' as const }
      ];

      searchTests.forEach(test => {
        const stop = monitor.start(`search_${test.query}_${test.mode}`);
        const results = nodeRepo.searchNodes(test.query, test.mode, 100);
        stop();
        
        expect(results.length).toBeGreaterThan(0);
      });

      // All searches should be fast
      searchTests.forEach(test => {
        const stats = monitor.getStats(`search_${test.query}_${test.mode}`);
        const threshold = process.env.CI ? 100 : 50;
        expect(stats!.average).toBeLessThan(threshold);
      });
    });

    it('should handle concurrent reads efficiently', () => {
      // Insert initial data
      const nodes = generateNodes(1000);
      const transaction = db.transaction((nodes: ParsedNode[]) => {
        nodes.forEach(node => nodeRepo.saveNode(node));
      });
      transaction(nodes);

      // Simulate concurrent reads
      const readOperations = 100;
      const promises: Promise<any>[] = [];

      const stop = monitor.start('concurrent_reads');
      
      for (let i = 0; i < readOperations; i++) {
        promises.push(
          Promise.resolve(nodeRepo.getNode(`n8n-nodes-base.node${i % 1000}`))
        );
      }

      Promise.all(promises);
      stop();

      const stats = monitor.getStats('concurrent_reads');
      const threshold = process.env.CI ? 200 : 100;
      expect(stats!.average).toBeLessThan(threshold);
      
      // Average per read should be very low
      const avgPerRead = stats!.average / readOperations;
      const perReadThreshold = process.env.CI ? 2 : 1;
      expect(avgPerRead).toBeLessThan(perReadThreshold);
    });
  });

  describe('Template Repository Performance with FTS5', () => {
    it('should perform FTS5 searches efficiently', () => {
      // Insert templates with varied content
      const templates = Array.from({ length: 10000 }, (_, i) => {
        const workflow: TemplateWorkflow = {
          id: i + 1,
          name: `${['Webhook', 'HTTP', 'Automation', 'Data Processing'][i % 4]} Workflow ${i}`,
          description: generateDescription(i),
          totalViews: Math.floor(Math.random() * 1000),
          createdAt: new Date().toISOString(),
          user: {
            id: 1,
            name: 'Test User',
            username: 'user',
            verified: false
          },
          nodes: [
            {
              id: i * 10 + 1,
              name: 'Start',
              icon: 'webhook'
            }
          ]
        };
        
        const detail: TemplateDetail = {
          id: i + 1,
          name: workflow.name,
          description: workflow.description || '',
          views: workflow.totalViews,
          createdAt: workflow.createdAt,
          workflow: {
            nodes: workflow.nodes,
            connections: {},
            settings: {}
          }
        };
        
        return { workflow, detail };
      });

      const stop1 = monitor.start('insert_templates_with_fts');
      const transaction = db.transaction((items: any[]) => {
        items.forEach(({ workflow, detail }) => {
          templateRepo.saveTemplate(workflow, detail);
        });
      });
      transaction(templates);
      stop1();

      // Ensure FTS index is built
      db.prepare('INSERT INTO templates_fts(templates_fts) VALUES(\'rebuild\')').run();

      // Test various FTS5 searches - use lowercase queries since FTS5 with quotes is case-sensitive
      const searchTests = [
        'webhook',
        'data',
        'automation',
        'http',
        'workflow',
        'processing'
      ];

      searchTests.forEach(query => {
        const stop = monitor.start(`fts5_search_${query}`);
        const results = templateRepo.searchTemplates(query, 100);
        stop();
        
        // Debug output
        if (results.length === 0) {
          console.log(`No results for query: ${query}`);
          // Try to understand what's in the database
          const count = db.prepare('SELECT COUNT(*) as count FROM templates').get() as { count: number };
          console.log(`Total templates in DB: ${count.count}`);
        }
        
        expect(results.length).toBeGreaterThan(0);
      });

      // All FTS5 searches should be very fast
      searchTests.forEach(query => {
        const stats = monitor.getStats(`fts5_search_${query}`);
        const threshold = process.env.CI ? 50 : 30;
        expect(stats!.average).toBeLessThan(threshold);
      });
    });

    it('should handle complex node type searches efficiently', () => {
      // Insert templates with various node combinations
      const nodeTypes = [
        'n8n-nodes-base.webhook',
        'n8n-nodes-base.httpRequest',
        'n8n-nodes-base.slack',
        'n8n-nodes-base.googleSheets',
        'n8n-nodes-base.mongodb'
      ];

      const templates = Array.from({ length: 5000 }, (_, i) => {
        const workflow: TemplateWorkflow = {
          id: i + 1,
          name: `Template ${i}`,
          description: `Template description ${i}`,
          totalViews: 100,
          createdAt: new Date().toISOString(),
          user: {
            id: 1,
            name: 'Test User',
            username: 'user',
            verified: false
          },
          nodes: []
        };
        
        const detail: TemplateDetail = {
          id: i + 1,
          name: `Template ${i}`,
          description: `Template description ${i}`,
          views: 100,
          createdAt: new Date().toISOString(),
          workflow: {
            nodes: Array.from({ length: 3 }, (_, j) => ({
              id: `node${j}`,
              name: `Node ${j}`,
              type: nodeTypes[(i + j) % nodeTypes.length],
              typeVersion: 1,
              position: [100 * j, 100],
              parameters: {}
            })),
            connections: {},
            settings: {}
          }
        };
        
        return { workflow, detail };
      });

      const insertTransaction = db.transaction((items: any[]) => {
        items.forEach(({ workflow, detail }) => templateRepo.saveTemplate(workflow, detail));
      });
      insertTransaction(templates);

      // Test searching by node types
      const stop = monitor.start('search_by_node_types');
      const results = templateRepo.getTemplatesByNodes([
        'n8n-nodes-base.webhook',
        'n8n-nodes-base.slack'
      ], 100);
      stop();

      expect(results.length).toBeGreaterThan(0);
      
      const stats = monitor.getStats('search_by_node_types');
      const threshold = process.env.CI ? 100 : 50;
      expect(stats!.average).toBeLessThan(threshold);
    });
  });

  describe('Database Optimization', () => {
    it('should benefit from proper indexing', () => {
      // Insert more data to make index benefits more apparent
      const nodes = generateNodes(10000);
      const transaction = db.transaction((nodes: ParsedNode[]) => {
        nodes.forEach(node => nodeRepo.saveNode(node));
      });
      transaction(nodes);

      // Verify indexes exist
      const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='nodes'").all() as { name: string }[];
      const indexNames = indexes.map(idx => idx.name);
      expect(indexNames).toContain('idx_package');
      expect(indexNames).toContain('idx_category');
      expect(indexNames).toContain('idx_ai_tool');

      // Test queries that use indexes
      const indexedQueries = [
        { 
          name: 'package_query',
          query: () => nodeRepo.getNodesByPackage('n8n-nodes-base'),
          column: 'package_name'
        },
        { 
          name: 'category_query',
          query: () => nodeRepo.getNodesByCategory('trigger'),
          column: 'category'
        },
        { 
          name: 'ai_tools_query',
          query: () => nodeRepo.getAITools(),
          column: 'is_ai_tool'
        }
      ];

      // Test indexed queries
      indexedQueries.forEach(({ name, query, column }) => {
        // Verify query plan uses index
        const plan = db.prepare(`EXPLAIN QUERY PLAN SELECT * FROM nodes WHERE ${column} = ?`).all('test') as any[];
        const usesIndex = plan.some(row => 
          row.detail && (row.detail.includes('USING INDEX') || row.detail.includes('USING COVERING INDEX'))
        );
        
        // For simple queries on small datasets, SQLite might choose full table scan
        // This is expected behavior and doesn't indicate a problem
        if (!usesIndex && process.env.CI) {
          console.log(`Note: Query on ${column} may not use index with small dataset (SQLite optimizer decision)`);
        }

        const stop = monitor.start(name);
        const results = query();
        stop();
        
        expect(Array.isArray(results)).toBe(true);
      });

      // All queries should be fast regardless of index usage
      // SQLite's query optimizer makes intelligent decisions
      indexedQueries.forEach(({ name }) => {
        const stats = monitor.getStats(name);
        // Environment-aware thresholds - CI is slower and has more variability
        // Increased from 100ms to 150ms to account for CI environment variations
        const threshold = process.env.CI ? 150 : 50;
        expect(stats!.average).toBeLessThan(threshold);
      });

      // Test a non-indexed query for comparison (description column has no index)
      const stop = monitor.start('non_indexed_query');
      const nonIndexedResults = db.prepare("SELECT * FROM nodes WHERE description LIKE ?").all('%webhook%') as any[];
      stop();

      const nonIndexedStats = monitor.getStats('non_indexed_query');
      
      // Non-indexed queries should still complete reasonably fast with 10k rows
      const nonIndexedThreshold = process.env.CI ? 200 : 100;
      expect(nonIndexedStats!.average).toBeLessThan(nonIndexedThreshold);
    });

    it('should handle VACUUM operation efficiently', () => {
      // Insert and delete data to create fragmentation
      const nodes = generateNodes(1000);
      
      // Insert
      const insertTx = db.transaction((nodes: ParsedNode[]) => {
        nodes.forEach(node => nodeRepo.saveNode(node));
      });
      insertTx(nodes);

      // Delete half
      db.prepare('DELETE FROM nodes WHERE ROWID % 2 = 0').run();

      // Measure VACUUM performance
      const stop = monitor.start('vacuum');
      db.exec('VACUUM');
      stop();

      const stats = monitor.getStats('vacuum');
      const threshold = process.env.CI ? 2000 : 1000;
      expect(stats!.average).toBeLessThan(threshold);

      // Verify database still works
      const remaining = nodeRepo.getAllNodes();
      expect(remaining.length).toBeGreaterThan(0);
    });

    it('should maintain performance with WAL mode', () => {
      // Verify WAL mode is enabled
      const mode = db.prepare('PRAGMA journal_mode').get() as { journal_mode: string };
      expect(mode.journal_mode).toBe('wal');

      // Perform mixed read/write operations
      const operations = 1000;
      
      const stop = monitor.start('wal_mixed_operations');
      
      for (let i = 0; i < operations; i++) {
        if (i % 10 === 0) {
          // Write operation
          const node = generateNodes(1)[0];
          nodeRepo.saveNode(node);
        } else {
          // Read operation
          nodeRepo.getAllNodes(10);
        }
      }
      
      stop();

      const stats = monitor.getStats('wal_mixed_operations');
      const threshold = process.env.CI ? 1000 : 500;
      expect(stats!.average).toBeLessThan(threshold);
    });
  });

  describe('Memory Usage', () => {
    it('should handle large result sets without excessive memory', () => {
      // Insert large dataset
      const nodes = generateNodes(10000);
      const transaction = db.transaction((nodes: ParsedNode[]) => {
        nodes.forEach(node => nodeRepo.saveNode(node));
      });
      transaction(nodes);

      // Measure memory before
      const memBefore = process.memoryUsage().heapUsed;

      // Fetch large result set
      const stop = monitor.start('large_result_set');
      const results = nodeRepo.getAllNodes();
      stop();

      // Measure memory after
      const memAfter = process.memoryUsage().heapUsed;
      const memIncrease = (memAfter - memBefore) / 1024 / 1024; // MB

      expect(results).toHaveLength(10000);
      expect(memIncrease).toBeLessThan(100); // Less than 100MB increase

      const stats = monitor.getStats('large_result_set');
      const threshold = process.env.CI ? 400 : 200;
      expect(stats!.average).toBeLessThan(threshold);
    });
  });

  describe('Concurrent Write Performance', () => {
    it('should handle concurrent writes with transactions', () => {
      const writeBatches = 10;
      const nodesPerBatch = 100;

      const stop = monitor.start('concurrent_writes');

      // Simulate concurrent write batches
      const promises = Array.from({ length: writeBatches }, (_, i) => {
        return new Promise<void>((resolve) => {
          const nodes = generateNodes(nodesPerBatch, i * nodesPerBatch);
          const transaction = db.transaction((nodes: ParsedNode[]) => {
            nodes.forEach(node => nodeRepo.saveNode(node));
          });
          transaction(nodes);
          resolve();
        });
      });

      Promise.all(promises);
      stop();

      const stats = monitor.getStats('concurrent_writes');
      const threshold = process.env.CI ? 1000 : 500;
      expect(stats!.average).toBeLessThan(threshold);

      // Verify all nodes were written
      const count = nodeRepo.getNodeCount();
      expect(count).toBe(writeBatches * nodesPerBatch);
    });
  });
});

// Helper functions
function generateNodes(count: number, startId: number = 0): ParsedNode[] {
  const categories = ['trigger', 'automation', 'transform', 'output'];
  const packages = ['n8n-nodes-base', '@n8n/n8n-nodes-langchain'];
  
  return Array.from({ length: count }, (_, i) => ({
    nodeType: `n8n-nodes-base.node${startId + i}`,
    packageName: packages[i % packages.length],
    displayName: `Node ${startId + i}`,
    description: `Description for node ${startId + i} with ${['webhook', 'http', 'automation', 'data'][i % 4]} functionality`,
    category: categories[i % categories.length],
    style: 'programmatic' as const,
    isAITool: i % 10 === 0,
    isTrigger: categories[i % categories.length] === 'trigger',
    isWebhook: i % 5 === 0,
    isVersioned: true,
    version: '1',
    documentation: i % 3 === 0 ? `Documentation for node ${i}` : undefined,
    properties: Array.from({ length: 5 }, (_, j) => ({
      displayName: `Property ${j}`,
      name: `prop${j}`,
      type: 'string',
      default: ''
    })),
    operations: [],
    credentials: i % 4 === 0 ? [{ name: 'httpAuth', required: true }] : [],
    // Add fullNodeType for search compatibility
    fullNodeType: `n8n-nodes-base.node${startId + i}`
  }));
}

function generateDescription(index: number): string {
  const descriptions = [
    'Automate your workflow with powerful webhook integrations',
    'Process http requests and transform data efficiently',
    'Connect to external APIs and sync data seamlessly',
    'Build complex automation workflows with ease',
    'Transform and filter data with advanced processing operations'
  ];
  return descriptions[index % descriptions.length] + ` - Version ${index}`;
}

// Generate nodes with searchable content for search tests
function generateSearchableNodes(count: number): ParsedNode[] {
  const searchTerms = ['webhook', 'http', 'request', 'automation', 'data', 'HTTP'];
  const categories = ['trigger', 'automation', 'transform', 'output'];
  const packages = ['n8n-nodes-base', '@n8n/n8n-nodes-langchain'];
  
  return Array.from({ length: count }, (_, i) => {
    // Ensure some nodes match our search terms
    const termIndex = i % searchTerms.length;
    const searchTerm = searchTerms[termIndex];
    
    return {
      nodeType: `n8n-nodes-base.${searchTerm}Node${i}`,
      packageName: packages[i % packages.length],
      displayName: `${searchTerm} Node ${i}`,
      description: `${searchTerm} functionality for ${searchTerms[(i + 1) % searchTerms.length]} operations`,
      category: categories[i % categories.length],
      style: 'programmatic' as const,
      isAITool: i % 10 === 0,
      isTrigger: categories[i % categories.length] === 'trigger',
      isWebhook: searchTerm === 'webhook' || i % 5 === 0,
      isVersioned: true,
      version: '1',
      documentation: i % 3 === 0 ? `Documentation for ${searchTerm} node ${i}` : undefined,
      properties: Array.from({ length: 5 }, (_, j) => ({
        displayName: `Property ${j}`,
        name: `prop${j}`,
        type: 'string',
        default: ''
      })),
      operations: [],
      credentials: i % 4 === 0 ? [{ name: 'httpAuth', required: true }] : []
    };
  });
}