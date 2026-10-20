/**
 * PropertyFilter Service
 * 
 * Intelligently filters node properties to return only essential and commonly-used ones.
 * Reduces property count from 200+ to 10-20 for better AI agent usability.
 */

export interface SimplifiedProperty {
  name: string;
  displayName: string;
  type: string;
  description: string;
  default?: any;
  options?: Array<{ value: string; label: string }>;
  required?: boolean;
  placeholder?: string;
  showWhen?: Record<string, any>;
  usageHint?: string;
  expectedFormat?: {
    structure: Record<string, string>;
    modes?: string[];
    example: Record<string, any>;
  };
  /** Options for this property come from the live service; resolve them with n8n_explore_node_resources. */
  dynamicOptions?: { methodName: string; methodType: 'loadOptions' | 'listSearch'; dependsOn: string[] };
}

export interface EssentialConfig {
  required: string[];
  common: string[];
  categoryPriority?: string[];
}

export interface FilteredProperties {
  required: SimplifiedProperty[];
  common: SimplifiedProperty[];
}

export class PropertyFilter {
  /**
   * Curated lists of essential properties for the most commonly used nodes.
   * Based on analysis of typical workflows and AI agent needs.
   */
  private static ESSENTIAL_PROPERTIES: Record<string, EssentialConfig> = {
    // HTTP Request - Most used node
    'nodes-base.httpRequest': {
      required: ['url'],
      common: ['method', 'authentication', 'sendBody', 'contentType', 'sendHeaders'],
      categoryPriority: ['basic', 'authentication', 'request', 'response', 'advanced']
    },
    
    // Webhook - Entry point for many workflows
    'nodes-base.webhook': {
      required: [],
      common: ['httpMethod', 'path', 'responseMode', 'responseData', 'responseCode'],
      categoryPriority: ['basic', 'response', 'advanced']
    },
    
    // Code - For custom logic
    'nodes-base.code': {
      required: [],
      common: ['language', 'jsCode', 'pythonCode', 'mode'],
      categoryPriority: ['basic', 'code', 'advanced']
    },
    
    // Set - Data manipulation
    'nodes-base.set': {
      required: [],
      common: ['mode', 'assignments', 'includeOtherFields', 'options'],
      categoryPriority: ['basic', 'data', 'advanced']
    },
    
    // If - Conditional logic
    'nodes-base.if': {
      required: [],
      common: ['conditions', 'combineOperation'],
      categoryPriority: ['basic', 'conditions', 'advanced']
    },
    
    // PostgreSQL - Database operations
    'nodes-base.postgres': {
      required: [],
      common: ['operation', 'table', 'query', 'additionalFields', 'returnAll'],
      categoryPriority: ['basic', 'query', 'options', 'advanced']
    },
    
    // OpenAI - AI operations
    'nodes-base.openAi': {
      required: [],
      common: ['resource', 'operation', 'modelId', 'prompt', 'messages', 'maxTokens'],
      categoryPriority: ['basic', 'model', 'input', 'options', 'advanced']
    },
    
    // Google Sheets - Spreadsheet operations
    'nodes-base.googleSheets': {
      required: [],
      common: ['operation', 'documentId', 'sheetName', 'range', 'dataStartRow'],
      categoryPriority: ['basic', 'location', 'data', 'options', 'advanced']
    },
    
    // Slack - Messaging
    'nodes-base.slack': {
      required: [],
      common: ['resource', 'operation', 'channelId', 'text', 'attachments', 'blocksUi'],
      categoryPriority: ['basic', 'message', 'formatting', 'advanced']
    },
    
    // Email - Email operations
    'nodes-base.email': {
      required: [],
      common: ['resource', 'operation', 'fromEmail', 'toEmail', 'subject', 'text', 'html'],
      categoryPriority: ['basic', 'recipients', 'content', 'advanced']
    },
    
    // Merge - Combining data streams
    'nodes-base.merge': {
      required: [],
      common: ['mode', 'joinMode', 'propertyName1', 'propertyName2', 'outputDataFrom'],
      categoryPriority: ['basic', 'merge', 'advanced']
    },
    
    // Function (legacy) - Custom functions
    'nodes-base.function': {
      required: [],
      common: ['functionCode'],
      categoryPriority: ['basic', 'code', 'advanced']
    },
    
    // Split In Batches - Batch processing
    'nodes-base.splitInBatches': {
      required: [],
      common: ['batchSize', 'options'],
      categoryPriority: ['basic', 'options', 'advanced']
    },
    
    // Redis - Cache operations
    'nodes-base.redis': {
      required: [],
      common: ['operation', 'key', 'value', 'keyType', 'expire'],
      categoryPriority: ['basic', 'data', 'options', 'advanced']
    },
    
    // MongoDB - NoSQL operations
    'nodes-base.mongoDb': {
      required: [],
      common: ['operation', 'collection', 'query', 'fields', 'limit'],
      categoryPriority: ['basic', 'query', 'options', 'advanced']
    },
    
    // MySQL - Database operations
    'nodes-base.mySql': {
      required: [],
      common: ['operation', 'table', 'query', 'columns', 'additionalFields'],
      categoryPriority: ['basic', 'query', 'options', 'advanced']
    },
    
    // FTP - File transfer
    'nodes-base.ftp': {
      required: [],
      common: ['operation', 'path', 'fileName', 'binaryData'],
      categoryPriority: ['basic', 'file', 'options', 'advanced']
    },
    
    // SSH - Remote execution
    'nodes-base.ssh': {
      required: [],
      common: ['resource', 'operation', 'command', 'path', 'cwd'],
      categoryPriority: ['basic', 'command', 'options', 'advanced']
    },
    
    // Execute Command - Local execution
    'nodes-base.executeCommand': {
      required: [],
      common: ['command', 'cwd'],
      categoryPriority: ['basic', 'advanced']
    },
    
    // GitHub - Version control operations
    'nodes-base.github': {
      required: [],
      common: ['resource', 'operation', 'owner', 'repository', 'title', 'body'],
      categoryPriority: ['basic', 'repository', 'content', 'advanced']
    }
  };
  
