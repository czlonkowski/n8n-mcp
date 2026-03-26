/**
 * AI-powered documentation generator for community nodes.
 *
 * Uses a local LLM (Qwen or compatible) via OpenAI-compatible API
 * to generate structured documentation summaries from README content.
 */

import OpenAI from 'openai';
import { z } from 'zod';
import { logger } from '../utils/logger';

/**
 * Schema for AI-generated documentation summary
 */
export const DocumentationSummarySchema = z.object({
  purpose: z.string().describe('What this node does in 1-2 sentences'),
  capabilities: z.array(z.string()).max(10).describe('Key features and operations'),
  authentication: z.string().describe('How to authenticate (API key, OAuth, None, etc.)'),
  commonUseCases: z.array(z.string()).max(5).describe('Practical use case examples'),
  limitations: z.array(z.string()).max(5).describe('Known limitations or caveats'),
  relatedNodes: z.array(z.string()).max(5).describe('Related n8n nodes if mentioned'),
});

export type DocumentationSummary = z.infer<typeof DocumentationSummarySchema>;

/**
 * Input for documentation generation
 */
export interface DocumentationInput {
  nodeType: string;
  displayName: string;
  description?: string;
  readme: string;
  npmPackageName?: string;
}

/**
 * Result of documentation generation
 */
export interface DocumentationResult {
  nodeType: string;
  summary: DocumentationSummary;
  error?: string;
}

/**
 * Configuration for the documentation generator
 */
export interface DocumentationGeneratorConfig {
  /** Base URL for the LLM server (e.g., http://localhost:1234/v1) */
  baseUrl: string;
  /** Model name to use (default: qwen3-4b-thinking-2507) */
  model?: string;
  /** API key (default: 'not-needed' for local servers) */
  apiKey?: string;
  /** Request timeout in ms (default: 60000) */
  timeout?: number;
  /** Max tokens for response (default: 2000) */
  maxTokens?: number;
  /** Temperature for generation (default: 0.3, set to undefined to omit) */
  temperature?: number;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: Required<Omit<DocumentationGeneratorConfig, 'baseUrl' | 'temperature'>> = {
  model: 'qwen3-4b-thinking-2507',
  apiKey: 'not-needed',
  timeout: 60000,
  maxTokens: 2000,
};

/**
 * Generates structured documentation summaries for community nodes
 * using a local LLM via OpenAI-compatible API.
 */
export class DocumentationGenerator {
  private client: OpenAI;
  private baseUrl: string;
  private apiKey: string;
  private model: string;
  private maxTokens: number;
  private timeout: number;
  private temperature?: number;

  constructor(config: DocumentationGeneratorConfig) {
    const fullConfig = { ...DEFAULT_CONFIG, ...config };

    this.baseUrl = config.baseUrl;
    this.apiKey = fullConfig.apiKey;
    this.client = new OpenAI({
      baseURL: config.baseUrl,
      apiKey: fullConfig.apiKey,
      timeout: fullConfig.timeout,
    });
    this.model = fullConfig.model;
    this.maxTokens = fullConfig.maxTokens;
    this.timeout = fullConfig.timeout;
    this.temperature = fullConfig.temperature;
  }

