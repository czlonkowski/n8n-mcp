import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NodeRepository } from '../../../src/database/node-repository';
import { DatabaseAdapter, PreparedStatement, RunResult } from '../../../src/database/database-adapter';
import { ParsedNode } from '../../../src/parsers/node-parser';

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

    // Configure get() for saveNode's SELECT to preserve existing doc fields
    if (sql.includes('SELECT npm_readme, ai_documentation_summary, ai_summary_generated_at FROM nodes')) {
      this.get = vi.fn(() => undefined); // No existing row by default
    }

    // Configure all() for getAITools
    if (sql.includes('WHERE is_ai_tool = 1')) {
      this.all = vi.fn(() => this.mockData.get('ai_tools') || []);
    }
  }
}

describe('NodeRepository - Core Functionality', () => {
  let repository: NodeRepository;
  let mockAdapter: MockDatabaseAdapter;
  
  beforeEach(() => {
    mockAdapter = new MockDatabaseAdapter();
    repository = new NodeRepository(mockAdapter);
  });
  
  describe('saveNode', () => {
    it('should save a node with proper JSON serialization', () => {
      const parsedNode: ParsedNode = {
        nodeType: 'nodes-base.httpRequest',
        displayName: 'HTTP Request',
        description: 'Makes HTTP requests',
        category: 'transform',
        style: 'declarative',
        packageName: 'n8n-nodes-base',
        properties: [{ name: 'url', type: 'string' }],
        operations: [{ name: 'execute', displayName: 'Execute' }],
        credentials: [{ name: 'httpBasicAuth' }],
        isAITool: false,
        isTrigger: false,
        isWebhook: false,
        isVersioned: true,
        version: '1.0',
        documentation: 'HTTP Request documentation',
        outputs: undefined,
        outputNames: undefined
      };
      
      repository.saveNode(parsedNode);

      // Verify prepare was called with correct SQL
      expect(mockAdapter.prepare).toHaveBeenCalledWith(expect.stringContaining('INSERT OR REPLACE INTO nodes'));

      // Get the prepared statement and verify run was called
      const stmt = mockAdapter._getStatement(mockAdapter.prepare.mock.lastCall?.[0] || '');
      expect(stmt?.run).toHaveBeenCalledWith(
        'nodes-base.httpRequest',
        'n8n-nodes-base',
        'HTTP Request',
        'Makes HTTP requests',
        'transform',
        'declarative',
        0, // isAITool
        0, // isTrigger
        0, // isWebhook
        1, // isVersioned
        0, // isToolVariant
        null, // toolVariantOf
        0, // hasToolVariant
        '1.0',
        'HTTP Request documentation',
        JSON.stringify([{ name: 'url', type: 'string' }], null, 2),
        JSON.stringify([{ name: 'execute', displayName: 'Execute' }], null, 2),
        JSON.stringify([{ name: 'httpBasicAuth' }], null, 2),
        null, // outputs
        null, // outputNames
        0, // isCommunity
        0, // isVerified
        null, // authorName
        null, // authorGithubUrl
        null, // npmPackageName
        null, // npmVersion
        0, // npmDownloads
        null, // communityFetchedAt
        null, // npm_readme (preserved from existing)
        null, // ai_documentation_summary (preserved from existing)
        null  // ai_summary_generated_at (preserved from existing)
      );
    });
    
    it('should handle nodes without optional fields', () => {
      const minimalNode: ParsedNode = {
        nodeType: 'nodes-base.simple',
        displayName: 'Simple Node',
        category: 'core',
        style: 'programmatic',
        packageName: 'n8n-nodes-base',
        properties: [],
        operations: [],
        credentials: [],
        isAITool: true,
        isTrigger: true,
        isWebhook: true,
        isVersioned: false,
        outputs: undefined,
        outputNames: undefined
      };
      
      repository.saveNode(minimalNode);

      const stmt = mockAdapter._getStatement(mockAdapter.prepare.mock.lastCall?.[0] || '');
      const runCall = stmt?.run.mock.lastCall;

      expect(runCall?.[2]).toBe('Simple Node'); // displayName
      expect(runCall?.[3]).toBeUndefined(); // description
      expect(runCall?.[13]).toBeUndefined(); // version (was 10, now 13 after 3 new columns)
      expect(runCall?.[14]).toBeNull(); // documentation (was 11, now 14 after 3 new columns)
    });
  });
  
  describe('getNode', () => {
    it('should retrieve and deserialize a node correctly', () => {
      const mockRow = {
        node_type: 'nodes-base.httpRequest',
        display_name: 'HTTP Request',
        description: 'Makes HTTP requests',
        category: 'transform',
        development_style: 'declarative',
        package_name: 'n8n-nodes-base',
        is_ai_tool: 0,
        is_trigger: 0,
        is_webhook: 0,
        is_versioned: 1,
        is_tool_variant: 0,
        tool_variant_of: null,
        has_tool_variant: 0,
        version: '1.0',
        properties_schema: JSON.stringify([{ name: 'url', type: 'string' }]),
        operations: JSON.stringify([{ name: 'execute' }]),
        credentials_required: JSON.stringify([{ name: 'httpBasicAuth' }]),
        documentation: 'HTTP docs',
        outputs: null,
        output_names: null,
        is_community: 0,
        is_verified: 0,
        author_name: null,
        author_github_url: null,
        npm_package_name: null,
        npm_version: null,
        npm_downloads: 0,
        community_fetched_at: null,
        npm_readme: null,
        ai_documentation_summary: null,
        ai_summary_generated_at: null,
      };

      mockAdapter._setMockData('node:nodes-base.httpRequest', mockRow);

      const result = repository.getNode('nodes-base.httpRequest');

      expect(result).toEqual({
        nodeType: 'nodes-base.httpRequest',
        displayName: 'HTTP Request',
        description: 'Makes HTTP requests',
        category: 'transform',
        developmentStyle: 'declarative',
        package: 'n8n-nodes-base',
        isAITool: false,
        isTrigger: false,
        isWebhook: false,
        isVersioned: true,
        isToolVariant: false,
        toolVariantOf: null,
        hasToolVariant: false,
        version: '1.0',
        properties: [{ name: 'url', type: 'string' }],
        operations: [{ name: 'execute' }],
        credentials: [{ name: 'httpBasicAuth' }],
        hasDocumentation: true,
        outputs: null,
        outputNames: null,
        isCommunity: false,
        isVerified: false,
        authorName: null,
        authorGithubUrl: null,
        npmPackageName: null,
        npmVersion: null,
        npmDownloads: 0,
        communityFetchedAt: null,
        npmReadme: null,
        aiDocumentationSummary: null,
        aiSummaryGeneratedAt: null,
      });
    });
    
    it('should return null for non-existent nodes', () => {
      const result = repository.getNode('non-existent');
      expect(result).toBeNull();
    });
    
    it('should handle invalid JSON gracefully', () => {
      const mockRow = {
        node_type: 'nodes-base.broken',
        display_name: 'Broken Node',
        description: 'Node with broken JSON',
        category: 'transform',
        development_style: 'declarative',
        package_name: 'n8n-nodes-base',
        is_ai_tool: 0,
        is_trigger: 0,
        is_webhook: 0,
        is_versioned: 0,
        is_tool_variant: 0,
        tool_variant_of: null,
        has_tool_variant: 0,
        version: null,
        properties_schema: '{invalid json',
        operations: 'not json at all',
        credentials_required: '{"valid": "json"}',
        documentation: null,
        outputs: null,
        output_names: null,
        is_community: 0,
        is_verified: 0,
        author_name: null,
        author_github_url: null,
        npm_package_name: null,
        npm_version: null,
        npm_downloads: 0,
        community_fetched_at: null,
        npm_readme: null,
        ai_documentation_summary: null,
        ai_summary_generated_at: null,
      };

      mockAdapter._setMockData('node:nodes-base.broken', mockRow);

      const result = repository.getNode('nodes-base.broken');

      expect(result?.properties).toEqual([]); // defaultValue from safeJsonParse
      expect(result?.operations).toEqual([]); // defaultValue from safeJsonParse
      expect(result?.credentials).toEqual({ valid: 'json' }); // successfully parsed
    });
  });

  describe('getAITools', () => {
    it('should retrieve all AI tools sorted by display name', () => {
      const mockAITools = [
        {
          node_type: 'nodes-base.openai',
          display_name: 'OpenAI',
          description: 'OpenAI integration',
          package_name: 'n8n-nodes-base'
        },
        {
          node_type: 'nodes-base.agent',
          display_name: 'AI Agent',
          description: 'AI Agent node',
          package_name: '@n8n/n8n-nodes-langchain'
        }
      ];
      
      mockAdapter._setMockData('ai_tools', mockAITools);
      
      const result = repository.getAITools();
      
      expect(result).toEqual([
        {
          nodeType: 'nodes-base.openai',
          displayName: 'OpenAI',
          description: 'OpenAI integration',
          package: 'n8n-nodes-base'
        },
        {
          nodeType: 'nodes-base.agent',
          displayName: 'AI Agent',
          description: 'AI Agent node',
          package: '@n8n/n8n-nodes-langchain'
        }
      ]);
    });
    
    it('should return empty array when no AI tools exist', () => {
      mockAdapter._setMockData('ai_tools', []);
      
      const result = repository.getAITools();
      
      expect(result).toEqual([]);
    });
  });
  
  describe('safeJsonParse', () => {
    it('should parse valid JSON', () => {
      // Access private method through the class
      const parseMethod = (repository as any).safeJsonParse.bind(repository);
      
      const validJson = '{"key": "value", "number": 42}';
      const result = parseMethod(validJson, {});
      
      expect(result).toEqual({ key: 'value', number: 42 });
    });
    
    it('should return default value for invalid JSON', () => {
      const parseMethod = (repository as any).safeJsonParse.bind(repository);
      
      const invalidJson = '{invalid json}';
      const defaultValue = { default: true };
      const result = parseMethod(invalidJson, defaultValue);
      
      expect(result).toEqual(defaultValue);
    });
    
    it('should handle empty strings', () => {
      const parseMethod = (repository as any).safeJsonParse.bind(repository);
      
      const result = parseMethod('', []);
      expect(result).toEqual([]);
    });
    
    it('should handle null and undefined', () => {
      const parseMethod = (repository as any).safeJsonParse.bind(repository);
      
      // JSON.parse(null) returns null, not an error
      expect(parseMethod(null, 'default')).toBe(null);
      expect(parseMethod(undefined, 'default')).toBe('default');
    });
  });
  
  describe('Edge Cases', () => {
    it('should handle very large JSON properties', () => {
      const largeProperties = Array(1000).fill(null).map((_, i) => ({
        name: `prop${i}`,
        type: 'string',
        description: 'A'.repeat(100)
      }));
      
      const node: ParsedNode = {
        nodeType: 'nodes-base.large',
        displayName: 'Large Node',
        category: 'test',
        style: 'declarative',
        packageName: 'test',
        properties: largeProperties,
        operations: [],
        credentials: [],
        isAITool: false,
        isTrigger: false,
        isWebhook: false,
        isVersioned: false,
        outputs: undefined,
        outputNames: undefined
      };
      
      repository.saveNode(node);

      const stmt = mockAdapter._getStatement(mockAdapter.prepare.mock.lastCall?.[0] || '');
      const runCall = stmt?.run.mock.lastCall;
      const savedProperties = runCall?.[15]; // was 12, now 15 after 3 new columns

      expect(savedProperties).toBe(JSON.stringify(largeProperties, null, 2));
    });
    
    it('should handle boolean conversion for integer fields', () => {
      const mockRow = {
        node_type: 'nodes-base.bool-test',
        display_name: 'Bool Test',
        description: 'Testing boolean conversion',
        category: 'test',
        development_style: 'declarative',
        package_name: 'test',
        is_ai_tool: 1,
        is_trigger: 0,
        is_webhook: '1', // String that should be converted
        is_versioned: '0', // String that should be converted
        is_tool_variant: 1,
        tool_variant_of: 'nodes-base.bool-base',
        has_tool_variant: 0,
        version: null,
        properties_schema: '[]',
        operations: '[]',
        credentials_required: '[]',
        documentation: null,
        outputs: null,
        output_names: null,
        is_community: 0,
        is_verified: 0,
        author_name: null,
        author_github_url: null,
        npm_package_name: null,
        npm_version: null,
        npm_downloads: 0,
        community_fetched_at: null,
        npm_readme: null,
        ai_documentation_summary: null,
        ai_summary_generated_at: null,
      };

      mockAdapter._setMockData('node:nodes-base.bool-test', mockRow);

      const result = repository.getNode('nodes-base.bool-test');

      expect(result?.isAITool).toBe(true);
      expect(result?.isTrigger).toBe(false);
      expect(result?.isWebhook).toBe(true);
      expect(result?.isVersioned).toBe(false);
      expect(result?.isToolVariant).toBe(true);
      expect(result?.toolVariantOf).toBe('nodes-base.bool-base');
      expect(result?.hasToolVariant).toBe(false);
    });
  });
});