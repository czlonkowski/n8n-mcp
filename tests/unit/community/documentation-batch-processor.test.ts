import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  DocumentationBatchProcessor,
  BatchProcessorOptions,
  BatchProcessorResult,
} from '@/community/documentation-batch-processor';
import type { NodeRepository } from '@/database/node-repository';
import type { CommunityNodeFetcher } from '@/community/community-node-fetcher';
import type { DocumentationGenerator, DocumentationResult } from '@/community/documentation-generator';

// Mock logger to suppress output during tests
vi.mock('@/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

/**
 * Factory for creating mock community nodes
 */
function createMockCommunityNode(overrides: Partial<{
  nodeType: string;
  displayName: string;
  description: string;
  npmPackageName: string;
  npmReadme: string | null;
  aiDocumentationSummary: object | null;
  npmDownloads: number;
}> = {}) {
  return {
    nodeType: overrides.nodeType || 'n8n-nodes-test.testNode',
    displayName: overrides.displayName || 'Test Node',
    description: overrides.description || 'A test community node',
    npmPackageName: overrides.npmPackageName || 'n8n-nodes-test',
    npmReadme: overrides.npmReadme === undefined ? null : overrides.npmReadme,
    aiDocumentationSummary: overrides.aiDocumentationSummary || null,
    npmDownloads: overrides.npmDownloads || 1000,
  };
}

/**
 * Factory for creating mock documentation summaries
 */
function createMockDocumentationSummary(nodeType: string) {
  return {
    purpose: `Node ${nodeType} does something useful`,
    capabilities: ['capability1', 'capability2'],
    authentication: 'API key required',
    commonUseCases: ['use case 1'],
    limitations: [],
    relatedNodes: [],
  };
}

/**
 * Create mock NodeRepository
 */
function createMockRepository(): NodeRepository {
  return {
    getCommunityNodes: vi.fn().mockReturnValue([]),
    getCommunityNodesWithoutReadme: vi.fn().mockReturnValue([]),
    getCommunityNodesWithoutAISummary: vi.fn().mockReturnValue([]),
    updateNodeReadme: vi.fn(),
    updateNodeAISummary: vi.fn(),
    getDocumentationStats: vi.fn().mockReturnValue({
      total: 10,
      withReadme: 5,
      withAISummary: 3,
      needingReadme: 5,
      needingAISummary: 2,
    }),
  } as unknown as NodeRepository;
}

/**
 * Create mock CommunityNodeFetcher
 */
function createMockFetcher(): CommunityNodeFetcher {
  return {
    fetchReadmesBatch: vi.fn().mockResolvedValue(new Map()),
  } as unknown as CommunityNodeFetcher;
}

/**
 * Create mock DocumentationGenerator
 */
function createMockGenerator(): DocumentationGenerator {
  return {
    testConnection: vi.fn().mockResolvedValue({ success: true, message: 'Connected' }),
    generateBatch: vi.fn().mockResolvedValue([]),
    generateSummary: vi.fn(),
  } as unknown as DocumentationGenerator;
}

describe('DocumentationBatchProcessor', () => {
  let processor: DocumentationBatchProcessor;
  let mockRepository: ReturnType<typeof createMockRepository>;
  let mockFetcher: ReturnType<typeof createMockFetcher>;
  let mockGenerator: ReturnType<typeof createMockGenerator>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRepository = createMockRepository();
    mockFetcher = createMockFetcher();
    mockGenerator = createMockGenerator();
    processor = new DocumentationBatchProcessor(mockRepository, mockFetcher, mockGenerator);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should create instance with all dependencies', () => {
      expect(processor).toBeDefined();
    });

    it('should use provided repository', () => {
      const customRepo = createMockRepository();
      const proc = new DocumentationBatchProcessor(customRepo);
      expect(proc).toBeDefined();
    });
  });

  describe('processAll - default options', () => {
    it('should process both READMEs and summaries with default options', async () => {
      const nodes = [
        createMockCommunityNode({ nodeType: 'node1', npmPackageName: 'pkg1' }),
        createMockCommunityNode({ nodeType: 'node2', npmPackageName: 'pkg2' }),
      ];

      vi.mocked(mockRepository.getCommunityNodes).mockReturnValue(nodes);
      vi.mocked(mockFetcher.fetchReadmesBatch).mockResolvedValue(
        new Map([
          ['pkg1', '# README for pkg1'],
          ['pkg2', '# README for pkg2'],
        ])
      );

      const nodesWithReadme = [
        createMockCommunityNode({ nodeType: 'node1', npmPackageName: 'pkg1', npmReadme: '# README' }),
      ];
      vi.mocked(mockRepository.getCommunityNodes).mockReturnValue(nodesWithReadme);
      vi.mocked(mockGenerator.generateBatch).mockResolvedValue([
        {
          nodeType: 'node1',
          summary: createMockDocumentationSummary('node1'),
        },
      ]);

      const result = await processor.processAll();

      expect(result).toBeDefined();
      expect(result.errors).toEqual([]);
      expect(result.durationSeconds).toBeGreaterThanOrEqual(0);
    });

    it('should return result with duration even when no nodes to process', async () => {
      vi.mocked(mockRepository.getCommunityNodes).mockReturnValue([]);

      const result = await processor.processAll();

      expect(result.readmesFetched).toBe(0);
      expect(result.readmesFailed).toBe(0);
      expect(result.summariesGenerated).toBe(0);
      expect(result.summariesFailed).toBe(0);
      expect(result.durationSeconds).toBeGreaterThanOrEqual(0);
    });

    it('should accumulate skipped counts from both phases', async () => {
      const result = await processor.processAll({
        skipExistingReadme: true,
        skipExistingSummary: true,
      });

      expect(result).toBeDefined();
      expect(typeof result.skipped).toBe('number');
    });
  });

  describe('processAll - readmeOnly option', () => {
    it('should skip AI generation when readmeOnly is true', async () => {
      const nodes = [
        createMockCommunityNode({ nodeType: 'node1', npmPackageName: 'pkg1' }),
      ];

      vi.mocked(mockRepository.getCommunityNodes).mockReturnValue(nodes);
      vi.mocked(mockFetcher.fetchReadmesBatch).mockResolvedValue(
        new Map([['pkg1', '# README content']])
      );

      const result = await processor.processAll({ readmeOnly: true });

      expect(mockGenerator.testConnection).not.toHaveBeenCalled();
      expect(mockGenerator.generateBatch).not.toHaveBeenCalled();
      expect(result.summariesGenerated).toBe(0);
      expect(result.summariesFailed).toBe(0);
    });

    it('should still fetch READMEs when readmeOnly is true', async () => {
      const nodes = [
        createMockCommunityNode({ nodeType: 'node1', npmPackageName: 'pkg1' }),
      ];

      vi.mocked(mockRepository.getCommunityNodes).mockReturnValue(nodes);
      vi.mocked(mockFetcher.fetchReadmesBatch).mockResolvedValue(
        new Map([['pkg1', '# README content']])
      );

      await processor.processAll({ readmeOnly: true });

      expect(mockFetcher.fetchReadmesBatch).toHaveBeenCalledTimes(1);
      expect(mockRepository.updateNodeReadme).toHaveBeenCalledWith('node1', '# README content');
    });
  });

  describe('processAll - summaryOnly option', () => {
    it('should skip README fetching when summaryOnly is true', async () => {
      const nodesWithReadme = [
        createMockCommunityNode({ nodeType: 'node1', npmReadme: '# Existing README' }),
      ];

      vi.mocked(mockRepository.getCommunityNodes).mockReturnValue(nodesWithReadme);
      vi.mocked(mockGenerator.generateBatch).mockResolvedValue([
        {
          nodeType: 'node1',
          summary: createMockDocumentationSummary('node1'),
        },
      ]);

      const result = await processor.processAll({ summaryOnly: true });

      expect(mockFetcher.fetchReadmesBatch).not.toHaveBeenCalled();
      expect(result.readmesFetched).toBe(0);
      expect(result.readmesFailed).toBe(0);
    });

    it('should still generate summaries when summaryOnly is true', async () => {
      const nodesWithReadme = [
        createMockCommunityNode({ nodeType: 'node1', npmReadme: '# README' }),
      ];

      vi.mocked(mockRepository.getCommunityNodes).mockReturnValue(nodesWithReadme);
      vi.mocked(mockGenerator.generateBatch).mockResolvedValue([
        {
          nodeType: 'node1',
          summary: createMockDocumentationSummary('node1'),
        },
      ]);

      await processor.processAll({ summaryOnly: true });

      expect(mockGenerator.testConnection).toHaveBeenCalled();
      expect(mockGenerator.generateBatch).toHaveBeenCalled();
    });
  });

  describe('processAll - skipExistingReadme option', () => {
    it('should use getCommunityNodesWithoutReadme when skipExistingReadme is true', async () => {
      const nodesWithoutReadme = [
        createMockCommunityNode({ nodeType: 'node1', npmPackageName: 'pkg1', npmReadme: null }),
      ];

      vi.mocked(mockRepository.getCommunityNodesWithoutReadme).mockReturnValue(nodesWithoutReadme);
      vi.mocked(mockFetcher.fetchReadmesBatch).mockResolvedValue(
        new Map([['pkg1', '# New README']])
      );

      await processor.processAll({ skipExistingReadme: true, readmeOnly: true });

      expect(mockRepository.getCommunityNodesWithoutReadme).toHaveBeenCalled();
      expect(mockRepository.getCommunityNodes).not.toHaveBeenCalled();
    });

    it('should use getCommunityNodes when skipExistingReadme is false', async () => {
      const allNodes = [
        createMockCommunityNode({ nodeType: 'node1', npmPackageName: 'pkg1', npmReadme: '# Old' }),
        createMockCommunityNode({ nodeType: 'node2', npmPackageName: 'pkg2', npmReadme: null }),
      ];

      vi.mocked(mockRepository.getCommunityNodes).mockReturnValue(allNodes);
      vi.mocked(mockFetcher.fetchReadmesBatch).mockResolvedValue(new Map());

      await processor.processAll({ skipExistingReadme: false, readmeOnly: true });

      expect(mockRepository.getCommunityNodes).toHaveBeenCalledWith({ orderBy: 'downloads' });
      expect(mockRepository.getCommunityNodesWithoutReadme).not.toHaveBeenCalled();
    });
  });

  describe('processAll - skipExistingSummary option', () => {
    it('should use getCommunityNodesWithoutAISummary when skipExistingSummary is true', async () => {
      const nodesWithoutSummary = [
        createMockCommunityNode({
          nodeType: 'node1',
          npmReadme: '# README',
          aiDocumentationSummary: null,
        }),
      ];

      vi.mocked(mockRepository.getCommunityNodesWithoutAISummary).mockReturnValue(nodesWithoutSummary);
      vi.mocked(mockGenerator.generateBatch).mockResolvedValue([
        { nodeType: 'node1', summary: createMockDocumentationSummary('node1') },
      ]);

      await processor.processAll({ skipExistingSummary: true, summaryOnly: true });

      expect(mockRepository.getCommunityNodesWithoutAISummary).toHaveBeenCalled();
    });

    it('should filter nodes by existing README when skipExistingSummary is false', async () => {
      const allNodes = [
        createMockCommunityNode({ nodeType: 'node1', npmReadme: '# README1' }),
        createMockCommunityNode({ nodeType: 'node2', npmReadme: '' }), // Empty README
        createMockCommunityNode({ nodeType: 'node3', npmReadme: null }), // No README
      ];

      vi.mocked(mockRepository.getCommunityNodes).mockReturnValue(allNodes);
      vi.mocked(mockGenerator.generateBatch).mockResolvedValue([
        { nodeType: 'node1', summary: createMockDocumentationSummary('node1') },
      ]);

      await processor.processAll({ skipExistingSummary: false, summaryOnly: true });

      // Should filter to only nodes with non-empty README
      expect(mockGenerator.generateBatch).toHaveBeenCalled();
      const callArgs = vi.mocked(mockGenerator.generateBatch).mock.calls[0];
      expect(callArgs[0]).toHaveLength(1);
      expect(callArgs[0][0].nodeType).toBe('node1');
    });
  });

  describe('processAll - limit option', () => {
    it('should limit number of nodes processed for READMEs', async () => {
      const manyNodes = Array.from({ length: 10 }, (_, i) =>
        createMockCommunityNode({
          nodeType: `node${i}`,
          npmPackageName: `pkg${i}`,
        })
      );

      vi.mocked(mockRepository.getCommunityNodes).mockReturnValue(manyNodes);
      vi.mocked(mockFetcher.fetchReadmesBatch).mockResolvedValue(new Map());

      await processor.processAll({ limit: 3, readmeOnly: true });

      expect(mockFetcher.fetchReadmesBatch).toHaveBeenCalled();
      const packageNames = vi.mocked(mockFetcher.fetchReadmesBatch).mock.calls[0][0];
      expect(packageNames).toHaveLength(3);
    });

    it('should limit number of nodes processed for summaries', async () => {
      const manyNodes = Array.from({ length: 10 }, (_, i) =>
        createMockCommunityNode({
          nodeType: `node${i}`,
          npmPackageName: `pkg${i}`,
          npmReadme: `# README ${i}`,
        })
      );

      vi.mocked(mockRepository.getCommunityNodes).mockReturnValue(manyNodes);
      vi.mocked(mockGenerator.generateBatch).mockResolvedValue([]);

      await processor.processAll({ limit: 5, summaryOnly: true });

      expect(mockGenerator.generateBatch).toHaveBeenCalled();
      const inputs = vi.mocked(mockGenerator.generateBatch).mock.calls[0][0];
      expect(inputs).toHaveLength(5);
    });
  });

  describe('fetchReadmes - progress tracking', () => {
    it('should call progress callback during README fetching', async () => {
      const nodes = [
        createMockCommunityNode({ nodeType: 'node1', npmPackageName: 'pkg1' }),
        createMockCommunityNode({ nodeType: 'node2', npmPackageName: 'pkg2' }),
      ];

      vi.mocked(mockRepository.getCommunityNodes).mockReturnValue(nodes);
      vi.mocked(mockFetcher.fetchReadmesBatch).mockImplementation(
        async (packageNames, progressCallback) => {
          if (progressCallback) {
            progressCallback('Fetching READMEs', 1, 2);
            progressCallback('Fetching READMEs', 2, 2);
          }
          return new Map([
            ['pkg1', '# README 1'],
            ['pkg2', '# README 2'],
          ]);
        }
      );

      const progressCallback = vi.fn();
      await processor.processAll({ readmeOnly: true, progressCallback });

      expect(mockFetcher.fetchReadmesBatch).toHaveBeenCalledWith(
        expect.any(Array),
        progressCallback,
        expect.any(Number)
      );
    });

    it('should pass concurrency option to fetchReadmesBatch', async () => {
      const nodes = [
        createMockCommunityNode({ nodeType: 'node1', npmPackageName: 'pkg1' }),
      ];

      vi.mocked(mockRepository.getCommunityNodes).mockReturnValue(nodes);
      vi.mocked(mockFetcher.fetchReadmesBatch).mockResolvedValue(new Map());

      await processor.processAll({ readmeOnly: true, readmeConcurrency: 10 });

      expect(mockFetcher.fetchReadmesBatch).toHaveBeenCalledWith(
        ['pkg1'],
        undefined,
        10
      );
    });

    it('should use default concurrency of 5 for README fetching', async () => {
      const nodes = [
        createMockCommunityNode({ nodeType: 'node1', npmPackageName: 'pkg1' }),
      ];

      vi.mocked(mockRepository.getCommunityNodes).mockReturnValue(nodes);
      vi.mocked(mockFetcher.fetchReadmesBatch).mockResolvedValue(new Map());

      await processor.processAll({ readmeOnly: true });

      expect(mockFetcher.fetchReadmesBatch).toHaveBeenCalledWith(
        ['pkg1'],
        undefined,
        5
      );
    });
  });

  describe('generateSummaries - LLM connection test failure', () => {
    it('should fail all summaries when LLM connection fails', async () => {
      const nodes = [
        createMockCommunityNode({ nodeType: 'node1', npmReadme: '# README 1' }),
        createMockCommunityNode({ nodeType: 'node2', npmReadme: '# README 2' }),
        createMockCommunityNode({ nodeType: 'node3', npmReadme: '# README 3' }),
      ];

      vi.mocked(mockRepository.getCommunityNodes).mockReturnValue(nodes);
      vi.mocked(mockGenerator.testConnection).mockResolvedValue({
        success: false,
        message: 'Connection refused: ECONNREFUSED',
      });

      const result = await processor.processAll({ summaryOnly: true });

      expect(result.summariesGenerated).toBe(0);
      expect(result.summariesFailed).toBe(3);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('LLM connection failed');
      expect(result.errors[0]).toContain('Connection refused');
    });

    it('should not call generateBatch when connection test fails', async () => {
      const nodes = [
        createMockCommunityNode({ nodeType: 'node1', npmReadme: '# README' }),
      ];

      vi.mocked(mockRepository.getCommunityNodes).mockReturnValue(nodes);
      vi.mocked(mockGenerator.testConnection).mockResolvedValue({
        success: false,
        message: 'Model not found',
      });

      await processor.processAll({ summaryOnly: true });

      expect(mockGenerator.generateBatch).not.toHaveBeenCalled();
    });

    it('should proceed with generation when connection test succeeds', async () => {
      const nodes = [
        createMockCommunityNode({ nodeType: 'node1', npmReadme: '# README' }),
      ];

      vi.mocked(mockRepository.getCommunityNodes).mockReturnValue(nodes);
      vi.mocked(mockGenerator.testConnection).mockResolvedValue({
        success: true,
        message: 'Connected to qwen3-4b',
      });
      vi.mocked(mockGenerator.generateBatch).mockResolvedValue([
        { nodeType: 'node1', summary: createMockDocumentationSummary('node1') },
      ]);

      const result = await processor.processAll({ summaryOnly: true });

      expect(mockGenerator.generateBatch).toHaveBeenCalled();
      expect(result.summariesGenerated).toBe(1);
    });
  });

  describe('getStats', () => {
    it('should return documentation statistics from repository', () => {
      const expectedStats = {
        total: 25,
        withReadme: 20,
        withAISummary: 15,
        needingReadme: 5,
        needingAISummary: 5,
      };

      vi.mocked(mockRepository.getDocumentationStats).mockReturnValue(expectedStats);

      const stats = processor.getStats();

      expect(stats).toEqual(expectedStats);
      expect(mockRepository.getDocumentationStats).toHaveBeenCalled();
    });

    it('should handle empty statistics', () => {
      const emptyStats = {
        total: 0,
        withReadme: 0,
        withAISummary: 0,
        needingReadme: 0,
        needingAISummary: 0,
      };

      vi.mocked(mockRepository.getDocumentationStats).mockReturnValue(emptyStats);

      const stats = processor.getStats();

      expect(stats.total).toBe(0);
      expect(stats.withReadme).toBe(0);
    });
  });

  describe('error handling', () => {
    it('should collect errors when README update fails', async () => {
      const nodes = [
        createMockCommunityNode({ nodeType: 'node1', npmPackageName: 'pkg1' }),
      ];

      vi.mocked(mockRepository.getCommunityNodes).mockReturnValue(nodes);
      vi.mocked(mockFetcher.fetchReadmesBatch).mockResolvedValue(
        new Map([['pkg1', '# README']])
      );
      vi.mocked(mockRepository.updateNodeReadme).mockImplementation(() => {
        throw new Error('Database write error');
      });

      const result = await processor.processAll({ readmeOnly: true });

      expect(result.readmesFetched).toBe(0);
      expect(result.readmesFailed).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Failed to save README');
      expect(result.errors[0]).toContain('Database write error');
    });

    it('should collect errors when summary generation fails', async () => {
      const nodes = [
        createMockCommunityNode({ nodeType: 'node1', npmReadme: '# README' }),
      ];

      vi.mocked(mockRepository.getCommunityNodes).mockReturnValue(nodes);
      vi.mocked(mockGenerator.generateBatch).mockResolvedValue([
        {
          nodeType: 'node1',
          summary: createMockDocumentationSummary('node1'),
          error: 'LLM timeout',
        },
      ]);

      const result = await processor.processAll({ summaryOnly: true });

      expect(result.summariesGenerated).toBe(0);
      expect(result.summariesFailed).toBe(1);
      expect(result.errors).toContain('node1: LLM timeout');
    });

    it('should collect errors when summary storage fails', async () => {
      const nodes = [
        createMockCommunityNode({ nodeType: 'node1', npmReadme: '# README' }),
      ];

      vi.mocked(mockRepository.getCommunityNodes).mockReturnValue(nodes);
      vi.mocked(mockGenerator.generateBatch).mockResolvedValue([
        { nodeType: 'node1', summary: createMockDocumentationSummary('node1') },
      ]);
      vi.mocked(mockRepository.updateNodeAISummary).mockImplementation(() => {
        throw new Error('Database constraint violation');
      });

      const result = await processor.processAll({ summaryOnly: true });

      expect(result.summariesGenerated).toBe(0);
      expect(result.summariesFailed).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Failed to save summary');
    });

    it('should handle batch processing exception gracefully', async () => {
      vi.mocked(mockRepository.getCommunityNodes).mockImplementation(() => {
        throw new Error('Database connection lost');
      });

      const result = await processor.processAll();

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Batch processing failed');
      expect(result.errors[0]).toContain('Database connection lost');
      expect(result.durationSeconds).toBeGreaterThanOrEqual(0);
    });

    it('should accumulate errors from both README and summary phases', async () => {
      const nodes = [
        createMockCommunityNode({ nodeType: 'node1', npmPackageName: 'pkg1' }),
      ];

      vi.mocked(mockRepository.getCommunityNodes).mockReturnValue(nodes);
      vi.mocked(mockFetcher.fetchReadmesBatch).mockResolvedValue(new Map());

      // First call for README phase returns nodes, subsequent calls for summary phase
      vi.mocked(mockRepository.getCommunityNodes)
        .mockReturnValueOnce(nodes)  // README phase
        .mockReturnValue([]);         // Summary phase (no nodes with README)

      const result = await processor.processAll();

      // Should complete without errors since no READMEs fetched means no summary phase
      expect(result.errors).toEqual([]);
    });
  });

  describe('README fetching edge cases', () => {
    it('should skip nodes without npmPackageName', async () => {
      const nodes = [
        createMockCommunityNode({ nodeType: 'node1', npmPackageName: 'pkg1' }),
        { ...createMockCommunityNode({ nodeType: 'node2' }), npmPackageName: undefined },
        { ...createMockCommunityNode({ nodeType: 'node3' }), npmPackageName: null },
      ];

      vi.mocked(mockRepository.getCommunityNodes).mockReturnValue(nodes as any);
      vi.mocked(mockFetcher.fetchReadmesBatch).mockResolvedValue(
        new Map([['pkg1', '# README']])
      );

      await processor.processAll({ readmeOnly: true });

      // Should only request README for pkg1
      expect(mockFetcher.fetchReadmesBatch).toHaveBeenCalledWith(
        ['pkg1'],
        undefined,
        5
      );
    });

    it('should handle failed README fetches (null in map)', async () => {
      const nodes = [
        createMockCommunityNode({ nodeType: 'node1', npmPackageName: 'pkg1' }),
        createMockCommunityNode({ nodeType: 'node2', npmPackageName: 'pkg2' }),
      ];

      vi.mocked(mockRepository.getCommunityNodes).mockReturnValue(nodes);
      vi.mocked(mockFetcher.fetchReadmesBatch).mockResolvedValue(
        new Map([
          ['pkg1', '# README'],
          ['pkg2', null], // Failed to fetch
        ])
      );

      const result = await processor.processAll({ readmeOnly: true });

      expect(result.readmesFetched).toBe(1);
      expect(result.readmesFailed).toBe(1);
      expect(mockRepository.updateNodeReadme).toHaveBeenCalledTimes(1);
    });

    it('should handle empty package name list', async () => {
      vi.mocked(mockRepository.getCommunityNodes).mockReturnValue([]);

      const result = await processor.processAll({ readmeOnly: true });

      expect(mockFetcher.fetchReadmesBatch).not.toHaveBeenCalled();
      expect(result.readmesFetched).toBe(0);
      expect(result.readmesFailed).toBe(0);
    });

    it('should fetch a README once for a package that ships several nodes (#967)', async () => {
      const nodes = [
        createMockCommunityNode({ nodeType: 'pkg1.first', npmPackageName: 'pkg1' }),
        createMockCommunityNode({ nodeType: 'pkg1.second', npmPackageName: 'pkg1' }),
      ];

      vi.mocked(mockRepository.getCommunityNodes).mockReturnValue(nodes);
      vi.mocked(mockFetcher.fetchReadmesBatch).mockResolvedValue(
        new Map([['pkg1', '# README']])
      );

      const result = await processor.processAll({ readmeOnly: true });

      expect(mockFetcher.fetchReadmesBatch).toHaveBeenCalledWith(['pkg1'], undefined, 5);
      // Both rows still get the README.
      expect(result.readmesFetched).toBe(2);
      expect(mockRepository.updateNodeReadme).toHaveBeenCalledWith('pkg1.first', '# README');
      expect(mockRepository.updateNodeReadme).toHaveBeenCalledWith('pkg1.second', '# README');
    });
  });

  describe('summary generation edge cases', () => {
    it('should generate one summary per package and store it on every row (#967)', async () => {
      const nodes = [
        createMockCommunityNode({
          nodeType: 'pkg1.first',
          displayName: 'First',
          npmPackageName: 'pkg1',
          npmReadme: '# README',
        }),
        createMockCommunityNode({
          nodeType: 'pkg1.second',
          displayName: 'Second',
          npmPackageName: 'pkg1',
          npmReadme: '# README',
        }),
      ];

      vi.mocked(mockRepository.getCommunityNodes).mockReturnValue(nodes);
      vi.mocked(mockGenerator.generateBatch).mockResolvedValue([
        { nodeType: 'pkg1.first', summary: createMockDocumentationSummary('pkg1') },
      ]);

      const result = await processor.processAll({ summaryOnly: true });

      const inputs = vi.mocked(mockGenerator.generateBatch).mock.calls[0][0];
      expect(inputs).toHaveLength(1);
      // The prompt must describe the package, not whichever sibling was picked.
      expect(inputs[0].nodeNames).toEqual(['First', 'Second']);
      expect(inputs[0].npmPackageName).toBe('pkg1');
      expect(result.summariesGenerated).toBe(2);
      expect(mockRepository.updateNodeAISummary).toHaveBeenCalledWith(
        'pkg1.first',
        expect.any(Object)
      );
      expect(mockRepository.updateNodeAISummary).toHaveBeenCalledWith(
        'pkg1.second',
        expect.any(Object)
      );
    });

    it('should count every row of a package as failed when its summary fails (#967)', async () => {
      const nodes = [
        createMockCommunityNode({
          nodeType: 'pkg1.first',
          npmPackageName: 'pkg1',
          npmReadme: '# README',
        }),
        createMockCommunityNode({
          nodeType: 'pkg1.second',
          npmPackageName: 'pkg1',
          npmReadme: '# README',
        }),
      ];

      vi.mocked(mockRepository.getCommunityNodes).mockReturnValue(nodes);
      vi.mocked(mockGenerator.generateBatch).mockResolvedValue([
        { nodeType: 'pkg1.first', summary: {} as any, error: 'LLM timeout' },
      ]);

      const result = await processor.processAll({ summaryOnly: true });

      expect(result.summariesGenerated).toBe(0);
      expect(result.summariesFailed).toBe(2);
      expect(mockRepository.updateNodeAISummary).not.toHaveBeenCalled();
    });

    it('should skip nodes without README for summary generation', async () => {
      const nodes = [
        createMockCommunityNode({ nodeType: 'node1', npmReadme: '# README' }),
        createMockCommunityNode({ nodeType: 'node2', npmReadme: '' }),
        createMockCommunityNode({ nodeType: 'node3', npmReadme: null }),
      ];

      vi.mocked(mockRepository.getCommunityNodes).mockReturnValue(nodes);
      vi.mocked(mockGenerator.generateBatch).mockResolvedValue([
        { nodeType: 'node1', summary: createMockDocumentationSummary('node1') },
      ]);

      await processor.processAll({ summaryOnly: true });

      const inputs = vi.mocked(mockGenerator.generateBatch).mock.calls[0][0];
      expect(inputs).toHaveLength(1);
      expect(inputs[0].nodeType).toBe('node1');
    });

    it('should pass correct concurrency to generateBatch', async () => {
      const nodes = [
        createMockCommunityNode({ nodeType: 'node1', npmReadme: '# README' }),
      ];

      vi.mocked(mockRepository.getCommunityNodes).mockReturnValue(nodes);
      vi.mocked(mockGenerator.generateBatch).mockResolvedValue([]);

      await processor.processAll({ summaryOnly: true, llmConcurrency: 10 });

      expect(mockGenerator.generateBatch).toHaveBeenCalledWith(
        expect.any(Array),
        10,
        undefined
      );
    });

    it('should use default LLM concurrency of 3', async () => {
      const nodes = [
        createMockCommunityNode({ nodeType: 'node1', npmReadme: '# README' }),
      ];

      vi.mocked(mockRepository.getCommunityNodes).mockReturnValue(nodes);
      vi.mocked(mockGenerator.generateBatch).mockResolvedValue([]);

      await processor.processAll({ summaryOnly: true });

      expect(mockGenerator.generateBatch).toHaveBeenCalledWith(
        expect.any(Array),
        3,
        undefined
      );
    });

    it('should handle empty node list for summary generation', async () => {
      vi.mocked(mockRepository.getCommunityNodes).mockReturnValue([]);

      const result = await processor.processAll({ summaryOnly: true });

      expect(mockGenerator.testConnection).not.toHaveBeenCalled();
      expect(mockGenerator.generateBatch).not.toHaveBeenCalled();
      expect(result.summariesGenerated).toBe(0);
    });
  });

  describe('concurrency options', () => {
    it('should respect custom readmeConcurrency option', async () => {
      const nodes = [
        createMockCommunityNode({ nodeType: 'node1', npmPackageName: 'pkg1' }),
      ];

      vi.mocked(mockRepository.getCommunityNodes).mockReturnValue(nodes);
      vi.mocked(mockFetcher.fetchReadmesBatch).mockResolvedValue(new Map());

      await processor.processAll({ readmeOnly: true, readmeConcurrency: 1 });

      expect(mockFetcher.fetchReadmesBatch).toHaveBeenCalledWith(
        expect.any(Array),
        undefined,
        1
      );
    });

    it('should respect custom llmConcurrency option', async () => {
      const nodes = [
        createMockCommunityNode({ nodeType: 'node1', npmReadme: '# README' }),
      ];

      vi.mocked(mockRepository.getCommunityNodes).mockReturnValue(nodes);
      vi.mocked(mockGenerator.generateBatch).mockResolvedValue([]);

      await processor.processAll({ summaryOnly: true, llmConcurrency: 1 });

      expect(mockGenerator.generateBatch).toHaveBeenCalledWith(
        expect.any(Array),
        1,
        undefined
      );
    });
  });

  describe('progress callback propagation', () => {
    it('should pass progress callback to summary generation', async () => {
      const nodes = [
        createMockCommunityNode({ nodeType: 'node1', npmReadme: '# README' }),
      ];

      vi.mocked(mockRepository.getCommunityNodes).mockReturnValue(nodes);
      vi.mocked(mockGenerator.generateBatch).mockResolvedValue([]);

      const progressCallback = vi.fn();
      await processor.processAll({ summaryOnly: true, progressCallback });

      expect(mockGenerator.generateBatch).toHaveBeenCalledWith(
        expect.any(Array),
        expect.any(Number),
        progressCallback
      );
    });

    it('should pass progress callback to README fetching', async () => {
      const nodes = [
        createMockCommunityNode({ nodeType: 'node1', npmPackageName: 'pkg1' }),
      ];

      vi.mocked(mockRepository.getCommunityNodes).mockReturnValue(nodes);
      vi.mocked(mockFetcher.fetchReadmesBatch).mockResolvedValue(new Map());

      const progressCallback = vi.fn();
      await processor.processAll({ readmeOnly: true, progressCallback });

      expect(mockFetcher.fetchReadmesBatch).toHaveBeenCalledWith(
        expect.any(Array),
        progressCallback,
        expect.any(Number)
      );
    });
  });

  describe('documentation input preparation', () => {
    it('should prepare correct input for documentation generator', async () => {
      const nodes = [
        {
          nodeType: 'n8n-nodes-test.testNode',
          displayName: 'Test Node',
          description: 'A test node',
          npmPackageName: 'n8n-nodes-test',
          npmReadme: '# Test README\nThis is a test.',
        },
      ];

      vi.mocked(mockRepository.getCommunityNodes).mockReturnValue(nodes as any);
      vi.mocked(mockGenerator.generateBatch).mockResolvedValue([
        { nodeType: 'n8n-nodes-test.testNode', summary: createMockDocumentationSummary('test') },
      ]);

      await processor.processAll({ summaryOnly: true });

      const inputs = vi.mocked(mockGenerator.generateBatch).mock.calls[0][0];
      expect(inputs[0]).toEqual({
        nodeType: 'n8n-nodes-test.testNode',
        displayName: 'Test Node',
        description: 'A test node',
        readme: '# Test README\nThis is a test.',
        npmPackageName: 'n8n-nodes-test',
        nodeNames: ['Test Node'],
      });
    });

    it('should handle missing optional fields', async () => {
      const nodes = [
        {
          nodeType: 'node1',
          displayName: 'Node 1',
          npmReadme: '# README',
          // Missing description and npmPackageName
        },
      ];

      vi.mocked(mockRepository.getCommunityNodes).mockReturnValue(nodes as any);
      vi.mocked(mockGenerator.generateBatch).mockResolvedValue([]);

      await processor.processAll({ summaryOnly: true });

      const inputs = vi.mocked(mockGenerator.generateBatch).mock.calls[0][0];
      expect(inputs[0].description).toBeUndefined();
      expect(inputs[0].npmPackageName).toBeUndefined();
    });
  });
});