  /**
   * Generate documentation summary for a single node
   */
  async generateSummary(input: DocumentationInput): Promise<DocumentationResult> {
    try {
      const prompt = this.buildPrompt(input);

      const completion = await this.chatCompletion([
        { role: 'system', content: this.getSystemPrompt() },
        { role: 'user', content: prompt },
      ], this.maxTokens);

      const content = completion.choices[0]?.message?.content;
      if (!content) {
        throw new Error('No content in LLM response');
      }

      // Extract JSON from response (handle markdown code blocks)
      const jsonContent = this.extractJson(content);
      const parsed = JSON.parse(jsonContent);

      // Truncate arrays to fit schema limits before validation
      const truncated = this.truncateArrayFields(parsed);

      // Validate with Zod
      const validated = DocumentationSummarySchema.parse(truncated);

      return {
        nodeType: input.nodeType,
        summary: validated,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Error generating documentation for ${input.nodeType}:`, error);

      return {
        nodeType: input.nodeType,
        summary: this.getDefaultSummary(input),
        error: errorMessage,
      };
    }
  }

  /**
   * Generate documentation for multiple nodes in parallel
   *
   * @param inputs Array of documentation inputs
   * @param concurrency Number of parallel requests (default: 3)
   * @param progressCallback Optional progress callback
   * @returns Array of documentation results
   */
  async generateBatch(
    inputs: DocumentationInput[],
    concurrency: number = 3,
    progressCallback?: (message: string, current: number, total: number) => void
  ): Promise<DocumentationResult[]> {
    const results: DocumentationResult[] = [];
    const total = inputs.length;

    logger.info(`Generating documentation for ${total} nodes (concurrency: ${concurrency})...`);

    // Process in batches based on concurrency
    for (let i = 0; i < inputs.length; i += concurrency) {
      const batch = inputs.slice(i, i + concurrency);

      // Process batch concurrently
      const batchPromises = batch.map((input) => this.generateSummary(input));
      const batchResults = await Promise.all(batchPromises);

      results.push(...batchResults);

      if (progressCallback) {
        progressCallback('Generating documentation', Math.min(i + concurrency, total), total);
      }

      // Small delay between batches to avoid overwhelming the LLM server
      if (i + concurrency < inputs.length) {
        await this.sleep(100);
      }
    }

    const successCount = results.filter((r) => !r.error).length;
    logger.info(`Generated ${successCount}/${total} documentation summaries successfully`);

    return results;
  }

  /**
   * Build the prompt for documentation generation
   */
  private buildPrompt(input: DocumentationInput): string {
    // Truncate README to avoid token limits (keep first ~6000 chars)
    const truncatedReadme = this.truncateReadme(input.readme, 6000);

    return `
Node Information:
- Name: ${input.displayName}
- Type: ${input.nodeType}
- Package: ${input.npmPackageName || 'unknown'}
- Description: ${input.description || 'No description provided'}

README Content:
${truncatedReadme}

Based on the README and node information above, generate a structured documentation summary.
`.trim();
  }

  /**
   * Get the system prompt for documentation generation
   */
  private getSystemPrompt(): string {
    return `You are analyzing an n8n community node to generate documentation for AI assistants.

Your task: Extract key information from the README and create a structured JSON summary.

Output format (JSON only, no markdown):
{
  "purpose": "What this node does in 1-2 sentences",
  "capabilities": ["feature1", "feature2", "feature3"],
  "authentication": "How to authenticate (e.g., 'API key required', 'OAuth2', 'None')",
  "commonUseCases": ["use case 1", "use case 2"],
  "limitations": ["limitation 1"] or [] if none mentioned,
  "relatedNodes": ["related n8n node types"] or [] if none mentioned
}

Guidelines:
- Focus on information useful for AI assistants configuring workflows
- Be concise but comprehensive
- For capabilities, list specific operations/actions supported
- For authentication, identify the auth method from README
- For limitations, note any mentioned constraints or missing features
- Respond with valid JSON only, no additional text`;
  }

  /**
   * Extract JSON from LLM response (handles markdown code blocks)
   */
  private extractJson(content: string): string {
    // Strip <think>...</think> blocks from thinking models (e.g., Qwen3-Thinking)
    const stripped = content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

    // Try to extract from markdown code block
    const jsonBlockMatch = stripped.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonBlockMatch) {
      return jsonBlockMatch[1].trim();
    }

    // Try to find JSON object directly
    const jsonMatch = stripped.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return jsonMatch[0];
    }

    // Return as-is if no extraction needed
    return stripped;
  }

  /**
   * Truncate array fields to fit schema limits
   * Ensures LLM responses with extra items still validate
   */
  private truncateArrayFields(parsed: Record<string, unknown>): Record<string, unknown> {
    const limits: Record<string, number> = {
      capabilities: 10,
      commonUseCases: 5,
      limitations: 5,
      relatedNodes: 5,
    };

    const result = { ...parsed };

    for (const [field, maxLength] of Object.entries(limits)) {
      if (Array.isArray(result[field]) && result[field].length > maxLength) {
        result[field] = (result[field] as unknown[]).slice(0, maxLength);
      }
    }

    return result;
  }

  /**
   * Truncate README to avoid token limits while keeping useful content
   */
  private truncateReadme(readme: string, maxLength: number): string {
    if (readme.length <= maxLength) {
      return readme;
    }

    // Try to truncate at a paragraph boundary
    const truncated = readme.slice(0, maxLength);
    const lastParagraph = truncated.lastIndexOf('\n\n');

    if (lastParagraph > maxLength * 0.7) {
      return truncated.slice(0, lastParagraph) + '\n\n[README truncated...]';
    }

    return truncated + '\n\n[README truncated...]';
  }

  /**
   * Get default summary when generation fails
   */
  private getDefaultSummary(input: DocumentationInput): DocumentationSummary {
    return {
      purpose: input.description || `Community node: ${input.displayName}`,
      capabilities: [],
      authentication: 'See README for authentication details',
      commonUseCases: [],
      limitations: ['Documentation could not be automatically generated'],
      relatedNodes: [],
    };
  }

  /**
   * Test connection to the LLM server
   */
  async testConnection(): Promise<{ success: boolean; message: string }> {
    try {
      const completion = await this.chatCompletion([
        { role: 'user', content: 'Hello' },
      ], 200);

      if (completion.choices[0]?.message?.content) {
        return { success: true, message: `Connected to ${this.model}` };
      }

      return { success: false, message: 'No response from LLM' };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, message: `Connection failed: ${message}` };
    }
  }

  /**
   * Make a chat completion request with chat_template_kwargs support for vLLM thinking models
   */
  private async chatCompletion(
    messages: Array<{ role: string; content: string }>,
    maxTokens: number
  ): Promise<{ choices: Array<{ message: { content: string | null } }> }> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.apiKey !== 'not-needed' ? { Authorization: `Bearer ${this.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          max_completion_tokens: maxTokens,
          ...(this.temperature !== undefined ? { temperature: this.temperature } : {}),
          chat_template_kwargs: { enable_thinking: false },
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`${response.status} ${text}`);
      }

      return (await response.json()) as { choices: Array<{ message: { content: string | null } }> };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Create a documentation generator with environment variable configuration
 */
export function createDocumentationGenerator(): DocumentationGenerator {
  const baseUrl = process.env.N8N_MCP_LLM_BASE_URL || 'http://localhost:1234/v1';
  const model = process.env.N8N_MCP_LLM_MODEL || 'qwen3-4b-thinking-2507';
  const timeout = parseInt(process.env.N8N_MCP_LLM_TIMEOUT || '60000', 10);
  const apiKey = process.env.N8N_MCP_LLM_API_KEY || process.env.OPENAI_API_KEY;
  // Only set temperature for local LLM servers; cloud APIs like OpenAI may not support custom values
  const isLocalServer = !baseUrl.includes('openai.com') && !baseUrl.includes('anthropic.com');

  return new DocumentationGenerator({
    baseUrl,
    model,
    timeout,
    ...(apiKey ? { apiKey } : {}),
    ...(isLocalServer ? { temperature: 0.3 } : {}),
  });
}
