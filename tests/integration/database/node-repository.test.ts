import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { NodeRepository } from '../../../src/database/node-repository';
import { DatabaseAdapter } from '../../../src/database/database-adapter';
import { TestDatabase, TestDataGenerator, MOCK_NODES, createTestDatabaseAdapter } from './test-utils';
import { ParsedNode } from '../../../src/parsers/node-parser';

describe('NodeRepository Integration Tests', () => {
  let testDb: TestDatabase;
  let db: Database.Database;
  let repository: NodeRepository;
  let adapter: DatabaseAdapter;

  beforeEach(async () => {
    testDb = new TestDatabase({ mode: 'memory' });
    db = await testDb.initialize();
    adapter = createTestDatabaseAdapter(db);
    repository = new NodeRepository(adapter);
  });

  afterEach(async () => {
    await testDb.cleanup();
  });

  describe('saveNode', () => {
    it('should save single node successfully', () => {
      const node = createParsedNode(MOCK_NODES.webhook);
      repository.saveNode(node);

      const saved = repository.getNode(node.nodeType);
      expect(saved).toBeTruthy();
      expect(saved.nodeType).toBe(node.nodeType);
      expect(saved.displayName).toBe(node.displayName);
    });

    it('should update existing nodes', () => {
      const node = createParsedNode(MOCK_NODES.webhook);
      
      // Save initial version
      repository.saveNode(node);
      
      // Update and save again
      const updated = { ...node, displayName: 'Updated Webhook' };
      repository.saveNode(updated);

      const saved = repository.getNode(node.nodeType);
      expect(saved?.displayName).toBe('Updated Webhook');
      
      // Should not create duplicate
      const count = repository.getNodeCount();
      expect(count).toBe(1);
    });

    it('should handle nodes with complex properties', () => {
      const complexNode: ParsedNode = {
        nodeType: 'n8n-nodes-base.complex',
        packageName: 'n8n-nodes-base',
        displayName: 'Complex Node',
        description: 'A complex node with many properties',
        category: 'automation',
        style: 'programmatic',
        isAITool: false,
        isTrigger: false,
        isWebhook: false,
        isVersioned: true,
        version: '1',
        documentation: 'Complex node documentation',
        properties: [
          {
            displayName: 'Resource',
            name: 'resource',
            type: 'options',
            options: [
              { name: 'User', value: 'user' },
              { name: 'Post', value: 'post' }
            ],
            default: 'user'
          },
          {
            displayName: 'Operation',
            name: 'operation',
            type: 'options',
            displayOptions: {
              show: {
                resource: ['user']
              }
            },
            options: [
              { name: 'Create', value: 'create' },
              { name: 'Get', value: 'get' }
            ]
          }
        ],
        operations: [
          { resource: 'user', operation: 'create' },
          { resource: 'user', operation: 'get' }
        ],
        credentials: [
          {
            name: 'httpBasicAuth',
            required: false
          }
        ]
      };

      repository.saveNode(complexNode);
      
      const saved = repository.getNode(complexNode.nodeType);
      expect(saved).toBeTruthy();
      expect(saved.properties).toHaveLength(2);
      expect(saved.credentials).toHaveLength(1);
      expect(saved.operations).toHaveLength(2);
    });

    it('should handle very large nodes', () => {
      const largeNode: ParsedNode = {
        nodeType: 'n8n-nodes-base.large',
        packageName: 'n8n-nodes-base',
        displayName: 'Large Node',
        description: 'A very large node',
        category: 'automation',
        style: 'programmatic',
        isAITool: false,
        isTrigger: false,
        isWebhook: false,
        isVersioned: true,
        version: '1',
        properties: Array.from({ length: 100 }, (_, i) => ({
          displayName: `Property ${i}`,
          name: `prop${i}`,
          type: 'string',
          default: ''
        })),
        operations: [],
        credentials: []
      };

      repository.saveNode(largeNode);
      
      const saved = repository.getNode(largeNode.nodeType);
      expect(saved?.properties).toHaveLength(100);
    });
  });

  describe('getNode', () => {
    beforeEach(() => {
      repository.saveNode(createParsedNode(MOCK_NODES.webhook));
      repository.saveNode(createParsedNode(MOCK_NODES.httpRequest));
    });

    it('should retrieve node by type', () => {
      const node = repository.getNode('n8n-nodes-base.webhook');
      expect(node).toBeTruthy();
      expect(node.displayName).toBe('Webhook');
      expect(node.nodeType).toBe('n8n-nodes-base.webhook');
      expect(node.package).toBe('n8n-nodes-base');
    });

    it('should return null for non-existent node', () => {
      const node = repository.getNode('n8n-nodes-base.nonExistent');
      expect(node).toBeNull();
    });

    it('should handle special characters in node types', () => {
      const specialNode: ParsedNode = {
        nodeType: 'n8n-nodes-base.special-chars_v2.node',
        packageName: 'n8n-nodes-base',
        displayName: 'Special Node',
        description: 'Node with special characters',
        category: 'automation',
        style: 'programmatic',
        isAITool: false,
        isTrigger: false,
        isWebhook: false,
        isVersioned: true,
        version: '2',
        properties: [],
        operations: [],
        credentials: []
      };
      
      repository.saveNode(specialNode);
      const retrieved = repository.getNode(specialNode.nodeType);
      expect(retrieved).toBeTruthy();
    });
  });

  describe('getAllNodes', () => {
    it('should return empty array when no nodes', () => {
      const nodes = repository.getAllNodes();
      expect(nodes).toHaveLength(0);
    });

    it('should return all nodes with limit', () => {
      const nodes = Array.from({ length: 20 }, (_, i) => 
        createParsedNode({
          ...MOCK_NODES.webhook,
          nodeType: `n8n-nodes-base.node${i}`,
          displayName: `Node ${i}`
        })
      );
      
      nodes.forEach(node => repository.saveNode(node));

      const retrieved = repository.getAllNodes(10);
      expect(retrieved).toHaveLength(10);
    });

    it('should return all nodes without limit', () => {
      const nodes = Array.from({ length: 20 }, (_, i) => 
        createParsedNode({
          ...MOCK_NODES.webhook,
          nodeType: `n8n-nodes-base.node${i}`,
          displayName: `Node ${i}`
        })
      );
      
      nodes.forEach(node => repository.saveNode(node));

      const retrieved = repository.getAllNodes();
      expect(retrieved).toHaveLength(20);
    });

    it('should handle very large result sets efficiently', () => {
      const nodes = Array.from({ length: 1000 }, (_, i) => 
        createParsedNode({
          ...MOCK_NODES.webhook,
          nodeType: `n8n-nodes-base.node${i}`,
          displayName: `Node ${i}`
        })
      );
      
      const insertMany = db.transaction((nodes: ParsedNode[]) => {
        nodes.forEach(node => repository.saveNode(node));
      });

      const start = Date.now();
      insertMany(nodes);
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(1000); // Should complete in under 1 second

      const retrieved = repository.getAllNodes();
      expect(retrieved).toHaveLength(1000);
    });
  });

  describe('getNodesByPackage', () => {
    beforeEach(() => {
      const nodes = [
        createParsedNode({ 
          ...MOCK_NODES.webhook,
          nodeType: 'n8n-nodes-base.node1',
          packageName: 'n8n-nodes-base'
        }),
        createParsedNode({ 
          ...MOCK_NODES.webhook,
          nodeType: 'n8n-nodes-base.node2',
          packageName: 'n8n-nodes-base' 
        }),
        createParsedNode({ 
          ...MOCK_NODES.webhook,
          nodeType: '@n8n/n8n-nodes-langchain.node3',
          packageName: '@n8n/n8n-nodes-langchain' 
        })
      ];
      nodes.forEach(node => repository.saveNode(node));
    });

    it('should filter nodes by package', () => {
      const baseNodes = repository.getNodesByPackage('n8n-nodes-base');
      expect(baseNodes).toHaveLength(2);

      const langchainNodes = repository.getNodesByPackage('@n8n/n8n-nodes-langchain');
      expect(langchainNodes).toHaveLength(1);
    });

    it('should return empty array for non-existent package', () => {
      const nodes = repository.getNodesByPackage('non-existent-package');
      expect(nodes).toHaveLength(0);
    });
  });

  describe('getNodesByCategory', () => {
    beforeEach(() => {
      const nodes = [
        createParsedNode({ 
          ...MOCK_NODES.webhook,
          nodeType: 'n8n-nodes-base.webhook',
          category: 'trigger'
        }),
        createParsedNode({ 
          ...MOCK_NODES.webhook,
          nodeType: 'n8n-nodes-base.schedule',
          displayName: 'Schedule',
          category: 'trigger'
        }),
        createParsedNode({ 
          ...MOCK_NODES.httpRequest,
          nodeType: 'n8n-nodes-base.httpRequest',
          category: 'automation'
        })
      ];
      nodes.forEach(node => repository.saveNode(node));
    });

    it('should filter nodes by category', () => {
      const triggers = repository.getNodesByCategory('trigger');
      expect(triggers).toHaveLength(2);
      expect(triggers.every(n => n.category === 'trigger')).toBe(true);

      const automation = repository.getNodesByCategory('automation');
      expect(automation).toHaveLength(1);
      expect(automation[0].category).toBe('automation');
    });
  });

  describe('searchNodes', () => {
    beforeEach(() => {
      const nodes = [
        createParsedNode({
          ...MOCK_NODES.webhook,
          description: 'Starts the workflow when webhook is called'
        }),
        createParsedNode({
          ...MOCK_NODES.httpRequest,
          description: 'Makes HTTP requests to external APIs'
        }),
        createParsedNode({
          nodeType: 'n8n-nodes-base.emailSend',
          packageName: 'n8n-nodes-base',
          displayName: 'Send Email',
          description: 'Sends emails via SMTP protocol',
          category: 'communication',
          developmentStyle: 'programmatic',
          isAITool: false,
          isTrigger: false,
          isWebhook: false,
          isVersioned: true,
          version: '1',
          properties: [],
          operations: [],
          credentials: []
        })
      ];
      nodes.forEach(node => repository.saveNode(node));
    });

    it('should search by node type', () => {
      const results = repository.searchNodes('webhook');
      expect(results).toHaveLength(1);
      expect(results[0].nodeType).toBe('n8n-nodes-base.webhook');
    });

    it('should search by display name', () => {
      const results = repository.searchNodes('Send Email');
      expect(results).toHaveLength(1);
      expect(results[0].nodeType).toBe('n8n-nodes-base.emailSend');
    });

    it('should search by description', () => {
      const results = repository.searchNodes('SMTP');
      expect(results).toHaveLength(1);
      expect(results[0].nodeType).toBe('n8n-nodes-base.emailSend');
    });

    it('should handle OR mode (default)', () => {
      const results = repository.searchNodes('webhook email', 'OR');
      expect(results).toHaveLength(2);
      const nodeTypes = results.map(r => r.nodeType);
      expect(nodeTypes).toContain('n8n-nodes-base.webhook');
      expect(nodeTypes).toContain('n8n-nodes-base.emailSend');
    });

    it('should handle AND mode', () => {
      const results = repository.searchNodes('HTTP request', 'AND');
      expect(results).toHaveLength(1);
      expect(results[0].nodeType).toBe('n8n-nodes-base.httpRequest');
    });

    it('should handle FUZZY mode', () => {
      const results = repository.searchNodes('HTT', 'FUZZY');
      expect(results).toHaveLength(1);
      expect(results[0].nodeType).toBe('n8n-nodes-base.httpRequest');
    });

    it('should handle case-insensitive search', () => {
      const results = repository.searchNodes('WEBHOOK');
      expect(results).toHaveLength(1);
      expect(results[0].nodeType).toBe('n8n-nodes-base.webhook');
    });

    it('should return empty array for no matches', () => {
      const results = repository.searchNodes('nonexistent');
      expect(results).toHaveLength(0);
    });

    it('should respect limit parameter', () => {
      // Add more nodes
      const nodes = Array.from({ length: 10 }, (_, i) => 
        createParsedNode({
          ...MOCK_NODES.webhook,
          nodeType: `n8n-nodes-base.test${i}`,
          displayName: `Test Node ${i}`,
          description: 'Test description'
        })
      );
      nodes.forEach(node => repository.saveNode(node));

      const results = repository.searchNodes('test', 'OR', 5);
      expect(results).toHaveLength(5);
    });
  });

  describe('getAITools', () => {
    it('should return only AI tool nodes', () => {
      const nodes = [
        createParsedNode({ 
          ...MOCK_NODES.webhook,
          nodeType: 'n8n-nodes-base.webhook',
          isAITool: false
        }),
        createParsedNode({ 
          ...MOCK_NODES.webhook,
          nodeType: '@n8n/n8n-nodes-langchain.agent',
          displayName: 'AI Agent',
          packageName: '@n8n/n8n-nodes-langchain',
          isAITool: true
        }),
        createParsedNode({ 
          ...MOCK_NODES.webhook,
          nodeType: '@n8n/n8n-nodes-langchain.tool',
          displayName: 'AI Tool',
          packageName: '@n8n/n8n-nodes-langchain',
          isAITool: true
        })
      ];
      
      nodes.forEach(node => repository.saveNode(node));

      const aiTools = repository.getAITools();
      expect(aiTools).toHaveLength(2);
      expect(aiTools.every(node => node.package.includes('langchain'))).toBe(true);
      expect(aiTools[0].displayName).toBe('AI Agent');
      expect(aiTools[1].displayName).toBe('AI Tool');
    });
  });

  describe('getNodeCount', () => {
    it('should return correct node count', () => {
      expect(repository.getNodeCount()).toBe(0);

      repository.saveNode(createParsedNode(MOCK_NODES.webhook));
      expect(repository.getNodeCount()).toBe(1);

      repository.saveNode(createParsedNode(MOCK_NODES.httpRequest));
      expect(repository.getNodeCount()).toBe(2);
    });
  });

  describe('community node set-diff', () => {
    // Exercises the generated NOT IN statement against a real SQLite engine —
    // the unit-level mock re-implements the predicate in JS (#967).
    const communityNode = (nodeType: string, isVerified = false): any => ({
      ...createParsedNode(MOCK_NODES.webhook),
      nodeType,
      isCommunity: true,
      isVerified,
      npmPackageName: 'n8n-nodes-multi',
    });

    beforeEach(() => {
      repository.saveNode(communityNode('n8n-nodes-multi.first'));
      repository.saveNode(communityNode('n8n-nodes-multi.second'));
      repository.saveNode(communityNode('n8n-nodes-multi.stale'));
      repository.saveNode(communityNode('n8n-nodes-multi.verified', true));
      repository.saveNode({
        ...createParsedNode(MOCK_NODES.httpRequest),
        isCommunity: true,
        isVerified: false,
        npmPackageName: 'n8n-nodes-other',
      });
    });

    it('should return every row of a package', () => {
      const nodes = repository.getNodesByNpmPackage('n8n-nodes-multi');

      expect(nodes.map((n: any) => n.nodeType)).toEqual([
        'n8n-nodes-multi.first',
        'n8n-nodes-multi.second',
        'n8n-nodes-multi.stale',
        'n8n-nodes-multi.verified',
      ]);
    });

    it('should delete only the unverified rows outside the keep set', () => {
      const removed = repository.deleteStaleCommunityNodes('n8n-nodes-multi', [
        'n8n-nodes-multi.first',
        'n8n-nodes-multi.second',
      ]);

      expect(removed).toBe(1);
      expect(repository.getNodesByNpmPackage('n8n-nodes-multi').map((n: any) => n.nodeType)).toEqual(
        ['n8n-nodes-multi.first', 'n8n-nodes-multi.second', 'n8n-nodes-multi.verified']
      );
      expect(repository.getNodesByNpmPackage('n8n-nodes-other')).toHaveLength(1);
    });

    it('should treat node types as data, not SQL', () => {
      const removed = repository.deleteStaleCommunityNodes('n8n-nodes-multi', [
        "n8n-nodes-multi.first'; DROP TABLE nodes; --",
      ]);

      expect(removed).toBe(3);
      expect(repository.getNodeCount()).toBe(2); // verified row + the other package
    });

    it('should no-op on an empty keep set', () => {
      const removed = repository.deleteStaleCommunityNodes('n8n-nodes-multi', []);

      expect(removed).toBe(0);
      expect(repository.getNodesByNpmPackage('n8n-nodes-multi')).toHaveLength(4);
    });
  });

  describe('searchNodeProperties', () => {
    beforeEach(() => {
      const node: ParsedNode = {
        nodeType: 'n8n-nodes-base.complex',
        packageName: 'n8n-nodes-base',
        displayName: 'Complex Node',
        description: 'A complex node',
        category: 'automation',
        style: 'programmatic',
        isAITool: false,
        isTrigger: false,
        isWebhook: false,
        isVersioned: true,
        version: '1',
        properties: [
          {
            displayName: 'Authentication',
            name: 'authentication',
            type: 'options',
            options: [
              { name: 'Basic', value: 'basic' },
              { name: 'OAuth2', value: 'oauth2' }
            ]
          },
          {
            displayName: 'Headers',
            name: 'headers',
            type: 'collection',
            default: {},
            options: [
              {
                displayName: 'Header',
                name: 'header',
                type: 'string'
              }
            ]
          }
        ],
        operations: [],
        credentials: []
      };
      repository.saveNode(node);
    });

    it('should find properties by name', () => {
      const results = repository.searchNodeProperties('n8n-nodes-base.complex', 'auth');
      expect(results.length).toBeGreaterThan(0);
      expect(results.some(r => r.path.includes('authentication'))).toBe(true);
    });

    it('should find nested properties', () => {
      const results = repository.searchNodeProperties('n8n-nodes-base.complex', 'header');
      expect(results.length).toBeGreaterThan(0);
    });

    it('should return empty array for non-existent node', () => {
      const results = repository.searchNodeProperties('non-existent', 'test');
      expect(results).toHaveLength(0);
    });
  });

  describe('Transaction handling', () => {
    it('should handle errors gracefully', () => {
      // Test with a node that violates database constraints
      const invalidNode = {
        nodeType: '', // Empty string should violate PRIMARY KEY constraint
        packageName: null, // NULL should violate NOT NULL constraint
        displayName: null, // NULL should violate NOT NULL constraint
        description: '',
        category: 'automation',
        style: 'programmatic',
        isAITool: false,
        isTrigger: false,
        isWebhook: false,
        isVersioned: false,
        version: '1',
        properties: [],
        operations: [],
        credentials: []
      } as any;

      expect(() => {
        repository.saveNode(invalidNode);
      }).toThrow();

      // Repository should still be functional
      const count = repository.getNodeCount();
      expect(count).toBe(0);
    });

    it('should handle concurrent saves', () => {
      const node = createParsedNode(MOCK_NODES.webhook);
      
      // Simulate concurrent saves of the same node with different display names
      const promises = Array.from({ length: 10 }, (_, i) => {
        const updatedNode = {
          ...node,
          displayName: `Display ${i}`
        };
        return Promise.resolve(repository.saveNode(updatedNode));
      });

      Promise.all(promises);

      // Should have only one node
      const count = repository.getNodeCount();
      expect(count).toBe(1);
      
      // Should have the last update
      const saved = repository.getNode(node.nodeType);
      expect(saved).toBeTruthy();
    });
  });

  describe('Performance characteristics', () => {
    it('should handle bulk operations efficiently', () => {
      const nodeCount = 1000;
      const nodes = Array.from({ length: nodeCount }, (_, i) => 
        createParsedNode({
          ...MOCK_NODES.webhook,
          nodeType: `n8n-nodes-base.node${i}`,
          displayName: `Node ${i}`,
          description: `Description for node ${i}`
        })
      );

      const insertMany = db.transaction((nodes: ParsedNode[]) => {
        nodes.forEach(node => repository.saveNode(node));
      });

      const start = Date.now();
      insertMany(nodes);
      const saveDuration = Date.now() - start;

      expect(saveDuration).toBeLessThan(1000); // Should complete in under 1 second

      // Test search performance
      const searchStart = Date.now();
      const results = repository.searchNodes('node', 'OR', 100);
      const searchDuration = Date.now() - searchStart;

      expect(searchDuration).toBeLessThan(50); // Search should be fast
      expect(results.length).toBe(100); // Respects limit
    });
  });
});

// Helper function to create ParsedNode from test data
function createParsedNode(data: any): ParsedNode {
  return {
    nodeType: data.nodeType,
    packageName: data.packageName,
    displayName: data.displayName,
    description: data.description || '',
    category: data.category || 'automation',
    style: data.developmentStyle || 'programmatic',
    isAITool: data.isAITool || false,
    isTrigger: data.isTrigger || false,
    isWebhook: data.isWebhook || false,
    isVersioned: data.isVersioned !== undefined ? data.isVersioned : true,
    version: data.version || '1',
    documentation: data.documentation || null,
    properties: data.properties || [],
    operations: data.operations || [],
    credentials: data.credentials || []
  };
}