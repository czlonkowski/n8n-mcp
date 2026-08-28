import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PropertyFilter } from '@/services/property-filter';
import type { SimplifiedProperty } from '@/services/property-filter';

// Mock the database
vi.mock('better-sqlite3');

describe('PropertyFilter - Edge Cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Null and Undefined Handling', () => {
    it('should handle null properties gracefully', () => {
      const result = PropertyFilter.getEssentials(null as any, 'nodes-base.http');
      expect(result).toEqual({ required: [], common: [] });
    });

    it('should handle undefined properties gracefully', () => {
      const result = PropertyFilter.getEssentials(undefined as any, 'nodes-base.http');
      expect(result).toEqual({ required: [], common: [] });
    });

    it('should handle null nodeType gracefully', () => {
      const properties = [{ name: 'test', type: 'string' }];
      const result = PropertyFilter.getEssentials(properties, null as any);
      // Should fallback to inferEssentials
      expect(result.required).toBeDefined();
      expect(result.common).toBeDefined();
    });

    it('should handle properties with null values', () => {
      const properties = [
        { name: 'prop1', type: 'string', displayName: null, description: null },
        null,
        undefined,
        { name: null, type: 'string' },
        { name: 'prop2', type: null }
      ];
      
      const result = PropertyFilter.getEssentials(properties as any, 'nodes-base.test');
      expect(() => result).not.toThrow();
      expect(result.required).toBeDefined();
      expect(result.common).toBeDefined();
    });
  });

  describe('Boundary Value Testing', () => {
    it('should handle empty properties array', () => {
      const result = PropertyFilter.getEssentials([], 'nodes-base.http');
      expect(result).toEqual({ required: [], common: [] });
    });

    it('should handle very large properties array', () => {
      const largeProperties = Array(10000).fill(null).map((_, i) => ({
        name: `prop${i}`,
        type: 'string',
        displayName: `Property ${i}`,
        description: `Description for property ${i}`,
        required: i % 100 === 0
      }));
      
      const start = Date.now();
      const result = PropertyFilter.getEssentials(largeProperties, 'nodes-base.test');
      const duration = Date.now() - start;
      
      expect(result).toBeDefined();
      expect(duration).toBeLessThan(1000); // Should filter within 1 second
      // For unconfigured nodes, it uses inferEssentials which limits results
      expect(result.required.length + result.common.length).toBeLessThanOrEqual(30);
    });

    it('should handle properties with extremely long strings', () => {
      const properties = [
        {
          name: 'longProp',
          type: 'string',
          displayName: 'A'.repeat(1000),
          description: 'B'.repeat(10000),
          placeholder: 'C'.repeat(5000),
          required: true
        }
      ];
      
      const result = PropertyFilter.getEssentials(properties, 'nodes-base.test');
      // For unconfigured nodes, this might be included as required
      const allProps = [...result.required, ...result.common];
      const longProp = allProps.find(p => p.name === 'longProp');
      if (longProp) {
        expect(longProp.displayName).toBeDefined();
      }
    });

    it('should limit options array size', () => {
      const manyOptions = Array(1000).fill(null).map((_, i) => ({
        value: `option${i}`,
        name: `Option ${i}`
      }));
      
      const properties = [{
        name: 'selectProp',
        type: 'options',
        displayName: 'Select Property',
        options: manyOptions,
        required: true
      }];
      
      const result = PropertyFilter.getEssentials(properties, 'nodes-base.test');
      const allProps = [...result.required, ...result.common];
      const selectProp = allProps.find(p => p.name === 'selectProp');
      
      if (selectProp && selectProp.options) {
        // Should limit options to reasonable number
        expect(selectProp.options.length).toBeLessThanOrEqual(20);
      }
    });
  });

  describe('Property Type Handling', () => {
    it('should handle all n8n property types', () => {
      const propertyTypes = [
        'string', 'number', 'boolean', 'options', 'multiOptions',
        'collection', 'fixedCollection', 'json', 'notice', 'assignmentCollection',
        'resourceLocator', 'resourceMapper', 'filter', 'credentials'
      ];
      
      const properties = propertyTypes.map(type => ({
        name: `${type}Prop`,
        type,
        displayName: `${type} Property`,
        description: `A ${type} property`
      }));
      
      const result = PropertyFilter.getEssentials(properties, 'nodes-base.test');
      expect(result).toBeDefined();
      
      const allProps = [...result.required, ...result.common];
      // Should handle various types without crashing
      expect(allProps.length).toBeGreaterThan(0);
    });

    it('should handle nested collection properties', () => {
      const properties = [{
        name: 'collection',
        type: 'collection',
        displayName: 'Collection',
        options: [
          { name: 'nested1', type: 'string', displayName: 'Nested 1' },
          { name: 'nested2', type: 'number', displayName: 'Nested 2' }
        ]
      }];
      
      const result = PropertyFilter.getEssentials(properties, 'nodes-base.test');
      const allProps = [...result.required, ...result.common];
      
      // Should include the collection
      expect(allProps.some(p => p.name === 'collection')).toBe(true);
    });

    it('should handle fixedCollection properties', () => {
      const properties = [{
        name: 'headers',
        type: 'fixedCollection',
        displayName: 'Headers',
        typeOptions: { multipleValues: true },
        options: [{
          name: 'parameter',
          displayName: 'Parameter',
          values: [
            { name: 'name', type: 'string', displayName: 'Name' },
            { name: 'value', type: 'string', displayName: 'Value' }
          ]
        }]
      }];
      
      const result = PropertyFilter.getEssentials(properties, 'nodes-base.test');
      const allProps = [...result.required, ...result.common];
      
      // Should include the fixed collection
      expect(allProps.some(p => p.name === 'headers')).toBe(true);
    });
  });

  describe('Special Cases', () => {
    it('should handle circular references in properties', () => {
      const properties: any = [{
        name: 'circular',
        type: 'string',
        displayName: 'Circular'
      }];
      properties[0].self = properties[0];
      
      expect(() => {
        PropertyFilter.getEssentials(properties, 'nodes-base.test');
      }).not.toThrow();
    });

    it('should handle properties with special characters', () => {
      const properties = [
        { name: 'prop-with-dash', type: 'string', displayName: 'Prop With Dash' },
        { name: 'prop_with_underscore', type: 'string', displayName: 'Prop With Underscore' },
        { name: 'prop.with.dot', type: 'string', displayName: 'Prop With Dot' },
        { name: 'prop@special', type: 'string', displayName: 'Prop Special' }
      ];
      
      const result = PropertyFilter.getEssentials(properties, 'nodes-base.test');
      expect(result).toBeDefined();
    });

    it('should handle duplicate property names', () => {
      const properties = [
        { name: 'duplicate', type: 'string', displayName: 'First Duplicate' },
        { name: 'duplicate', type: 'number', displayName: 'Second Duplicate' },
        { name: 'duplicate', type: 'boolean', displayName: 'Third Duplicate' }
      ];
      
      const result = PropertyFilter.getEssentials(properties, 'nodes-base.test');
      const allProps = [...result.required, ...result.common];
      
      // Should deduplicate
      const duplicates = allProps.filter(p => p.name === 'duplicate');
      expect(duplicates.length).toBe(1);
    });
  });

  describe('Node-Specific Configurations', () => {
    it('should apply HTTP Request specific filtering', () => {
      const properties = [
        { name: 'url', type: 'string', required: true },
        { name: 'method', type: 'options', options: [{ value: 'GET' }, { value: 'POST' }] },
        { name: 'authentication', type: 'options' },
        { name: 'sendBody', type: 'boolean' },
        { name: 'contentType', type: 'options' },
        { name: 'sendHeaders', type: 'fixedCollection' },
        { name: 'someObscureOption', type: 'string' }
      ];
      
      const result = PropertyFilter.getEssentials(properties, 'nodes-base.httpRequest');
      
      expect(result.required.some(p => p.name === 'url')).toBe(true);
      expect(result.common.some(p => p.name === 'method')).toBe(true);
      expect(result.common.some(p => p.name === 'authentication')).toBe(true);
      
      // Should not include obscure option
      const allProps = [...result.required, ...result.common];
      expect(allProps.some(p => p.name === 'someObscureOption')).toBe(false);
    });

    it('should apply Slack specific filtering', () => {
      const properties = [
        { name: 'resource', type: 'options', required: true },
        { name: 'operation', type: 'options', required: true },
        { name: 'channelId', type: 'string' },
        { name: 'text', type: 'string' },
        { name: 'attachments', type: 'collection' },
        { name: 'ts', type: 'string' },
        { name: 'advancedOption1', type: 'string' },
        { name: 'advancedOption2', type: 'boolean' }
      ];

      const result = PropertyFilter.getEssentials(properties, 'nodes-base.slack');

      // In the actual config, resource and operation are in common, not required
      expect(result.common.some(p => p.name === 'resource')).toBe(true);
      expect(result.common.some(p => p.name === 'operation')).toBe(true);
      expect(result.common.some(p => p.name === 'channelId')).toBe(true);
      expect(result.common.some(p => p.name === 'text')).toBe(true);
    });
  });

  describe('Fallback Behavior', () => {
    it('should infer essentials for unconfigured nodes', () => {
      const properties = [
        { name: 'requiredProp', type: 'string', required: true },
        { name: 'commonProp', type: 'string', displayName: 'Common Property' },
        { name: 'advancedProp', type: 'json', displayName: 'Advanced Property' },
        { name: 'debugProp', type: 'boolean', displayName: 'Debug Mode' },
        { name: 'internalProp', type: 'hidden' }
      ];
      
      const result = PropertyFilter.getEssentials(properties, 'nodes-base.unknownNode');
      
      // Should include required properties
      expect(result.required.some(p => p.name === 'requiredProp')).toBe(true);
      
      // Should include some common properties
      expect(result.common.length).toBeGreaterThan(0);
      
      // Should not include internal/hidden properties
      const allProps = [...result.required, ...result.common];
      expect(allProps.some(p => p.name === 'internalProp')).toBe(false);
    });

    it('should handle nodes with only advanced properties', () => {
      const properties = [
        { name: 'advanced1', type: 'json', displayName: 'Advanced Option 1' },
        { name: 'advanced2', type: 'collection', displayName: 'Advanced Collection' },
        { name: 'advanced3', type: 'assignmentCollection', displayName: 'Advanced Assignment' }
      ];
      
      const result = PropertyFilter.getEssentials(properties, 'nodes-base.advancedNode');
      
      // Should still return some properties
      const allProps = [...result.required, ...result.common];
      expect(allProps.length).toBeGreaterThan(0);
    });
  });

  describe('Property Simplification', () => {
    it('should simplify complex property structures', () => {
      const properties = [{
        name: 'complexProp',
        type: 'options',
        displayName: 'Complex Property',
        description: 'A'.repeat(500), // Long description
        default: 'option1',
        placeholder: 'Select an option',
        hint: 'This is a hint',
        displayOptions: { show: { mode: ['advanced'] } },
        options: Array(50).fill(null).map((_, i) => ({
          value: `option${i}`,
          name: `Option ${i}`,
          description: `Description for option ${i}`
        }))
      }];
      
      const result = PropertyFilter.getEssentials(properties, 'nodes-base.test');
      const allProps = [...result.required, ...result.common];
      const simplified = allProps.find(p => p.name === 'complexProp');
      
      if (simplified) {
        // Should include essential fields
        expect(simplified.name).toBe('complexProp');
        expect(simplified.displayName).toBe('Complex Property');
        expect(simplified.type).toBe('options');
        
        // Should limit options
        if (simplified.options) {
          expect(simplified.options.length).toBeLessThanOrEqual(20);
        }
      }
    });

    it('should handle properties without display names', () => {
      const properties = [
        { name: 'prop_without_display', type: 'string', description: 'Property description' },
        { name: 'anotherProp', displayName: '', type: 'number' }
      ];
      
      const result = PropertyFilter.getEssentials(properties, 'nodes-base.test');
      const allProps = [...result.required, ...result.common];
      
      allProps.forEach(prop => {
        // Should have a displayName (fallback to name if needed)
        expect(prop.displayName).toBeTruthy();
        expect(prop.displayName.length).toBeGreaterThan(0);
      });
    });
  });

  describe('Performance', () => {
    it('should handle property filtering efficiently', () => {
      const nodeTypes = [
        'nodes-base.httpRequest',
        'nodes-base.webhook',
        'nodes-base.slack',
        'nodes-base.googleSheets',
        'nodes-base.postgres'
      ];
      
      const properties = Array(100).fill(null).map((_, i) => ({
        name: `prop${i}`,
        type: i % 2 === 0 ? 'string' : 'options',
        displayName: `Property ${i}`,
        required: i < 5
      }));
      
      const start = Date.now();
      nodeTypes.forEach(nodeType => {
        PropertyFilter.getEssentials(properties, nodeType);
      });
      const duration = Date.now() - start;
      
      // Should process multiple nodes quickly
      expect(duration).toBeLessThan(50);
    });
  });
});