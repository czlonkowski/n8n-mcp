import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NodeRepository } from '@/database/node-repository';
import { DatabaseAdapter, PreparedStatement, RunResult } from '@/database/database-adapter';

// Mock DatabaseAdapter for testing the new operation methods
class MockDatabaseAdapter implements DatabaseAdapter {
  private statements = new Map<string, MockPreparedStatement>();
  private mockNodes = new Map<string, any>();

  prepare = vi.fn((sql: string) => {
    if (!this.statements.has(sql)) {
      this.statements.set(sql, new MockPreparedStatement(sql, this.mockNodes));
    }
    return this.statements.get(sql)!;
  });

  exec = vi.fn();
  close = vi.fn();
  pragma = vi.fn();
  transaction = vi.fn((fn: () => any) => fn());
  checkFTS5Support = vi.fn(() => true);
  inTransaction = false;

  // Test helper to set mock data
  _setMockNode(nodeType: string, value: any) {
    this.mockNodes.set(nodeType, value);
  }
}

class MockPreparedStatement implements PreparedStatement {
  run = vi.fn((...params: any[]): RunResult => ({ changes: 1, lastInsertRowid: 1 }));
  get = vi.fn();
  all = vi.fn((..._params: any[]): any[] => []);
  iterate = vi.fn();
  pluck = vi.fn(() => this);
  expand = vi.fn(() => this);
  raw = vi.fn(() => this);
  columns = vi.fn((..._params: any[]): any[] => []);
  bind = vi.fn(() => this);

  constructor(private sql: string, private mockNodes: Map<string, any>) {
    // Configure get() to return node data
    if (sql.includes('SELECT * FROM nodes WHERE node_type = ?')) {
      this.get = vi.fn((nodeType: string) => this.mockNodes.get(nodeType));
    }

    // Configure all() for getAllNodes
    if (sql.includes('SELECT * FROM nodes ORDER BY display_name')) {
      this.all = vi.fn(() => Array.from(this.mockNodes.values()));
    }
  }
}

