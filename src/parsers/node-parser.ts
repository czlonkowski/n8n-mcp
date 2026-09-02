import { PropertyExtractor } from './property-extractor';
import type {
  NodeClass,
  VersionedNodeInstance
} from '../types/node-types';
import {
  isVersionedNodeInstance,
  isVersionedNodeClass,
  getNodeDescription as getNodeDescriptionHelper,
  instantiateNode
} from '../types/node-types';
import type { INodeTypeBaseDescription, INodeTypeDescription } from 'n8n-workflow';
import { filterPropertiesForVersion } from './version-display-gate';

export interface ParsedNode {
  style: 'declarative' | 'programmatic';
  nodeType: string;
  displayName: string;
  description?: string;
  category?: string;
  properties: any[];
  credentials: any[];
  isAITool: boolean;
  isTrigger: boolean;
  isWebhook: boolean;
  operations: any[];
  version?: string;
  isVersioned: boolean;
  packageName: string;
  documentation?: string;
  outputs?: any[];
  outputNames?: string[];
  // Tool variant fields (for nodes with usableAsTool: true)
  isToolVariant?: boolean;      // True for *Tool variants (e.g., supabaseTool)
  toolVariantOf?: string;       // For Tool variants: base node type (e.g., nodes-base.supabase)
  hasToolVariant?: boolean;     // For base nodes: true if Tool variant exists
}

/**
 * One concrete version of a node, as n8n resolves it from a workflow's typeVersion.
 * Feeds the node_versions table so version history and schema diffs work offline.
 */
export interface ParsedNodeVersion {
  nodeType: string;
  version: string;
  packageName: string;
  displayName: string;
  description?: string;
  category?: string;
  isCurrentMax: boolean;
  properties: any[];
  operations: any[];
  credentials: any[];
  outputs?: any[];
  addedProperties: string[];
  deprecatedProperties: string[];
}

/**
 * Format a version the way workflows store typeVersion: 1 -> "1", 4.1 -> "4.1".
 * Keys of a VersionedNodeType map arrive as strings, description.version as numbers.
 */
export function normalizeNodeVersion(version: unknown): string {
  const numeric = Number(version);
  return Number.isFinite(numeric) ? String(numeric) : String(version);
}

export class NodeParser {
  private propertyExtractor = new PropertyExtractor();
  private currentNodeClass: NodeClass | null = null;

  parse(nodeClass: NodeClass, packageName: string): ParsedNode {
    this.currentNodeClass = nodeClass;
    // Get base description (handles versioned nodes)
    const description = this.getNodeDescription(nodeClass);
    const outputInfo = this.extractOutputs(description);
    
    return {
      style: this.detectStyle(nodeClass),
      nodeType: this.extractNodeType(description, packageName),
      displayName: description.displayName || description.name,
      description: description.description,
      category: this.extractCategory(description),
      properties: this.propertyExtractor.extractProperties(nodeClass),
      credentials: this.propertyExtractor.extractCredentials(nodeClass),
      isAITool: this.propertyExtractor.detectAIToolCapability(nodeClass),
      isTrigger: this.detectTrigger(description),
      isWebhook: this.detectWebhook(description),
      operations: this.propertyExtractor.extractOperations(nodeClass),
      version: this.extractVersion(nodeClass),
      isVersioned: this.detectVersioned(nodeClass),
      packageName: packageName,
      outputs: outputInfo.outputs,
      outputNames: outputInfo.outputNames
    };
  }
  
