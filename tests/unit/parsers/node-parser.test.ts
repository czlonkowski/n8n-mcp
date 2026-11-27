import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NodeParser } from '@/parsers/node-parser';
import { PropertyExtractor } from '@/parsers/property-extractor';
import {
  programmaticNodeFactory,
  declarativeNodeFactory,
  triggerNodeFactory,
  webhookNodeFactory,
  aiToolNodeFactory,
  versionedNodeClassFactory,
  versionedNodeTypeClassFactory,
  malformedNodeFactory,
  nodeClassFactory,
  propertyFactory,
  stringPropertyFactory,
  optionsPropertyFactory
} from '@tests/fixtures/factories/parser-node.factory';

// Mock PropertyExtractor
vi.mock('@/parsers/property-extractor');

describe('NodeParser', () => {
  let parser: NodeParser;
  let mockPropertyExtractor: any;

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Setup mock property extractor
    mockPropertyExtractor = {
      extractProperties: vi.fn().mockReturnValue([]),
      extractCredentials: vi.fn().mockReturnValue([]),
      detectAIToolCapability: vi.fn().mockReturnValue(false),
      extractOperations: vi.fn().mockReturnValue([])
    };
    
    (PropertyExtractor as any).mockImplementation(function () { return mockPropertyExtractor; });
    
    parser = new NodeParser();
  });

  describe('parse method', () => {
    it('should parse correctly when node is programmatic', () => {
      const nodeDefinition = programmaticNodeFactory.build();
      const NodeClass = nodeClassFactory.build({ description: nodeDefinition });
      
      mockPropertyExtractor.extractProperties.mockReturnValue(nodeDefinition.properties);
      mockPropertyExtractor.extractCredentials.mockReturnValue(nodeDefinition.credentials);
      
      const result = parser.parse(NodeClass as any, 'n8n-nodes-base');
      
      expect(result).toMatchObject({
        style: 'programmatic',
        nodeType: `nodes-base.${nodeDefinition.name}`,
        displayName: nodeDefinition.displayName,
        description: nodeDefinition.description,
        category: nodeDefinition.group?.[0] || 'misc',
        packageName: 'n8n-nodes-base'
      });
      
      // Check specific properties separately to avoid strict matching
      expect(result.isVersioned).toBe(false);
      expect(result.version).toBe(nodeDefinition.version?.toString() || '1');
      
      expect(mockPropertyExtractor.extractProperties).toHaveBeenCalledWith(NodeClass);
      expect(mockPropertyExtractor.extractCredentials).toHaveBeenCalledWith(NodeClass);
    });

    it('should parse correctly when node is declarative', () => {
      const nodeDefinition = declarativeNodeFactory.build();
      const NodeClass = nodeClassFactory.build({ description: nodeDefinition });
      
      const result = parser.parse(NodeClass as any, 'n8n-nodes-base');
      
      expect(result.style).toBe('declarative');
      expect(result.nodeType).toBe(`nodes-base.${nodeDefinition.name}`);
    });

    it('should preserve type when package prefix is already included', () => {
      const nodeDefinition = programmaticNodeFactory.build({
        name: 'nodes-base.slack'
      });
      const NodeClass = nodeClassFactory.build({ description: nodeDefinition });
      
      const result = parser.parse(NodeClass as any, 'n8n-nodes-base');
      
      expect(result.nodeType).toBe('nodes-base.slack');
    });

    it('should set isTrigger flag when node is a trigger', () => {
      const nodeDefinition = triggerNodeFactory.build();
      const NodeClass = nodeClassFactory.build({ description: nodeDefinition });
      
      const result = parser.parse(NodeClass as any, 'n8n-nodes-base');
      
      expect(result.isTrigger).toBe(true);
    });

    it('should set isWebhook flag when node is a webhook', () => {
      const nodeDefinition = webhookNodeFactory.build();
      const NodeClass = nodeClassFactory.build({ description: nodeDefinition });
      
      const result = parser.parse(NodeClass as any, 'n8n-nodes-base');
      
      expect(result.isWebhook).toBe(true);
    });

    it('should set isAITool flag when node has AI capability', () => {
      const nodeDefinition = aiToolNodeFactory.build();
      const NodeClass = nodeClassFactory.build({ description: nodeDefinition });
      
      mockPropertyExtractor.detectAIToolCapability.mockReturnValue(true);
      
      const result = parser.parse(NodeClass as any, 'n8n-nodes-base');
      
      expect(result.isAITool).toBe(true);
    });

    it('should parse correctly when node uses VersionedNodeType class', () => {
      // Create a simple versioned node class without modifying function properties
      const VersionedNodeClass = class VersionedNodeType {
        baseDescription = {
          name: 'versionedNode',
          displayName: 'Versioned Node',
          description: 'A versioned node',
          defaultVersion: 2
        };
        nodeVersions = {
          1: { description: { properties: [] } },
          2: { description: { properties: [] } }
        };
        currentVersion = 2;
      };
      
      mockPropertyExtractor.extractProperties.mockReturnValue([
        propertyFactory.build(),
        propertyFactory.build()
      ]);
      
      const result = parser.parse(VersionedNodeClass as any, 'n8n-nodes-base');
      
      expect(result.isVersioned).toBe(true);
      expect(result.version).toBe('2');
      expect(result.nodeType).toBe('nodes-base.versionedNode');
    });

    it('should parse correctly when node has nodeVersions property', () => {
      const versionedDef = versionedNodeClassFactory.build();
      const NodeClass = class {
        nodeVersions = versionedDef.nodeVersions;
        baseDescription = versionedDef.baseDescription;
      };
      
      const result = parser.parse(NodeClass as any, 'n8n-nodes-base');
      
      expect(result.isVersioned).toBe(true);
      expect(result.version).toBe('2');
    });

    it('should use max version when version is an array', () => {
      const nodeDefinition = programmaticNodeFactory.build({
        version: [1, 1.1, 1.2, 2]
      });
      const NodeClass = nodeClassFactory.build({ description: nodeDefinition });
      
      const result = parser.parse(NodeClass as any, 'n8n-nodes-base');
      
      expect(result.isVersioned).toBe(true);
      expect(result.version).toBe('2'); // Should return max version
    });

    it('should throw error when node is missing name property', () => {
      const nodeDefinition = malformedNodeFactory.build();
      const NodeClass = nodeClassFactory.build({ description: nodeDefinition });
      
      expect(() => parser.parse(NodeClass as any, 'n8n-nodes-base')).toThrow('Node is missing name property');
    });

    it('should use static description when instantiation fails', () => {
      const NodeClass = class {
        static description = programmaticNodeFactory.build();
        constructor() {
          throw new Error('Cannot instantiate');
        }
      };
      
      const result = parser.parse(NodeClass as any, 'n8n-nodes-base');
      
      expect(result.displayName).toBe(NodeClass.description.displayName);
    });

    it('should extract category when using different property names', () => {
      const testCases = [
        { group: ['transform'], expected: 'transform' },
        { categories: ['output'], expected: 'output' },
        { category: 'trigger', expected: 'trigger' },
        { /* no category */ expected: 'misc' }
      ];
      
      testCases.forEach(({ group, categories, category, expected }) => {
        const nodeDefinition = programmaticNodeFactory.build({
          group,
          categories,
          category
        } as any);
        const NodeClass = nodeClassFactory.build({ description: nodeDefinition });
        
        const result = parser.parse(NodeClass as any, 'n8n-nodes-base');
        
        expect(result.category).toBe(expected);
      });
    });

    it('should set isTrigger flag when node has polling property', () => {
      const nodeDefinition = programmaticNodeFactory.build({
        polling: true
      });
      const NodeClass = nodeClassFactory.build({ description: nodeDefinition });
      
      const result = parser.parse(NodeClass as any, 'n8n-nodes-base');
      
      expect(result.isTrigger).toBe(true);
    });

    it('should set isTrigger flag when node has eventTrigger property', () => {
      const nodeDefinition = programmaticNodeFactory.build({
        eventTrigger: true
      });
      const NodeClass = nodeClassFactory.build({ description: nodeDefinition });
      
      const result = parser.parse(NodeClass as any, 'n8n-nodes-base');
      
      expect(result.isTrigger).toBe(true);
    });

    it('should set isTrigger flag when node name contains trigger', () => {
      const nodeDefinition = programmaticNodeFactory.build({
        name: 'myTrigger'
      });
      const NodeClass = nodeClassFactory.build({ description: nodeDefinition });
      
      const result = parser.parse(NodeClass as any, 'n8n-nodes-base');
      
      expect(result.isTrigger).toBe(true);
    });

    it('should set isWebhook flag when node name contains webhook', () => {
      const nodeDefinition = programmaticNodeFactory.build({
        name: 'customWebhook'
      });
      const NodeClass = nodeClassFactory.build({ description: nodeDefinition });
      
      const result = parser.parse(NodeClass as any, 'n8n-nodes-base');
      
      expect(result.isWebhook).toBe(true);
    });

    it('should parse correctly when node is an instance object', () => {
      const nodeDefinition = programmaticNodeFactory.build();
      const nodeInstance = {
        description: nodeDefinition
      };
      
      mockPropertyExtractor.extractProperties.mockReturnValue(nodeDefinition.properties);

      const result = parser.parse(nodeInstance as any, 'n8n-nodes-base');
      
      expect(result.displayName).toBe(nodeDefinition.displayName);
    });

    it('should handle different package name formats', () => {
      const nodeDefinition = programmaticNodeFactory.build();
      const NodeClass = nodeClassFactory.build({ description: nodeDefinition });
      
      const testCases = [
        { packageName: '@n8n/n8n-nodes-langchain', expectedPrefix: 'nodes-langchain' },
        { packageName: 'n8n-nodes-custom', expectedPrefix: 'nodes-custom' },
        { packageName: 'custom-package', expectedPrefix: 'custom-package' }
      ];
      
      testCases.forEach(({ packageName, expectedPrefix }) => {
        const result = parser.parse(NodeClass as any, packageName);
        expect(result.nodeType).toBe(`${expectedPrefix}.${nodeDefinition.name}`);
      });
    });
  });

  describe('version extraction', () => {
    it('should prioritize currentVersion over description.defaultVersion', () => {
      const NodeClass = class {
        currentVersion = 2.2;  // Should be returned
        description = {
          name: 'AI Agent',
          displayName: 'AI Agent',
          defaultVersion: 3  // Should be ignored when currentVersion exists
        };
      };

      const result = parser.parse(NodeClass as any, 'n8n-nodes-base');

      expect(result.version).toBe('2.2');
    });

    it('should extract version from description.defaultVersion', () => {
      const NodeClass = class {
        description = {
          name: 'test',
          displayName: 'Test',
          defaultVersion: 3
        };
      };

      const result = parser.parse(NodeClass as any, 'n8n-nodes-base');

      expect(result.version).toBe('3');
    });

    it('should handle currentVersion = 0 correctly', () => {
      const NodeClass = class {
        currentVersion = 0;  // Edge case: version 0 should be valid
        description = {
          name: 'test',
          displayName: 'Test',
          defaultVersion: 5  // Should be ignored
        };
      };

      const result = parser.parse(NodeClass as any, 'n8n-nodes-base');

      expect(result.version).toBe('0');
    });

    it('should NOT extract version from non-existent baseDescription (legacy bug)', () => {
      const NodeClass = class {
        baseDescription = {  // This property doesn't exist on VersionedNodeType!
          name: 'test',
          displayName: 'Test',
          defaultVersion: 3
        };
      };

      const result = parser.parse(NodeClass as any, 'n8n-nodes-base');

      expect(result.version).toBe('1');  // Should fallback to default
    });

    it('should extract version from nodeVersions keys', () => {
      const NodeClass = class {
        description = { name: 'test', displayName: 'Test' };
        nodeVersions = {
          1: { description: {} },
          2: { description: {} },
          3: { description: {} }
        };
      };
      
      const result = parser.parse(NodeClass as any, 'n8n-nodes-base');
      
      expect(result.version).toBe('3');
    });

    it('should extract version from instance nodeVersions', () => {
      const NodeClass = class {
        description = { name: 'test', displayName: 'Test' };
        
        constructor() {
          (this as any).nodeVersions = {
            1: { description: {} },
            2: { description: {} },
            4: { description: {} }
          };
        }
      };
      
      const result = parser.parse(NodeClass as any, 'n8n-nodes-base');
      
      expect(result.version).toBe('4');
    });

    it('should handle version as number in description', () => {
      const nodeDefinition = programmaticNodeFactory.build({
        version: 2
      });
      const NodeClass = nodeClassFactory.build({ description: nodeDefinition });
      
      const result = parser.parse(NodeClass as any, 'n8n-nodes-base');
      
      expect(result.version).toBe('2');
    });

    it('should handle version as string in description', () => {
      const nodeDefinition = programmaticNodeFactory.build({
        version: '1.5' as any
      });
      const NodeClass = nodeClassFactory.build({ description: nodeDefinition });
      
      const result = parser.parse(NodeClass as any, 'n8n-nodes-base');
      
      expect(result.version).toBe('1.5');
    });

    it('should default to version 1 when no version found', () => {
      const nodeDefinition = programmaticNodeFactory.build();
      delete (nodeDefinition as any).version;
      const NodeClass = nodeClassFactory.build({ description: nodeDefinition });
      
      const result = parser.parse(NodeClass as any, 'n8n-nodes-base');
      
      expect(result.version).toBe('1');
    });
  });

  describe('versioned node detection', () => {
    it('should detect versioned nodes with nodeVersions', () => {
      const NodeClass = class {
        description = { name: 'test', displayName: 'Test' };
        nodeVersions = { 1: {}, 2: {} };
      };
      
      const result = parser.parse(NodeClass as any, 'n8n-nodes-base');
      
      expect(result.isVersioned).toBe(true);
    });

    it('should detect versioned nodes with defaultVersion', () => {
      const NodeClass = class {
        baseDescription = {
          name: 'test',
          displayName: 'Test',
          defaultVersion: 2
        };
      };
      
      const result = parser.parse(NodeClass as any, 'n8n-nodes-base');
      
      expect(result.isVersioned).toBe(true);
    });

    it('should detect versioned nodes with version array in instance', () => {
      const NodeClass = class {
        description = {
          name: 'test',
          displayName: 'Test',
          version: [1, 1.1, 2]
        };
      };
      
      const result = parser.parse(NodeClass as any, 'n8n-nodes-base');
      
      expect(result.isVersioned).toBe(true);
    });

    it('should not detect non-versioned nodes as versioned', () => {
      const nodeDefinition = programmaticNodeFactory.build({
        version: 1
      });
      const NodeClass = nodeClassFactory.build({ description: nodeDefinition });
      
      const result = parser.parse(NodeClass as any, 'n8n-nodes-base');
      
      expect(result.isVersioned).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('should handle null/undefined description gracefully', () => {
      const NodeClass = class {
        description = null;
      };
      
      expect(() => parser.parse(NodeClass as any, 'n8n-nodes-base')).toThrow();
    });

    it('should handle empty routing object for declarative nodes', () => {
      const nodeDefinition = declarativeNodeFactory.build({
        routing: {} as any
      });
      const NodeClass = nodeClassFactory.build({ description: nodeDefinition });
      
      const result = parser.parse(NodeClass as any, 'n8n-nodes-base');
      
      expect(result.style).toBe('declarative');
    });

    it('should handle complex nested versioned structure', () => {
      const NodeClass = class VersionedNodeType {
        constructor() {
          (this as any).baseDescription = {
            name: 'complex',
            displayName: 'Complex Node',
            defaultVersion: 3
          };
          (this as any).nodeVersions = {
            1: { description: { properties: [] } },
            2: { description: { properties: [] } },
            3: { description: { properties: [] } }
          };
        }
      };
      
      // Override constructor name check
      Object.defineProperty(NodeClass.prototype.constructor, 'name', {
        value: 'VersionedNodeType'
      });
      
      const result = parser.parse(NodeClass as any, 'n8n-nodes-base');
      
      expect(result.isVersioned).toBe(true);
      expect(result.version).toBe('3');
    });
  });
});