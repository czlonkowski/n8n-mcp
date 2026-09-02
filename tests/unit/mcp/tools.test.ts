import { describe, it, expect } from 'vitest';
import { n8nDocumentationToolsFinal } from '@/mcp/tools';
import { n8nManagementTools } from '@/mcp/tools-n8n-manager';
import { z } from 'zod';

describe('n8nDocumentationToolsFinal', () => {
  describe('Tool Structure Validation', () => {
    it('should have all required properties for each tool', () => {
      n8nDocumentationToolsFinal.forEach(tool => {
        // Check required properties exist
        expect(tool).toHaveProperty('name');
        expect(tool).toHaveProperty('description');
        expect(tool).toHaveProperty('inputSchema');

        // Check property types
        expect(typeof tool.name).toBe('string');
        expect(typeof tool.description).toBe('string');
        expect(tool.inputSchema).toBeTypeOf('object');

        // Name should be non-empty
        expect(tool.name.length).toBeGreaterThan(0);
        
        // Description should be meaningful
        expect(tool.description.length).toBeGreaterThan(10);
      });
    });

    it('should have unique tool names', () => {
      const names = n8nDocumentationToolsFinal.map(tool => tool.name);
      const uniqueNames = new Set(names);
      expect(names.length).toBe(uniqueNames.size);
    });

    it('should have valid JSON Schema for all inputSchemas', () => {
      // Define a minimal JSON Schema validator using Zod
      const jsonSchemaValidator = z.object({
        type: z.literal('object'),
        properties: z.record(z.any()).optional(),
        required: z.array(z.string()).optional(),
      });

      n8nDocumentationToolsFinal.forEach(tool => {
        expect(() => {
          jsonSchemaValidator.parse(tool.inputSchema);
        }).not.toThrow();
      });
    });

    it('uses camelCase for every public top-level input', () => {
      [...n8nDocumentationToolsFinal, ...n8nManagementTools].forEach(tool => {
        const propertyNames = Object.keys(tool.inputSchema.properties ?? {});
        expect(propertyNames.filter(name => name.includes('_')), tool.name).toEqual([]);
      });
    });
  });

  describe('Individual Tool Validation', () => {
    describe('tools_documentation', () => {
      const tool = n8nDocumentationToolsFinal.find(t => t.name === 'tools_documentation');

      it('should exist', () => {
        expect(tool).toBeDefined();
      });

      it('should have correct schema', () => {
        expect(tool?.inputSchema).toMatchObject({
          type: 'object',
          properties: {
            topic: {
              type: 'string',
              description: expect.any(String)
            },
            depth: {
              type: 'string',
              enum: ['essentials', 'full'],
              description: expect.any(String),
              default: 'essentials'
            }
          }
        });
      });

      it('should have helpful description', () => {
        expect(tool?.description).toContain('documentation');
        expect(tool?.description).toContain('MCP tools');
      });
    });

    describe('get_node', () => {
      const tool = n8nDocumentationToolsFinal.find(t => t.name === 'get_node');

      it('should exist', () => {
        expect(tool).toBeDefined();
      });

      it('should have nodeType as required parameter', () => {
        expect(tool?.inputSchema.required).toContain('nodeType');
      });

      it('should mention detail levels in description', () => {
        expect(tool?.description).toMatch(/minimal|standard|full/i);
      });
    });

    describe('search_nodes', () => {
      const tool = n8nDocumentationToolsFinal.find(t => t.name === 'search_nodes');

      it('should exist', () => {
        expect(tool).toBeDefined();
      });

      it('should have query as required parameter', () => {
        expect(tool?.inputSchema.required).toContain('query');
      });

      it('should have mode enum with correct values', () => {
        expect(tool?.inputSchema.properties.mode.enum).toEqual(['OR', 'AND', 'FUZZY']);
        expect(tool?.inputSchema.properties.mode.default).toBe('OR');
      });

      it('should have limit with default value', () => {
        expect(tool?.inputSchema.properties.limit.default).toBe(20);
      });
    });

    describe('validate_workflow', () => {
      const tool = n8nDocumentationToolsFinal.find(t => t.name === 'validate_workflow');

      it('should exist', () => {
        expect(tool).toBeDefined();
      });

      it('should have workflow as required parameter', () => {
        expect(tool?.inputSchema.required).toContain('workflow');
      });

      it('should have options with correct validation settings', () => {
        const options = tool?.inputSchema.properties.options.properties;
        expect(options).toHaveProperty('validateNodes');
        expect(options).toHaveProperty('validateConnections');
        expect(options).toHaveProperty('validateExpressions');
        expect(options).toHaveProperty('profile');
      });

      it('should have correct profile enum values', () => {
        const profile = tool?.inputSchema.properties.options.properties.profile;
        expect(profile.enum).toEqual(['minimal', 'runtime', 'ai-friendly', 'strict']);
        expect(profile.default).toBe('runtime');
      });
    });

    describe('search_templates (consolidated)', () => {
      const tool = n8nDocumentationToolsFinal.find(t => t.name === 'search_templates');

      it('should exist', () => {
        expect(tool).toBeDefined();
      });

      it('should have searchMode parameter with correct enum values', () => {
        const searchModeParam = tool?.inputSchema.properties?.searchMode;
        expect(searchModeParam).toBeDefined();
        expect(searchModeParam.enum).toEqual(['keyword', 'by_nodes', 'by_task', 'by_metadata', 'patterns']);
        expect(searchModeParam.default).toBe('keyword');
      });

      it('should have task parameter for by_task searchMode', () => {
        const taskParam = tool?.inputSchema.properties?.task;
        expect(taskParam).toBeDefined();
        const expectedTasks = [
          'ai_automation',
          'data_sync',
          'webhook_processing',
          'email_automation',
          'slack_integration',
          'data_transformation',
          'file_processing',
          'scheduling',
          'api_integration',
          'database_operations'
        ];
        expect(taskParam.enum).toEqual(expectedTasks);
      });

      it('should have nodeTypes parameter for by_nodes searchMode', () => {
        const nodeTypesParam = tool?.inputSchema.properties?.nodeTypes;
        expect(nodeTypesParam).toBeDefined();
        expect(nodeTypesParam.type).toBe('array');
        expect(nodeTypesParam.items.type).toBe('string');
      });
    });
  });

  describe('Tool Description Quality', () => {
    it('should have concise descriptions that fit within reasonable limits', () => {
      n8nDocumentationToolsFinal.forEach(tool => {
        // Consolidated tools (v2.26.0) may have longer descriptions due to multiple modes
        // Allow up to 500 chars for tools with mode-based functionality
        expect(tool.description.length).toBeLessThan(500);
      });
    });

    it('should include examples or key information in descriptions', () => {
      const toolsWithExamples = [
        'get_node',
        'search_nodes'
      ];

      toolsWithExamples.forEach(toolName => {
        const tool = n8nDocumentationToolsFinal.find(t => t.name === toolName);
        // Should include either example usage, format information, or "nodes-base"
        expect(tool?.description).toMatch(/example|Example|format|Format|nodes-base|Common:|mode/i);
      });
    });
  });

  describe('Schema Consistency', () => {
    it('should use consistent parameter naming', () => {
      const toolsWithNodeType = n8nDocumentationToolsFinal.filter(tool => 
        tool.inputSchema.properties?.nodeType
      );

      toolsWithNodeType.forEach(tool => {
        const nodeTypeParam = tool.inputSchema.properties.nodeType;
        expect(nodeTypeParam.type).toBe('string');
        // Should mention the prefix requirement
        expect(nodeTypeParam.description).toMatch(/nodes-base|prefix/i);
      });
    });

    it('should have consistent limit parameter defaults', () => {
      const toolsWithLimit = n8nDocumentationToolsFinal.filter(tool => 
        tool.inputSchema.properties?.limit
      );

      toolsWithLimit.forEach(tool => {
        const limitParam = tool.inputSchema.properties.limit;
        expect(limitParam.type).toBe('number');
        expect(limitParam.default).toBeDefined();
        expect(limitParam.default).toBeGreaterThan(0);
      });
    });
  });

  describe('Tool Categories Coverage', () => {
    it('should have tools for all major categories', () => {
      // Updated for v2.26.0 consolidated tools
      const categories = {
        discovery: ['search_nodes'],
        configuration: ['get_node'],  // get_node now includes docs mode
        validation: ['validate_node', 'validate_workflow'],  // consolidated validate_node
        templates: ['search_templates', 'get_template'],  // search_templates now handles all search modes
        documentation: ['tools_documentation']
      };

      Object.entries(categories).forEach(([_category, expectedTools]) => {
        expectedTools.forEach(toolName => {
          const tool = n8nDocumentationToolsFinal.find(t => t.name === toolName);
          expect(tool).toBeDefined();
        });
      });
    });
  });

  describe('Parameter Validation', () => {
    it('should have proper type definitions for all parameters', () => {
      const validTypes = ['string', 'number', 'boolean', 'object', 'array'];

      n8nDocumentationToolsFinal.forEach(tool => {
        if (tool.inputSchema.properties) {
          Object.entries(tool.inputSchema.properties).forEach(([paramName, param]) => {
            expect(validTypes).toContain(param.type);
            expect(param.description).toBeDefined();
          });
        }
      });
    });

    it('should mark required parameters correctly', () => {
      const toolsWithRequired = n8nDocumentationToolsFinal.filter(tool => 
        tool.inputSchema.required && tool.inputSchema.required.length > 0
      );

      toolsWithRequired.forEach(tool => {
        tool.inputSchema.required!.forEach(requiredParam => {
          expect(tool.inputSchema.properties).toHaveProperty(requiredParam);
        });
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle tools with optional parameters only', () => {
      // Tools where all parameters are optional
      const toolsWithOptionalParams = ['tools_documentation'];

      toolsWithOptionalParams.forEach(toolName => {
        const tool = n8nDocumentationToolsFinal.find(t => t.name === toolName);
        expect(tool).toBeDefined();
        // These tools have properties but no required array or empty required array
        expect(tool?.inputSchema.required === undefined || tool?.inputSchema.required?.length === 0).toBe(true);
      });
    });

    it('should have array parameters defined correctly', () => {
      // search_templates now handles nodeTypes for by_nodes mode
      const tool = n8nDocumentationToolsFinal.find(t => t.name === 'search_templates');
      const arrayParam = tool?.inputSchema.properties?.nodeTypes;
      expect(arrayParam?.type).toBe('array');
      expect(arrayParam?.items).toBeDefined();
      expect(arrayParam?.items.type).toBe('string');
    });
  });

  describe('Consolidated Template Tools (v2.26.0)', () => {
    describe('get_template', () => {
      const tool = n8nDocumentationToolsFinal.find(t => t.name === 'get_template');

      it('should exist and support mode parameter', () => {
        expect(tool).toBeDefined();
        expect(tool?.description).toContain('mode');
      });

      it('should have mode parameter with correct values', () => {
        expect(tool?.inputSchema.properties).toHaveProperty('mode');

        const modeParam = tool?.inputSchema.properties.mode;
        expect(modeParam.enum).toEqual(['nodes_only', 'structure', 'full']);
        expect(modeParam.default).toBe('full');
      });

      it('should require templateId parameter', () => {
        expect(tool?.inputSchema.required).toContain('templateId');
      });
    });

    describe('search_templates (consolidated with searchMode)', () => {
      const tool = n8nDocumentationToolsFinal.find(t => t.name === 'search_templates');

      it('should exist with searchMode parameter', () => {
        expect(tool).toBeDefined();
        expect(tool?.inputSchema.properties).toHaveProperty('searchMode');
      });

      it('should support metadata filtering via by_metadata searchMode', () => {
        // These properties are for by_metadata searchMode
        const props = tool?.inputSchema.properties;
        expect(props).toHaveProperty('category');
        expect(props).toHaveProperty('complexity');
        expect(props?.complexity?.enum).toEqual(['simple', 'medium', 'complex']);
      });

      it('should have pagination parameters', () => {
        const limitProp = tool?.inputSchema.properties?.limit;
        const offsetProp = tool?.inputSchema.properties?.offset;

        expect(limitProp).toBeDefined();
        expect(limitProp.type).toBe('number');
        expect(limitProp.default).toBe(20);
        expect(limitProp.maximum).toBe(100);
        expect(limitProp.minimum).toBe(1);

        expect(offsetProp).toBeDefined();
        expect(offsetProp.type).toBe('number');
        expect(offsetProp.default).toBe(0);
        expect(offsetProp.minimum).toBe(0);
      });

      it('should include all search mode-specific properties', () => {
        const properties = Object.keys(tool?.inputSchema.properties || {});
        // Consolidated tool includes properties from all former tools
        const expectedProperties = [
          'searchMode',  // New mode selector
          'query',       // For keyword search
          'nodeTypes',   // For by_nodes search (formerly list_node_templates)
          'task',        // For by_task search (formerly get_templates_for_task)
          'category',    // For by_metadata search
          'complexity',
          'limit',
          'offset'
        ];

        expectedProperties.forEach(prop => {
          expect(properties).toContain(prop);
        });
      });
    });
  });
});