  /**
   * Expand a node class into one record per version number.
   *
   * A VersionedNodeType registers every supported typeVersion as a key of its
   * nodeVersions map (several keys usually share one implementation), and n8n
   * resolves a workflow node by exact key lookup, so the keys are the version
   * list. A plain node declares its versions as description.version, either a
   * scalar or an array that shares the single description.
   *
   * Returns an empty array for nodes with a single scalar version: they have no
   * history to record, and readers fall back to the nodes table for them.
   */
  parseVersions(nodeClass: NodeClass, packageName: string): ParsedNodeVersion[] {
    this.currentNodeClass = nodeClass;
    const base = this.getNodeDescription(nodeClass);
    const nodeType = this.extractNodeType(base, packageName);
    const currentVersion = this.extractVersion(nodeClass);
    const category = this.extractCategory(base);

    const instance = instantiateNode(nodeClass) as any;
    const nodeVersions = instance?.nodeVersions ?? (nodeClass as any).nodeVersions;

    // A workflow's typeVersion is a number, so only numeric versions are reachable
    const entries = new Map<string, any>();
    const record = (version: unknown, description: any) => {
      if (description && Number.isFinite(Number(version))) {
        entries.set(normalizeNodeVersion(version), description);
      }
    };
    if (nodeVersions && typeof nodeVersions === 'object') {
      for (const [key, implementation] of Object.entries<any>(nodeVersions)) {
        record(key, implementation?.description);
      }
    } else {
      const declared = (base as any).version;
      if (!Array.isArray(declared)) return [];
      for (const version of declared) record(version, base);
    }

    // Keys are numeric strings after normalizeNodeVersion, and n8n's typeVersion
    // is a number, so ordering them numerically matches how n8n reads them.
    const ordered = [...entries.entries()].sort(([a], [b]) => Number(a) - Number(b));

    let previousNames: Set<string> | null = null;
    return ordered.map(([version, description]) => {
      const details = this.propertyExtractor.extractVersionDetails(description);
      // A shared implementation gates properties per typeVersion; keep what this version shows
      details.properties = filterPropertiesForVersion(details.properties, version);
      const names = new Set<string>(
        details.properties.map((p: any) => p.name).filter((n: any) => typeof n === 'string')
      );
      const previous = previousNames;
      const addedProperties = previous ? [...names].filter(n => !previous.has(n)) : [];
      const deprecatedProperties = previous ? [...previous].filter(n => !names.has(n)) : [];
      previousNames = names;

      return {
        nodeType,
        version,
        packageName,
        displayName: description.displayName || base.displayName || base.name,
        description: description.description ?? base.description,
        category,
        isCurrentMax: version === currentVersion,
        properties: details.properties,
        operations: details.operations,
        credentials: details.credentials,
        outputs: this.extractOutputs(description).outputs,
        addedProperties,
        deprecatedProperties
      };
    });
  }

  private getNodeDescription(nodeClass: NodeClass): INodeTypeBaseDescription | INodeTypeDescription {
    // Try to get description from the class first
    let description: INodeTypeBaseDescription | INodeTypeDescription | undefined;

    // Check if it's a versioned node using type guard
    if (isVersionedNodeClass(nodeClass)) {
      // This is a VersionedNodeType class - instantiate it
      try {
        const instance = new (nodeClass as new () => VersionedNodeInstance)();
        // Strategic any assertion for accessing both description and baseDescription
        const inst = instance as any;
        // Try description first (real VersionedNodeType with getter)
        // Only fallback to baseDescription if nodeVersions exists (complete VersionedNodeType mock)
        // This prevents using baseDescription for incomplete mocks that test edge cases
        description = inst.description || (inst.nodeVersions ? inst.baseDescription : undefined);

        // If still undefined (incomplete mock), leave as undefined to use catch block fallback
      } catch (e) {
        // Some nodes might require parameters to instantiate
      }
    } else if (typeof nodeClass === 'function') {
      // Try to instantiate to get description
      try {
        const instance = new nodeClass();
        description = instance.description;
        // If description is empty or missing name, check for baseDescription fallback
        if (!description || !description.name) {
          const inst = instance as any;
          if (inst.baseDescription?.name) {
            description = inst.baseDescription;
          }
        }
      } catch (e) {
        // Some nodes might require parameters to instantiate
        // Try to access static properties
        description = (nodeClass as any).description;
      }
    } else {
      // Maybe it's already an instance
      description = nodeClass.description;
      // If description is empty or missing name, check for baseDescription fallback
      if (!description || !description.name) {
        const inst = nodeClass as any;
        if (inst.baseDescription?.name) {
          description = inst.baseDescription;
        }
      }
    }

    return description || ({} as any);
  }
  
  private detectStyle(nodeClass: NodeClass): 'declarative' | 'programmatic' {
    const desc = this.getNodeDescription(nodeClass);
    return (desc as any).routing ? 'declarative' : 'programmatic';
  }

