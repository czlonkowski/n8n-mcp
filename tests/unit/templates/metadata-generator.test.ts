import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MetadataGenerator, TemplateMetadataSchema, MetadataRequest } from '../../../src/templates/metadata-generator';

// Mock OpenAI
vi.mock('openai', () => {
  return {
    default: vi.fn().mockImplementation(function () {
      return {
        chat: {
          completions: {
            create: vi.fn()
          }
        }
      };
    })
  };
});

describe('MetadataGenerator', () => {
  let generator: MetadataGenerator;
  
  beforeEach(() => {
    generator = new MetadataGenerator('test-api-key', 'gpt-5-mini-2025-08-07');
  });
  
  describe('createBatchRequest', () => {
    it('should create a valid batch request', () => {
      const template: MetadataRequest = {
        templateId: 123,
        name: 'Test Workflow',
        description: 'A test workflow',
        nodes: ['n8n-nodes-base.webhook', 'n8n-nodes-base.httpRequest', 'n8n-nodes-base.slack']
      };
      
      const request = generator.createBatchRequest(template);
      
      expect(request.custom_id).toBe('template-123');
      expect(request.method).toBe('POST');
      expect(request.url).toBe('/v1/chat/completions');
      expect(request.body.model).toBe('gpt-5-mini-2025-08-07');
      expect(request.body.response_format.type).toBe('json_schema');
      expect(request.body.response_format.json_schema.strict).toBe(true);
      expect(request.body.messages).toHaveLength(2);
    });
    
    it('should summarize nodes effectively', () => {
      const template: MetadataRequest = {
        templateId: 456,
        name: 'Complex Workflow',
        nodes: [
          'n8n-nodes-base.webhook',
          'n8n-nodes-base.httpRequest',
          'n8n-nodes-base.httpRequest',
          'n8n-nodes-base.postgres',
          'n8n-nodes-base.slack',
          '@n8n/n8n-nodes-langchain.agent'
        ]
      };
      
      const request = generator.createBatchRequest(template);
      const userMessage = request.body.messages[1].content;
      
      expect(userMessage).toContain('Complex Workflow');
      expect(userMessage).toContain('Nodes Used (6)');
      expect(userMessage).toContain('HTTP/Webhooks');
    });
  });
  
  describe('parseResult', () => {
    it('should parse a successful result', () => {
      const mockResult = {
        custom_id: 'template-789',
        response: {
          body: {
            choices: [{
              message: {
                content: JSON.stringify({
                  categories: ['automation', 'integration'],
                  complexity: 'medium',
                  use_cases: ['API integration', 'Data sync'],
                  estimated_setup_minutes: 30,
                  required_services: ['Slack API'],
                  key_features: ['Webhook triggers', 'API calls'],
                  target_audience: ['developers']
                })
              },
              finish_reason: 'stop'
            }]
          }
        }
      };
      
      const result = generator.parseResult(mockResult);
      
      expect(result.templateId).toBe(789);
      expect(result.metadata.categories).toEqual(['automation', 'integration']);
      expect(result.metadata.complexity).toBe('medium');
      expect(result.error).toBeUndefined();
    });
    
    it('should handle error results', () => {
      const mockResult = {
        custom_id: 'template-999',
        error: {
          message: 'API error'
        }
      };
      
      const result = generator.parseResult(mockResult);
      
      expect(result.templateId).toBe(999);
      expect(result.error).toBe('API error');
      expect(result.metadata).toBeDefined();
      expect(result.metadata.complexity).toBe('medium'); // Default metadata
    });
    
    it('should handle malformed responses', () => {
      const mockResult = {
        custom_id: 'template-111',
        response: {
          body: {
            choices: [{
              message: {
                content: 'not valid json'
              },
              finish_reason: 'stop'
            }]
          }
        }
      };
      
      const result = generator.parseResult(mockResult);
      
      expect(result.templateId).toBe(111);
      expect(result.error).toContain('Unexpected token');
      expect(result.metadata).toBeDefined();
    });
  });
  
  describe('TemplateMetadataSchema', () => {
    it('should validate correct metadata', () => {
      const validMetadata = {
        categories: ['automation', 'integration'],
        complexity: 'simple' as const,
        use_cases: ['API calls', 'Data processing'],
        estimated_setup_minutes: 15,
        required_services: [],
        key_features: ['Fast processing'],
        target_audience: ['developers']
      };
      
      const result = TemplateMetadataSchema.safeParse(validMetadata);
      
      expect(result.success).toBe(true);
    });
    
    it('should reject invalid complexity', () => {
      const invalidMetadata = {
        categories: ['automation'],
        complexity: 'very-hard', // Invalid
        use_cases: ['API calls'],
        estimated_setup_minutes: 15,
        required_services: [],
        key_features: ['Fast'],
        target_audience: ['developers']
      };
      
      const result = TemplateMetadataSchema.safeParse(invalidMetadata);
      
      expect(result.success).toBe(false);
    });
    
    it('should enforce array limits', () => {
      const tooManyCategories = {
        categories: ['a', 'b', 'c', 'd', 'e', 'f'], // Max 5
        complexity: 'simple' as const,
        use_cases: ['API calls'],
        estimated_setup_minutes: 15,
        required_services: [],
        key_features: ['Fast'],
        target_audience: ['developers']
      };
      
      const result = TemplateMetadataSchema.safeParse(tooManyCategories);
      
      expect(result.success).toBe(false);
    });
    
    it('should enforce time limits', () => {
      const tooLongSetup = {
        categories: ['automation'],
        complexity: 'complex' as const,
        use_cases: ['API calls'],
        estimated_setup_minutes: 500, // Max 480
        required_services: [],
        key_features: ['Fast'],
        target_audience: ['developers']
      };
      
      const result = TemplateMetadataSchema.safeParse(tooLongSetup);
      
      expect(result.success).toBe(false);
    });
  });

  describe('Input Sanitization and Security', () => {
    it('should handle malicious template names safely', () => {
      const maliciousTemplate: MetadataRequest = {
        templateId: 123,
        name: '<script>alert("xss")</script>',
        description: 'javascript:alert(1)',
        nodes: ['n8n-nodes-base.webhook']
      };
      
      const request = generator.createBatchRequest(maliciousTemplate);
      const userMessage = request.body.messages[1].content;
      
      // Should contain the malicious content as-is (OpenAI will handle it)
      // but should not cause any injection in our code
      expect(userMessage).toContain('<script>alert("xss")</script>');
      expect(userMessage).toContain('javascript:alert(1)');
      expect(request.body.model).toBe('gpt-5-mini-2025-08-07');
    });

    it('should handle extremely long template names', () => {
      const longName = 'A'.repeat(10000); // Very long name
      const template: MetadataRequest = {
        templateId: 456,
        name: longName,
        nodes: ['n8n-nodes-base.webhook']
      };
      
      const request = generator.createBatchRequest(template);
      
      expect(request.custom_id).toBe('template-456');
      expect(request.body.messages[1].content).toContain(longName);
    });

    it('should handle special characters in node names', () => {
      const template: MetadataRequest = {
        templateId: 789,
        name: 'Test Workflow',
        nodes: [
          'n8n-nodes-base.webhook',
          '@n8n/custom-node.with.dots',
          'custom-package/node-with-slashes',
          'node_with_underscore',
          'node-with-unicode-名前'
        ]
      };
      
      const request = generator.createBatchRequest(template);
      const userMessage = request.body.messages[1].content;
      
      expect(userMessage).toContain('HTTP/Webhooks');
      expect(userMessage).toContain('custom-node.with.dots');
    });

    it('should handle empty or undefined descriptions safely', () => {
      const template: MetadataRequest = {
        templateId: 100,
        name: 'Test',
        description: undefined,
        nodes: ['n8n-nodes-base.webhook']
      };
      
      const request = generator.createBatchRequest(template);
      const userMessage = request.body.messages[1].content;
      
      // Should not include undefined or null in the message
      expect(userMessage).not.toContain('undefined');
      expect(userMessage).not.toContain('null');
      expect(userMessage).toContain('Test');
    });

    it('should limit context size for very large workflows', () => {
      const manyNodes = Array.from({ length: 1000 }, (_, i) => `n8n-nodes-base.node${i}`);
      const template: MetadataRequest = {
        templateId: 200,
        name: 'Huge Workflow',
        nodes: manyNodes,
        workflow: {
          nodes: Array.from({ length: 500 }, (_, i) => ({ id: `node${i}` })),
          connections: {}
        }
      };
      
      const request = generator.createBatchRequest(template);
      const userMessage = request.body.messages[1].content;
      
      // Should handle large amounts of data gracefully
      expect(userMessage.length).toBeLessThan(50000); // Reasonable limit
      expect(userMessage).toContain('Huge Workflow');
    });
  });

  describe('Error Handling and Edge Cases', () => {
    it('should handle malformed OpenAI responses', () => {
      const malformedResults = [
        {
          custom_id: 'template-111',
          response: {
            body: {
              choices: [{
                message: {
                  content: '{"invalid": json syntax}'
                },
                finish_reason: 'stop'
              }]
            }
          }
        },
        {
          custom_id: 'template-222', 
          response: {
            body: {
              choices: [{
                message: {
                  content: null
                },
                finish_reason: 'stop'
              }]
            }
          }
        },
        {
          custom_id: 'template-333',
          response: {
            body: {
              choices: []
            }
          }
        }
      ];
      
      malformedResults.forEach(result => {
        const parsed = generator.parseResult(result);
        expect(parsed.error).toBeDefined();
        expect(parsed.metadata).toBeDefined();
        expect(parsed.metadata.complexity).toBe('medium'); // Default metadata
      });
    });

    it('should handle Zod validation failures', () => {
      const invalidResponse = {
        custom_id: 'template-444',
        response: {
          body: {
            choices: [{
              message: {
                content: JSON.stringify({
                  categories: ['too', 'many', 'categories', 'here', 'way', 'too', 'many'],
                  complexity: 'invalid-complexity',
                  use_cases: [],
                  estimated_setup_minutes: -5, // Invalid negative time
                  required_services: 'not-an-array',
                  key_features: null,
                  target_audience: ['too', 'many', 'audiences', 'here']
                })
              },
              finish_reason: 'stop'
            }]
          }
        }
      };
      
      const result = generator.parseResult(invalidResponse);
      
      expect(result.templateId).toBe(444);
      expect(result.error).toBeDefined();
      expect(result.metadata).toEqual(generator['getDefaultMetadata']());
    });

    it('should handle network timeouts gracefully in generateSingle', async () => {
      // Create a new generator with mocked OpenAI client
      const mockClient = {
        chat: {
          completions: {
            create: vi.fn().mockRejectedValue(new Error('Request timed out'))
          }
        }
      };
      
      // Override the client property using Object.defineProperty
      Object.defineProperty(generator, 'client', {
        value: mockClient,
        writable: true
      });
      
      const template: MetadataRequest = {
        templateId: 555,
        name: 'Timeout Test',
        nodes: ['n8n-nodes-base.webhook']
      };
      
      const result = await generator.generateSingle(template);
      
      // Should return default metadata instead of throwing
      expect(result).toEqual(generator['getDefaultMetadata']());
    });
  });

  describe('Node Summarization Logic', () => {
    it('should group similar nodes correctly', () => {
      const template: MetadataRequest = {
        templateId: 666,
        name: 'Complex Workflow',
        nodes: [
          'n8n-nodes-base.webhook',
          'n8n-nodes-base.httpRequest',
          'n8n-nodes-base.postgres',
          'n8n-nodes-base.mysql',
          'n8n-nodes-base.slack',
          'n8n-nodes-base.gmail',
          '@n8n/n8n-nodes-langchain.openAi',
          '@n8n/n8n-nodes-langchain.agent',
          'n8n-nodes-base.googleSheets',
          'n8n-nodes-base.excel'
        ]
      };
      
      const request = generator.createBatchRequest(template);
      const userMessage = request.body.messages[1].content;
      
      expect(userMessage).toContain('HTTP/Webhooks (2)');
      expect(userMessage).toContain('Database (2)');
      expect(userMessage).toContain('Communication (2)');
      expect(userMessage).toContain('AI/ML (2)');
      expect(userMessage).toContain('Spreadsheets (2)');
    });

    it('should handle unknown node types gracefully', () => {
      const template: MetadataRequest = {
        templateId: 777,
        name: 'Unknown Nodes',
        nodes: [
          'custom-package.unknownNode',
          'another-package.weirdNodeType',
          'someNodeTrigger',
          'anotherNode'
        ]
      };
      
      const request = generator.createBatchRequest(template);
      const userMessage = request.body.messages[1].content;
      
      // Should handle unknown nodes without crashing
      expect(userMessage).toContain('unknownNode');
      expect(userMessage).toContain('weirdNodeType');
      expect(userMessage).toContain('someNode'); // Trigger suffix removed
    });

    it('should limit node summary length', () => {
      const manyNodes = Array.from({ length: 50 }, (_, i) => 
        `n8n-nodes-base.customNode${i}`
      );
      
      const template: MetadataRequest = {
        templateId: 888,
        name: 'Many Nodes',
        nodes: manyNodes
      };
      
      const request = generator.createBatchRequest(template);
      const userMessage = request.body.messages[1].content;
      
      // Should limit to top 10 groups
      const summaryLine = userMessage.split('\n').find((line: string) => 
        line.includes('Nodes Used (50)')
      );
      
      expect(summaryLine).toBeDefined();
      const nodeGroups = summaryLine!.split(': ')[1].split(', ');
      expect(nodeGroups.length).toBeLessThanOrEqual(10);
    });
  });
});