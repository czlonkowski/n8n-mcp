"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DocumentationGenerator = exports.DocumentationSummarySchema = void 0;
exports.createDocumentationGenerator = createDocumentationGenerator;
const openai_1 = __importDefault(require("openai"));
const zod_1 = require("zod");
const logger_1 = require("../utils/logger");
exports.DocumentationSummarySchema = zod_1.z.object({
    purpose: zod_1.z.string().describe('What this node does in 1-2 sentences'),
    capabilities: zod_1.z.array(zod_1.z.string()).max(10).describe('Key features and operations'),
    authentication: zod_1.z.string().describe('How to authenticate (API key, OAuth, None, etc.)'),
    commonUseCases: zod_1.z.array(zod_1.z.string()).max(5).describe('Practical use case examples'),
    limitations: zod_1.z.array(zod_1.z.string()).max(5).describe('Known limitations or caveats'),
    relatedNodes: zod_1.z.array(zod_1.z.string()).max(5).describe('Related n8n nodes if mentioned'),
});
const DEFAULT_CONFIG = {
    model: 'qwen3-4b-thinking-2507',
    apiKey: 'not-needed',
    timeout: 60000,
    maxTokens: 2000,
};
class DocumentationGenerator {
    constructor(config) {
        const fullConfig = { ...DEFAULT_CONFIG, ...config };
        this.client = new openai_1.default({
            baseURL: config.baseUrl,
            apiKey: fullConfig.apiKey,
            timeout: fullConfig.timeout,
        });
        this.model = fullConfig.model;
        this.maxTokens = fullConfig.maxTokens;
        this.timeout = fullConfig.timeout;
        this.temperature = fullConfig.temperature;
    }
    async generateSummary(input) {
        try {
            const prompt = this.buildPrompt(input);
            const completion = await this.client.chat.completions.create({
                model: this.model,
                max_completion_tokens: this.maxTokens,
                ...(this.temperature !== undefined ? { temperature: this.temperature } : {}),
                messages: [
                    {
                        role: 'system',
                        content: this.getSystemPrompt(),
                    },
                    {
                        role: 'user',
                        content: prompt,
                    },
                ],
            });
            const content = completion.choices[0]?.message?.content;
            if (!content) {
                throw new Error('No content in LLM response');
            }
            const jsonContent = this.extractJson(content);
            const parsed = JSON.parse(jsonContent);
            const truncated = this.truncateArrayFields(parsed);
            const validated = exports.DocumentationSummarySchema.parse(truncated);
            return {
                nodeType: input.nodeType,
                summary: validated,
            };
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            logger_1.logger.error(`Error generating documentation for ${input.nodeType}:`, error);
            return {
                nodeType: input.nodeType,
                summary: this.getDefaultSummary(input),
                error: errorMessage,
            };
        }
    }
    async generateBatch(inputs, concurrency = 3, progressCallback) {
        const results = [];
        const total = inputs.length;
        logger_1.logger.info(`Generating documentation for ${total} nodes (concurrency: ${concurrency})...`);
        for (let i = 0; i < inputs.length; i += concurrency) {
            const batch = inputs.slice(i, i + concurrency);
            const batchPromises = batch.map((input) => this.generateSummary(input));
            const batchResults = await Promise.all(batchPromises);
            results.push(...batchResults);
            if (progressCallback) {
                progressCallback('Generating documentation', Math.min(i + concurrency, total), total);
            }
            if (i + concurrency < inputs.length) {
                await this.sleep(100);
            }
        }
        const successCount = results.filter((r) => !r.error).length;
        logger_1.logger.info(`Generated ${successCount}/${total} documentation summaries successfully`);
        return results;
    }
    buildPrompt(input) {
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
    getSystemPrompt() {
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
    extractJson(content) {
        const jsonBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (jsonBlockMatch) {
            return jsonBlockMatch[1].trim();
        }
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            return jsonMatch[0];
        }
        return content.trim();
    }
    truncateArrayFields(parsed) {
        const limits = {
            capabilities: 10,
            commonUseCases: 5,
            limitations: 5,
            relatedNodes: 5,
        };
        const result = { ...parsed };
        for (const [field, maxLength] of Object.entries(limits)) {
            if (Array.isArray(result[field]) && result[field].length > maxLength) {
                result[field] = result[field].slice(0, maxLength);
            }
        }
        return result;
    }
    truncateReadme(readme, maxLength) {
        if (readme.length <= maxLength) {
            return readme;
        }
        const truncated = readme.slice(0, maxLength);
        const lastParagraph = truncated.lastIndexOf('\n\n');
        if (lastParagraph > maxLength * 0.7) {
            return truncated.slice(0, lastParagraph) + '\n\n[README truncated...]';
        }
        return truncated + '\n\n[README truncated...]';
    }
    getDefaultSummary(input) {
        return {
            purpose: input.description || `Community node: ${input.displayName}`,
            capabilities: [],
            authentication: 'See README for authentication details',
            commonUseCases: [],
            limitations: ['Documentation could not be automatically generated'],
            relatedNodes: [],
        };
    }
    async testConnection() {
        try {
            const completion = await this.client.chat.completions.create({
                model: this.model,
                max_completion_tokens: 200,
                messages: [
                    {
                        role: 'user',
                        content: 'Hello',
                    },
                ],
            });
            if (completion.choices[0]?.message?.content) {
                return { success: true, message: `Connected to ${this.model}` };
            }
            return { success: false, message: 'No response from LLM' };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            return { success: false, message: `Connection failed: ${message}` };
        }
    }
    sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}
exports.DocumentationGenerator = DocumentationGenerator;
function createDocumentationGenerator() {
    const baseUrl = process.env.N8N_MCP_LLM_BASE_URL || 'http://localhost:1234/v1';
    const model = process.env.N8N_MCP_LLM_MODEL || 'qwen3-4b-thinking-2507';
    const timeout = parseInt(process.env.N8N_MCP_LLM_TIMEOUT || '60000', 10);
    const apiKey = process.env.N8N_MCP_LLM_API_KEY || process.env.OPENAI_API_KEY;
    const isLocalServer = !baseUrl.includes('openai.com') && !baseUrl.includes('anthropic.com');
    return new DocumentationGenerator({
        baseUrl,
        model,
        timeout,
        ...(apiKey ? { apiKey } : {}),
        ...(isLocalServer ? { temperature: 0.3 } : {}),
    });
}
//# sourceMappingURL=documentation-generator.js.map