  private extractNodeType(description: INodeTypeBaseDescription | INodeTypeDescription, packageName: string): string {
    // Ensure we have the full node type including package prefix
    const name = description.name;
    
    if (!name) {
      throw new Error('Node is missing name property');
    }
    
    if (name.includes('.')) {
      return name;
    }
    
    // Add package prefix if missing
    const packagePrefix = packageName.replace('@n8n/', '').replace('n8n-', '');
    return `${packagePrefix}.${name}`;
  }
  
  private extractCategory(description: INodeTypeBaseDescription | INodeTypeDescription): string {
    return description.group?.[0] ||
           (description as any).categories?.[0] ||
           (description as any).category ||
           'misc';
  }

  private detectTrigger(description: INodeTypeBaseDescription | INodeTypeDescription): boolean {
    // Strategic any assertion for properties that only exist on INodeTypeDescription
    const desc = description as any;

    // Primary check: group includes 'trigger'
    if (description.group && Array.isArray(description.group)) {
      if (description.group.includes('trigger')) {
        return true;
      }
    }

    // Fallback checks for edge cases
    return desc.polling === true ||
           desc.trigger === true ||
           desc.eventTrigger === true ||
           description.name?.toLowerCase().includes('trigger');
  }
  
  private detectWebhook(description: INodeTypeBaseDescription | INodeTypeDescription): boolean {
    const desc = description as any; // INodeTypeDescription has webhooks, but INodeTypeBaseDescription doesn't
    return (desc.webhooks?.length > 0) ||
           desc.webhook === true ||
           description.name?.toLowerCase().includes('webhook');
  }
  
  /**
   * Extracts the version from a node class.
   *
   * Priority Chain:
   * 1. Instance currentVersion (VersionedNodeType's computed property)
   * 2. Instance description.defaultVersion (explicit default)
   * 3. Instance nodeVersions (fallback to max available version)
   * 4. Description version array (legacy nodes)
   * 5. Description version scalar (simple versioning)
   * 6. Class-level properties (if instantiation fails)
   * 7. Default to "1"
   *
   * Critical Fix (v2.17.4): Removed check for non-existent instance.baseDescription.defaultVersion
   * which caused AI Agent to incorrectly return version "3" instead of "2.2"
   *
   * @param nodeClass - The node class or instance to extract version from
   * @returns The version as a string
   */
  private extractVersion(nodeClass: NodeClass): string {
    // Check instance properties first
    try {
      const instance = typeof nodeClass === 'function' ? new nodeClass() : nodeClass;
      // Strategic any assertion - instance could be INodeType or IVersionedNodeType
      const inst = instance as any;

      // PRIORITY 1: Check currentVersion (what VersionedNodeType actually uses)
      // For VersionedNodeType, currentVersion = defaultVersion ?? max(nodeVersions)
      if (inst?.currentVersion !== undefined) {
        return inst.currentVersion.toString();
      }

      // PRIORITY 2: Handle instance-level description.defaultVersion
      // VersionedNodeType stores baseDescription as 'description', not 'baseDescription'
      if (inst?.description?.defaultVersion) {
        return inst.description.defaultVersion.toString();
      }

      // PRIORITY 3: Handle instance-level nodeVersions (fallback to max)
      if (inst?.nodeVersions) {
        const versions = Object.keys(inst.nodeVersions).map(Number);
        if (versions.length > 0) {
          const maxVersion = Math.max(...versions);
          if (!isNaN(maxVersion)) {
            return maxVersion.toString();
          }
        }
      }

      // Handle version array in description (e.g., [1, 1.1, 1.2])
      if (inst?.description?.version) {
        const version = inst.description.version;
        if (Array.isArray(version)) {
          const numericVersions = version.map((v: any) => parseFloat(v.toString()));
          if (numericVersions.length > 0) {
            const maxVersion = Math.max(...numericVersions);
            if (!isNaN(maxVersion)) {
              return maxVersion.toString();
            }
          }
        } else if (typeof version === 'number' || typeof version === 'string') {
          return version.toString();
        }
      }
    } catch (e) {
      // Some nodes might require parameters to instantiate
      // Try class-level properties
    }

    // Handle class-level VersionedNodeType with defaultVersion
    // Note: Most VersionedNodeType classes don't have static properties
    // Strategic any assertion for class-level property access
    const nodeClassAny = nodeClass as any;
    if (nodeClassAny.description?.defaultVersion) {
      return nodeClassAny.description.defaultVersion.toString();
    }

    // Handle class-level VersionedNodeType with nodeVersions
    if (nodeClassAny.nodeVersions) {
      const versions = Object.keys(nodeClassAny.nodeVersions).map(Number);
      if (versions.length > 0) {
        const maxVersion = Math.max(...versions);
        if (!isNaN(maxVersion)) {
          return maxVersion.toString();
        }
      }
    }

    // Also check class-level description for version array
    const description = this.getNodeDescription(nodeClass);
    const desc = description as any; // Strategic assertion for version property
    if (desc?.version) {
      if (Array.isArray(desc.version)) {
        const numericVersions = desc.version.map((v: any) => parseFloat(v.toString()));
        if (numericVersions.length > 0) {
          const maxVersion = Math.max(...numericVersions);
          if (!isNaN(maxVersion)) {
            return maxVersion.toString();
          }
        }
      } else if (typeof desc.version === 'number' || typeof desc.version === 'string') {
        return desc.version.toString();
      }
    }

    // Default to version 1
    return '1';
  }
  
