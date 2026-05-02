"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MetadataGenerator = exports.TemplateMetadataSchema = void 0;
const openai_1 = __importDefault(require("openai"));
const zod_1 = require("zod");
const logger_1 = require("../utils/logger");
exports.TemplateMetadataSchema = zod_1.z.object({
    categories: zod_1.z.array(zod_1.z.string()).max(5).describe('Main categories (max 5)'),
    complexity: zod_1.z.enum(['simple', 'medium', 'complex']).describe('Implementation complexity'),
    use_cases: zod_1.z.array(zod_1.z.string()).max(5).describe('Primary use cases'),
    estimated_setup_minutes: zod_1.z.number().min(5).max(480).describe('Setup time in minutes'),
    required_services: zod_1.z.array(zod_1.z.string()).describe('External services needed'),
    key_features: zod_1.z.array(zod_1.z.string()).max(5).describe('Main capabilities'),
    target_audience: zod_1.z.array(zod_1.z.string()).max(3).describe('Target users')
});
class MetadataGenerator {
    constructor(apiKey, model = 'gpt-5-mini-2025-08-07', baseURL) {
        this.client = new openai_1.default({ apiKey, ...(baseURL ? { baseURL } : {}) });
        this.model = model;
    }
    getJsonSchema() {
        return {
            name: 'template_metadata',
            strict: true,
            schema: {
                type: 'object',
                properties: {
                    categories: {
                        type: 'array',
                        items: { type: 'string' },
                        maxItems: 5,
                        description: 'Main categories like automation, integration, data processing'
                    },
                    complexity: {
                        type: 'string',
                        enum: ['simple', 'medium', 'complex'],
                        description: 'Implementation complexity level'
                    },
                    use_cases: {
                        type: 'array',
                        items: { type: 'string' },
                        maxItems: 5,
                        description: 'Primary use cases for this template'
                    },
                    estimated_setup_minutes: {
                        type: 'number',
                        minimum: 5,
                        maximum: 480,
                        description: 'Estimated setup time in minutes'
                    },
                    required_services: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'External services or APIs required'
                    },
                    key_features: {
                        type: 'array',
                        items: { type: 'string' },
                        maxItems: 5,
                        description: 'Main capabilities or features'
                    },
                    target_audience: {
                        type: 'array',
                        items: { type: 'string' },
                        maxItems: 3,
                        description: 'Target users like developers, marketers, analysts'
                    }
                },
                required: [
                    'categories',
                    'complexity',
                    'use_cases',
                    'estimated_setup_minutes',
                    'required_services',
                    'key_features',
                    'target_audience'
                ],
                additionalProperties: false
            }
        };
    }
    createBatchRequest(template) {
        return {
            custom_id: `template-${template.templateId}`,
            method: 'POST',
            url: '/v1/chat/completions',
            body: this.buildChatRequest(template)
        };
    }
    sanitizeInput(input, maxLength) {
        let sanitized = input.slice(0, maxLength);
        sanitized = sanitized.replace(/[\x00-\x1F\x7F-\x9F]/g, '');
        sanitized = sanitized.replace(/\s+/g, ' ').trim();
        sanitized = sanitized.replace(/\b(system|assistant|user|human|ai):/gi, '');
        sanitized = sanitized.replace(/```[\s\S]*?```/g, '');
        sanitized = sanitized.replace(/\[INST\]|\[\/INST\]/g, '');
        return sanitized;
    }
    summarizeNodes(nodes) {
        const nodeGroups = {};
        for (const node of nodes) {
            const baseName = node.split('.').pop() || node;
            if (baseName.includes('webhook') || baseName.includes('http')) {
                nodeGroups['HTTP/Webhooks'] = (nodeGroups['HTTP/Webhooks'] || 0) + 1;
            }
            else if (baseName.includes('database') || baseName.includes('postgres') || baseName.includes('mysql')) {
                nodeGroups['Database'] = (nodeGroups['Database'] || 0) + 1;
            }
            else if (baseName.includes('slack') || baseName.includes('email') || baseName.includes('gmail')) {
                nodeGroups['Communication'] = (nodeGroups['Communication'] || 0) + 1;
            }
            else if (baseName.includes('ai') || baseName.includes('openai') || baseName.includes('langchain') ||
                baseName.toLowerCase().includes('openai') || baseName.includes('agent')) {
                nodeGroups['AI/ML'] = (nodeGroups['AI/ML'] || 0) + 1;
            }
            else if (baseName.includes('sheet') || baseName.includes('csv') || baseName.includes('excel') ||
                baseName.toLowerCase().includes('googlesheets')) {
                nodeGroups['Spreadsheets'] = (nodeGroups['Spreadsheets'] || 0) + 1;
            }
            else {
                let displayName;
                if (node.includes('.with.') && node.includes('@')) {
                    displayName = node.split('/').pop() || baseName;
                }
                else {
                    if (baseName.endsWith('Trigger') && baseName.length > 7) {
                        displayName = baseName.slice(0, -7);
                    }
                    else if (baseName.endsWith('Node') && baseName.length > 4 && baseName !== 'unknownNode') {
                        displayName = baseName.slice(0, -4);
                    }
                    else {
                        displayName = baseName;
                    }
                }
                nodeGroups[displayName] = (nodeGroups[displayName] || 0) + 1;
            }
        }
        const summary = Object.entries(nodeGroups)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([name, count]) => count > 1 ? `${name} (${count})` : name)
            .join(', ');
        return summary;
    }
    parseResult(result) {
        try {
            if (result.error) {
                return {
                    templateId: parseInt(result.custom_id.replace('template-', '')),
                    metadata: this.getDefaultMetadata(),
                    error: result.error.message
                };
            }
            const response = result.response;
            if (!response?.body?.choices?.[0]?.message?.content) {
                throw new Error('Invalid response structure');
            }
            const content = response.body.choices[0].message.content;
            const metadata = JSON.parse(content);
            const validated = exports.TemplateMetadataSchema.parse(metadata);
            return {
                templateId: parseInt(result.custom_id.replace('template-', '')),
                metadata: validated
            };
        }
        catch (error) {
            logger_1.logger.error(`Error parsing result for ${result.custom_id}:`, error);
            return {
                templateId: parseInt(result.custom_id.replace('template-', '')),
                metadata: this.getDefaultMetadata(),
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }
    getDefaultMetadata() {
        return {
            categories: ['automation'],
            complexity: 'medium',
            use_cases: ['Process automation'],
            estimated_setup_minutes: 30,
            required_services: [],
            key_features: ['Workflow automation'],
            target_audience: ['developers']
        };
    }
    buildChatRequest(template) {
        const nodesSummary = this.summarizeNodes(template.nodes);
        const sanitizedName = this.sanitizeInput(template.name, Math.max(200, template.name.length));
        const sanitizedDescription = template.description
            ? this.sanitizeInput(template.description, 500)
            : '';
        const context = [
            `Template: ${sanitizedName}`,
            sanitizedDescription ? `Description: ${sanitizedDescription}` : '',
            `Nodes Used (${template.nodes.length}): ${nodesSummary}`,
            template.workflow ? `Workflow has ${template.workflow.nodes?.length || 0} nodes with ${Object.keys(template.workflow.connections || {}).length} connections` : ''
        ].filter(Boolean).join('\n');
        return {
            model: this.model,
            max_completion_tokens: 3000,
            response_format: {
                type: 'json_schema',
                json_schema: this.getJsonSchema()
            },
            messages: [
                {
                    role: 'system',
                    content: [
                        'You extract metadata about n8n workflow templates. Output ONLY the JSON the schema demands. Never echo the input.',
                        'categories: 1–5 broad domains (e.g. "AI/ML", "Communication", "Data Processing", "DevOps", "Marketing"). Never include the words "Template:", "Description:", or any prompt header.',
                        'use_cases: short noun phrases describing what users do with this workflow.',
                        'required_services: external SaaS / APIs / databases the workflow connects to. Do NOT list n8n itself, the runtime, or generic categories.',
                        'key_features: capabilities the workflow demonstrates.',
                        'target_audience: 1–3 user roles (e.g. "developers", "marketers", "ops engineers"). Use short noun phrases.'
                    ].join('\n')
                },
                { role: 'user', content: context }
            ]
        };
    }
    async generateDirect(template) {
        try {
            const req = this.buildChatRequest(template);
            const completion = await this.client.chat.completions.create(req);
            const content = completion.choices[0]?.message?.content;
            if (!content)
                throw new Error('No content in response');
            const metadata = JSON.parse(content);
            const validated = exports.TemplateMetadataSchema.parse(metadata);
            return { templateId: template.templateId, metadata: validated };
        }
        catch (error) {
            logger_1.logger.error(`Error generating metadata for template ${template.templateId}:`, error);
            return {
                templateId: template.templateId,
                metadata: this.getDefaultMetadata(),
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }
    async generateSingle(template) {
        try {
            const completion = await this.client.chat.completions.create({
                model: this.model,
                max_completion_tokens: 3000,
                response_format: {
                    type: 'json_schema',
                    json_schema: this.getJsonSchema()
                },
                messages: [
                    {
                        role: 'system',
                        content: `Analyze n8n workflow templates and extract metadata. Be concise.`
                    },
                    {
                        role: 'user',
                        content: `Template: ${template.name}\nNodes: ${template.nodes.slice(0, 10).join(', ')}`
                    }
                ]
            });
            const content = completion.choices[0].message.content;
            if (!content) {
                logger_1.logger.error('No content in OpenAI response');
                throw new Error('No content in response');
            }
            const metadata = JSON.parse(content);
            return exports.TemplateMetadataSchema.parse(metadata);
        }
        catch (error) {
            logger_1.logger.error('Error generating single metadata:', error);
            return this.getDefaultMetadata();
        }
    }
}
exports.MetadataGenerator = MetadataGenerator;
//# sourceMappingURL=metadata-generator.js.map