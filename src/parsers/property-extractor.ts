import type { NodeClass } from '../types/node-types';
import { instantiateNode } from '../types/node-types';

export class PropertyExtractor {
  /**
   * Extract properties with proper handling of n8n's complex structures
   */
  extractProperties(nodeClass: NodeClass): any[] {
    const properties: any[] = [];

    // First try to get instance-level properties
    const instance: any = instantiateNode(nodeClass);

    // Handle versioned nodes - check instance for nodeVersions
    if (instance?.nodeVersions) {
      const versions = Object.keys(instance.nodeVersions).map(Number);
      if (versions.length > 0) {
        const latestVersion = Math.max(...versions);
        if (!isNaN(latestVersion)) {
          const versionedNode = instance.nodeVersions[latestVersion];

          if (versionedNode?.description?.properties) {
            return this.normalizeProperties(versionedNode.description.properties);
          }
        }
      }
    }
    
    // Check for description with properties
    const description = instance?.description || instance?.baseDescription || 
                       this.getNodeDescription(nodeClass);
    
    if (description?.properties) {
      return this.normalizeProperties(description.properties);
    }
    
    return properties;
  }
  
  private getNodeDescription(nodeClass: NodeClass): any {
    // Already an instance - read the description off it directly
    if (typeof nodeClass !== 'function') {
      return (nodeClass as any).description || {};
    }

    // Some nodes need parameters to instantiate; fall back to class-level properties
    const instance: any = instantiateNode(nodeClass);

    return instance
      ? instance.description || instance.baseDescription || {}
      : (nodeClass as any).description || {};
  }
  
  /**
   * Extract operations from both declarative and programmatic nodes
   */
  extractOperations(nodeClass: NodeClass): any[] {
    const operations: any[] = [];

    // First try to get instance-level data
    const instance: any = instantiateNode(nodeClass);

    // Handle versioned nodes
    if (instance?.nodeVersions) {
      const versions = Object.keys(instance.nodeVersions).map(Number);
      if (versions.length > 0) {
        const latestVersion = Math.max(...versions);
        if (!isNaN(latestVersion)) {
          const versionedNode = instance.nodeVersions[latestVersion];

          if (versionedNode?.description) {
            return this.extractOperationsFromDescription(versionedNode.description);
          }
        }
      }
    }
    
    // Get description
    const description = instance?.description || instance?.baseDescription || 
                       this.getNodeDescription(nodeClass);
    
    return this.extractOperationsFromDescription(description);
  }
  
  /**
   * Extract the per-version details (properties, operations, credentials) from
   * one concrete node description. Used to record every version of a node, not
   * only the latest one that extractProperties/extractOperations return.
   */
  extractVersionDetails(description: any): { properties: any[]; operations: any[]; credentials: any[] } {
    return {
      properties: Array.isArray(description?.properties)
        ? this.normalizeProperties(description.properties)
        : [],
      operations: this.extractOperationsFromDescription(description),
      credentials: Array.isArray(description?.credentials) ? description.credentials : []
    };
  }

  private extractOperationsFromDescription(description: any): any[] {
    const operations: any[] = [];
    
    if (!description) return operations;
    
    // Declarative nodes (with routing)
    if (description.routing) {
      const routing = description.routing;
      
      // Extract from request.resource and request.operation
      if (routing.request?.resource) {
        const resources = routing.request.resource.options || [];
        const operationOptions = routing.request.operation?.options || {};
        
        resources.forEach((resource: any) => {
          const resourceOps = operationOptions[resource.value] || [];
          resourceOps.forEach((op: any) => {
            operations.push({
              resource: resource.value,
              operation: op.value,
              name: `${resource.name} - ${op.name}`,
              action: op.action
            });
          });
        });
      }
    }
    
    // Programmatic nodes - look for operation properties in properties
    // Note: nodes can have MULTIPLE operation properties, each with displayOptions.show.resource
    // mapping to a different resource (e.g., Slack has 7 operation props for channel, message, etc.)
    if (description.properties && Array.isArray(description.properties)) {
      const operationProps = description.properties.filter(
        (p: any) => p.name === 'operation' || p.name === 'action'
      );

      for (const operationProp of operationProps) {
        if (!operationProp?.options) continue;
        const resource = operationProp.displayOptions?.show?.resource?.[0];
        operationProp.options.forEach((op: any) => {
          operations.push({
            operation: op.value,
            name: op.name,
            description: op.description,
            ...(resource ? { resource } : {})
          });
        });
      }
    }
    
    return operations;
  }
  
