import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  DocumentationGenerator,
  DocumentationGeneratorConfig,
  LLM_PROVIDER_PRESETS,
  createDocumentationGenerator,
} from '../../../src/community/documentation-generator';

// Mock OpenAI to avoid real API calls
vi.mock('openai', () => {
  return {
    default: vi.fn().mockImplementation((config: { baseURL?: string; apiKey?: string }) => ({
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    purpose: 'Test node purpose',
                    capabilities: ['feature1'],
                    authentication: 'API Key',
                    commonUseCases: ['use case'],
                    limitations: [],
                    relatedNodes: [],
                  }),
                },
              },
            ],
          }),
        },
      },
      _config: config,
    })),
  };
});

vi.mock('../../../src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('LLM Provider Integration', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.N8N_MCP_LLM_PROVIDER;
    delete process.env.N8N_MCP_LLM_BASE_URL;
    delete process.env.N8N_MCP_LLM_MODEL;
    delete process.env.N8N_MCP_LLM_API_KEY;
    delete process.env.MINIMAX_API_KEY;
    delete process.env.OPENAI_API_KEY;
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.clearAllMocks();
  });

  describe('MiniMax provider end-to-end', () => {
    it('should generate documentation using minimax preset', async () => {
      process.env.N8N_MCP_LLM_PROVIDER = 'minimax';
      process.env.MINIMAX_API_KEY = 'test-minimax-key';

      const generator = createDocumentationGenerator();
      const result = await generator.generateSummary({
        nodeType: 'n8n-nodes-community.test',
        displayName: 'Test Node',
        readme: '# Test Node\nA test community node.',
      });

      expect(result.error).toBeUndefined();
      expect(result.summary.purpose).toBe('Test node purpose');
    });

    it('should handle MiniMax response with thinking tags in batch mode', async () => {
      process.env.N8N_MCP_LLM_PROVIDER = 'minimax';
      process.env.MINIMAX_API_KEY = 'test-key';

      const generator = createDocumentationGenerator();

      // Inject mock client directly to ensure batch works
      const mockCreate = vi.fn().mockResolvedValue({
        choices: [
          {
            message: {
              content:
                '<think>Analyzing node...</think>\n' +
                JSON.stringify({
                  purpose: 'Test node purpose',
                  capabilities: ['feature1'],
                  authentication: 'API Key',
                  commonUseCases: ['use case'],
                  limitations: [],
                  relatedNodes: [],
                }),
            },
          },
        ],
      });
      Object.defineProperty(generator, 'client', {
        value: { chat: { completions: { create: mockCreate } } },
        writable: true,
      });

      const inputs = [
        {
          nodeType: 'n8n-nodes-community.node1',
          displayName: 'Node 1',
          readme: '# Node 1',
        },
        {
          nodeType: 'n8n-nodes-community.node2',
          displayName: 'Node 2',
          readme: '# Node 2',
        },
      ];

      const results = await generator.generateBatch(inputs, 2);

      expect(results).toHaveLength(2);
      expect(results[0].error).toBeUndefined();
      expect(results[1].error).toBeUndefined();
      expect(mockCreate).toHaveBeenCalledTimes(2);
    });

    it('should use MiniMax preset model by default', () => {
      process.env.N8N_MCP_LLM_PROVIDER = 'minimax';
      process.env.MINIMAX_API_KEY = 'test-key';

      const generator = createDocumentationGenerator();

      expect(generator['model']).toBe('MiniMax-M2.7');
    });
  });

  describe('Provider fallback chain', () => {
    it('should use preset when only N8N_MCP_LLM_PROVIDER is set', () => {
      process.env.N8N_MCP_LLM_PROVIDER = 'openai';
      process.env.OPENAI_API_KEY = 'test-key';

      const generator = createDocumentationGenerator();

      expect(generator['model']).toBe('gpt-4o-mini');
    });

    it('should allow model override with preset', () => {
      process.env.N8N_MCP_LLM_PROVIDER = 'minimax';
      process.env.N8N_MCP_LLM_MODEL = 'MiniMax-M2.5-highspeed';
      process.env.MINIMAX_API_KEY = 'test-key';

      const generator = createDocumentationGenerator();

      expect(generator['model']).toBe('MiniMax-M2.5-highspeed');
    });

    it('should use local defaults when no provider is set', () => {
      const generator = createDocumentationGenerator();

      expect(generator['model']).toBe('qwen3-4b-thinking-2507');
      expect(generator['temperature']).toBe(0.3);
    });
  });
});