  /**
   * Deduplicate properties based on name and display conditions
   */
  static deduplicateProperties(properties: any[]): any[] {
    const seen = new Map<string, any>();
    
    return properties.filter(prop => {
      // Skip null/undefined properties
      if (!prop || !prop.name) {
        return false;
      }
      
      // Create unique key from name + conditions
      const conditions = JSON.stringify(prop.displayOptions || {});
      const key = `${prop.name}_${conditions}`;
      
      if (seen.has(key)) {
        return false; // Skip duplicate
      }
      
      seen.set(key, prop);
      return true;
    });
  }
  
  /**
   * Get essential properties for a node type
   */
  static getEssentials(allProperties: any[], nodeType: string): FilteredProperties {
    // Handle null/undefined properties
    if (!allProperties) {
      return { required: [], common: [] };
    }
    
    // Deduplicate first
    const uniqueProperties = this.deduplicateProperties(allProperties);
    const config = this.ESSENTIAL_PROPERTIES[nodeType];
    
    if (!config) {
      // Fallback for unconfigured nodes
      return this.inferEssentials(uniqueProperties);
    }
    
    // Extract required properties
    const required = this.extractProperties(uniqueProperties, config.required, true);
    
    // Extract common properties (excluding any already in required)
    const requiredNames = new Set(required.map(p => p.name));
    const common = this.extractProperties(uniqueProperties, config.common, false)
      .filter(p => !requiredNames.has(p.name));
    
    return { required, common };
  }
  
  /**
   * Extract and simplify specified properties
   */
  private static extractProperties(
    allProperties: any[], 
    propertyNames: string[], 
    markAsRequired: boolean
  ): SimplifiedProperty[] {
    const extracted: SimplifiedProperty[] = [];
    
    for (const name of propertyNames) {
      const property = this.findPropertyByName(allProperties, name);
      if (property) {
        const simplified = this.simplifyProperty(property);
        if (markAsRequired) {
          simplified.required = true;
        }
        extracted.push(simplified);
      }
    }
    
    return extracted;
  }
  
