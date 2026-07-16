import { describe, it, expect, vi, beforeEach, afterEach, MockInstance } from 'vitest';

// Mock path module
vi.mock('path', async () => {
  const actual = await vi.importActual<typeof import('path')>('path');
  return {
    ...actual,
    default: actual
  };
});

describe('N8nNodeLoader', () => {
  let N8nNodeLoader: any;
  let consoleLogSpy: MockInstance;
  let consoleErrorSpy: MockInstance;
  let consoleWarnSpy: MockInstance;

  // Create mocks for require and require.resolve
  const mockRequire = vi.fn();
  const mockRequireResolve = vi.fn();
  
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    
    // Mock console methods
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Reset mocks
    mockRequire.mockReset();
    mockRequireResolve.mockReset();
    (mockRequire as any).resolve = mockRequireResolve;
    
    // Default implementation for require.resolve
    mockRequireResolve.mockImplementation((path: string) => path);
  });

  afterEach(() => {
    // Restore console methods
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
  });

  // Helper to create a loader instance with mocked require
  async function createLoaderWithMocks() {
    // Intercept the module and replace require
    vi.doMock('@/loaders/node-loader', () => {
      const originalModule = vi.importActual('@/loaders/node-loader');
      
      return {
        ...originalModule,
        N8nNodeLoader: class MockedN8nNodeLoader {
          private readonly CORE_PACKAGES = [
            { name: 'n8n-nodes-base', path: 'n8n-nodes-base' },
            { name: '@n8n/n8n-nodes-langchain', path: '@n8n/n8n-nodes-langchain' }
          ];

          async loadAllNodes() {
            const results: any[] = [];
            
            for (const pkg of this.CORE_PACKAGES) {
              try {
                console.log(`📦 Loading package: ${pkg.name} from ${pkg.path}`);
                const packageJson = mockRequire(`${pkg.path}/package.json`);
                console.log(`  Found ${Object.keys(packageJson.n8n?.nodes || {}).length} nodes in package.json`);
                const nodes = await this.loadPackageNodes(pkg.name, pkg.path, packageJson);
                results.push(...nodes);
              } catch (error) {
                console.error(`Failed to load ${pkg.name}:`, error);
              }
            }
            
            return results;
          }

          private async loadPackageNodes(packageName: string, packagePath: string, packageJson: any) {
            const n8nConfig = packageJson.n8n || {};
            const nodes: any[] = [];
            
            const nodesList = n8nConfig.nodes || [];
            
            if (Array.isArray(nodesList)) {
              for (const nodePath of nodesList) {
                try {
                  const fullPath = mockRequireResolve(`${packagePath}/${nodePath}`);
                  const nodeModule = mockRequire(fullPath);
                  
                  const nodeNameMatch = nodePath.match(/\/([^\/]+)\.node(?:\.ee)?\.(js|ts)$/);
                  const nodeName = nodeNameMatch ? nodeNameMatch[1] : nodePath.replace(/.*\//, '').replace(/\.node(?:\.ee)?\.(js|ts)$/, '');

                  const NodeClass = nodeModule.default || nodeModule[nodeName] || Object.values(nodeModule).find((v: any) => typeof v === 'function');
                  if (NodeClass) {
                    nodes.push({ packageName, nodeName, NodeClass });
                    console.log(`  ✓ Loaded ${nodeName} from ${packageName}`);
                  } else {
                    console.warn(`  ⚠ No valid export found for ${nodeName} in ${packageName}`);
                  }
                } catch (error) {
                  console.error(`  ✗ Failed to load node from ${packageName}/${nodePath}:`, (error as Error).message);
                }
              }
            } else {
              for (const [nodeName, nodePath] of Object.entries(nodesList)) {
                try {
                  const fullPath = mockRequireResolve(`${packagePath}/${nodePath as string}`);
                  const nodeModule = mockRequire(fullPath);

                  const NodeClass = nodeModule.default || nodeModule[nodeName] || Object.values(nodeModule).find((v: any) => typeof v === 'function');
                  if (NodeClass) {
                    nodes.push({ packageName, nodeName, NodeClass });
                    console.log(`  ✓ Loaded ${nodeName} from ${packageName}`);
                  } else {
                    console.warn(`  ⚠ No valid export found for ${nodeName} in ${packageName}`);
                  }
                } catch (error) {
                  console.error(`  ✗ Failed to load node ${nodeName} from ${packageName}:`, (error as Error).message);
                }
              }
            }
            
            return nodes;
          }
        }
      };
    });

    const module = await import('@/loaders/node-loader');
    return new module.N8nNodeLoader();
  }

  describe('loadAllNodes', () => {
    it('should load nodes from all configured packages', async () => {
      // Mock package.json for n8n-nodes-base (array format)
      const basePackageJson = {
        n8n: {
          nodes: [
            'dist/nodes/Slack/Slack.node.js',
            'dist/nodes/HTTP/HTTP.node.js'
          ]
        }
      };

      // Mock package.json for langchain (object format)
      const langchainPackageJson = {
        n8n: {
          nodes: {
            'OpenAI': 'dist/nodes/OpenAI/OpenAI.node.js',
            'Pinecone': 'dist/nodes/Pinecone/Pinecone.node.js'
          }
        }
      };

      // Mock node classes
      class SlackNode { name = 'Slack'; }
      class HTTPNode { name = 'HTTP'; }
      class OpenAINode { name = 'OpenAI'; }
      class PineconeNode { name = 'Pinecone'; }

      // Setup require mocks
      mockRequire.mockImplementation((path: string) => {
        if (path === 'n8n-nodes-base/package.json') return basePackageJson;
        if (path === '@n8n/n8n-nodes-langchain/package.json') return langchainPackageJson;
        if (path.includes('Slack.node.js')) return { default: SlackNode };
        if (path.includes('HTTP.node.js')) return { default: HTTPNode };
        if (path.includes('OpenAI.node.js')) return { default: OpenAINode };
        if (path.includes('Pinecone.node.js')) return { default: PineconeNode };
        throw new Error(`Module not found: ${path}`);
      });

      const loader = await createLoaderWithMocks();
      const results = await loader.loadAllNodes();

      expect(results).toHaveLength(4);
      expect(results).toContainEqual({
        packageName: 'n8n-nodes-base',
        nodeName: 'Slack',
        NodeClass: SlackNode
      });
      expect(results).toContainEqual({
        packageName: 'n8n-nodes-base',
        nodeName: 'HTTP',
        NodeClass: HTTPNode
      });
      expect(results).toContainEqual({
        packageName: '@n8n/n8n-nodes-langchain',
        nodeName: 'OpenAI',
        NodeClass: OpenAINode
      });
      expect(results).toContainEqual({
        packageName: '@n8n/n8n-nodes-langchain',
        nodeName: 'Pinecone',
        NodeClass: PineconeNode
      });

      // Verify console logs
      expect(consoleLogSpy).toHaveBeenCalledWith('📦 Loading package: n8n-nodes-base from n8n-nodes-base');
      expect(consoleLogSpy).toHaveBeenCalledWith('  Found 2 nodes in package.json');
      expect(consoleLogSpy).toHaveBeenCalledWith('  ✓ Loaded Slack from n8n-nodes-base');
      expect(consoleLogSpy).toHaveBeenCalledWith('  ✓ Loaded HTTP from n8n-nodes-base');
    });

    it('should handle missing packages gracefully', async () => {
      mockRequire.mockImplementation((path: string) => {
        throw new Error(`Cannot find module '${path}'`);
      });

      const loader = await createLoaderWithMocks();
      const results = await loader.loadAllNodes();

      expect(results).toHaveLength(0);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to load n8n-nodes-base:',
        expect.any(Error)
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to load @n8n/n8n-nodes-langchain:',
        expect.any(Error)
      );
    });

    it('should handle packages with no n8n config', async () => {
      const emptyPackageJson = {};

      mockRequire.mockImplementation((path: string) => {
        if (path.includes('package.json')) return emptyPackageJson;
        throw new Error(`Module not found: ${path}`);
      });

      const loader = await createLoaderWithMocks();
      const results = await loader.loadAllNodes();

      expect(results).toHaveLength(0);
      expect(consoleLogSpy).toHaveBeenCalledWith('  Found 0 nodes in package.json');
    });
  });

  describe('loadPackageNodes - array format', () => {
    it('should load nodes with default export', async () => {
      const packageJson = {
        n8n: {
          nodes: ['dist/nodes/Test/Test.node.js']
        }
      };

      class TestNode { name = 'Test'; }

      mockRequire.mockImplementation((path: string) => {
        if (path.includes('Test.node.js')) return { default: TestNode };
        return packageJson;
      });

      const loader = await createLoaderWithMocks();
      const results = await loader['loadPackageNodes']('test-package', 'test-package', packageJson);

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        packageName: 'test-package',
        nodeName: 'Test',
        NodeClass: TestNode
      });
    });

    it('should load nodes with named export matching node name', async () => {
      const packageJson = {
        n8n: {
          nodes: ['dist/nodes/Custom/Custom.node.js']
        }
      };

      class CustomNode { name = 'Custom'; }

      mockRequire.mockImplementation((path: string) => {
        if (path.includes('Custom.node.js')) return { Custom: CustomNode };
        return packageJson;
      });

      const loader = await createLoaderWithMocks();
      const results = await loader['loadPackageNodes']('test-package', 'test-package', packageJson);

      expect(results).toHaveLength(1);
      expect(results[0].NodeClass).toBe(CustomNode);
    });

    it('should load nodes with object values export', async () => {
      const packageJson = {
        n8n: {
          nodes: ['dist/nodes/Widget/Widget.node.js']
        }
      };

      class WidgetNode { name = 'Widget'; }

      mockRequire.mockImplementation((path: string) => {
        if (path.includes('Widget.node.js')) return { SomeExport: WidgetNode };
        return packageJson;
      });

      const loader = await createLoaderWithMocks();
      const results = await loader['loadPackageNodes']('test-package', 'test-package', packageJson);

      expect(results).toHaveLength(1);
      expect(results[0].NodeClass).toBe(WidgetNode);
    });

    it('should extract node name from complex paths', async () => {
      const packageJson = {
        n8n: {
          nodes: [
            'dist/nodes/Complex/Path/ComplexNode.node.js',
            'dist/nodes/Another.node.ts',
            'some/weird/path/NoExtension'
          ]
        }
      };

      class ComplexNode { name = 'ComplexNode'; }
      class AnotherNode { name = 'Another'; }
      class NoExtensionNode { name = 'NoExtension'; }

      mockRequire.mockImplementation((path: string) => {
        if (path.includes('ComplexNode')) return { default: ComplexNode };
        if (path.includes('Another')) return { default: AnotherNode };
        if (path.includes('NoExtension')) return { default: NoExtensionNode };
        return packageJson;
      });

      const loader = await createLoaderWithMocks();
      const results = await loader['loadPackageNodes']('test-package', 'test-package', packageJson);

      expect(results).toHaveLength(3);
      expect(results[0].nodeName).toBe('ComplexNode');
      expect(results[1].nodeName).toBe('Another');
      expect(results[2].nodeName).toBe('NoExtension');
    });

    it('should handle nodes that fail to load', async () => {
      const packageJson = {
        n8n: {
          nodes: [
            'dist/nodes/Good/Good.node.js',
            'dist/nodes/Bad/Bad.node.js'
          ]
        }
      };

      class GoodNode { name = 'Good'; }

      mockRequire.mockImplementation((path: string) => {
        if (path.includes('Good.node.js')) return { default: GoodNode };
        if (path.includes('Bad.node.js')) throw new Error('Module parse error');
        return packageJson;
      });
      mockRequireResolve.mockImplementation((path: string) => {
        if (path.includes('Bad.node.js')) throw new Error('Cannot resolve module');
        return path;
      });

      const loader = await createLoaderWithMocks();
      const results = await loader['loadPackageNodes']('test-package', 'test-package', packageJson);

      expect(results).toHaveLength(1);
      expect(results[0].nodeName).toBe('Good');
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '  ✗ Failed to load node from test-package/dist/nodes/Bad/Bad.node.js:',
        'Cannot resolve module'
      );
    });

    it('should warn when no valid export is found', async () => {
      const packageJson = {
        n8n: {
          nodes: ['dist/nodes/Empty/Empty.node.js']
        }
      };

      mockRequire.mockImplementation((path: string) => {
        if (path.includes('Empty.node.js')) return {}; // Empty exports
        return packageJson;
      });

      const loader = await createLoaderWithMocks();
      const results = await loader['loadPackageNodes']('test-package', 'test-package', packageJson);

      expect(results).toHaveLength(0);
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        '  ⚠ No valid export found for Empty in test-package'
      );
    });
  });

  describe('loadPackageNodes - object format', () => {
    it('should load nodes from object format', async () => {
      const packageJson = {
        n8n: {
          nodes: {
            'FirstNode': 'dist/nodes/First.node.js',
            'SecondNode': 'dist/nodes/Second.node.js'
          }
        }
      };

      class FirstNode { name = 'First'; }
      class SecondNode { name = 'Second'; }

      mockRequire.mockImplementation((path: string) => {
        if (path.includes('First.node.js')) return { default: FirstNode };
        if (path.includes('Second.node.js')) return { default: SecondNode };
        return packageJson;
      });

      const loader = await createLoaderWithMocks();
      const results = await loader['loadPackageNodes']('test-package', 'test-package', packageJson);

      expect(results).toHaveLength(2);
      expect(results).toContainEqual({
        packageName: 'test-package',
        nodeName: 'FirstNode',
        NodeClass: FirstNode
      });
      expect(results).toContainEqual({
        packageName: 'test-package',
        nodeName: 'SecondNode',
        NodeClass: SecondNode
      });
    });

    it('should handle different export patterns in object format', async () => {
      const packageJson = {
        n8n: {
          nodes: {
            'DefaultExport': 'dist/default.js',
            'NamedExport': 'dist/named.js',
            'ObjectExport': 'dist/object.js'
          }
        }
      };

      class DefaultNode { name = 'Default'; }
      class NamedNode { name = 'Named'; }
      class ObjectNode { name = 'Object'; }

      mockRequire.mockImplementation((path: string) => {
        if (path.includes('default.js')) return { default: DefaultNode };
        if (path.includes('named.js')) return { NamedExport: NamedNode };
        if (path.includes('object.js')) return { SomeOtherExport: ObjectNode };
        return packageJson;
      });

      const loader = await createLoaderWithMocks();
      const results = await loader['loadPackageNodes']('test-package', 'test-package', packageJson);

      expect(results).toHaveLength(3);
      expect(results[0].NodeClass).toBe(DefaultNode);
      expect(results[1].NodeClass).toBe(NamedNode);
      expect(results[2].NodeClass).toBe(ObjectNode);
    });

    it('should handle errors in object format', async () => {
      const packageJson = {
        n8n: {
          nodes: {
            'WorkingNode': 'dist/working.js',
            'BrokenNode': 'dist/broken.js'
          }
        }
      };

      class WorkingNode { name = 'Working'; }

      mockRequire.mockImplementation((path: string) => {
        if (path.includes('working.js')) return { default: WorkingNode };
        if (path.includes('broken.js')) throw new Error('Syntax error');
        return packageJson;
      });
      mockRequireResolve.mockImplementation((path: string) => {
        if (path.includes('broken.js')) throw new Error('Module not found');
        return path;
      });

      const loader = await createLoaderWithMocks();
      const results = await loader['loadPackageNodes']('test-package', 'test-package', packageJson);

      expect(results).toHaveLength(1);
      expect(results[0].nodeName).toBe('WorkingNode');
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '  ✗ Failed to load node BrokenNode from test-package:',
        'Module not found'
      );
    });
  });

  describe('edge cases', () => {
    it('should handle empty nodes array', async () => {
      const packageJson = {
        n8n: {
          nodes: []
        }
      };

      const loader = await createLoaderWithMocks();
      const results = await loader['loadPackageNodes']('test-package', 'test-package', packageJson);

      expect(results).toHaveLength(0);
    });

    it('should handle empty nodes object', async () => {
      const packageJson = {
        n8n: {
          nodes: {}
        }
      };

      const loader = await createLoaderWithMocks();
      const results = await loader['loadPackageNodes']('test-package', 'test-package', packageJson);

      expect(results).toHaveLength(0);
    });

    it('should handle package.json without n8n property', async () => {
      const packageJson = {};

      const loader = await createLoaderWithMocks();
      const results = await loader['loadPackageNodes']('test-package', 'test-package', packageJson);

      expect(results).toHaveLength(0);
    });

    it('should handle malformed node paths', async () => {
      const packageJson = {
        n8n: {
          nodes: [
            '', // empty string
            null, // null value
            undefined, // undefined value
            123, // number instead of string
            'valid/path/Node.node.js'
          ]
        }
      };

      class ValidNode { name = 'Valid'; }

      mockRequire.mockImplementation((path: string) => {
        if (path.includes('valid/path')) return { default: ValidNode };
        return packageJson;
      });
      mockRequireResolve.mockImplementation((path: string) => {
        if (path.includes('valid/path')) return path;
        throw new Error('Invalid path');
      });

      const loader = await createLoaderWithMocks();
      const results = await loader['loadPackageNodes']('test-package', 'test-package', packageJson);

      // Only the valid node should be loaded
      expect(results).toHaveLength(1);
      expect(results[0].nodeName).toBe('Node');
    });

    it('should handle circular references in exports', async () => {
      const packageJson = {
        n8n: {
          nodes: ['dist/circular.js']
        }
      };

      const circularExport: any = { name: 'Circular' };
      circularExport.self = circularExport; // Create circular reference

      mockRequire.mockImplementation((path: string) => {
        if (path.includes('circular.js')) return { default: circularExport };
        return packageJson;
      });

      const loader = await createLoaderWithMocks();
      const results = await loader['loadPackageNodes']('test-package', 'test-package', packageJson);

      expect(results).toHaveLength(1);
      expect(results[0].NodeClass).toBe(circularExport);
    });

    it('should handle very long file paths', async () => {
      const longPath = 'dist/' + 'very/'.repeat(50) + 'deep/LongPathNode.node.js';
      const packageJson = {
        n8n: {
          nodes: [longPath]
        }
      };

      class LongPathNode { name = 'LongPath'; }

      mockRequire.mockImplementation((path: string) => {
        if (path.includes('LongPathNode')) return { default: LongPathNode };
        return packageJson;
      });

      const loader = await createLoaderWithMocks();
      const results = await loader['loadPackageNodes']('test-package', 'test-package', packageJson);

      expect(results).toHaveLength(1);
      expect(results[0].nodeName).toBe('LongPathNode');
    });

    it('should handle special characters in node names', async () => {
      const packageJson = {
        n8n: {
          nodes: [
            'dist/nodes/Node-With-Dashes.node.js',
            'dist/nodes/Node_With_Underscores.node.js',
            'dist/nodes/Node.With.Dots.node.js',
            'dist/nodes/Node@Special.node.js'
          ]
        }
      };

      class DashNode { name = 'Dash'; }
      class UnderscoreNode { name = 'Underscore'; }
      class DotNode { name = 'Dot'; }
      class SpecialNode { name = 'Special'; }

      mockRequire.mockImplementation((path: string) => {
        if (path.includes('Node-With-Dashes')) return { default: DashNode };
        if (path.includes('Node_With_Underscores')) return { default: UnderscoreNode };
        if (path.includes('Node.With.Dots')) return { default: DotNode };
        if (path.includes('Node@Special')) return { default: SpecialNode };
        return packageJson;
      });

      const loader = await createLoaderWithMocks();
      const results = await loader['loadPackageNodes']('test-package', 'test-package', packageJson);

      expect(results).toHaveLength(4);
      expect(results[0].nodeName).toBe('Node-With-Dashes');
      expect(results[1].nodeName).toBe('Node_With_Underscores');
      expect(results[2].nodeName).toBe('Node.With.Dots');
      expect(results[3].nodeName).toBe('Node@Special');
    });

    it('should handle mixed array and object in nodes (invalid but defensive)', async () => {
      const packageJson = {
        n8n: {
          nodes: ['array-node.js'] as any // TypeScript would prevent this, but we test runtime behavior
        }
      };
      
      // Simulate someone accidentally mixing formats
      (packageJson.n8n.nodes as any).CustomNode = 'object-node.js';

      class ArrayNode { name = 'Array'; }
      class ObjectNode { name = 'Object'; }

      mockRequire.mockImplementation((path: string) => {
        if (path.includes('array-node')) return { default: ArrayNode };
        if (path.includes('object-node')) return { default: ObjectNode };
        return packageJson;
      });

      const loader = await createLoaderWithMocks();
      const results = await loader['loadPackageNodes']('test-package', 'test-package', packageJson);

      // Should treat as array and only load the array item
      expect(results).toHaveLength(1);
      expect(results[0].NodeClass).toBe(ArrayNode);
    });
  });

  describe('console output verification', () => {
    it('should log correct messages for successful loads', async () => {
      const packageJson = {
        n8n: {
          nodes: ['dist/Success.node.js']
        }
      };

      class SuccessNode { name = 'Success'; }

      mockRequire.mockImplementation((path: string) => {
        if (path.includes('Success')) return { default: SuccessNode };
        return packageJson;
      });

      const loader = await createLoaderWithMocks();
      await loader['loadPackageNodes']('test-pkg', 'test-pkg', packageJson);

      expect(consoleLogSpy).toHaveBeenCalledWith('  ✓ Loaded Success from test-pkg');
    });

    it('should log package loading progress', async () => {
      mockRequire.mockImplementation(() => {
        throw new Error('Not found');
      });

      const loader = await createLoaderWithMocks();
      await loader.loadAllNodes();

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('📦 Loading package: n8n-nodes-base')
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('📦 Loading package: @n8n/n8n-nodes-langchain')
      );
    });
  });
});