import path from 'path';
import { Module } from 'module';

export interface LoadedNode {
  packageName: string;
  nodeName: string;
  NodeClass: any;
}

/**
 * Constructible/callable stand-in for a module that cannot be resolved.
 * Any property access returns the stub itself so top-level destructuring,
 * subclassing and instantiation in node description files don't throw at
 * index time — the real dependency is only needed when the node executes.
 */
function createMissingDependencyStub(): any {
  const stub: any = new Proxy(class MissingOptionalDependency {}, {
    get(target, prop) {
      if (prop in target) return Reflect.get(target, prop);
      if (typeof prop === 'symbol') return undefined;
      return stub;
    },
    apply() {
      return stub;
    },
    construct() {
      return {};
    }
  });
  return stub;
}

export class N8nNodeLoader {
  private readonly CORE_PACKAGES = [
    { name: 'n8n-nodes-base', path: 'n8n-nodes-base' },
    { name: '@n8n/n8n-nodes-langchain', path: '@n8n/n8n-nodes-langchain' }
  ];

  async loadAllNodes(): Promise<LoadedNode[]> {
    const results: LoadedNode[] = [];
    
    for (const pkg of this.CORE_PACKAGES) {
      try {
        console.log(`\n📦 Loading package: ${pkg.name} from ${pkg.path}`);
        // Use the path property to locate the package
        const packageJson = require(`${pkg.path}/package.json`);
        console.log(`  Found ${Object.keys(packageJson.n8n?.nodes || {}).length} nodes in package.json`);
        const nodes = await this.loadPackageNodes(pkg.name, pkg.path, packageJson);
        results.push(...nodes);
      } catch (error) {
        console.error(`Failed to load ${pkg.name}:`, error);
      }
    }
    
    return results;
  }

  /**
   * Resolve the absolute directory of an installed package.
   * Uses require.resolve on package.json (always exported) and strips the filename.
   */
  private resolvePackageDir(packagePath: string): string {
    const pkgJsonPath = require.resolve(`${packagePath}/package.json`);
    return path.dirname(pkgJsonPath);
  }

  /**
   * Load a node module by absolute file path, bypassing package.json "exports".
   * Some packages (e.g. @n8n/n8n-nodes-langchain >=2.9) restrict exports but
   * still list node files in the n8n.nodes array — we need direct filesystem access.
   *
   * If the module fails with MODULE_NOT_FOUND — typically an optional peer
   * dependency the node only needs at execution time (e.g.
   * EmbeddingsHuggingFaceInference requiring @huggingface/inference) — retry
   * with the unresolvable dependencies stubbed so the node description can
   * still be extracted and indexed instead of silently dropping the node.
   */
  private loadNodeModule(absolutePath: string): any {
    try {
      return require(absolutePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'MODULE_NOT_FOUND') {
        throw error;
      }
      return this.loadNodeModuleWithStubbedDependencies(absolutePath);
    }
  }

  private loadNodeModuleWithStubbedDependencies(absolutePath: string): any {
    const moduleInternals = Module as any;
    const originalLoad = moduleInternals._load;
    const stubbedDependencies = new Set<string>();

    moduleInternals._load = function (request: string, parent: any, isMain: boolean) {
      try {
        return originalLoad.call(this, request, parent, isMain);
      } catch (error) {
        const err = error as NodeJS.ErrnoException;
        // Only stub BARE specifiers (optional peer deps). A missing relative
        // ('./x') or absolute sibling is a real packaging bug that must fail
        // loudly, never the node entry file, and never errors unrelated to
        // module resolution.
        if (
          err.code === 'MODULE_NOT_FOUND' &&
          request !== absolutePath &&
          !request.startsWith('.') &&
          !path.isAbsolute(request) &&
          typeof err.message === 'string' &&
          err.message.includes(`'${request}'`)
        ) {
          stubbedDependencies.add(request);
          return createMissingDependencyStub();
        }
        throw error;
      }
    };

    try {
      const nodeModule = require(absolutePath);
      console.warn(
        `  ⚠ Loaded ${path.basename(absolutePath)} with stubbed missing dependencies: ${[...stubbedDependencies].join(', ')}`
      );
      return nodeModule;
    } finally {
      moduleInternals._load = originalLoad;
    }
  }

  /**
   * Resolve the node class from a module's exports: default export, then the
   * export matching the node name, then the first function-typed export. The
   * last step must skip non-function exports — EvaluationTrigger.node.ee.js
   * exports the constant DEFAULT_STARTING_ROW before the class, and picking
   * it silently dropped the node from the database (#937).
   */
  private resolveNodeClass(nodeModule: any, nodeName: string): any {
    return (
      nodeModule.default ||
      nodeModule[nodeName] ||
      Object.values(nodeModule).find(exported => typeof exported === 'function')
    );
  }

  private async loadPackageNodes(packageName: string, packagePath: string, packageJson: any): Promise<LoadedNode[]> {
    const n8nConfig = packageJson.n8n || {};
    const nodes: LoadedNode[] = [];
    const packageDir = this.resolvePackageDir(packagePath);

    // Check if nodes is an array or object
    const nodesList = n8nConfig.nodes || [];

    if (Array.isArray(nodesList)) {
      // Handle array format (n8n-nodes-base uses this)
      for (const nodePath of nodesList) {
        try {
          // Resolve absolute path directly to bypass package exports restrictions
          const fullPath = path.join(packageDir, nodePath);
          const nodeModule = this.loadNodeModule(fullPath);

          // Extract node name from path, including enterprise ".node.ee.js"
          // files (e.g. "dist/nodes/Evaluation/EvaluationTrigger/EvaluationTrigger.node.ee.js" -> "EvaluationTrigger")
          const nodeNameMatch = nodePath.match(/\/([^\/]+)\.node(?:\.ee)?\.(js|ts)$/);
          const nodeName = nodeNameMatch
            ? nodeNameMatch[1]
            : path.basename(nodePath).replace(/\.node(?:\.ee)?\.(js|ts)$/, '');

          const NodeClass = this.resolveNodeClass(nodeModule, nodeName);
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
      // Handle object format (for other packages)
      for (const [nodeName, nodePath] of Object.entries(nodesList)) {
        try {
          const fullPath = path.join(packageDir, nodePath as string);
          const nodeModule = this.loadNodeModule(fullPath);

          const NodeClass = this.resolveNodeClass(nodeModule, nodeName);
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