  /**
   * Find a property by name, including in nested collections
   */
  private static findPropertyByName(properties: any[], name: string): any | undefined {
    for (const prop of properties) {
      if (prop.name === name) {
        return prop;
      }
      
      // Check in nested collections
      if (prop.type === 'collection' && prop.options) {
        const found = this.findPropertyByName(prop.options, name);
        if (found) return found;
      }
      
      // Check in fixed collections
      if (prop.type === 'fixedCollection' && prop.options) {
        for (const option of prop.options) {
          if (option.values) {
            const found = this.findPropertyByName(option.values, name);
            if (found) return found;
          }
        }
      }
    }
    
    return undefined;
  }
  
  /**
   * Simplify a property for AI consumption
   */
  private static simplifyProperty(prop: any): SimplifiedProperty {
    const simplified: SimplifiedProperty = {
      name: prop.name,
      displayName: prop.displayName || prop.name,
      type: prop.type || 'string', // Default to string if no type specified
      description: this.extractDescription(prop),
      required: prop.required || false
    };
    
    // Include default value if it's simple
    if (prop.default !== undefined && 
        typeof prop.default !== 'object' || 
        prop.type === 'options' || 
        prop.type === 'multiOptions') {
      simplified.default = prop.default;
    }
    
    // Include placeholder
    if (prop.placeholder) {
      simplified.placeholder = prop.placeholder;
    }
    
    // Simplify options for select fields
    if (prop.options && Array.isArray(prop.options)) {
      // Limit options to first 20 for better usability
      const limitedOptions = prop.options.slice(0, 20);
      simplified.options = limitedOptions.map((opt: any) => {
        if (typeof opt === 'string') {
          return { value: opt, label: opt };
        }
        return {
          value: opt.value || opt.name,
          label: opt.name || opt.value || opt.displayName
        };
      });
    }

    // Add expectedFormat for resource-locator shaped types - critical for correct
    // configuration. agentSelector (n8n 2.31) carries the same shape.
    if (prop.type === 'resourceLocator' || prop.type === 'agentSelector') {
      const modes = prop.modes?.map((m: any) => m.name || m) || ['list', 'id'];
      const defaultValue = prop.default?.value || 'your-resource-id';
      simplified.expectedFormat = {
        structure: { mode: 'string', value: 'string' },
        modes,
        example: { mode: 'id', value: defaultValue }
      };
    }

    // Include simple display conditions (max 2 conditions)
    if (prop.displayOptions?.show) {
      const conditions = Object.keys(prop.displayOptions.show);
      if (conditions.length <= 2) {
        simplified.showWhen = prop.displayOptions.show;
      }
    }

    const dynamic = PropertyFilter.extractDynamicOptions(prop);
    if (dynamic) simplified.dynamicOptions = dynamic;

    // Add usage hints based on property characteristics
    simplified.usageHint = this.generateUsageHint(prop);

    return simplified;
  }

  /**
   * Detect properties whose options are resolved at runtime rather than
   * enumerated statically (loadOptions methods or resource-locator list search).
   *
   * Precedence: a `loadOptionsMethod` on the property itself wins over a
   * resource-locator mode's `searchListMethod`. A property carrying both is
   * a plain options field that also happens to offer a list-search mode, and
   * the property-level method is the one that fills the field. Only one
   * dynamic source is reported, so the caller has a single method to call.
   *
   * `dependsOn` merges the property-level and mode-level dependency lists and
   * de-duplicates them: the two commonly name the same parent field.
   */
  private static extractDynamicOptions(prop: any): SimplifiedProperty['dynamicOptions'] | undefined {
    const dependsOn = (o: any): string[] => Array.isArray(o?.loadOptionsDependsOn) ? o.loadOptionsDependsOn.map(String) : [];
    const method = prop?.typeOptions?.loadOptionsMethod;
    if (typeof method === 'string' && method) {
      return { methodName: method, methodType: 'loadOptions', dependsOn: dependsOn(prop.typeOptions) };
    }
    if (Array.isArray(prop?.modes)) {
      const mode = prop.modes.find((m: any) => typeof m?.typeOptions?.searchListMethod === 'string');
      if (mode) {
        return {
          methodName: mode.typeOptions.searchListMethod,
          methodType: 'listSearch',
          dependsOn: [...new Set([...dependsOn(prop.typeOptions), ...dependsOn(mode.typeOptions)])]
        };
      }
    }
    return undefined;
  }