describe('NodeRepository - Operations and Resources', () => {
  let repository: NodeRepository;
  let mockAdapter: MockDatabaseAdapter;

  beforeEach(() => {
    mockAdapter = new MockDatabaseAdapter();
    repository = new NodeRepository(mockAdapter);
  });

  describe('getNodeOperations', () => {
    it('should extract operations from array format', () => {
      const mockNode = {
        node_type: 'nodes-base.httpRequest',
        display_name: 'HTTP Request',
        operations: JSON.stringify([
          { name: 'get', displayName: 'GET' },
          { name: 'post', displayName: 'POST' }
        ]),
        properties_schema: '[]',
        credentials_required: '[]'
      };

      mockAdapter._setMockNode('nodes-base.httpRequest', mockNode);

      const operations = repository.getNodeOperations('nodes-base.httpRequest');

      expect(operations).toEqual([
        { name: 'get', displayName: 'GET' },
        { name: 'post', displayName: 'POST' }
      ]);
    });

    it('should extract operations from object format grouped by resource', () => {
      const mockNode = {
        node_type: 'nodes-base.slack',
        display_name: 'Slack',
        operations: JSON.stringify({
          message: [
            { name: 'send', displayName: 'Send Message' },
            { name: 'update', displayName: 'Update Message' }
          ],
          channel: [
            { name: 'create', displayName: 'Create Channel' },
            { name: 'archive', displayName: 'Archive Channel' }
          ]
        }),
        properties_schema: '[]',
        credentials_required: '[]'
      };

      mockAdapter._setMockNode('nodes-base.slack', mockNode);

      const allOperations = repository.getNodeOperations('nodes-base.slack');
      const messageOperations = repository.getNodeOperations('nodes-base.slack', 'message');

      expect(allOperations).toHaveLength(4);
      expect(messageOperations).toEqual([
        { name: 'send', displayName: 'Send Message' },
        { name: 'update', displayName: 'Update Message' }
      ]);
    });

    it('should extract operations from properties with operation field', () => {
      const mockNode = {
        node_type: 'nodes-base.googleSheets',
        display_name: 'Google Sheets',
        operations: '[]',
        properties_schema: JSON.stringify([
          {
            name: 'resource',
            type: 'options',
            options: [{ name: 'sheet', displayName: 'Sheet' }]
          },
          {
            name: 'operation',
            type: 'options',
            displayOptions: {
              show: {
                resource: ['sheet']
              }
            },
            options: [
              { name: 'append', displayName: 'Append Row' },
              { name: 'read', displayName: 'Read Rows' }
            ]
          }
        ]),
        credentials_required: '[]'
      };

      mockAdapter._setMockNode('nodes-base.googleSheets', mockNode);

      const operations = repository.getNodeOperations('nodes-base.googleSheets');

      expect(operations).toEqual([
        { name: 'append', displayName: 'Append Row' },
        { name: 'read', displayName: 'Read Rows' }
      ]);
    });

    it('should filter operations by resource when specified', () => {
      const mockNode = {
        node_type: 'nodes-base.googleSheets',
        display_name: 'Google Sheets',
        operations: '[]',
        properties_schema: JSON.stringify([
          {
            name: 'operation',
            type: 'options',
            displayOptions: {
              show: {
                resource: ['sheet']
              }
            },
            options: [
              { name: 'append', displayName: 'Append Row' }
            ]
          },
          {
            name: 'operation',
            type: 'options',
            displayOptions: {
              show: {
                resource: ['cell']
              }
            },
            options: [
              { name: 'update', displayName: 'Update Cell' }
            ]
          }
        ]),
        credentials_required: '[]'
      };

      mockAdapter._setMockNode('nodes-base.googleSheets', mockNode);

      const sheetOperations = repository.getNodeOperations('nodes-base.googleSheets', 'sheet');
      const cellOperations = repository.getNodeOperations('nodes-base.googleSheets', 'cell');

      expect(sheetOperations).toEqual([{ name: 'append', displayName: 'Append Row' }]);
      expect(cellOperations).toEqual([{ name: 'update', displayName: 'Update Cell' }]);
    });

    it('should return empty array for non-existent node', () => {
      const operations = repository.getNodeOperations('nodes-base.nonexistent');
      expect(operations).toEqual([]);
    });

    it('should handle nodes without operations', () => {
      const mockNode = {
        node_type: 'nodes-base.simple',
        display_name: 'Simple Node',
        operations: '[]',
        properties_schema: '[]',
        credentials_required: '[]'
      };

      mockAdapter._setMockNode('nodes-base.simple', mockNode);

      const operations = repository.getNodeOperations('nodes-base.simple');
      expect(operations).toEqual([]);
    });

    it('should handle malformed operations JSON gracefully', () => {
      const mockNode = {
        node_type: 'nodes-base.broken',
        display_name: 'Broken Node',
        operations: '{invalid json}',
        properties_schema: '[]',
        credentials_required: '[]'
      };

      mockAdapter._setMockNode('nodes-base.broken', mockNode);

      const operations = repository.getNodeOperations('nodes-base.broken');
      expect(operations).toEqual([]);
    });
  });

  describe('getNodeResources', () => {
    it('should extract resources from properties', () => {
      const mockNode = {
        node_type: 'nodes-base.slack',
        display_name: 'Slack',
        operations: '[]',
        properties_schema: JSON.stringify([
          {
            name: 'resource',
            type: 'options',
            options: [
              { name: 'message', displayName: 'Message' },
              { name: 'channel', displayName: 'Channel' },
              { name: 'user', displayName: 'User' }
            ]
          }
        ]),
        credentials_required: '[]'
      };

      mockAdapter._setMockNode('nodes-base.slack', mockNode);

      const resources = repository.getNodeResources('nodes-base.slack');

      expect(resources).toEqual([
        { name: 'message', displayName: 'Message' },
        { name: 'channel', displayName: 'Channel' },
        { name: 'user', displayName: 'User' }
      ]);
    });

    it('should return empty array for node without resources', () => {
      const mockNode = {
        node_type: 'nodes-base.simple',
        display_name: 'Simple Node',
        operations: '[]',
        properties_schema: JSON.stringify([
          { name: 'url', type: 'string' }
        ]),
        credentials_required: '[]'
      };

      mockAdapter._setMockNode('nodes-base.simple', mockNode);

      const resources = repository.getNodeResources('nodes-base.simple');
      expect(resources).toEqual([]);
    });

    it('should return empty array for non-existent node', () => {
      const resources = repository.getNodeResources('nodes-base.nonexistent');
      expect(resources).toEqual([]);
    });

    it('should handle multiple resource properties', () => {
      const mockNode = {
        node_type: 'nodes-base.multi',
        display_name: 'Multi Resource Node',
        operations: '[]',
        properties_schema: JSON.stringify([
          {
            name: 'resource',
            type: 'options',
            options: [{ name: 'type1', displayName: 'Type 1' }]
          },
          {
            name: 'resource',
            type: 'options',
            options: [{ name: 'type2', displayName: 'Type 2' }]
          }
        ]),
        credentials_required: '[]'
      };

      mockAdapter._setMockNode('nodes-base.multi', mockNode);

      const resources = repository.getNodeResources('nodes-base.multi');

      expect(resources).toEqual([
        { name: 'type1', displayName: 'Type 1' },
        { name: 'type2', displayName: 'Type 2' }
      ]);
    });
  });

  describe('getOperationsForResource', () => {
    it('should return operations for specific resource', () => {
      const mockNode = {
        node_type: 'nodes-base.slack',
        display_name: 'Slack',
        operations: '[]',
        properties_schema: JSON.stringify([
          {
            name: 'operation',
            type: 'options',
            displayOptions: {
              show: {
                resource: ['message']
              }
            },
            options: [
              { name: 'send', displayName: 'Send Message' },
              { name: 'update', displayName: 'Update Message' }
            ]
          },
          {
            name: 'operation',
            type: 'options',
            displayOptions: {
              show: {
                resource: ['channel']
              }
            },
            options: [
              { name: 'create', displayName: 'Create Channel' }
            ]
          }
        ]),
        credentials_required: '[]'
      };

      mockAdapter._setMockNode('nodes-base.slack', mockNode);

      const messageOps = repository.getOperationsForResource('nodes-base.slack', 'message');
      const channelOps = repository.getOperationsForResource('nodes-base.slack', 'channel');
      const nonExistentOps = repository.getOperationsForResource('nodes-base.slack', 'nonexistent');

      expect(messageOps).toEqual([
        { name: 'send', displayName: 'Send Message' },
        { name: 'update', displayName: 'Update Message' }
      ]);
      expect(channelOps).toEqual([
        { name: 'create', displayName: 'Create Channel' }
      ]);
      expect(nonExistentOps).toEqual([]);
    });

    it('should handle array format for resource display options', () => {
      const mockNode = {
        node_type: 'nodes-base.multi',
        display_name: 'Multi Node',
        operations: '[]',
        properties_schema: JSON.stringify([
          {
            name: 'operation',
            type: 'options',
            displayOptions: {
              show: {
                resource: ['message', 'channel'] // Array format
              }
            },
            options: [
              { name: 'list', displayName: 'List Items' }
            ]
          }
        ]),
        credentials_required: '[]'
      };

      mockAdapter._setMockNode('nodes-base.multi', mockNode);

      const messageOps = repository.getOperationsForResource('nodes-base.multi', 'message');
      const channelOps = repository.getOperationsForResource('nodes-base.multi', 'channel');
      const otherOps = repository.getOperationsForResource('nodes-base.multi', 'other');

      expect(messageOps).toEqual([{ name: 'list', displayName: 'List Items' }]);
      expect(channelOps).toEqual([{ name: 'list', displayName: 'List Items' }]);
      expect(otherOps).toEqual([]);
    });

    it('should return empty array for non-existent node', () => {
      const operations = repository.getOperationsForResource('nodes-base.nonexistent', 'message');
      expect(operations).toEqual([]);
    });

    it('should handle string format for single resource', () => {
      const mockNode = {
        node_type: 'nodes-base.single',
        display_name: 'Single Node',
        operations: '[]',
        properties_schema: JSON.stringify([
          {
            name: 'operation',
            type: 'options',
            displayOptions: {
              show: {
                resource: 'document' // String format
              }
            },
            options: [
              { name: 'create', displayName: 'Create Document' }
            ]
          }
        ]),
        credentials_required: '[]'
      };

      mockAdapter._setMockNode('nodes-base.single', mockNode);

      const operations = repository.getOperationsForResource('nodes-base.single', 'document');
      expect(operations).toEqual([{ name: 'create', displayName: 'Create Document' }]);
    });
  });

  describe('getAllOperations', () => {
    it('should collect operations from all nodes', () => {
      const mockNodes = [
        {
          node_type: 'nodes-base.httpRequest',
          display_name: 'HTTP Request',
          operations: JSON.stringify([{ name: 'execute' }]),
          properties_schema: '[]',
          credentials_required: '[]'
        },
        {
          node_type: 'nodes-base.slack',
          display_name: 'Slack',
          operations: JSON.stringify([{ name: 'send' }]),
          properties_schema: '[]',
          credentials_required: '[]'
        },
        {
          node_type: 'nodes-base.empty',
          display_name: 'Empty Node',
          operations: '[]',
          properties_schema: '[]',
          credentials_required: '[]'
        }
      ];

      mockNodes.forEach(node => {
        mockAdapter._setMockNode(node.node_type, node);
      });

      const allOperations = repository.getAllOperations();

      expect(allOperations.size).toBe(2); // Only nodes with operations
      expect(allOperations.get('nodes-base.httpRequest')).toEqual([{ name: 'execute' }]);
      expect(allOperations.get('nodes-base.slack')).toEqual([{ name: 'send' }]);
      expect(allOperations.has('nodes-base.empty')).toBe(false);
    });

    it('should handle empty node list', () => {
      const allOperations = repository.getAllOperations();
      expect(allOperations.size).toBe(0);
    });
  });

  describe('getAllResources', () => {
    it('should collect resources from all nodes', () => {
      const mockNodes = [
        {
          node_type: 'nodes-base.slack',
          display_name: 'Slack',
          operations: '[]',
          properties_schema: JSON.stringify([
            {
              name: 'resource',
              options: [{ name: 'message' }, { name: 'channel' }]
            }
          ]),
          credentials_required: '[]'
        },
        {
          node_type: 'nodes-base.sheets',
          display_name: 'Google Sheets',
          operations: '[]',
          properties_schema: JSON.stringify([
            {
              name: 'resource',
              options: [{ name: 'sheet' }]
            }
          ]),
          credentials_required: '[]'
        },
        {
          node_type: 'nodes-base.simple',
          display_name: 'Simple Node',
          operations: '[]',
          properties_schema: '[]', // No resources
          credentials_required: '[]'
        }
      ];

      mockNodes.forEach(node => {
        mockAdapter._setMockNode(node.node_type, node);
      });

      const allResources = repository.getAllResources();

      expect(allResources.size).toBe(2); // Only nodes with resources
      expect(allResources.get('nodes-base.slack')).toEqual([
        { name: 'message' },
        { name: 'channel' }
      ]);
      expect(allResources.get('nodes-base.sheets')).toEqual([{ name: 'sheet' }]);
      expect(allResources.has('nodes-base.simple')).toBe(false);
    });

    it('should handle empty node list', () => {
      const allResources = repository.getAllResources();
      expect(allResources.size).toBe(0);
    });
  });

  describe('edge cases and error handling', () => {
    it('should handle null or undefined properties gracefully', () => {
      const mockNode = {
        node_type: 'nodes-base.null',
        display_name: 'Null Node',
        operations: null,
        properties_schema: null,
        credentials_required: null
      };

      mockAdapter._setMockNode('nodes-base.null', mockNode);

      const operations = repository.getNodeOperations('nodes-base.null');
      const resources = repository.getNodeResources('nodes-base.null');

      expect(operations).toEqual([]);
      expect(resources).toEqual([]);
    });

    it('should handle complex nested operation properties', () => {
      const mockNode = {
        node_type: 'nodes-base.complex',
        display_name: 'Complex Node',
        operations: '[]',
        properties_schema: JSON.stringify([
          {
            name: 'operation',
            type: 'options',
            displayOptions: {
              show: {
                resource: ['message'],
                mode: ['advanced']
              }
            },
            options: [
              { name: 'complexOperation', displayName: 'Complex Operation' }
            ]
          }
        ]),
        credentials_required: '[]'
      };

      mockAdapter._setMockNode('nodes-base.complex', mockNode);

      const operations = repository.getNodeOperations('nodes-base.complex');
      expect(operations).toEqual([{ name: 'complexOperation', displayName: 'Complex Operation' }]);
    });

    it('should handle operations with mixed data types', () => {
      const mockNode = {
        node_type: 'nodes-base.mixed',
        display_name: 'Mixed Node',
        operations: JSON.stringify({
          string_operation: 'invalid', // Should be array
          valid_operations: [{ name: 'valid' }],
          nested_object: { inner: [{ name: 'nested' }] }
        }),
        properties_schema: '[]',
        credentials_required: '[]'
      };

      mockAdapter._setMockNode('nodes-base.mixed', mockNode);

      const operations = repository.getNodeOperations('nodes-base.mixed');
      expect(operations).toEqual([{ name: 'valid' }]); // Only valid array operations
    });

    it('should handle very deeply nested properties', () => {
      const deepProperties = [
        {
          name: 'resource',
          options: [{ name: 'deep', displayName: 'Deep Resource' }],
          nested: {
            level1: {
              level2: {
                operations: [{ name: 'deep_operation' }]
              }
            }
          }
        }
      ];

      const mockNode = {
        node_type: 'nodes-base.deep',
        display_name: 'Deep Node',
        operations: '[]',
        properties_schema: JSON.stringify(deepProperties),
        credentials_required: '[]'
      };

      mockAdapter._setMockNode('nodes-base.deep', mockNode);

      const resources = repository.getNodeResources('nodes-base.deep');
      expect(resources).toEqual([{ name: 'deep', displayName: 'Deep Resource' }]);
    });
  });
});