  private detectVersioned(nodeClass: NodeClass): boolean {
    // Check instance-level properties first
    try {
      const instance = typeof nodeClass === 'function' ? new nodeClass() : nodeClass;
      // Strategic any assertion - instance could be INodeType or IVersionedNodeType
      const inst = instance as any;

      // Check for instance baseDescription with defaultVersion
      if (inst?.baseDescription?.defaultVersion) {
        return true;
      }

      // Check for nodeVersions
      if (inst?.nodeVersions) {
        return true;
      }

      // Check for version array in description
      if (inst?.description?.version && Array.isArray(inst.description.version)) {
        return true;
      }
    } catch (e) {
      // Some nodes might require parameters to instantiate
      // Try class-level checks
    }

    // Check class-level nodeVersions
    // Strategic any assertion for class-level property access
    const nodeClassAny = nodeClass as any;
    if (nodeClassAny.nodeVersions || nodeClassAny.baseDescription?.defaultVersion) {
      return true;
    }

    // Also check class-level description for version array
    const description = this.getNodeDescription(nodeClass);
    const desc = description as any; // Strategic assertion for version property
    if (desc?.version && Array.isArray(desc.version)) {
      return true;
    }
    
    return false;
  }

  private extractOutputs(description: INodeTypeBaseDescription | INodeTypeDescription): { outputs?: any[], outputNames?: string[] } {
    const result: { outputs?: any[], outputNames?: string[] } = {};
    // Strategic any assertion for outputs/outputNames properties
    const desc = description as any;

    // First check the base description
    if (desc.outputs) {
      result.outputs = Array.isArray(desc.outputs) ? desc.outputs : [desc.outputs];
    }

    if (desc.outputNames) {
      result.outputNames = Array.isArray(desc.outputNames) ? desc.outputNames : [desc.outputNames];
    }

    // If no outputs found and this is a versioned node, check the latest version
    if (!result.outputs && !result.outputNames) {
      const nodeClass = this.currentNodeClass; // We'll need to track this
      if (nodeClass) {
        try {
          const instance = typeof nodeClass === 'function' ? new nodeClass() : nodeClass;
          // Strategic any assertion for instance properties
          const inst = instance as any;
          if (inst.nodeVersions) {
            // Get the latest version
            const versions = Object.keys(inst.nodeVersions).map(Number);
            if (versions.length > 0) {
              const latestVersion = Math.max(...versions);
              if (!isNaN(latestVersion)) {
                const versionedDescription = inst.nodeVersions[latestVersion]?.description;
            
            if (versionedDescription) {
              if (versionedDescription.outputs) {
                result.outputs = Array.isArray(versionedDescription.outputs) 
                  ? versionedDescription.outputs 
                  : [versionedDescription.outputs];
              }
              
              if (versionedDescription.outputNames) {
                result.outputNames = Array.isArray(versionedDescription.outputNames)
                  ? versionedDescription.outputNames
                  : [versionedDescription.outputNames];
              }
            }
              }
            }
          }
        } catch (e) {
          // Ignore errors from instantiating node
        }
      }
    }
    
    return result;
  }
}