  /**
   * Generate helpful usage hints for properties
   */
  private static generateUsageHint(prop: any): string | undefined {
    // URL properties
    if (prop.name.toLowerCase().includes('url') || prop.name === 'endpoint') {
      return 'Enter the full URL including https://';
    }
    
    // Authentication properties
    if (prop.name.includes('auth') || prop.name.includes('credential')) {
      return 'Select authentication method or credentials';
    }
    
    // JSON properties
    if (prop.type === 'json' || prop.name.includes('json')) {
      return 'Enter valid JSON data';
    }
    
    // Code properties
    if (prop.type === 'code' || prop.name.includes('code')) {
      return 'Enter your code here';
    }
    
    // Boolean with specific behaviors
    if (prop.type === 'boolean' && prop.displayOptions) {
      return 'Enabling this will show additional options';
    }
    
    return undefined;
  }
  
  /**
   * Extract description from various possible fields
   */
  private static extractDescription(prop: any): string {
    // Try multiple fields where description might be stored
    const description = prop.description || 
                       prop.hint || 
                       prop.placeholder || 
                       prop.displayName ||
                       '';
    
    // If still empty, generate based on property characteristics
    if (!description) {
      return this.generateDescription(prop);
    }
    
    return description;
  }
  
  /**
   * Generate a description based on property characteristics
   */
  private static generateDescription(prop: any): string {
    const name = prop.name.toLowerCase();
    const type = prop.type;
    
    // Common property descriptions
    const commonDescriptions: Record<string, string> = {
      'url': 'The URL to make the request to',
      'method': 'HTTP method to use for the request',
      'authentication': 'Authentication method to use',
      'sendbody': 'Whether to send a request body',
      'contenttype': 'Content type of the request body',
      'sendheaders': 'Whether to send custom headers',
      'jsonbody': 'JSON data to send in the request body',
      'headers': 'Custom headers to send with the request',
      'timeout': 'Request timeout in milliseconds',
      'query': 'SQL query to execute',
      'table': 'Database table name',
      'operation': 'Operation to perform',
      'path': 'Webhook path or file path',
      'httpmethod': 'HTTP method to accept',
      'responsemode': 'How to respond to the webhook',
      'responsecode': 'HTTP response code to return',
      'channel': 'Slack channel to send message to',
      'text': 'Text content of the message',
      'subject': 'Email subject line',
      'fromemail': 'Sender email address',
      'toemail': 'Recipient email address',
      'language': 'Programming language to use',
      'jscode': 'JavaScript code to execute',
      'pythoncode': 'Python code to execute'
    };
    
    // Check for exact match
    if (commonDescriptions[name]) {
      return commonDescriptions[name];
    }
    
    // Check for partial matches
    for (const [key, desc] of Object.entries(commonDescriptions)) {
      if (name.includes(key)) {
        return desc;
      }
    }
    
    // Type-based descriptions
    if (type === 'boolean') {
      return `Enable or disable ${prop.displayName || name}`;
    } else if (type === 'options') {
      return `Select ${prop.displayName || name}`;
    } else if (type === 'string') {
      return `Enter ${prop.displayName || name}`;
    } else if (type === 'number') {
      return `Number value for ${prop.displayName || name}`;
    } else if (type === 'json') {
      return `JSON data for ${prop.displayName || name}`;
    }
    
    return `Configure ${prop.displayName || name}`;
  }
  
