import OpenAI from 'openai';
import { z } from 'zod';
import { logger } from '../utils/logger';
import { TemplateWorkflow, TemplateDetail } from './template-fetcher';

// Metadata schema using Zod for validation
export const TemplateMetadataSchema = z.object({
  categories: z.array(z.string()).max(5).describe('Main categories (max 5)'),
  complexity: z.enum(['simple', 'medium', 'complex']).describe('Implementation complexity'),
  use_cases: z.array(z.string()).max(5).describe('Primary use cases'),
  estimated_setup_minutes: z.number().min(5).max(480).describe('Setup time in minutes'),
  required_services: z.array(z.string()).describe('External services needed'),
  key_features: z.array(z.string()).max(5).describe('Main capabilities'),
  target_audience: z.array(z.string()).max(3).describe('Target users')
});

export type TemplateMetadata = z.infer<typeof TemplateMetadataSchema>;

export interface MetadataRequest {
  templateId: number;
  name: string;
  description?: string;
  nodes: string[];
  workflow?: any;
}

export interface MetadataResult {
  templateId: number;
  metadata: TemplateMetadata;
  error?: string;
}

export class MetadataGenerator {
  private client: OpenAI;
  private model: string;

  constructor(apiKey: string, model: string = 'gpt-5-mini-2025-08-07', baseURL?: string) {
    this.client = new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) });
    this.model = model;
  }
  
  /**
   * Generate the JSON schema for OpenAI structured outputs
   */
  private getJsonSchema() {
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
  
  /**
   * Create a batch request for a single template. Shares the chat body with
   * {@link buildChatRequest} so the leak-resistant system prompt applies to
   * the OpenAI Batch API path too.
   */
  createBatchRequest(template: MetadataRequest): any {
    return {
      custom_id: `template-${template.templateId}`,
      method: 'POST',
      url: '/v1/chat/completions',
      body: this.buildChatRequest(template)
    };
  }
  
  /**
   * Sanitize input to prevent prompt injection and control token usage
   */
  private sanitizeInput(input: string, maxLength: number): string {
    // Truncate to max length
    let sanitized = input.slice(0, maxLength);
    
    // Remove control characters and excessive whitespace
    sanitized = sanitized.replace(/[\x00-\x1F\x7F-\x9F]/g, '');
    
    // Replace multiple spaces/newlines with single space
    sanitized = sanitized.replace(/\s+/g, ' ').trim();
    
    // Remove potential prompt injection patterns
    sanitized = sanitized.replace(/\b(system|assistant|user|human|ai):/gi, '');
    sanitized = sanitized.replace(/```[\s\S]*?```/g, ''); // Remove code blocks
    sanitized = sanitized.replace(/\[INST\]|\[\/INST\]/g, ''); // Remove instruction markers
    
    return sanitized;
  }
  
  /**
   * Summarize nodes for better context
   */
  private summarizeNodes(nodes: string[]): string {
    // Group similar nodes
    const nodeGroups: Record<string, number> = {};
    
    for (const node of nodes) {
      // Extract base node name (remove package prefix)
      const baseName = node.split('.').pop() || node;
      
      // Group by category
      if (baseName.includes('webhook') || baseName.includes('http')) {
        nodeGroups['HTTP/Webhooks'] = (nodeGroups['HTTP/Webhooks'] || 0) + 1;
      } else if (baseName.includes('database') || baseName.includes('postgres') || baseName.includes('mysql')) {
        nodeGroups['Database'] = (nodeGroups['Database'] || 0) + 1;
      } else if (baseName.includes('slack') || baseName.includes('email') || baseName.includes('gmail')) {
        nodeGroups['Communication'] = (nodeGroups['Communication'] || 0) + 1;
      } else if (baseName.includes('ai') || baseName.includes('openai') || baseName.includes('langchain') || 
                 baseName.toLowerCase().includes('openai') || baseName.includes('agent')) {
        nodeGroups['AI/ML'] = (nodeGroups['AI/ML'] || 0) + 1;
      } else if (baseName.includes('sheet') || baseName.includes('csv') || baseName.includes('excel') || 
                 baseName.toLowerCase().includes('googlesheets')) {
        nodeGroups['Spreadsheets'] = (nodeGroups['Spreadsheets'] || 0) + 1;
      } else {
        // For unmatched nodes, try to use a meaningful name
        // If it's a special node name with dots, preserve the meaningful part
        let displayName;
        if (node.includes('.with.') && node.includes('@')) {
          // Special case for node names like '@n8n/custom-node.with.dots'
          displayName = node.split('/').pop() || baseName;
        } else {
          // Use the full base name for normal unknown nodes
          // Only clean obvious suffixes, not when they're part of meaningful names
          if (baseName.endsWith('Trigger') && baseName.length > 7) {
            displayName = baseName.slice(0, -7); // Remove 'Trigger'
          } else if (baseName.endsWith('Node') && baseName.length > 4 && baseName !== 'unknownNode') {
            displayName = baseName.slice(0, -4); // Remove 'Node' only if it's not the main name
          } else {
            displayName = baseName; // Keep the full name
          }
        }
        nodeGroups[displayName] = (nodeGroups[displayName] || 0) + 1;
      }
    }
    
    // Format summary
    const summary = Object.entries(nodeGroups)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10) // Top 10 groups
      .map(([name, count]) => count > 1 ? `${name} (${count})` : name)
      .join(', ');
    
    return summary;
  }
  
  /**
   * Parse a batch result
   */
  parseResult(result: any): MetadataResult {
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
      
      // Validate with Zod
      const validated = TemplateMetadataSchema.parse(metadata);
      
      return {
        templateId: parseInt(result.custom_id.replace('template-', '')),
        metadata: validated
      };
    } catch (error) {
      logger.error(`Error parsing result for ${result.custom_id}:`, error);
      return {
        templateId: parseInt(result.custom_id.replace('template-', '')),
        metadata: this.getDefaultMetadata(),
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
  
  /**
   * Get default metadata for fallback
   */
  private getDefaultMetadata(): TemplateMetadata {
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
  
  /**
   * Build the prompt body shared by batch and direct paths.
   */
  buildChatRequest(template: MetadataRequest) {
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
      } as any,
      messages: [
        {
          role: 'system' as const,
          content: [
            'You extract metadata about n8n workflow templates. Output ONLY the JSON the schema demands. Never echo the input.',
            'categories: 1–5 broad domains (e.g. "AI/ML", "Communication", "Data Processing", "DevOps", "Marketing"). Never include the words "Template:", "Description:", or any prompt header.',
            'use_cases: short noun phrases describing what users do with this workflow.',
            'required_services: external SaaS / APIs / databases the workflow connects to. Do NOT list n8n itself, the runtime, or generic categories.',
            'key_features: capabilities the workflow demonstrates.',
            'target_audience: 1–3 user roles (e.g. "developers", "marketers", "ops engineers"). Use short noun phrases.'
          ].join('\n')
        },
        { role: 'user' as const, content: context }
      ]
    };
  }

  /**
   * Generate metadata for one template via direct (non-batch) chat completion.
   * Used for OpenAI-compatible servers (vLLM, Ollama) that don't implement /v1/batches.
   */
  async generateDirect(template: MetadataRequest): Promise<MetadataResult> {
    try {
      const req = this.buildChatRequest(template);
      const completion = await this.client.chat.completions.create(req);
      const content = completion.choices[0]?.message?.content;
      if (!content) throw new Error('No content in response');
      const metadata = JSON.parse(content);
      const validated = TemplateMetadataSchema.parse(metadata);
      return { templateId: template.templateId, metadata: validated };
    } catch (error) {
      logger.error(`Error generating metadata for template ${template.templateId}:`, error);
      return {
        templateId: template.templateId,
        metadata: this.getDefaultMetadata(),
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Generate metadata for a single template (for testing)
   */
  async generateSingle(template: MetadataRequest): Promise<TemplateMetadata> {
    try {
      const completion = await this.client.chat.completions.create({
        model: this.model,
        // temperature removed - not supported in batch API for this model
        max_completion_tokens: 3000,
        response_format: {
          type: 'json_schema',
          json_schema: this.getJsonSchema()
        } as any,
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
        logger.error('No content in OpenAI response');
        throw new Error('No content in response');
      }
      
      const metadata = JSON.parse(content);
      return TemplateMetadataSchema.parse(metadata);
    } catch (error) {
      logger.error('Error generating single metadata:', error);
      return this.getDefaultMetadata();
    }
  }
}