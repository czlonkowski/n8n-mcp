import path from 'path';
import { logger } from '../utils/logger';

export interface LoadedNode {
  packageName: string;
  nodeName: string;
  NodeClass: any;
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
        logger.info(`Loading package: ${pkg.name} from ${pkg.path}`);
        // Use the path property to locate the package
        const packageJson = require(`${pkg.path}/package.json`);
        logger.info(`Found ${Object.keys(packageJson.n8n?.nodes || {}).length} nodes in package.json`);
        const nodes = await this.loadPackageNodes(pkg.name, pkg.path, packageJson);
        results.push(...nodes);
      } catch (error) {
        logger.error(`Failed to load ${pkg.name}: ${error}`);
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
   */
  private loadNodeModule(absolutePath: string): any {
    return require(absolutePath);
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

          // Extract node name from path (e.g., "dist/nodes/Slack/Slack.node.js" -> "Slack")
          const nodeNameMatch = nodePath.match(/\/([^\/]+)\.node\.(js|ts)$/);
          const nodeName = nodeNameMatch ? nodeNameMatch[1] : path.basename(nodePath, '.node.js');

          // Handle default export and various export patterns
          const NodeClass = nodeModule.default || nodeModule[nodeName] || Object.values(nodeModule)[0];
          if (NodeClass) {
            nodes.push({ packageName, nodeName, NodeClass });
            logger.debug(`Loaded ${nodeName} from ${packageName}`);
          } else {
            logger.warn(`No valid export found for ${nodeName} in ${packageName}`);
          }
        } catch (error) {
          logger.error(`Failed to load node from ${packageName}/${nodePath}: ${(error as Error).message}`);
        }
      }
    } else {
      // Handle object format (for other packages)
      for (const [nodeName, nodePath] of Object.entries(nodesList)) {
        try {
          const fullPath = path.join(packageDir, nodePath as string);
          const nodeModule = this.loadNodeModule(fullPath);

          // Handle default export and various export patterns
          const NodeClass = nodeModule.default || nodeModule[nodeName] || Object.values(nodeModule)[0];
          if (NodeClass) {
            nodes.push({ packageName, nodeName, NodeClass });
            logger.debug(`Loaded ${nodeName} from ${packageName}`);
          } else {
            logger.warn(`No valid export found for ${nodeName} in ${packageName}`);
          }
        } catch (error) {
          logger.error(`Failed to load node ${nodeName} from ${packageName}: ${(error as Error).message}`);
        }
      }
    }

    return nodes;
  }
}