  /**
   * Infer essentials for nodes without curated lists
   */
  private static inferEssentials(properties: any[]): FilteredProperties {
    // Extract explicitly required properties (limit to prevent huge results)
    const required = properties
      .filter(p => p.name && p.required === true)
      .slice(0, 10) // Limit required properties
      .map(p => this.simplifyProperty(p));
    
    // Find common properties (simple, always visible, at root level)
    const common = properties
      .filter(p => {
        return p.name && // Ensure property has a name
               !p.required && 
               !p.displayOptions && 
               p.type !== 'hidden' && // Filter out hidden properties
               p.type !== 'notice' &&  // Filter out notice properties
               !p.name.startsWith('options') &&
               !p.name.startsWith('_'); // Filter out internal properties
      })
      .slice(0, 10) // Take first 10 simple properties
      .map(p => this.simplifyProperty(p));
    
    // If we have very few properties, include some conditional ones
    if (required.length + common.length < 10) {
      const additional = properties
        .filter(p => {
          return p.name && // Ensure property has a name
                 !p.required &&
                 p.type !== 'hidden' && // Filter out hidden properties
                 p.displayOptions &&
                 Object.keys(p.displayOptions.show || {}).length === 1;
        })
        .slice(0, 10 - (required.length + common.length))
        .map(p => this.simplifyProperty(p));
      
      common.push(...additional);
    }
    
    // Total should not exceed 30 properties
    const totalLimit = 30;
    if (required.length + common.length > totalLimit) {
      // Prioritize required properties
      const requiredCount = Math.min(required.length, 15);
      const commonCount = totalLimit - requiredCount;
      return {
        required: required.slice(0, requiredCount),
        common: common.slice(0, commonCount)
      };
    }
    
    return { required, common };
  }
  
  /**
   * Search for properties matching a query
   */
  static searchProperties(
    allProperties: any[], 
    query: string,
    maxResults: number = 20
  ): SimplifiedProperty[] {
    // Return empty array for empty query
    if (!query || query.trim() === '') {
      return [];
    }
    
    const lowerQuery = query.toLowerCase();
    const matches: Array<{ property: any; score: number; path: string }> = [];
    
    this.searchPropertiesRecursive(allProperties, lowerQuery, matches);
    
    // Sort by score and return top results
    return matches
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults)
      .map(match => ({
        ...this.simplifyProperty(match.property),
        path: match.path
      } as SimplifiedProperty & { path: string }));
  }
  
  /**
   * Recursively search properties including nested ones
   */
  private static searchPropertiesRecursive(
    properties: any[],
    query: string,
    matches: Array<{ property: any; score: number; path: string }>,
    path: string = ''
  ): void {
    for (const prop of properties) {
      const currentPath = path ? `${path}.${prop.name}` : prop.name;
      let score = 0;
      
      // Check name match
      if (prop.name.toLowerCase() === query) {
        score = 10; // Exact match
      } else if (prop.name.toLowerCase().startsWith(query)) {
        score = 8; // Prefix match
      } else if (prop.name.toLowerCase().includes(query)) {
        score = 5; // Contains match
      }
      
      // Check display name match
      if (prop.displayName?.toLowerCase().includes(query)) {
        score = Math.max(score, 4);
      }
      
      // Check description match
      if (prop.description?.toLowerCase().includes(query)) {
        score = Math.max(score, 3);
      }
      
      if (score > 0) {
        matches.push({ property: prop, score, path: currentPath });
      }
      
      // Search nested properties
      if (prop.type === 'collection' && prop.options) {
        this.searchPropertiesRecursive(prop.options, query, matches, currentPath);
      } else if (prop.type === 'fixedCollection' && prop.options) {
        for (const option of prop.options) {
          if (option.values) {
            this.searchPropertiesRecursive(
              option.values, 
              query, 
              matches, 
              `${currentPath}.${option.name}`
            );
          }
        }
      }
    }
  }
}