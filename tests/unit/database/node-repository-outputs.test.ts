import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NodeRepository } from '@/database/node-repository';
import { DatabaseAdapter } from '@/database/database-adapter';
import { ParsedNode } from '@/parsers/node-parser';

describe('NodeRepository - Outputs Handling', () => {
  let repository: NodeRepository;
  let mockDb: DatabaseAdapter;
  let mockStatement: any;

  beforeEach(() => {
    mockStatement = {
      run: vi.fn(),
      get: vi.fn(),
      all: vi.fn()
    };

    // saveNode now calls prepare twice: first a SELECT (returns get), then INSERT (returns run).
    // We create a separate mock for the SELECT statement that returns undefined (no existing row).
    const selectStatement = {
      run: vi.fn(),
      get: vi.fn().mockReturnValue(undefined),
      all: vi.fn()
    };

    mockDb = {
      prepare: vi.fn((sql: string) => {
        if (sql.includes('SELECT npm_readme')) {
          return selectStatement;
        }
        return mockStatement;
      }),
      transaction: vi.fn(),
      exec: vi.fn(),
      close: vi.fn(),
      pragma: vi.fn()
    } as any;

    repository = new NodeRepository(mockDb);
  });

  describe('saveNode with outputs', () => {
    it('should save node with outputs and outputNames correctly', () => {
      const outputs = [
        { displayName: 'Done', description: 'Final results when loop completes' },
        { displayName: 'Loop', description: 'Current batch data during iteration' }
      ];
      const outputNames = ['done', 'loop'];

      const node: ParsedNode = {
        style: 'programmatic',
        nodeType: 'nodes-base.splitInBatches',
        displayName: 'Split In Batches',
        description: 'Split data into batches',
        category: 'transform',
        properties: [],
        credentials: [],
        isAITool: false,
        isTrigger: false,
        isWebhook: false,
        operations: [],
        version: '3',
        isVersioned: false,
        packageName: 'n8n-nodes-base',
        outputs,
        outputNames
      };

      repository.saveNode(node);

      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('INSERT OR REPLACE INTO nodes')
      );

      expect(mockStatement.run).toHaveBeenCalledWith(
        'nodes-base.splitInBatches',
        'n8n-nodes-base',
        'Split In Batches',
        'Split data into batches',
        'transform',
        'programmatic',
        0, // isAITool
        0, // isTrigger
        0, // isWebhook
        0, // isVersioned
        0, // isToolVariant
        null, // toolVariantOf
        0, // hasToolVariant
        '3', // version
        null, // documentation
        JSON.stringify([], null, 2), // properties
        JSON.stringify([], null, 2), // operations
        JSON.stringify([], null, 2), // credentials
        JSON.stringify(outputs, null, 2), // outputs
        JSON.stringify(outputNames, null, 2), // output_names
        0, // is_community
        0, // is_verified
        null, // author_name
        null, // author_github_url
        null, // npm_package_name
        null, // npm_version
        0, // npm_downloads
        null, // community_fetched_at
        null, // npm_readme (preserved from existing)
        null, // ai_documentation_summary (preserved from existing)
        null  // ai_summary_generated_at (preserved from existing)
      );
    });

    it('should save node with only outputs (no outputNames)', () => {
      const outputs = [
        { displayName: 'True', description: 'Items that match condition' },
        { displayName: 'False', description: 'Items that do not match condition' }
      ];

      const node: ParsedNode = {
        style: 'programmatic',
        nodeType: 'nodes-base.if',
        displayName: 'IF',
        description: 'Route items based on conditions',
        category: 'transform',
        properties: [],
        credentials: [],
        isAITool: false,
        isTrigger: false,
        isWebhook: false,
        operations: [],
        version: '2',
        isVersioned: false,
        packageName: 'n8n-nodes-base',
        outputs
        // no outputNames
      };

      repository.saveNode(node);

      const callArgs = mockStatement.run.mock.calls[0];
      expect(callArgs[18]).toBe(JSON.stringify(outputs, null, 2)); // outputs
      expect(callArgs[19]).toBe(null); // output_names should be null
    });

    it('should save node with only outputNames (no outputs)', () => {
      const outputNames = ['main', 'error'];

      const node: ParsedNode = {
        style: 'programmatic',
        nodeType: 'nodes-base.customNode',
        displayName: 'Custom Node',
        description: 'Custom node with output names only',
        category: 'transform',
        properties: [],
        credentials: [],
        isAITool: false,
        isTrigger: false,
        isWebhook: false,
        operations: [],
        version: '1',
        isVersioned: false,
        packageName: 'n8n-nodes-base',
        outputNames
        // no outputs
      };

      repository.saveNode(node);

      const callArgs = mockStatement.run.mock.calls[0];
      expect(callArgs[18]).toBe(null); // outputs should be null
      expect(callArgs[19]).toBe(JSON.stringify(outputNames, null, 2)); // output_names
    });

    it('should save node without outputs or outputNames', () => {
      const node: ParsedNode = {
        style: 'programmatic',
        nodeType: 'nodes-base.httpRequest',
        displayName: 'HTTP Request',
        description: 'Make HTTP requests',
        category: 'input',
        properties: [],
        credentials: [],
        isAITool: false,
        isTrigger: false,
        isWebhook: false,
        operations: [],
        version: '4',
        isVersioned: false,
        packageName: 'n8n-nodes-base'
        // no outputs or outputNames
      };

      repository.saveNode(node);

      const callArgs = mockStatement.run.mock.calls[0];
      expect(callArgs[18]).toBe(null); // outputs should be null
      expect(callArgs[19]).toBe(null); // output_names should be null
    });

    it('should handle empty outputs and outputNames arrays', () => {
      const node: ParsedNode = {
        style: 'programmatic',
        nodeType: 'nodes-base.emptyNode',
        displayName: 'Empty Node',
        description: 'Node with empty outputs',
        category: 'misc',
        properties: [],
        credentials: [],
        isAITool: false,
        isTrigger: false,
        isWebhook: false,
        operations: [],
        version: '1',
        isVersioned: false,
        packageName: 'n8n-nodes-base',
        outputs: [],
        outputNames: []
      };

      repository.saveNode(node);

      const callArgs = mockStatement.run.mock.calls[0];
      expect(callArgs[18]).toBe(JSON.stringify([], null, 2)); // outputs
      expect(callArgs[19]).toBe(JSON.stringify([], null, 2)); // output_names
    });
  });

  describe('getNode with outputs', () => {
    it('should retrieve node with outputs and outputNames correctly', () => {
      const outputs = [
        { displayName: 'Done', description: 'Final results when loop completes' },
        { displayName: 'Loop', description: 'Current batch data during iteration' }
      ];
      const outputNames = ['done', 'loop'];

      const mockRow = {
        node_type: 'nodes-base.splitInBatches',
        display_name: 'Split In Batches',
        description: 'Split data into batches',
        category: 'transform',
        development_style: 'programmatic',
        package_name: 'n8n-nodes-base',
        is_ai_tool: 0,
        is_trigger: 0,
        is_webhook: 0,
        is_versioned: 0,
        is_tool_variant: 0,
        tool_variant_of: null,
        has_tool_variant: 0,
        version: '3',
        properties_schema: JSON.stringify([]),
        operations: JSON.stringify([]),
        credentials_required: JSON.stringify([]),
        documentation: null,
        outputs: JSON.stringify(outputs),
        output_names: JSON.stringify(outputNames),
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
        ai_summary_generated_at: null
      };

      mockStatement.get.mockReturnValue(mockRow);

      const result = repository.getNode('nodes-base.splitInBatches');

      expect(result).toEqual({
        nodeType: 'nodes-base.splitInBatches',
        displayName: 'Split In Batches',
        description: 'Split data into batches',
        category: 'transform',
        developmentStyle: 'programmatic',
        package: 'n8n-nodes-base',
        isAITool: false,
        isTrigger: false,
        isWebhook: false,
        isVersioned: false,
        isToolVariant: false,
        toolVariantOf: null,
        hasToolVariant: false,
        version: '3',
        properties: [],
        operations: [],
        credentials: [],
        hasDocumentation: false,
        outputs,
        outputNames,
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
        aiSummaryGeneratedAt: null
      });
    });

    it('should retrieve node with only outputs (null outputNames)', () => {
      const outputs = [
        { displayName: 'True', description: 'Items that match condition' }
      ];

      const mockRow = {
        node_type: 'nodes-base.if',
        display_name: 'IF',
        description: 'Route items',
        category: 'transform',
        development_style: 'programmatic',
        package_name: 'n8n-nodes-base',
        is_ai_tool: 0,
        is_trigger: 0,
        is_webhook: 0,
        is_versioned: 0,
        is_tool_variant: 0,
        tool_variant_of: null,
        has_tool_variant: 0,
        version: '2',
        properties_schema: JSON.stringify([]),
        operations: JSON.stringify([]),
        credentials_required: JSON.stringify([]),
        documentation: null,
        outputs: JSON.stringify(outputs),
        output_names: null,
        is_community: 0,
        is_verified: 0,
        author_name: null,
        author_github_url: null,
        npm_package_name: null,
        npm_version: null,
        npm_downloads: 0,
        community_fetched_at: null
      };

      mockStatement.get.mockReturnValue(mockRow);

      const result = repository.getNode('nodes-base.if');

      expect(result.outputs).toEqual(outputs);
      expect(result.outputNames).toBe(null);
    });

    it('should retrieve node with only outputNames (null outputs)', () => {
      const outputNames = ['main'];

      const mockRow = {
        node_type: 'nodes-base.customNode',
        display_name: 'Custom Node',
        description: 'Custom node',
        category: 'misc',
        development_style: 'programmatic',
        package_name: 'n8n-nodes-base',
        is_ai_tool: 0,
        is_trigger: 0,
        is_webhook: 0,
        is_versioned: 0,
        is_tool_variant: 0,
        tool_variant_of: null,
        has_tool_variant: 0,
        version: '1',
        properties_schema: JSON.stringify([]),
        operations: JSON.stringify([]),
        credentials_required: JSON.stringify([]),
        documentation: null,
        outputs: null,
        output_names: JSON.stringify(outputNames),
        is_community: 0,
        is_verified: 0,
        author_name: null,
        author_github_url: null,
        npm_package_name: null,
        npm_version: null,
        npm_downloads: 0,
        community_fetched_at: null
      };

      mockStatement.get.mockReturnValue(mockRow);

      const result = repository.getNode('nodes-base.customNode');

      expect(result.outputs).toBe(null);
      expect(result.outputNames).toEqual(outputNames);
    });

    it('should retrieve node without outputs or outputNames', () => {
      const mockRow = {
        node_type: 'nodes-base.httpRequest',
        display_name: 'HTTP Request',
        description: 'Make HTTP requests',
        category: 'input',
        development_style: 'programmatic',
        package_name: 'n8n-nodes-base',
        is_ai_tool: 0,
        is_trigger: 0,
        is_webhook: 0,
        is_versioned: 0,
        is_tool_variant: 0,
        tool_variant_of: null,
        has_tool_variant: 0,
        version: '4',
        properties_schema: JSON.stringify([]),
        operations: JSON.stringify([]),
        credentials_required: JSON.stringify([]),
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
        community_fetched_at: null
      };

      mockStatement.get.mockReturnValue(mockRow);

      const result = repository.getNode('nodes-base.httpRequest');

      expect(result.outputs).toBe(null);
      expect(result.outputNames).toBe(null);
    });

    it('should handle malformed JSON gracefully', () => {
      const mockRow = {
        node_type: 'nodes-base.malformed',
        display_name: 'Malformed Node',
        description: 'Node with malformed JSON',
        category: 'misc',
        development_style: 'programmatic',
        package_name: 'n8n-nodes-base',
        is_ai_tool: 0,
        is_trigger: 0,
        is_webhook: 0,
        is_versioned: 0,
        is_tool_variant: 0,
        tool_variant_of: null,
        has_tool_variant: 0,
        version: '1',
        properties_schema: JSON.stringify([]),
        operations: JSON.stringify([]),
        credentials_required: JSON.stringify([]),
        documentation: null,
        outputs: '{invalid json}',
        output_names: '[invalid, json',
        is_community: 0,
        is_verified: 0,
        author_name: null,
        author_github_url: null,
        npm_package_name: null,
        npm_version: null,
        npm_downloads: 0,
        community_fetched_at: null
      };

      mockStatement.get.mockReturnValue(mockRow);

      const result = repository.getNode('nodes-base.malformed');

      // Should use default values when JSON parsing fails
      expect(result.outputs).toBe(null);
      expect(result.outputNames).toBe(null);
    });

    it('should return null for non-existent node', () => {
      mockStatement.get.mockReturnValue(null);

      const result = repository.getNode('nodes-base.nonExistent');

      expect(result).toBe(null);
    });

    it('should handle SplitInBatches counterintuitive output order correctly', () => {
      // Test that the output order is preserved: done=0, loop=1
      const outputs = [
        { displayName: 'Done', description: 'Final results when loop completes', index: 0 },
        { displayName: 'Loop', description: 'Current batch data during iteration', index: 1 }
      ];
      const outputNames = ['done', 'loop'];

      const mockRow = {
        node_type: 'nodes-base.splitInBatches',
        display_name: 'Split In Batches',
        description: 'Split data into batches',
        category: 'transform',
        development_style: 'programmatic',
        package_name: 'n8n-nodes-base',
        is_ai_tool: 0,
        is_trigger: 0,
        is_webhook: 0,
        is_versioned: 0,
        is_tool_variant: 0,
        tool_variant_of: null,
        has_tool_variant: 0,
        version: '3',
        properties_schema: JSON.stringify([]),
        operations: JSON.stringify([]),
        credentials_required: JSON.stringify([]),
        documentation: null,
        outputs: JSON.stringify(outputs),
        output_names: JSON.stringify(outputNames),
        is_community: 0,
        is_verified: 0,
        author_name: null,
        author_github_url: null,
        npm_package_name: null,
        npm_version: null,
        npm_downloads: 0,
        community_fetched_at: null,
      };

      mockStatement.get.mockReturnValue(mockRow);

      const result = repository.getNode('nodes-base.splitInBatches');

      // Verify order is preserved
      expect(result.outputs[0].displayName).toBe('Done');
      expect(result.outputs[1].displayName).toBe('Loop');
      expect(result.outputNames[0]).toBe('done');
      expect(result.outputNames[1]).toBe('loop');
    });
  });

  describe('parseNodeRow with outputs', () => {
    it('should parse node row with outputs correctly using parseNodeRow', () => {
      const outputs = [{ displayName: 'Output' }];
      const outputNames = ['main'];

      const mockRow = {
        node_type: 'nodes-base.test',
        display_name: 'Test',
        description: 'Test node',
        category: 'misc',
        development_style: 'programmatic',
        package_name: 'n8n-nodes-base',
        is_ai_tool: 0,
        is_trigger: 0,
        is_webhook: 0,
        is_versioned: 0,
        is_tool_variant: 0,
        tool_variant_of: null,
        has_tool_variant: 0,
        version: '1',
        properties_schema: JSON.stringify([]),
        operations: JSON.stringify([]),
        credentials_required: JSON.stringify([]),
        documentation: null,
        outputs: JSON.stringify(outputs),
        output_names: JSON.stringify(outputNames),
        is_community: 0,
        is_verified: 0,
        author_name: null,
        author_github_url: null,
        npm_package_name: null,
        npm_version: null,
        npm_downloads: 0,
        community_fetched_at: null,
      };

      mockStatement.all.mockReturnValue([mockRow]);

      const results = repository.getAllNodes(1);

      expect(results[0].outputs).toEqual(outputs);
      expect(results[0].outputNames).toEqual(outputNames);
    });

    it('should handle empty string as null for outputs', () => {
      const mockRow = {
        node_type: 'nodes-base.empty',
        display_name: 'Empty',
        description: 'Empty node',
        category: 'misc',
        development_style: 'programmatic',
        package_name: 'n8n-nodes-base',
        is_ai_tool: 0,
        is_trigger: 0,
        is_webhook: 0,
        is_versioned: 0,
        is_tool_variant: 0,
        tool_variant_of: null,
        has_tool_variant: 0,
        version: '1',
        properties_schema: JSON.stringify([]),
        operations: JSON.stringify([]),
        credentials_required: JSON.stringify([]),
        documentation: null,
        outputs: '', // empty string
        output_names: '', // empty string
        is_community: 0,
        is_verified: 0,
        author_name: null,
        author_github_url: null,
        npm_package_name: null,
        npm_version: null,
        npm_downloads: 0,
        community_fetched_at: null,
      };

      mockStatement.all.mockReturnValue([mockRow]);

      const results = repository.getAllNodes(1);

      // Empty strings should be treated as null since they fail JSON parsing
      expect(results[0].outputs).toBe(null);
      expect(results[0].outputNames).toBe(null);
    });
  });

  describe('complex output structures', () => {
    it('should handle complex output objects with metadata', () => {
      const complexOutputs = [
        {
          displayName: 'Done',
          name: 'done',
          type: 'main',
          hint: 'Receives the final data after all batches have been processed',
          description: 'Final results when loop completes',
          index: 0
        },
        {
          displayName: 'Loop',
          name: 'loop',
          type: 'main', 
          hint: 'Receives the current batch data during each iteration',
          description: 'Current batch data during iteration',
          index: 1
        }
      ];

      const node: ParsedNode = {
        style: 'programmatic',
        nodeType: 'nodes-base.splitInBatches',
        displayName: 'Split In Batches',
        description: 'Split data into batches',
        category: 'transform',
        properties: [],
        credentials: [],
        isAITool: false,
        isTrigger: false,
        isWebhook: false,
        operations: [],
        version: '3',
        isVersioned: false,
        packageName: 'n8n-nodes-base',
        outputs: complexOutputs,
        outputNames: ['done', 'loop']
      };

      repository.saveNode(node);

      // Simulate retrieval
      const mockRow = {
        node_type: 'nodes-base.splitInBatches',
        display_name: 'Split In Batches',
        description: 'Split data into batches',
        category: 'transform',
        development_style: 'programmatic',
        package_name: 'n8n-nodes-base',
        is_ai_tool: 0,
        is_trigger: 0,
        is_webhook: 0,
        is_versioned: 0,
        is_tool_variant: 0,
        tool_variant_of: null,
        has_tool_variant: 0,
        version: '3',
        properties_schema: JSON.stringify([]),
        operations: JSON.stringify([]),
        credentials_required: JSON.stringify([]),
        documentation: null,
        outputs: JSON.stringify(complexOutputs),
        output_names: JSON.stringify(['done', 'loop']),
        is_community: 0,
        is_verified: 0,
        author_name: null,
        author_github_url: null,
        npm_package_name: null,
        npm_version: null,
        npm_downloads: 0,
        community_fetched_at: null,
      };

      mockStatement.get.mockReturnValue(mockRow);

      const result = repository.getNode('nodes-base.splitInBatches');

      expect(result.outputs).toEqual(complexOutputs);
      expect(result.outputs[0]).toMatchObject({
        displayName: 'Done',
        name: 'done',
        type: 'main',
        hint: 'Receives the final data after all batches have been processed'
      });
    });
  });
});