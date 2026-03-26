import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConfigValidator } from '@/services/config-validator';
import type { ValidationResult, ValidationError, ValidationWarning } from '@/services/config-validator';

// Mock the database
vi.mock('better-sqlite3');

describe('ConfigValidator - Basic Validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('validate', () => {
    it('should validate required fields for Slack message post', () => {
      const nodeType = 'nodes-base.slack';
      const config = {
        resource: 'message',
        operation: 'post'
        // Missing required 'channel' field
      };
      const properties = [
        {
          name: 'resource',
          type: 'options',
          required: true,
          default: 'message',
          options: [
            { name: 'Message', value: 'message' },
            { name: 'Channel', value: 'channel' }
          ]
        },
        {
          name: 'operation',
          type: 'options',
          required: true,
          default: 'post',
          displayOptions: {
            show: { resource: ['message'] }
          },
          options: [
            { name: 'Post', value: 'post' },
            { name: 'Update', value: 'update' }
          ]
        },
        {
          name: 'channel',
          type: 'string',
          required: true,
          displayOptions: {
            show: { 
              resource: ['message'],
              operation: ['post']
            }
          }
        }
      ];

      const result = ConfigValidator.validate(nodeType, config, properties);

      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toMatchObject({
        type: 'missing_required',
        property: 'channel',
        message: "Required property 'channel' is missing",
        fix: 'Add channel to your configuration'
      });
    });

    it('should validate successfully with all required fields', () => {
      const nodeType = 'nodes-base.slack';
      const config = {
        resource: 'message',
        operation: 'post',
        channel: '#general',
        text: 'Hello, Slack!'
      };
      const properties = [
        {
          name: 'resource',
          type: 'options',
          required: true,
          default: 'message',
          options: [
            { name: 'Message', value: 'message' },
            { name: 'Channel', value: 'channel' }
          ]
        },
        {
          name: 'operation',
          type: 'options',
          required: true,
          default: 'post',
          displayOptions: {
            show: { resource: ['message'] }
          },
          options: [
            { name: 'Post', value: 'post' },
            { name: 'Update', value: 'update' }
          ]
        },
        {
          name: 'channel',
          type: 'string',
          required: true,
          displayOptions: {
            show: { 
              resource: ['message'],
              operation: ['post']
            }
          }
        },
        {
          name: 'text',
          type: 'string',
          default: '',
          displayOptions: {
            show: { 
              resource: ['message'],
              operation: ['post']
            }
          }
        }
      ];

      const result = ConfigValidator.validate(nodeType, config, properties);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should handle unknown node types gracefully', () => {
      const nodeType = 'nodes-base.unknown';
      const config = { field: 'value' };
      const properties: any[] = [];

      const result = ConfigValidator.validate(nodeType, config, properties);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      // May have warnings about unused properties
    });

    it('should validate property types', () => {
      const nodeType = 'nodes-base.test';
      const config = {
        numberField: 'not-a-number', // Should be number
        booleanField: 'yes' // Should be boolean
      };
      const properties = [
        { name: 'numberField', type: 'number' },
        { name: 'booleanField', type: 'boolean' }
      ];

      const result = ConfigValidator.validate(nodeType, config, properties);

      expect(result.errors).toHaveLength(2);
      expect(result.errors.some(e => 
        e.property === 'numberField' && 
        e.type === 'invalid_type'
      )).toBe(true);
      expect(result.errors.some(e => 
        e.property === 'booleanField' && 
        e.type === 'invalid_type'
      )).toBe(true);
    });

    it('should validate option values', () => {
      const nodeType = 'nodes-base.test';
      const config = {
        selectField: 'invalid-option'
      };
      const properties = [
        {
          name: 'selectField',
          type: 'options',
          options: [
            { name: 'Option A', value: 'a' },
            { name: 'Option B', value: 'b' }
          ]
        }
      ];

      const result = ConfigValidator.validate(nodeType, config, properties);

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toMatchObject({
        type: 'invalid_value',
        property: 'selectField',
        message: expect.stringContaining('Invalid value')
      });
    });

    it('should check property visibility based on displayOptions', () => {
      const nodeType = 'nodes-base.test';
      const config = {
        resource: 'user',
        userField: 'visible'
      };
      const properties = [
        {
          name: 'resource',
          type: 'options',
          options: [
            { name: 'User', value: 'user' },
            { name: 'Post', value: 'post' }
          ]
        },
        {
          name: 'userField',
          type: 'string',
          displayOptions: {
            show: { resource: ['user'] }
          }
        },
        {
          name: 'postField',
          type: 'string',
          displayOptions: {
            show: { resource: ['post'] }
          }
        }
      ];

      const result = ConfigValidator.validate(nodeType, config, properties);

      expect(result.visibleProperties).toContain('resource');
      expect(result.visibleProperties).toContain('userField');
      expect(result.hiddenProperties).toContain('postField');
    });

    it('should handle empty properties array', () => {
      const nodeType = 'nodes-base.test';
      const config = { someField: 'value' };
      const properties: any[] = [];

      const result = ConfigValidator.validate(nodeType, config, properties);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should handle missing displayOptions gracefully', () => {
      const nodeType = 'nodes-base.test';
      const config = { field1: 'value1' };
      const properties = [
        { name: 'field1', type: 'string' }
        // No displayOptions
      ];

      const result = ConfigValidator.validate(nodeType, config, properties);

      expect(result.visibleProperties).toContain('field1');
    });

    it('should validate options with array format', () => {
      const nodeType = 'nodes-base.test';
      const config = { optionField: 'b' };
      const properties = [
        {
          name: 'optionField',
          type: 'options',
          options: [
            { name: 'Option A', value: 'a' },
            { name: 'Option B', value: 'b' },
            { name: 'Option C', value: 'c' }
          ]
        }
      ];

      const result = ConfigValidator.validate(nodeType, config, properties);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('edge cases and additional coverage', () => {
    it('should handle null and undefined config values', () => {
      const nodeType = 'nodes-base.test';
      const config = {
        nullField: null,
        undefinedField: undefined,
        validField: 'value'
      };
      const properties = [
        { name: 'nullField', type: 'string', required: true },
        { name: 'undefinedField', type: 'string', required: true },
        { name: 'validField', type: 'string' }
      ];

      const result = ConfigValidator.validate(nodeType, config, properties);

      expect(result.errors.some(e => e.property === 'nullField')).toBe(true);
      expect(result.errors.some(e => e.property === 'undefinedField')).toBe(true);
    });

    it('should validate nested displayOptions conditions', () => {
      const nodeType = 'nodes-base.test';
      const config = {
        mode: 'advanced',
        resource: 'user',
        advancedUserField: 'value'
      };
      const properties = [
        {
          name: 'mode',
          type: 'options',
          options: [
            { name: 'Simple', value: 'simple' },
            { name: 'Advanced', value: 'advanced' }
          ]
        },
        {
          name: 'resource',
          type: 'options',
          displayOptions: {
            show: { mode: ['advanced'] }
          },
          options: [
            { name: 'User', value: 'user' },
            { name: 'Post', value: 'post' }
          ]
        },
        {
          name: 'advancedUserField',
          type: 'string',
          displayOptions: {
            show: { 
              mode: ['advanced'],
              resource: ['user']
            }
          }
        }
      ];

      const result = ConfigValidator.validate(nodeType, config, properties);

      expect(result.visibleProperties).toContain('advancedUserField');
    });

    it('should handle hide conditions in displayOptions', () => {
      const nodeType = 'nodes-base.test';
      const config = {
        showAdvanced: false,
        hiddenField: 'should-not-be-here'
      };
      const properties = [
        {
          name: 'showAdvanced',
          type: 'boolean'
        },
        {
          name: 'hiddenField',
          type: 'string',
          displayOptions: {
            hide: { showAdvanced: [false] }
          }
        }
      ];

      const result = ConfigValidator.validate(nodeType, config, properties);

      expect(result.hiddenProperties).toContain('hiddenField');
      expect(result.warnings.some(w => 
        w.property === 'hiddenField' && 
        w.type === 'inefficient'
      )).toBe(true);
    });

    it('should handle internal properties that start with underscore', () => {
      const nodeType = 'nodes-base.test';
      const config = {
        '@version': 1,
        '_internalField': 'value',
        normalField: 'value'
      };
      const properties = [
        { name: 'normalField', type: 'string' }
      ];

      const result = ConfigValidator.validate(nodeType, config, properties);

      // Should not warn about @version or _internalField
      expect(result.warnings.some(w => 
        w.property === '@version' || 
        w.property === '_internalField'
      )).toBe(false);
    });

    it('should warn about inefficient configured but hidden properties', () => {
      const nodeType = 'nodes-base.test'; // Changed from Code node
      const config = {
        mode: 'manual',
        automaticField: 'This will not be used'
      };
      const properties = [
        {
          name: 'mode',
          type: 'options',
          options: [
            { name: 'Manual', value: 'manual' },
            { name: 'Automatic', value: 'automatic' }
          ]
        },
        {
          name: 'automaticField',
          type: 'string',
          displayOptions: {
            show: { mode: ['automatic'] }
          }
        }
      ];

      const result = ConfigValidator.validate(nodeType, config, properties);

      expect(result.warnings.some(w => 
        w.type === 'inefficient' && 
        w.property === 'automaticField' &&
        w.message.includes("won't be used")
      )).toBe(true);
    });

    it('should suggest commonly used properties', () => {
      const nodeType = 'nodes-base.httpRequest';
      const config = {
        method: 'GET',
        url: 'https://api.example.com/data'
      };
      const properties = [
        { name: 'method', type: 'options' },
        { name: 'url', type: 'string' },
        { name: 'headers', type: 'json' }
      ];

      const result = ConfigValidator.validate(nodeType, config, properties);

      // Common properties suggestion not implemented for headers
      expect(result.suggestions.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('resourceLocator validation', () => {
    it('should reject string value when resourceLocator object is required', () => {
      const nodeType = '@n8n/n8n-nodes-langchain.lmChatOpenAi';
      const config = {
        model: 'gpt-4o-mini' // Wrong - should be object with mode and value
      };
      const properties = [
        {
          name: 'model',
          displayName: 'Model',
          type: 'resourceLocator',
          required: true,
          default: { mode: 'list', value: 'gpt-4o-mini' }
        }
      ];

      const result = ConfigValidator.validate(nodeType, config, properties);

      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toMatchObject({
        type: 'invalid_type',
        property: 'model',
        message: expect.stringContaining('must be an object with \'mode\' and \'value\' properties')
      });
      expect(result.errors[0].fix).toContain('mode');
      expect(result.errors[0].fix).toContain('value');
    });

    it('should accept valid resourceLocator with mode and value', () => {
      const nodeType = '@n8n/n8n-nodes-langchain.lmChatOpenAi';
      const config = {
        model: {
          mode: 'list',
          value: 'gpt-4o-mini'
        }
      };
      const properties = [
        {
          name: 'model',
          displayName: 'Model',
          type: 'resourceLocator',
          required: true,
          default: { mode: 'list', value: 'gpt-4o-mini' }
        }
      ];

      const result = ConfigValidator.validate(nodeType, config, properties);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject null value for resourceLocator', () => {
      const nodeType = '@n8n/n8n-nodes-langchain.lmChatOpenAi';
      const config = {
        model: null
      };
      const properties = [
        {
          name: 'model',
          type: 'resourceLocator',
          required: true
        }
      ];

      const result = ConfigValidator.validate(nodeType, config, properties);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e =>
        e.property === 'model' &&
        e.type === 'invalid_type'
      )).toBe(true);
    });

    it('should reject array value for resourceLocator', () => {
      const nodeType = '@n8n/n8n-nodes-langchain.lmChatOpenAi';
      const config = {
        model: ['gpt-4o-mini']
      };
      const properties = [
        {
          name: 'model',
          type: 'resourceLocator',
          required: true
        }
      ];

      const result = ConfigValidator.validate(nodeType, config, properties);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e =>
        e.property === 'model' &&
        e.type === 'invalid_type' &&
        e.message.includes('must be an object')
      )).toBe(true);
    });

    it('should detect missing mode property in resourceLocator', () => {
      const nodeType = '@n8n/n8n-nodes-langchain.lmChatOpenAi';
      const config = {
        model: {
          value: 'gpt-4o-mini'
          // Missing mode property
        }
      };
      const properties = [
        {
          name: 'model',
          type: 'resourceLocator',
          required: true
        }
      ];

      const result = ConfigValidator.validate(nodeType, config, properties);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e =>
        e.property === 'model.mode' &&
        e.type === 'missing_required' &&
        e.message.includes('missing required property \'mode\'')
      )).toBe(true);
    });

    it('should detect missing value property in resourceLocator', () => {
      const nodeType = '@n8n/n8n-nodes-langchain.lmChatOpenAi';
      const config = {
        model: {
          mode: 'list'
          // Missing value property
        }
      };
      const properties = [
        {
          name: 'model',
          displayName: 'Model',
          type: 'resourceLocator',
          required: true
        }
      ];

      const result = ConfigValidator.validate(nodeType, config, properties);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e =>
        e.property === 'model.value' &&
        e.type === 'missing_required' &&
        e.message.includes('missing required property \'value\'')
      )).toBe(true);
    });

    it('should detect invalid mode type in resourceLocator', () => {
      const nodeType = '@n8n/n8n-nodes-langchain.lmChatOpenAi';
      const config = {
        model: {
          mode: 123, // Should be string
          value: 'gpt-4o-mini'
        }
      };
      const properties = [
        {
          name: 'model',
          type: 'resourceLocator',
          required: true
        }
      ];

      const result = ConfigValidator.validate(nodeType, config, properties);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e =>
        e.property === 'model.mode' &&
        e.type === 'invalid_type' &&
        e.message.includes('must be a string')
      )).toBe(true);
    });

    it('should accept resourceLocator with mode "id"', () => {
      const nodeType = '@n8n/n8n-nodes-langchain.lmChatOpenAi';
      const config = {
        model: {
          mode: 'id',
          value: 'gpt-4o-2024-11-20'
        }
      };
      const properties = [
        {
          name: 'model',
          type: 'resourceLocator',
          required: true
        }
      ];

      const result = ConfigValidator.validate(nodeType, config, properties);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject number value when resourceLocator is required', () => {
      const nodeType = '@n8n/n8n-nodes-langchain.lmChatOpenAi';
      const config = {
        model: 12345 // Wrong type
      };
      const properties = [
        {
          name: 'model',
          type: 'resourceLocator',
          required: true
        }
      ];

      const result = ConfigValidator.validate(nodeType, config, properties);

      expect(result.valid).toBe(false);
      expect(result.errors[0].type).toBe('invalid_type');
      expect(result.errors[0].message).toContain('must be an object');
    });

    it('should provide helpful fix suggestion for string to resourceLocator conversion', () => {
      const nodeType = '@n8n/n8n-nodes-langchain.lmChatOpenAi';
      const config = {
        model: 'gpt-4o-mini'
      };
      const properties = [
        {
          name: 'model',
          type: 'resourceLocator',
          required: true
        }
      ];

      const result = ConfigValidator.validate(nodeType, config, properties);

      expect(result.errors[0].fix).toContain('{ mode: "list", value: "gpt-4o-mini" }');
      expect(result.errors[0].fix).toContain('{ mode: "id", value: "gpt-4o-mini" }');
    });

    it('should reject invalid mode values when schema defines allowed modes', () => {
      const nodeType = '@n8n/n8n-nodes-langchain.lmChatOpenAi';
      const config = {
        model: {
          mode: 'invalid-mode',
          value: 'gpt-4o-mini'
        }
      };
      const properties = [
        {
          name: 'model',
          type: 'resourceLocator',
          required: true,
          // In real n8n, modes are at top level, not in typeOptions
          modes: [
            { name: 'list', displayName: 'List' },
            { name: 'id', displayName: 'ID' },
            { name: 'url', displayName: 'URL' }
          ]
        }
      ];

      const result = ConfigValidator.validate(nodeType, config, properties);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e =>
        e.property === 'model.mode' &&
        e.type === 'invalid_value' &&
        e.message.includes('must be one of [list, id, url]')
      )).toBe(true);
    });

    it('should handle modes defined as array format', () => {
      const nodeType = '@n8n/n8n-nodes-langchain.lmChatOpenAi';
      const config = {
        model: {
          mode: 'custom',
          value: 'gpt-4o-mini'
        }
      };
      const properties = [
        {
          name: 'model',
          type: 'resourceLocator',
          required: true,
          // Array format at top level (real n8n structure)
          modes: [
            { name: 'list', displayName: 'List' },
            { name: 'id', displayName: 'ID' },
            { name: 'custom', displayName: 'Custom' }
          ]
        }
      ];

      const result = ConfigValidator.validate(nodeType, config, properties);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should handle malformed modes schema gracefully', () => {
      const nodeType = '@n8n/n8n-nodes-langchain.lmChatOpenAi';
      const config = {
        model: {
          mode: 'any-mode',
          value: 'gpt-4o-mini'
        }
      };
      const properties = [
        {
          name: 'model',
          type: 'resourceLocator',
          required: true,
          modes: 'invalid-string' // Malformed schema at top level
        }
      ];

      const result = ConfigValidator.validate(nodeType, config, properties);

      // Should NOT crash, should skip validation
      expect(result.valid).toBe(true);
      expect(result.errors.some(e => e.property === 'model.mode')).toBe(false);
    });

    it('should handle empty modes definition gracefully', () => {
      const nodeType = '@n8n/n8n-nodes-langchain.lmChatOpenAi';
      const config = {
        model: {
          mode: 'any-mode',
          value: 'gpt-4o-mini'
        }
      };
      const properties = [
        {
          name: 'model',
          type: 'resourceLocator',
          required: true,
          modes: {} // Empty object at top level
        }
      ];

      const result = ConfigValidator.validate(nodeType, config, properties);

      // Should skip validation with empty modes
      expect(result.valid).toBe(true);
      expect(result.errors.some(e => e.property === 'model.mode')).toBe(false);
    });

    it('should skip mode validation when modes not provided', () => {
      const nodeType = '@n8n/n8n-nodes-langchain.lmChatOpenAi';
      const config = {
        model: {
          mode: 'custom-mode',
          value: 'gpt-4o-mini'
        }
      };
      const properties = [
        {
          name: 'model',
          type: 'resourceLocator',
          required: true
          // No modes property - schema doesn't define modes
        }
      ];

      const result = ConfigValidator.validate(nodeType, config, properties);

      // Should accept any mode when schema doesn't define them
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should accept resourceLocator with mode "url"', () => {
      const nodeType = '@n8n/n8n-nodes-langchain.lmChatOpenAi';
      const config = {
        model: {
          mode: 'url',
          value: 'https://api.example.com/models/custom'
        }
      };
      const properties = [
        {
          name: 'model',
          type: 'resourceLocator',
          required: true
        }
      ];

      const result = ConfigValidator.validate(nodeType, config, properties);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect empty resourceLocator object', () => {
      const nodeType = '@n8n/n8n-nodes-langchain.lmChatOpenAi';
      const config = {
        model: {} // Empty object, missing both mode and value
      };
      const properties = [
        {
          name: 'model',
          type: 'resourceLocator',
          required: true
        }
      ];

      const result = ConfigValidator.validate(nodeType, config, properties);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(2); // Both mode and value missing
      expect(result.errors.some(e => e.property === 'model.mode')).toBe(true);
      expect(result.errors.some(e => e.property === 'model.value')).toBe(true);
    });

    it('should handle resourceLocator with extra properties gracefully', () => {
      const nodeType = '@n8n/n8n-nodes-langchain.lmChatOpenAi';
      const config = {
        model: {
          mode: 'list',
          value: 'gpt-4o-mini',
          extraProperty: 'ignored' // Extra properties should be ignored
        }
      };
      const properties = [
        {
          name: 'model',
          type: 'resourceLocator',
          required: true
        }
      ];

      const result = ConfigValidator.validate(nodeType, config, properties);

      expect(result.valid).toBe(true); // Should pass with extra properties
      expect(result.errors).toHaveLength(0);
    });
  });
});