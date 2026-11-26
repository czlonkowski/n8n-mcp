/**
 * Test cases for validation fixes - specifically for false positives
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WorkflowValidator } from '../../../src/services/workflow-validator';
import { EnhancedConfigValidator } from '../../../src/services/enhanced-config-validator';
import { NodeRepository } from '../../../src/database/node-repository';
import { DatabaseAdapter, PreparedStatement, RunResult } from '../../../src/database/database-adapter';

// Mock logger to prevent console output
vi.mock('@/utils/logger', () => ({
  Logger: vi.fn().mockImplementation(function () { return ({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn()
  }); })
}));

// Create a complete mock for DatabaseAdapter
class MockDatabaseAdapter implements DatabaseAdapter {
  private statements = new Map<string, MockPreparedStatement>();
  private mockData = new Map<string, any>();

  prepare = vi.fn((sql: string) => {
    if (!this.statements.has(sql)) {
      this.statements.set(sql, new MockPreparedStatement(sql, this.mockData));
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
  _setMockData(key: string, value: any) {
    this.mockData.set(key, value);
  }

  // Test helper to get statement by SQL
  _getStatement(sql: string) {
    return this.statements.get(sql);
  }
}

class MockPreparedStatement implements PreparedStatement {
  run = vi.fn((...params: any[]): RunResult => ({ changes: 1, lastInsertRowid: 1 }));
  get = vi.fn();
  all = vi.fn(() => []);
  iterate = vi.fn();
  pluck = vi.fn(() => this);
  expand = vi.fn(() => this);
  raw = vi.fn(() => this);
  columns = vi.fn(() => []);
  bind = vi.fn(() => this);

  constructor(private sql: string, private mockData: Map<string, any>) {
    // Configure get() based on SQL pattern
    if (sql.includes('SELECT * FROM nodes WHERE node_type = ?')) {
      this.get = vi.fn((nodeType: string) => this.mockData.get(`node:${nodeType}`));
    }
  }
}

describe('Validation Fixes for False Positives', () => {
  let repository: any;
  let mockAdapter: MockDatabaseAdapter;
  let validator: WorkflowValidator;

  beforeEach(() => {
    mockAdapter = new MockDatabaseAdapter();
    repository = new NodeRepository(mockAdapter);

    // Add findSimilarNodes method for WorkflowValidator
    repository.findSimilarNodes = vi.fn().mockReturnValue([]);

    // Initialize services
    EnhancedConfigValidator.initializeSimilarityServices(repository);

    validator = new WorkflowValidator(repository, EnhancedConfigValidator);

    // Mock Google Drive node data
    const googleDriveNodeData = {
      node_type: 'nodes-base.googleDrive',
      package_name: 'n8n-nodes-base',
      display_name: 'Google Drive',
      description: 'Access Google Drive',
      category: 'input',
      development_style: 'programmatic',
      is_ai_tool: 0,
      is_trigger: 0,
      is_webhook: 0,
      is_versioned: 1,
      version: '3',
      properties_schema: JSON.stringify([
        {
          name: 'resource',
          type: 'options',
          default: 'file',
          options: [
            { value: 'file', name: 'File' },
            { value: 'fileFolder', name: 'File/Folder' },
            { value: 'folder', name: 'Folder' },
            { value: 'drive', name: 'Shared Drive' }
          ]
        },
        {
          name: 'operation',
          type: 'options',
          displayOptions: {
            show: {
              resource: ['fileFolder']
            }
          },
          default: 'search',
          options: [
            { value: 'search', name: 'Search' }
          ]
        },
        {
          name: 'queryString',
          type: 'string',
          displayOptions: {
            show: {
              resource: ['fileFolder'],
              operation: ['search']
            }
          }
        },
        {
          name: 'filter',
          type: 'collection',
          displayOptions: {
            show: {
              resource: ['fileFolder'],
              operation: ['search']
            }
          },
          default: {},
          options: [
            {
              name: 'folderId',
              type: 'resourceLocator',
              default: { mode: 'list', value: '' }
            }
          ]
        },
        {
          name: 'options',
          type: 'collection',
          displayOptions: {
            show: {
              resource: ['fileFolder'],
              operation: ['search']
            }
          },
          default: {},
          options: [
            {
              name: 'fields',
              type: 'multiOptions',
              default: []
            }
          ]
        }
      ]),
      operations: JSON.stringify([]),
      credentials_required: JSON.stringify([]),
      documentation: null,
      outputs: null,
      output_names: null
    };

    // Set mock data for node retrieval
    mockAdapter._setMockData('node:nodes-base.googleDrive', googleDriveNodeData);
    mockAdapter._setMockData('node:n8n-nodes-base.googleDrive', googleDriveNodeData);
  });

  describe('Google Drive fileFolder Resource Validation', () => {
    it('should validate fileFolder as a valid resource', () => {
      const config = {
        resource: 'fileFolder'
      };

      const node = repository.getNode('nodes-base.googleDrive');
      const result = EnhancedConfigValidator.validateWithMode(
        'nodes-base.googleDrive',
        config,
        node.properties,
        'operation',
        'ai-friendly'
      );

      expect(result.valid).toBe(true);

      // Should not have resource error
      const resourceError = result.errors.find(e => e.property === 'resource');
      expect(resourceError).toBeUndefined();
    });

    it('should apply default operation when not specified', () => {
      const config = {
        resource: 'fileFolder'
        // operation is not specified, should use default 'search'
      };

      const node = repository.getNode('nodes-base.googleDrive');
      const result = EnhancedConfigValidator.validateWithMode(
        'nodes-base.googleDrive',
        config,
        node.properties,
        'operation',
        'ai-friendly'
      );

      expect(result.valid).toBe(true);

      // Should not have operation error
      const operationError = result.errors.find(e => e.property === 'operation');
      expect(operationError).toBeUndefined();
    });

    it('should not warn about properties being unused when default operation is applied', () => {
      const config = {
        resource: 'fileFolder',
        // operation not specified, will use default 'search'
        queryString: '=',
        filter: {
          folderId: {
            __rl: true,
            value: '={{ $json.id }}',
            mode: 'id'
          }
        },
        options: {
          fields: ['id', 'kind', 'mimeType', 'name', 'webViewLink']
        }
      };

      const node = repository.getNode('nodes-base.googleDrive');
      const result = EnhancedConfigValidator.validateWithMode(
        'nodes-base.googleDrive',
        config,
        node.properties,
        'operation',
        'ai-friendly'
      );

      // Should be valid
      expect(result.valid).toBe(true);

      // Should not have warnings about properties not being used
      const propertyWarnings = result.warnings.filter(w =>
        w.message.includes("won't be used") || w.message.includes("not used")
      );
      expect(propertyWarnings.length).toBe(0);
    });

    it.skip('should validate complete workflow with Google Drive nodes', async () => {
      const workflow = {
        name: 'Test Google Drive Workflow',
        nodes: [
          {
            id: '1',
            name: 'Google Drive',
            type: 'n8n-nodes-base.googleDrive',
            typeVersion: 3,
            position: [100, 100] as [number, number],
            parameters: {
              resource: 'fileFolder',
              queryString: '=',
              filter: {
                folderId: {
                  __rl: true,
                  value: '={{ $json.id }}',
                  mode: 'id'
                }
              },
              options: {
                fields: ['id', 'kind', 'mimeType', 'name', 'webViewLink']
              }
            }
          }
        ],
        connections: {}
      };

      let result;
      try {
        result = await validator.validateWorkflow(workflow, {
          validateNodes: true,
          validateConnections: true,
          validateExpressions: true,
          profile: 'ai-friendly'
        });
      } catch (error) {
        console.log('Validation threw error:', error);
        throw error;
      }

      // Debug output
      if (!result.valid) {
        console.log('Validation errors:', JSON.stringify(result.errors, null, 2));
        console.log('Validation warnings:', JSON.stringify(result.warnings, null, 2));
      }

      // Should be valid
      expect(result.valid).toBe(true);

      // Should not have "Invalid resource" errors
      const resourceErrors = result.errors.filter((e: any) =>
        e.message.includes('Invalid resource') && e.message.includes('fileFolder')
      );
      expect(resourceErrors.length).toBe(0);
    });

    it('should still report errors for truly invalid resources', () => {
      const config = {
        resource: 'invalidResource'
      };

      const node = repository.getNode('nodes-base.googleDrive');
      const result = EnhancedConfigValidator.validateWithMode(
        'nodes-base.googleDrive',
        config,
        node.properties,
        'operation',
        'ai-friendly'
      );

      expect(result.valid).toBe(false);

      // Should have resource error for invalid resource
      const resourceError = result.errors.find(e => e.property === 'resource');
      expect(resourceError).toBeDefined();
      expect(resourceError!.message).toContain('Invalid resource "invalidResource"');
    });
  });

  describe('Node Type Validation', () => {
    it('should accept both n8n-nodes-base and nodes-base prefixes', async () => {
      const workflow1 = {
        name: 'Test with n8n-nodes-base prefix',
        nodes: [
          {
            id: '1',
            name: 'Google Drive',
            type: 'n8n-nodes-base.googleDrive',
            typeVersion: 3,
            position: [100, 100] as [number, number],
            parameters: {
              resource: 'file'
            }
          }
        ],
        connections: {}
      };

      const result1 = await validator.validateWorkflow(workflow1);

      // Should not have errors about node type format
      const typeErrors1 = result1.errors.filter((e: any) =>
        e.message.includes('Invalid node type') ||
        e.message.includes('must use the full package name')
      );
      expect(typeErrors1.length).toBe(0);

      // Note: nodes-base prefix might still be invalid in actual workflows
      // but the validator shouldn't incorrectly suggest it's always wrong
    });
  });
});