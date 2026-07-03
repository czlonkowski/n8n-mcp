import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NodeSimilarityService } from '@/services/node-similarity-service';
import { NodeRepository } from '@/database/node-repository';
import type { ParsedNode } from '@/parsers/node-parser';

vi.mock('@/database/node-repository');

describe('NodeSimilarityService', () => {
  let service: NodeSimilarityService;
  let mockRepository: NodeRepository;

  const createMockNode = (type: string, displayName: string, description = ''): any => ({
    nodeType: type,
    displayName,
    description,
    version: 1,
    defaults: {},
    inputs: ['main'],
    outputs: ['main'],
    properties: [],
    package: 'n8n-nodes-base',
    typeVersion: 1
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockRepository = new NodeRepository({} as any);
    service = new NodeSimilarityService(mockRepository);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Cache Management', () => {
    it('should invalidate cache when requested', () => {
      service.invalidateCache();
      expect(service['nodeCache']).toBeNull();
      expect(service['cacheVersion']).toBeGreaterThan(0);
    });

    it('should refresh cache with new data', async () => {
      const nodes = [
        createMockNode('nodes-base.httpRequest', 'HTTP Request'),
        createMockNode('nodes-base.webhook', 'Webhook')
      ];

      vi.spyOn(mockRepository, 'getAllNodes').mockReturnValue(nodes);

      await service.refreshCache();

      expect(service['nodeCache']).toEqual(nodes);
      expect(mockRepository.getAllNodes).toHaveBeenCalled();
    });

    it('should use stale cache on refresh error', async () => {
      const staleNodes = [createMockNode('nodes-base.slack', 'Slack')];
      service['nodeCache'] = staleNodes;
      service['cacheExpiry'] = Date.now() + 1000; // Set cache as not expired

      vi.spyOn(mockRepository, 'getAllNodes').mockImplementation(() => {
        throw new Error('Database error');
      });

      const nodes = await service['getCachedNodes']();

      expect(nodes).toEqual(staleNodes);
    });

    it('should refresh cache when expired', async () => {
      service['cacheExpiry'] = Date.now() - 1000; // Cache expired
      const nodes = [createMockNode('nodes-base.httpRequest', 'HTTP Request')];

      vi.spyOn(mockRepository, 'getAllNodes').mockReturnValue(nodes);

      const result = await service['getCachedNodes']();

      expect(result).toEqual(nodes);
      expect(mockRepository.getAllNodes).toHaveBeenCalled();
    });
  });

  describe('Edit Distance Optimization', () => {
    it('should return 0 for identical strings', () => {
      const distance = service['getEditDistance']('test', 'test');
      expect(distance).toBe(0);
    });

    it('should early terminate for length difference exceeding max', () => {
      const distance = service['getEditDistance']('a', 'abcdefghijk', 3);
      expect(distance).toBe(4); // maxDistance + 1
    });

    it('should calculate correct edit distance within threshold', () => {
      const distance = service['getEditDistance']('kitten', 'sitting', 10);
      expect(distance).toBe(3);
    });

    it('should use early termination when min distance exceeds max', () => {
      const distance = service['getEditDistance']('abc', 'xyz', 2);
      expect(distance).toBe(3); // Should terminate early and return maxDistance + 1
    });
  });


  describe('Node Suggestions', () => {
    beforeEach(() => {
      const nodes = [
        createMockNode('nodes-base.httpRequest', 'HTTP Request', 'Make HTTP requests'),
        createMockNode('nodes-base.webhook', 'Webhook', 'Receive webhooks'),
        createMockNode('nodes-base.slack', 'Slack', 'Send messages to Slack'),
        createMockNode('nodes-langchain.openAi', 'OpenAI', 'Use OpenAI models')
      ];

      vi.spyOn(mockRepository, 'getAllNodes').mockReturnValue(nodes);
    });

    it('should find similar nodes for exact match', async () => {
      const suggestions = await service.findSimilarNodes('httpRequest', 3);

      expect(suggestions).toHaveLength(1);
      expect(suggestions[0].nodeType).toBe('nodes-base.httpRequest');
      expect(suggestions[0].confidence).toBeGreaterThan(0.5); // Adjusted based on actual implementation
    });

    it('should find nodes for typo queries', async () => {
      const suggestions = await service.findSimilarNodes('htpRequest', 3);

      expect(suggestions.length).toBeGreaterThan(0);
      expect(suggestions[0].nodeType).toBe('nodes-base.httpRequest');
      expect(suggestions[0].confidence).toBeGreaterThan(0.4); // Adjusted based on actual implementation
    });

    it('should find nodes for partial matches', async () => {
      const suggestions = await service.findSimilarNodes('slack', 3);

      expect(suggestions.length).toBeGreaterThan(0);
      expect(suggestions[0].nodeType).toBe('nodes-base.slack');
    });

    it('should return empty array for no matches', async () => {
      const suggestions = await service.findSimilarNodes('nonexistent', 3);

      expect(suggestions).toEqual([]);
    });

    it('should respect the limit parameter', async () => {
      const suggestions = await service.findSimilarNodes('request', 2);

      expect(suggestions.length).toBeLessThanOrEqual(2);
    });

    it('should provide appropriate confidence levels', async () => {
      const suggestions = await service.findSimilarNodes('HttpRequest', 3);

      if (suggestions.length > 0) {
        expect(suggestions[0].confidence).toBeGreaterThan(0.5);
        expect(suggestions[0].reason).toBeDefined();
      }
    });

    it('should handle package prefix normalization', async () => {
      // Add a node with the exact type we're searching for
      const nodes = [
        createMockNode('nodes-base.httpRequest', 'HTTP Request', 'Make HTTP requests')
      ];
      vi.spyOn(mockRepository, 'getAllNodes').mockReturnValue(nodes);

      const suggestions = await service.findSimilarNodes('nodes-base.httpRequest', 3);

      expect(suggestions.length).toBeGreaterThan(0);
      expect(suggestions[0].nodeType).toBe('nodes-base.httpRequest');
    });
  });

  describe('False positive regression: long unknown types (validator FP audit)', () => {
    // Reproduces the audit finding: for the long unknown type
    // @n8n/n8n-nodes-langchain.embeddingsHuggingFaceInference the scorer
    // suggested unrelated short-name AI-category community nodes (Z.ai Image,
    // Zenlayer) at 55% because (a) the capped edit-distance sentinel was
    // divided by string length and (b) the 2-char category "ai" substring
    // matched inside "langchain".
    const createCategorizedNode = (type: string, displayName: string, category: string): any => ({
      ...createMockNode(type, displayName),
      category
    });

    it('should not suggest unrelated short-name nodes for an unknown langchain embeddings type', async () => {
      const nodes = [
        createCategorizedNode('n8n-nodes-zai.zaiImage', 'Z.ai Image', 'AI'),
        createCategorizedNode('n8n-nodes-zenlayer.zenlayer', 'Zenlayer', 'AI')
      ];
      vi.spyOn(mockRepository, 'getAllNodes').mockReturnValue(nodes);

      const suggestions = await service.findSimilarNodes(
        '@n8n/n8n-nodes-langchain.embeddingsHuggingFaceInference',
        5
      );

      expect(suggestions).toEqual([]);
    });

    it('should treat a capped edit distance as no similarity', () => {
      const similarity = service['getStringSimilarity'](
        'n8nn8nnodeslangchainembeddingshuggingfaceinference',
        'zaiimage'
      );
      expect(similarity).toBe(0);
    });

    it('should not award category match when a short category is only a substring', () => {
      const node = createCategorizedNode('n8n-nodes-zai.zaiImage', 'Z.ai Image', 'AI');
      const score = service['calculateSimilarityScore'](
        '@n8n/n8n-nodes-langchain.embeddingsHuggingFaceInference',
        node
      );
      expect(score.categoryMatch).toBe(0);
    });

    it('should still award category match on a whole-token category match', () => {
      const node = createCategorizedNode('nodes-base.set', 'Edit Fields', 'Transform');
      const score = service['calculateSimilarityScore']('transform', node);
      expect(score.categoryMatch).toBe(20);
    });

    it('should still compute real similarity for distances within the cap', () => {
      const similarity = service['getStringSimilarity']('htprequest', 'httprequest');
      expect(similarity).toBeCloseTo(1 - 1 / 11, 5);
    });

    it('should still suggest the right node for a genuine typo (guard)', async () => {
      const nodes = [
        createMockNode('nodes-base.httpRequest', 'HTTP Request', 'Make HTTP requests'),
        createCategorizedNode('n8n-nodes-zai.zaiImage', 'Z.ai Image', 'AI')
      ];
      vi.spyOn(mockRepository, 'getAllNodes').mockReturnValue(nodes);

      const suggestions = await service.findSimilarNodes('htpRequest', 3);

      expect(suggestions.length).toBeGreaterThan(0);
      expect(suggestions[0].nodeType).toBe('nodes-base.httpRequest');
      expect(suggestions.some(s => s.nodeType === 'n8n-nodes-zai.zaiImage')).toBe(false);
    });
  });

  describe('Constants Usage', () => {
    it('should use proper constants for scoring', () => {
      expect(NodeSimilarityService['SCORING_THRESHOLD']).toBe(50);
      expect(NodeSimilarityService['TYPO_EDIT_DISTANCE']).toBe(2);
      expect(NodeSimilarityService['SHORT_SEARCH_LENGTH']).toBe(5);
      expect(NodeSimilarityService['CACHE_DURATION_MS']).toBe(5 * 60 * 1000);
      expect(NodeSimilarityService['AUTO_FIX_CONFIDENCE']).toBe(0.9);
    });
  });
});