  /**
   * Whether a description declares that n8n may expose the node as a tool.
   *
   * n8n's type is `usableAsTool?: true | UsableAsToolDescription`. The object
   * form carries codex replacements for the generated variant and is what HTTP
   * Request uses on every version from 3 onwards, so comparing against `true`
   * alone misses the most widely used tool node there is.
   */
  private declaresToolUse(description: any): boolean {
    const usableAsTool = description?.usableAsTool;

    return usableAsTool !== undefined && usableAsTool !== null && usableAsTool !== false;
  }

  /**
   * Detect whether n8n exposes this node as an AI Agent tool.
   *
   * `usableAsTool` is the only signal, matching n8n's own node-helpers. A node
   * whose name merely mentions an AI vendor is not exposed as a tool, so
   * inferring capability from the name invents node types that do not exist.
   */
  detectAIToolCapability(nodeClass: NodeClass): boolean {
    const instance: any = instantiateNode(nodeClass);
    // Reuse the instance rather than letting getNodeDescription construct a second one
    const description =
      instance?.description || instance?.baseDescription || this.getNodeDescription(nodeClass);

    // VersionedNodeType assigns nodeVersions in its constructor, so for a class
    // the map only exists on an instance (e.g. messageAnAgent, microsoftSharePoint).
    const nodeVersions = (nodeClass as any).nodeVersions ?? instance?.nodeVersions;

    if (nodeVersions) {
      // n8n resolves a versioned node to nodeVersions[currentVersion] before it
      // reads usableAsTool, so only the default version decides. Accepting any
      // version would claim a tool variant n8n does not create once a node drops
      // tool support while keeping the older version around.
      //
      // VersionedNodeType computes currentVersion as `defaultVersion ?? latest`;
      // both fallbacks below reproduce that for shapes that never ran the
      // constructor, so the highest key is only used when no default is declared.
      const currentVersion =
        instance?.currentVersion ??
        description?.defaultVersion ??
        Math.max(...Object.keys(nodeVersions).map(Number));
      const versionDescription = nodeVersions[currentVersion]?.description;

      if (versionDescription) return this.declaresToolUse(versionDescription);
    }

    if (this.declaresToolUse(description)) return true;

    // Per-action flags, for declarative nodes that carry them
    return description?.actions?.some((a: any) => this.declaresToolUse(a)) === true;
  }
  
  /**
   * Extract credential requirements with proper structure
   */
  extractCredentials(nodeClass: NodeClass): any[] {
    const credentials: any[] = [];

    // First try to get instance-level data
    const instance: any = instantiateNode(nodeClass);

    // Handle versioned nodes
    if (instance?.nodeVersions) {
      const versions = Object.keys(instance.nodeVersions).map(Number);
      if (versions.length > 0) {
        const latestVersion = Math.max(...versions);
        if (!isNaN(latestVersion)) {
          const versionedNode = instance.nodeVersions[latestVersion];

          if (versionedNode?.description?.credentials) {
            return versionedNode.description.credentials;
          }
        }
      }
    }
    
    // Check for description with credentials
    const description = instance?.description || instance?.baseDescription || 
                       this.getNodeDescription(nodeClass);
    
    if (description?.credentials) {
      return description.credentials;
    }
    
    return credentials;
  }
  
  private normalizeProperties(properties: any[]): any[] {
    // Ensure all properties have consistent structure
    return properties.map(prop => ({
      displayName: prop.displayName,
      name: prop.name,
      type: prop.type,
      default: prop.default,
      description: prop.description,
      options: prop.options,
      required: prop.required,
      displayOptions: prop.displayOptions,
      typeOptions: prop.typeOptions,
      modes: prop.modes, // For resourceLocator type properties - modes are at top level
      noDataExpression: prop.noDataExpression
    }));
  }
}