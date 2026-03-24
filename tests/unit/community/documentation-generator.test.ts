import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  DocumentationGenerator,
  DocumentationSummarySchema,
  DocumentationGeneratorConfig,
  DocumentationInput,
  DocumentationResult,
  createDocumentationGenerator,
} from '../../../src/community/documentation-generator';

// Mock OpenAI
vi.mock('openai', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      chat: {
        completions: {
          create: vi.fn(),
        },
      },
    })),
  };
});

// Mock logger to prevent console output during tests
vi.mock('../../../src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('DocumentationGenerator', () => {
  let generator: DocumentationGenerator;
  let mockCreate: ReturnType<typeof vi.fn>;

  const defaultConfig: DocumentationGeneratorConfig = {
    baseUrl: 'http://localhost:1234/v1',
    model: 'test-model',
    apiKey: 'test-key',
    timeout: 30000,
    maxTokens: 1000,
    temperature: 0.3,
  };

  const validSummary = {
    purpose: 'Sends messages to Slack channels',
    capabilities: ['Send messages', 'Create channels', 'Upload files'],
    authentication: 'OAuth2 or API Token',
    commonUseCases: ['Team notifications', 'Alert systems'],
    limitations: ['Rate limits apply'],
    relatedNodes: ['n8n-nodes-base.slack'],
  };

  const sampleInput: DocumentationInput = {
    nodeType: 'n8n-nodes-community.slack',
    displayName: 'Slack Community',
    description: 'A community Slack integration',
    readme: '# Slack Community Node\n\nThis node allows you to send messages to Slack.',
    npmPackageName: '@community/n8n-nodes-slack',
  };

  beforeEach(() => {
    generator = new DocumentationGenerator(defaultConfig);

    // Get the mocked create function
    mockCreate = vi.fn();
    Object.defineProperty(generator, 'client', {
      value: {
        chat: {
          completions: {
            create: mockCreate,
          },
        },
      },
      writable: true,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Constructor Configuration', () => {
    it('should use provided configuration values', () => {
      const config: DocumentationGeneratorConfig = {
        baseUrl: 'http://custom-server:8080/v1',
        model: 'custom-model',
        apiKey: 'custom-key',
        timeout: 45000,
        maxTokens: 2500,
      };

      const customGenerator = new DocumentationGenerator(config);

      // Verify internal properties are set correctly
      expect(customGenerator['model']).toBe('custom-model');
      expect(customGenerator['maxTokens']).toBe(2500);
      expect(customGenerator['timeout']).toBe(45000);
    });

    it('should apply default values when optional config is omitted', () => {
      const minimalConfig: DocumentationGeneratorConfig = {
        baseUrl: 'http://localhost:1234/v1',
      };

      const minimalGenerator = new DocumentationGenerator(minimalConfig);

      expect(minimalGenerator['model']).toBe('qwen3-4b-thinking-2507');
      expect(minimalGenerator['maxTokens']).toBe(2000);
      expect(minimalGenerator['timeout']).toBe(60000);
    });

    it('should partially override defaults', () => {
      const partialConfig: DocumentationGeneratorConfig = {
        baseUrl: 'http://localhost:1234/v1',
        model: 'custom-model',
        // apiKey, timeout, maxTokens should use defaults
      };

      const partialGenerator = new DocumentationGenerator(partialConfig);

      expect(partialGenerator['model']).toBe('custom-model');
      expect(partialGenerator['maxTokens']).toBe(2000);
      expect(partialGenerator['timeout']).toBe(60000);
    });
  });

  describe('generateSummary()', () => {
    describe('Successful generation', () => {
      it('should generate documentation summary from valid LLM response', async () => {
        mockCreate.mockResolvedValue({
          choices: [
            {
              message: {
                content: JSON.stringify(validSummary),
              },
            },
          ],
        });

        const result = await generator.generateSummary(sampleInput);

        expect(result.nodeType).toBe('n8n-nodes-community.slack');
        expect(result.summary.purpose).toBe('Sends messages to Slack channels');
        expect(result.summary.capabilities).toEqual(['Send messages', 'Create channels', 'Upload files']);
        expect(result.summary.authentication).toBe('OAuth2 or API Token');
        expect(result.error).toBeUndefined();
      });

      it('should call OpenAI with correct parameters', async () => {
        mockCreate.mockResolvedValue({
          choices: [
            {
              message: {
                content: JSON.stringify(validSummary),
              },
            },
          ],
        });

        await generator.generateSummary(sampleInput);

        expect(mockCreate).toHaveBeenCalledWith({
          model: 'test-model',
          max_completion_tokens: 1000,
          temperature: 0.3,
          messages: expect.arrayContaining([
            expect.objectContaining({ role: 'system' }),
            expect.objectContaining({ role: 'user' }),
          ]),
        });
      });

      it('should include node information in the prompt', async () => {
        mockCreate.mockResolvedValue({
          choices: [
            {
              message: {
                content: JSON.stringify(validSummary),
              },
            },
          ],
        });

        await generator.generateSummary(sampleInput);

        const userMessage = mockCreate.mock.calls[0][0].messages[1].content;
        expect(userMessage).toContain('Slack Community');
        expect(userMessage).toContain('n8n-nodes-community.slack');
        expect(userMessage).toContain('@community/n8n-nodes-slack');
        expect(userMessage).toContain('A community Slack integration');
      });
    });

    describe('JSON extraction from markdown code blocks', () => {
      it('should extract JSON from markdown json code block', async () => {
        mockCreate.mockResolvedValue({
          choices: [
            {
              message: {
                content: '```json\n' + JSON.stringify(validSummary) + '\n```',
              },
            },
          ],
        });

        const result = await generator.generateSummary(sampleInput);

        expect(result.error).toBeUndefined();
        expect(result.summary.purpose).toBe('Sends messages to Slack channels');
      });

      it('should extract JSON from generic markdown code block', async () => {
        mockCreate.mockResolvedValue({
          choices: [
            {
              message: {
                content: '```\n' + JSON.stringify(validSummary) + '\n```',
              },
            },
          ],
        });

        const result = await generator.generateSummary(sampleInput);

        expect(result.error).toBeUndefined();
        expect(result.summary.purpose).toBe('Sends messages to Slack channels');
      });

      it('should extract JSON object directly from response text', async () => {
        mockCreate.mockResolvedValue({
          choices: [
            {
              message: {
                content: 'Here is the summary:\n' + JSON.stringify(validSummary) + '\n\nDone.',
              },
            },
          ],
        });

        const result = await generator.generateSummary(sampleInput);

        expect(result.error).toBeUndefined();
        expect(result.summary.purpose).toBe('Sends messages to Slack channels');
      });

      it('should handle JSON with extra whitespace in code block', async () => {
        mockCreate.mockResolvedValue({
          choices: [
            {
              message: {
                content: '```json\n  \n' + JSON.stringify(validSummary, null, 2) + '\n  \n```',
              },
            },
          ],
        });

        const result = await generator.generateSummary(sampleInput);

        expect(result.error).toBeUndefined();
        expect(result.summary.purpose).toBe('Sends messages to Slack channels');
      });
    });

    describe('Error handling', () => {
      it('should return default summary when LLM returns no content', async () => {
        mockCreate.mockResolvedValue({
          choices: [
            {
              message: {
                content: null,
              },
            },
          ],
        });

        const result = await generator.generateSummary(sampleInput);

        expect(result.error).toBe('No content in LLM response');
        expect(result.summary.purpose).toBe('A community Slack integration');
        expect(result.summary.limitations).toContain('Documentation could not be automatically generated');
      });

      it('should return default summary when LLM returns empty content', async () => {
        mockCreate.mockResolvedValue({
          choices: [
            {
              message: {
                content: '',
              },
            },
          ],
        });

        const result = await generator.generateSummary(sampleInput);

        expect(result.error).toBeDefined();
        expect(result.summary.limitations).toContain('Documentation could not be automatically generated');
      });

      it('should return default summary when LLM returns invalid JSON', async () => {
        mockCreate.mockResolvedValue({
          choices: [
            {
              message: {
                content: 'This is not valid JSON at all',
              },
            },
          ],
        });

        const result = await generator.generateSummary(sampleInput);

        expect(result.error).toBeDefined();
        expect(result.summary.purpose).toBe('A community Slack integration');
      });

      it('should return default summary when LLM returns malformed JSON', async () => {
        mockCreate.mockResolvedValue({
          choices: [
            {
              message: {
                content: '{"purpose": "test", "capabilities": [}',
              },
            },
          ],
        });

        const result = await generator.generateSummary(sampleInput);

        expect(result.error).toBeDefined();
        expect(result.nodeType).toBe('n8n-nodes-community.slack');
      });

      it('should return default summary when choices array is empty', async () => {
        mockCreate.mockResolvedValue({
          choices: [],
        });

        const result = await generator.generateSummary(sampleInput);

        expect(result.error).toBe('No content in LLM response');
      });

      it('should return default summary on network error', async () => {
        mockCreate.mockRejectedValue(new Error('Connection refused'));

        const result = await generator.generateSummary(sampleInput);

        expect(result.error).toBe('Connection refused');
        expect(result.summary.limitations).toContain('Documentation could not be automatically generated');
      });

      it('should return default summary on timeout', async () => {
        mockCreate.mockRejectedValue(new Error('Request timed out'));

        const result = await generator.generateSummary(sampleInput);

        expect(result.error).toBe('Request timed out');
      });

      it('should return default summary when Zod validation fails', async () => {
        mockCreate.mockResolvedValue({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  purpose: 'Valid purpose',
                  capabilities: 'not-an-array', // Should be array
                  authentication: 'API key',
                  commonUseCases: [],
                  limitations: [],
                  relatedNodes: [],
                }),
              },
            },
          ],
        });

        const result = await generator.generateSummary(sampleInput);

        expect(result.error).toBeDefined();
        expect(result.summary.limitations).toContain('Documentation could not be automatically generated');
      });

      it('should use node display name in default summary when description is missing', async () => {
        mockCreate.mockRejectedValue(new Error('API error'));

        const inputWithoutDescription: DocumentationInput = {
          nodeType: 'n8n-nodes-community.custom',
          displayName: 'Custom Node',
          readme: '# Custom Node',
        };

        const result = await generator.generateSummary(inputWithoutDescription);

        expect(result.summary.purpose).toBe('Community node: Custom Node');
      });

      it('should handle non-Error exceptions', async () => {
        mockCreate.mockRejectedValue('String error');

        const result = await generator.generateSummary(sampleInput);

        expect(result.error).toBe('Unknown error');
      });
    });
  });

  describe('generateBatch()', () => {
    const createInputs = (count: number): DocumentationInput[] => {
      return Array.from({ length: count }, (_, i) => ({
        nodeType: `n8n-nodes-community.node${i}`,
        displayName: `Node ${i}`,
        description: `Description for node ${i}`,
        readme: `# Node ${i} README`,
      }));
    };

    it('should process multiple nodes in parallel', async () => {
      mockCreate.mockResolvedValue({
        choices: [
          {
            message: {
              content: JSON.stringify(validSummary),
            },
          },
        ],
      });

      const inputs = createInputs(5);
      const results = await generator.generateBatch(inputs, 2);

      expect(results).toHaveLength(5);
      results.forEach((result, i) => {
        expect(result.nodeType).toBe(`n8n-nodes-community.node${i}`);
      });
    });

    it('should respect concurrency limit', async () => {
      const callOrder: number[] = [];
      let currentConcurrency = 0;
      let maxConcurrency = 0;

      mockCreate.mockImplementation(async () => {
        currentConcurrency++;
        maxConcurrency = Math.max(maxConcurrency, currentConcurrency);
        callOrder.push(currentConcurrency);

        await new Promise((resolve) => setTimeout(resolve, 50));

        currentConcurrency--;
        return {
          choices: [
            {
              message: {
                content: JSON.stringify(validSummary),
              },
            },
          ],
        };
      });

      const inputs = createInputs(6);
      await generator.generateBatch(inputs, 2);

      // Max concurrency should not exceed the limit
      expect(maxConcurrency).toBeLessThanOrEqual(2);
    });

    it('should call progress callback with correct values', async () => {
      mockCreate.mockResolvedValue({
        choices: [
          {
            message: {
              content: JSON.stringify(validSummary),
            },
          },
        ],
      });

      const progressCalls: Array<{ message: string; current: number; total: number }> = [];
      const progressCallback = (message: string, current: number, total: number) => {
        progressCalls.push({ message, current, total });
      };

      const inputs = createInputs(5);
      await generator.generateBatch(inputs, 2, progressCallback);

      expect(progressCalls.length).toBeGreaterThan(0);
      expect(progressCalls[0].message).toBe('Generating documentation');
      expect(progressCalls[progressCalls.length - 1].current).toBe(5);
      expect(progressCalls[progressCalls.length - 1].total).toBe(5);
    });

    it('should handle mixed success and failure results', async () => {
      let callCount = 0;
      mockCreate.mockImplementation(async () => {
        callCount++;
        if (callCount % 2 === 0) {
          throw new Error('Simulated failure');
        }
        return {
          choices: [
            {
              message: {
                content: JSON.stringify(validSummary),
              },
            },
          ],
        };
      });

      const inputs = createInputs(4);
      const results = await generator.generateBatch(inputs, 2);

      expect(results).toHaveLength(4);
      const successCount = results.filter((r) => !r.error).length;
      const errorCount = results.filter((r) => r.error).length;

      expect(successCount).toBe(2);
      expect(errorCount).toBe(2);
    });

    it('should handle empty input array', async () => {
      const results = await generator.generateBatch([], 3);

      expect(results).toHaveLength(0);
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('should handle single item input', async () => {
      mockCreate.mockResolvedValue({
        choices: [
          {
            message: {
              content: JSON.stringify(validSummary),
            },
          },
        ],
      });

      const inputs = createInputs(1);
      const results = await generator.generateBatch(inputs, 3);

      expect(results).toHaveLength(1);
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });

    it('should use default concurrency of 3', async () => {
      let maxConcurrency = 0;
      let currentConcurrency = 0;

      mockCreate.mockImplementation(async () => {
        currentConcurrency++;
        maxConcurrency = Math.max(maxConcurrency, currentConcurrency);
        await new Promise((resolve) => setTimeout(resolve, 10));
        currentConcurrency--;
        return {
          choices: [
            {
              message: {
                content: JSON.stringify(validSummary),
              },
            },
          ],
        };
      });

      const inputs = createInputs(9);
      await generator.generateBatch(inputs);

      expect(maxConcurrency).toBeLessThanOrEqual(3);
    });
  });

  describe('testConnection()', () => {
    it('should return success when LLM responds', async () => {
      mockCreate.mockResolvedValue({
        choices: [
          {
            message: {
              content: 'Hello!',
            },
          },
        ],
      });

      const result = await generator.testConnection();

      expect(result.success).toBe(true);
      expect(result.message).toBe('Connected to test-model');
    });

    it('should return failure when LLM returns empty response', async () => {
      mockCreate.mockResolvedValue({
        choices: [
          {
            message: {
              content: null,
            },
          },
        ],
      });

      const result = await generator.testConnection();

      expect(result.success).toBe(false);
      expect(result.message).toBe('No response from LLM');
    });

    it('should return failure when LLM returns empty string', async () => {
      mockCreate.mockResolvedValue({
        choices: [
          {
            message: {
              content: '',
            },
          },
        ],
      });

      const result = await generator.testConnection();

      expect(result.success).toBe(false);
      expect(result.message).toBe('No response from LLM');
    });

    it('should return failure when choices array is empty', async () => {
      mockCreate.mockResolvedValue({
        choices: [],
      });

      const result = await generator.testConnection();

      expect(result.success).toBe(false);
      expect(result.message).toBe('No response from LLM');
    });

    it('should return failure on connection error', async () => {
      mockCreate.mockRejectedValue(new Error('Connection refused'));

      const result = await generator.testConnection();

      expect(result.success).toBe(false);
      expect(result.message).toBe('Connection failed: Connection refused');
    });

    it('should return failure on timeout', async () => {
      mockCreate.mockRejectedValue(new Error('Request timed out'));

      const result = await generator.testConnection();

      expect(result.success).toBe(false);
      expect(result.message).toBe('Connection failed: Request timed out');
    });

    it('should handle non-Error exceptions', async () => {
      mockCreate.mockRejectedValue('Network failure');

      const result = await generator.testConnection();

      expect(result.success).toBe(false);
      expect(result.message).toBe('Connection failed: Unknown error');
    });

    it('should use minimal tokens for connection test', async () => {
      mockCreate.mockResolvedValue({
        choices: [
          {
            message: {
              content: 'Hi',
            },
          },
        ],
      });

      await generator.testConnection();

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          max_completion_tokens: 200,
          messages: [
            {
              role: 'user',
              content: 'Hello',
            },
          ],
        })
      );
    });
  });

  describe('DocumentationSummarySchema validation', () => {
    it('should validate correct documentation summary', () => {
      const result = DocumentationSummarySchema.safeParse(validSummary);

      expect(result.success).toBe(true);
    });

    it('should reject missing required fields', () => {
      const incompleteSummary = {
        purpose: 'Test purpose',
        capabilities: ['test'],
        // Missing: authentication, commonUseCases, limitations, relatedNodes
      };

      const result = DocumentationSummarySchema.safeParse(incompleteSummary);

      expect(result.success).toBe(false);
    });

    it('should enforce capabilities array max length of 10', () => {
      const tooManyCapabilities = {
        ...validSummary,
        capabilities: Array.from({ length: 11 }, (_, i) => `capability${i}`),
      };

      const result = DocumentationSummarySchema.safeParse(tooManyCapabilities);

      expect(result.success).toBe(false);
    });

    it('should enforce commonUseCases array max length of 5', () => {
      const tooManyUseCases = {
        ...validSummary,
        commonUseCases: Array.from({ length: 6 }, (_, i) => `useCase${i}`),
      };

      const result = DocumentationSummarySchema.safeParse(tooManyUseCases);

      expect(result.success).toBe(false);
    });

    it('should accept empty arrays for optional fields', () => {
      const minimalSummary = {
        purpose: 'Minimal node',
        capabilities: [],
        authentication: 'None',
        commonUseCases: [],
        limitations: [],
        relatedNodes: [],
      };

      const result = DocumentationSummarySchema.safeParse(minimalSummary);

      expect(result.success).toBe(true);
    });

    it('should reject non-string values in arrays', () => {
      const invalidSummary = {
        ...validSummary,
        capabilities: [1, 2, 3],
      };

      const result = DocumentationSummarySchema.safeParse(invalidSummary);

      expect(result.success).toBe(false);
    });

    it('should reject non-string purpose', () => {
      const invalidSummary = {
        ...validSummary,
        purpose: { text: 'purpose' },
      };

      const result = DocumentationSummarySchema.safeParse(invalidSummary);

      expect(result.success).toBe(false);
    });

    it('should reject null values', () => {
      const invalidSummary = {
        ...validSummary,
        authentication: null,
      };

      const result = DocumentationSummarySchema.safeParse(invalidSummary);

      expect(result.success).toBe(false);
    });
  });

  describe('createDocumentationGenerator factory', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('should use environment variables when set', () => {
      process.env.N8N_MCP_LLM_BASE_URL = 'http://custom:9999/v1';
      process.env.N8N_MCP_LLM_MODEL = 'custom-model';
      process.env.N8N_MCP_LLM_TIMEOUT = '90000';

      const factoryGenerator = createDocumentationGenerator();

      expect(factoryGenerator['model']).toBe('custom-model');
      expect(factoryGenerator['timeout']).toBe(90000);
    });

    it('should use default values when environment variables are not set', () => {
      delete process.env.N8N_MCP_LLM_BASE_URL;
      delete process.env.N8N_MCP_LLM_MODEL;
      delete process.env.N8N_MCP_LLM_TIMEOUT;

      const factoryGenerator = createDocumentationGenerator();

      expect(factoryGenerator['model']).toBe('qwen3-4b-thinking-2507');
      expect(factoryGenerator['timeout']).toBe(60000);
    });
  });

  describe('Private method behaviors', () => {
    describe('truncateReadme', () => {
      it('should not truncate short README', async () => {
        mockCreate.mockResolvedValue({
          choices: [
            {
              message: {
                content: JSON.stringify(validSummary),
              },
            },
          ],
        });

        const shortReadme = 'Short README content';
        const input = { ...sampleInput, readme: shortReadme };

        await generator.generateSummary(input);

        const userMessage = mockCreate.mock.calls[0][0].messages[1].content;
        expect(userMessage).toContain(shortReadme);
        expect(userMessage).not.toContain('[README truncated...]');
      });

      it('should truncate very long README', async () => {
        mockCreate.mockResolvedValue({
          choices: [
            {
              message: {
                content: JSON.stringify(validSummary),
              },
            },
          ],
        });

        const longReadme = 'A'.repeat(10000);
        const input = { ...sampleInput, readme: longReadme };

        await generator.generateSummary(input);

        const userMessage = mockCreate.mock.calls[0][0].messages[1].content;
        expect(userMessage).toContain('[README truncated...]');
      });

      it('should try to truncate at paragraph boundary', async () => {
        mockCreate.mockResolvedValue({
          choices: [
            {
              message: {
                content: JSON.stringify(validSummary),
              },
            },
          ],
        });

        const readmeWithParagraphs = 'A'.repeat(5000) + '\n\n' + 'B'.repeat(2000);
        const input = { ...sampleInput, readme: readmeWithParagraphs };

        await generator.generateSummary(input);

        const userMessage = mockCreate.mock.calls[0][0].messages[1].content;
        expect(userMessage).toContain('[README truncated...]');
      });
    });

    describe('buildPrompt', () => {
      it('should handle missing optional fields', async () => {
        mockCreate.mockResolvedValue({
          choices: [
            {
              message: {
                content: JSON.stringify(validSummary),
              },
            },
          ],
        });

        const minimalInput: DocumentationInput = {
          nodeType: 'n8n-nodes-community.minimal',
          displayName: 'Minimal Node',
          readme: '# Minimal',
        };

        await generator.generateSummary(minimalInput);

        const userMessage = mockCreate.mock.calls[0][0].messages[1].content;
        expect(userMessage).toContain('Package: unknown');
        expect(userMessage).toContain('Description: No description provided');
      });
    });
  });

  describe('Edge cases and security', () => {
    it('should handle README with special characters', async () => {
      mockCreate.mockResolvedValue({
        choices: [
          {
            message: {
              content: JSON.stringify(validSummary),
            },
          },
        ],
      });

      const specialReadme = '# Node with "quotes" and `backticks` and <html> tags';
      const input = { ...sampleInput, readme: specialReadme };

      const result = await generator.generateSummary(input);

      expect(result.error).toBeUndefined();
    });

    it('should handle Unicode content in README', async () => {
      mockCreate.mockResolvedValue({
        choices: [
          {
            message: {
              content: JSON.stringify(validSummary),
            },
          },
        ],
      });

      const unicodeReadme = '# Node with Unicode: emoji, Chinese: 中文, Arabic: العربية';
      const input = { ...sampleInput, readme: unicodeReadme };

      await generator.generateSummary(input);

      const userMessage = mockCreate.mock.calls[0][0].messages[1].content;
      expect(userMessage).toContain('中文');
      expect(userMessage).toContain('العربية');
    });

    it('should handle LLM response with thinking tokens', async () => {
      mockCreate.mockResolvedValue({
        choices: [
          {
            message: {
              content:
                '<think>Let me analyze this...</think>\n```json\n' + JSON.stringify(validSummary) + '\n```',
            },
          },
        ],
      });

      const result = await generator.generateSummary(sampleInput);

      expect(result.error).toBeUndefined();
      expect(result.summary.purpose).toBe('Sends messages to Slack channels');
    });

    it('should handle MiniMax-style multi-line thinking tags', async () => {
      const thinkContent = '<think>\nStep 1: Read the node info\nStep 2: Extract capabilities\nStep 3: Generate JSON\n</think>';
      mockCreate.mockResolvedValue({
        choices: [
          {
            message: {
              content: thinkContent + '\n' + JSON.stringify(validSummary),
            },
          },
        ],
      });

      const result = await generator.generateSummary(sampleInput);

      expect(result.error).toBeUndefined();
      expect(result.summary.purpose).toBe('Sends messages to Slack channels');
    });

    it('should handle response with multiple thinking blocks', async () => {
      mockCreate.mockResolvedValue({
        choices: [
          {
            message: {
              content:
                '<think>First thought</think>Some text<think>Second thought</think>\n' + JSON.stringify(validSummary),
            },
          },
        ],
      });

      const result = await generator.generateSummary(sampleInput);

      expect(result.error).toBeUndefined();
      expect(result.summary.purpose).toBe('Sends messages to Slack channels');
    });

    it('should return error when response contains multiple JSON objects', async () => {
      // When the response contains multiple JSON objects concatenated,
      // JSON.parse will fail, and we should get a default summary with error
      mockCreate.mockResolvedValue({
        choices: [
          {
            message: {
              content: JSON.stringify(validSummary) + '\n\n' + JSON.stringify({ other: 'data' }),
            },
          },
        ],
      });

      const result = await generator.generateSummary(sampleInput);

      // This should fail to parse and return default summary with error
      expect(result.error).toBeDefined();
      expect(result.summary.limitations).toContain('Documentation could not be automatically generated');
    });
  });

  describe('truncateArrayFields helper', () => {
    it('should truncate capabilities array to 10 items', () => {
      const truncateMethod = (generator as any).truncateArrayFields.bind(generator);
      const input = {
        purpose: 'Test purpose',
        capabilities: Array.from({ length: 15 }, (_, i) => `capability${i}`),
        authentication: 'None',
        commonUseCases: [],
        limitations: [],
        relatedNodes: [],
      };

      const result = truncateMethod(input);

      expect(result.capabilities).toHaveLength(10);
      expect(result.capabilities[0]).toBe('capability0');
      expect(result.capabilities[9]).toBe('capability9');
    });

    it('should truncate commonUseCases array to 5 items', () => {
      const truncateMethod = (generator as any).truncateArrayFields.bind(generator);
      const input = {
        purpose: 'Test purpose',
        capabilities: [],
        authentication: 'None',
        commonUseCases: Array.from({ length: 8 }, (_, i) => `useCase${i}`),
        limitations: [],
        relatedNodes: [],
      };

      const result = truncateMethod(input);

      expect(result.commonUseCases).toHaveLength(5);
      expect(result.commonUseCases[0]).toBe('useCase0');
      expect(result.commonUseCases[4]).toBe('useCase4');
    });

    it('should truncate limitations array to 5 items', () => {
      const truncateMethod = (generator as any).truncateArrayFields.bind(generator);
      const input = {
        purpose: 'Test purpose',
        capabilities: [],
        authentication: 'None',
        commonUseCases: [],
        limitations: Array.from({ length: 10 }, (_, i) => `limitation${i}`),
        relatedNodes: [],
      };

      const result = truncateMethod(input);

      expect(result.limitations).toHaveLength(5);
      expect(result.limitations[0]).toBe('limitation0');
      expect(result.limitations[4]).toBe('limitation4');
    });

    it('should truncate relatedNodes array to 5 items', () => {
      const truncateMethod = (generator as any).truncateArrayFields.bind(generator);
      const input = {
        purpose: 'Test purpose',
        capabilities: [],
        authentication: 'None',
        commonUseCases: [],
        limitations: [],
        relatedNodes: Array.from({ length: 7 }, (_, i) => `node${i}`),
      };

      const result = truncateMethod(input);

      expect(result.relatedNodes).toHaveLength(5);
      expect(result.relatedNodes[0]).toBe('node0');
      expect(result.relatedNodes[4]).toBe('node4');
    });

    it('should not modify arrays within limits', () => {
      const truncateMethod = (generator as any).truncateArrayFields.bind(generator);
      const input = {
        purpose: 'Test purpose',
        capabilities: ['cap1', 'cap2', 'cap3'],
        authentication: 'None',
        commonUseCases: ['use1', 'use2'],
        limitations: ['lim1'],
        relatedNodes: [],
      };

      const result = truncateMethod(input);

      expect(result.capabilities).toHaveLength(3);
      expect(result.commonUseCases).toHaveLength(2);
      expect(result.limitations).toHaveLength(1);
      expect(result.relatedNodes).toHaveLength(0);
    });

    it('should not modify arrays at exact limits', () => {
      const truncateMethod = (generator as any).truncateArrayFields.bind(generator);
      const input = {
        purpose: 'Test purpose',
        capabilities: Array.from({ length: 10 }, (_, i) => `cap${i}`),
        authentication: 'None',
        commonUseCases: Array.from({ length: 5 }, (_, i) => `use${i}`),
        limitations: Array.from({ length: 5 }, (_, i) => `lim${i}`),
        relatedNodes: Array.from({ length: 5 }, (_, i) => `node${i}`),
      };

      const result = truncateMethod(input);

      expect(result.capabilities).toHaveLength(10);
      expect(result.commonUseCases).toHaveLength(5);
      expect(result.limitations).toHaveLength(5);
      expect(result.relatedNodes).toHaveLength(5);
    });

    it('should handle empty arrays', () => {
      const truncateMethod = (generator as any).truncateArrayFields.bind(generator);
      const input = {
        purpose: 'Test purpose',
        capabilities: [],
        authentication: 'None',
        commonUseCases: [],
        limitations: [],
        relatedNodes: [],
      };

      const result = truncateMethod(input);

      expect(result.capabilities).toHaveLength(0);
      expect(result.commonUseCases).toHaveLength(0);
      expect(result.limitations).toHaveLength(0);
      expect(result.relatedNodes).toHaveLength(0);
    });

    it('should preserve non-array fields unchanged', () => {
      const truncateMethod = (generator as any).truncateArrayFields.bind(generator);
      const input = {
        purpose: 'This is a long purpose string',
        capabilities: Array.from({ length: 15 }, (_, i) => `cap${i}`),
        authentication: 'OAuth2 with refresh token',
        commonUseCases: [],
        limitations: [],
        relatedNodes: [],
        extraField: 'should be preserved',
      };

      const result = truncateMethod(input);

      expect(result.purpose).toBe('This is a long purpose string');
      expect(result.authentication).toBe('OAuth2 with refresh token');
      expect(result.extraField).toBe('should be preserved');
    });

    it('should handle missing array fields gracefully', () => {
      const truncateMethod = (generator as any).truncateArrayFields.bind(generator);
      const input = {
        purpose: 'Test purpose',
        authentication: 'None',
        // Missing: capabilities, commonUseCases, limitations, relatedNodes
      };

      const result = truncateMethod(input);

      expect(result.purpose).toBe('Test purpose');
      expect(result.authentication).toBe('None');
      expect(result.capabilities).toBeUndefined();
    });

    it('should truncate multiple arrays simultaneously', () => {
      const truncateMethod = (generator as any).truncateArrayFields.bind(generator);
      const input = {
        purpose: 'Test purpose',
        capabilities: Array.from({ length: 12 }, (_, i) => `cap${i}`),
        authentication: 'None',
        commonUseCases: Array.from({ length: 8 }, (_, i) => `use${i}`),
        limitations: Array.from({ length: 6 }, (_, i) => `lim${i}`),
        relatedNodes: Array.from({ length: 10 }, (_, i) => `node${i}`),
      };

      const result = truncateMethod(input);

      expect(result.capabilities).toHaveLength(10);
      expect(result.commonUseCases).toHaveLength(5);
      expect(result.limitations).toHaveLength(5);
      expect(result.relatedNodes).toHaveLength(5);
    });

    it('should preserve order of items when truncating', () => {
      const truncateMethod = (generator as any).truncateArrayFields.bind(generator);
      const input = {
        purpose: 'Test purpose',
        capabilities: ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth'],
        authentication: 'None',
        commonUseCases: [],
        limitations: [],
        relatedNodes: [],
      };

      const result = truncateMethod(input);

      expect(result.capabilities[0]).toBe('first');
      expect(result.capabilities[9]).toBe('tenth');
      expect(result.capabilities).not.toContain('eleventh');
      expect(result.capabilities).not.toContain('twelfth');
    });

    it('should handle non-string array items', () => {
      const truncateMethod = (generator as any).truncateArrayFields.bind(generator);
      const input = {
        purpose: 'Test purpose',
        capabilities: Array.from({ length: 12 }, (_, i) => ({ id: i, name: `cap${i}` })),
        authentication: 'None',
        commonUseCases: [],
        limitations: [],
        relatedNodes: [],
      };

      const result = truncateMethod(input);

      expect(result.capabilities).toHaveLength(10);
      expect(result.capabilities[0]).toEqual({ id: 0, name: 'cap0' });
      expect(result.capabilities[9]).toEqual({ id: 9, name: 'cap9' });
    });

    it('should create a new object and not mutate the original', () => {
      const truncateMethod = (generator as any).truncateArrayFields.bind(generator);
      const original = {
        purpose: 'Test purpose',
        capabilities: Array.from({ length: 15 }, (_, i) => `cap${i}`),
        authentication: 'None',
        commonUseCases: [],
        limitations: [],
        relatedNodes: [],
      };
      const originalCapabilitiesLength = original.capabilities.length;

      const result = truncateMethod(original);

      // Original should not be mutated
      expect(original.capabilities).toHaveLength(originalCapabilitiesLength);
      // Result should be truncated
      expect(result.capabilities).toHaveLength(10);
      // They should not be the same reference
      expect(result).not.toBe(original);
    });
  });
});
