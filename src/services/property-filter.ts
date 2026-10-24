/**
 * PropertyFilter Service
 * 
 * Intelligently filters node properties to return only essential and commonly-used ones.
 * Reduces property count from 200+ to 10-20 for better AI agent usability.
 */

import { filterPropertiesForVersion } from '../parsers/version-display-gate';
import { parseTypeVersion } from '../utils/typeversion';

/** Set on a child of a merged options collection that applies to some modes only. */
const APPLIES_WHEN = Symbol('appliesWhen');

export interface SimplifiedProperty {
  name: string;
  displayName: string;
  type: string;
  description: string;
  default?: any;
  /**
   * Choices of an options field, or the child settings of a collection /
   * fixedCollection. Child settings carry a one-line `description`.
   */
  options?: Array<{ value: string; label: string; description?: string }>;
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
      common: ['method', 'authentication', 'sendQuery', 'sendHeaders', 'sendBody', 'contentType', 'specifyBody', 'jsonBody', 'options'],
      categoryPriority: ['basic', 'authentication', 'request', 'response', 'advanced']
    },
    
    // Webhook - Entry point for many workflows
    'nodes-base.webhook': {
      required: [],
      common: ['httpMethod', 'path', 'authentication', 'responseMode', 'responseData', 'options'],
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
      common: ['mode', 'assignments', 'jsonOutput', 'includeOtherFields', 'include', 'options'],
      categoryPriority: ['basic', 'data', 'advanced']
    },
    
    // If - Conditional logic
    'nodes-base.if': {
      required: [],
      common: ['conditions', 'looseTypeValidation', 'options'],
      categoryPriority: ['basic', 'conditions', 'advanced']
    },
    
    // PostgreSQL - Database operations
    'nodes-base.postgres': {
      required: [],
      common: ['operation', 'schema', 'table', 'query', 'columns', 'where', 'returnAll', 'options'],
      categoryPriority: ['basic', 'query', 'options', 'advanced']
    },
    
    // OpenAI - AI operations
    'nodes-base.openAi': {
      required: [],
      common: ['resource', 'operation', 'chatModel', 'model', 'prompt', 'options'],
      categoryPriority: ['basic', 'model', 'input', 'options', 'advanced']
    },
    
    // Google Sheets - Spreadsheet operations
    'nodes-base.googleSheets': {
      required: [],
      common: ['operation', 'documentId', 'sheetName', 'columns', 'filtersUI', 'options'],
      categoryPriority: ['basic', 'location', 'data', 'options', 'advanced']
    },
    
    // Slack - Messaging
    'nodes-base.slack': {
      required: [],
      common: ['resource', 'operation', 'channelId', 'text', 'attachments', 'blocksUi'],
      categoryPriority: ['basic', 'message', 'formatting', 'advanced']
    },
    
    // Send Email - Email operations
    'nodes-base.emailSend': {
      required: [],
      common: ['operation', 'fromEmail', 'toEmail', 'subject', 'emailFormat', 'text', 'html', 'options'],
      categoryPriority: ['basic', 'recipients', 'content', 'advanced']
    },
    
    // Merge - Combining data streams
    'nodes-base.merge': {
      required: [],
      common: ['mode', 'combineBy', 'fieldsToMatchString', 'joinMode', 'outputDataFrom', 'numberInputs', 'options'],
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
      common: ['operation', 'table', 'query', 'dataMode', 'valuesToSend', 'where', 'options'],
      categoryPriority: ['basic', 'query', 'options', 'advanced']
    },
    
    // FTP - File transfer
    'nodes-base.ftp': {
      required: [],
      common: ['protocol', 'operation', 'path', 'binaryData', 'binaryPropertyName', 'options'],
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
      common: ['command', 'executeOnce'],
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
  static getEssentials(allProperties: any[], nodeType: string, version?: string | number): FilteredProperties {
    // Handle null/undefined properties
    if (!allProperties) {
      return { required: [], common: [] };
    }
    
    // The stored schema covers every typeVersion; keep only what `version` shows.
    // A version that does not parse leaves the schema and its gates as they are.
    const numericVersion = parseTypeVersion(version);
    const versioned = numericVersion === null
      ? allProperties
      : this.resolveVersionGates(allProperties, numericVersion);
    const uniqueProperties = this.mergeOptionsCollections(this.deduplicateProperties(versioned));
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
   * Keep the properties shown at `version` and drop the resolved `@version`
   * gates from the top-level display conditions, so a property that is always
   * visible at that version is treated as unconditional.
   */
  private static resolveVersionGates(properties: any[], version: number): any[] {
    return filterPropertiesForVersion(properties, version).map(prop => {
      const display = prop?.displayOptions;
      if (!display || (display.show?.['@version'] === undefined && display.hide?.['@version'] === undefined)) {
        return prop;
      }
      const strip = (conditions: Record<string, any> | undefined) => {
        if (!conditions) return undefined;
        const { '@version': _resolved, ...rest } = conditions;
        return Object.keys(rest).length > 0 ? rest : undefined;
      };
      const show = strip(display.show);
      const hide = strip(display.hide);
      const displayOptions = show || hide ? { ...(show && { show }), ...(hide && { hide }) } : undefined;
      return { ...prop, displayOptions };
    });
  }

  /**
   * Nodes often declare one `options` collection per operation or mode. Merge the
   * top-level `options` collections into the first one, so the agent sees every
   * available setting once. Other per-operation collections (additionalFields,
   * updateFields, ...) stay separate: their union would mix unrelated operations.
   * Display conditions are kept only when all merged collections share them;
   * otherwise a child that is not in every collection records the conditions
   * under which it applies.
   */
  private static mergeOptionsCollections(properties: any[]): any[] {
    const isOptionsCollection = (prop: any) => prop?.type === 'collection' && prop.name === 'options';
    const collections = properties.filter(prop => isOptionsCollection(prop) && Array.isArray(prop.options));
    if (collections.length < 2) return properties;

    const first = properties.find(isOptionsCollection);
    const conditions = JSON.stringify(first.displayOptions ?? null);
    const shared = collections.every(c => JSON.stringify(c.displayOptions ?? null) === conditions);

    // child variant -> its first definition and the collections that contain it
    const byName = new Map<string, { child: any; parents: Set<any> }>();
    for (const collection of collections) {
      for (const child of collection.options) {
        if (!child?.name) continue;
        const key = this.variantKey(child);
        const entry = byName.get(key) ?? { child, parents: new Set<any>() };
        entry.parents.add(collection);
        byName.set(key, entry);
      }
    }

    const children = [...byName.values()].map(({ child, parents }) => {
      if (shared || parents.size === collections.length) return child;
      const appliesWhen = this.describeConditions([...parents].map(parent => parent.displayOptions));
      return appliesWhen ? { ...child, [APPLIES_WHEN]: appliesWhen } : child;
    });
    const merged = { ...first, options: children, displayOptions: shared ? first.displayOptions : undefined };

    // The merged collection takes the place of the first one; the others are dropped
    return properties.flatMap(prop => {
      if (!isOptionsCollection(prop)) return [prop];
      return prop === first ? [merged] : [];
    });
  }

  /**
   * Render several display rules as one short phrase, e.g.
   * `operation=formatDate|getCurrentDate`. Plain `show` rules with the same keys
   * are folded into one clause; otherwise each rule is rendered and the rules are
   * joined with "or". `hide` conditions become "not ..." and `_cnd` operators are
   * written out ("queryReplacement is set", "limit>=10"). Returns undefined when
   * any rule has no conditions (always shown). `@version` gates are left out:
   * they are resolved when a version is known.
   */
  private static describeConditions(rules: any[]): string | undefined {
    const parsed = rules.map(rule => ({
      show: this.withoutVersionGate(rule?.show),
      hide: this.withoutVersionGate(rule?.hide)
    }));
    if (parsed.some(rule => Object.keys(rule.show).length === 0 && Object.keys(rule.hide).length === 0)) {
      return undefined;
    }

    const key = (show: Record<string, unknown[]>) => Object.keys(show).sort().join(',');
    // Folding fields independently is only exact when the rules differ in one field:
    // {resource: chat, operation: complete} + {resource: text, operation: edit}
    // must not become resource=chat|text & operation=complete|edit.
    const differingFields = Object.keys(parsed[0].show).filter(name =>
      new Set(parsed.map(rule => JSON.stringify([...new Set((rule.show[name] ?? []).map(String))].sort()))).size > 1
    );
    const foldable = differingFields.length <= 1 && parsed.every(rule =>
      Object.keys(rule.hide).length === 0 &&
      key(rule.show) === key(parsed[0].show) &&
      Object.values(rule.show).flat().every(value => !this.isOperatorCondition(value))
    );
    if (foldable) {
      const folded: Record<string, unknown[]> = {};
      for (const { show } of parsed) {
        for (const [name, values] of Object.entries(show)) folded[name] = (folded[name] ?? []).concat(values);
      }
      return this.describeRule(folded, {});
    }
    return parsed.map(rule => this.describeRule(rule.show, rule.hide)).join(' or ');
  }

  private static withoutVersionGate(conditions: unknown): Record<string, unknown[]> {
    if (!conditions || typeof conditions !== 'object') return {};
    const { '@version': _gate, ...rest } = conditions as Record<string, unknown>;
    return Object.fromEntries(Object.entries(rest).map(([name, values]) => [name, ([] as unknown[]).concat(values)]));
  }

  private static describeRule(show: Record<string, unknown[]>, hide: Record<string, unknown[]>): string {
    const shown = Object.keys(show).sort().map(name => this.describeField(name, show[name]));
    const hidden = Object.keys(hide).sort().map(name => `not ${this.describeField(name, hide[name])}`);
    return [...shown, ...hidden].join(' & ');
  }

  /** `name=a|b`, or the written-out operator for `_cnd` conditions. */
  private static describeField(rawName: string, values: unknown[]): string {
    const name = rawName.replace(/^\//, '');
    const plain = [...new Set(values
      .filter(value => !this.isOperatorCondition(value))
      .map(value => (value === '' ? '""' : String(value))))];
    const parts = plain.length > 0 ? [`${name}=${plain.join('|')}`] : [];
    for (const value of values) {
      if (this.isOperatorCondition(value)) parts.push(this.describeOperator(name, (value as any)._cnd));
    }
    return parts.length > 1 ? `(${parts.join(' or ')})` : parts[0] ?? name;
  }

  private static isOperatorCondition(value: unknown): boolean {
    return typeof value === 'object' && value !== null && '_cnd' in value;
  }

  private static describeOperator(name: string, condition: Record<string, any>): string {
    const [operator, target] = Object.entries(condition ?? {})[0] ?? [];
    switch (operator) {
      case 'exists': return `${name} is set`;
      case 'eq': return `${name}=${target}`;
      case 'not': return `${name}!=${target}`;
      case 'gte': return `${name}>=${target}`;
      case 'lte': return `${name}<=${target}`;
      case 'gt': return `${name}>${target}`;
      case 'lt': return `${name}<${target}`;
      case 'between': return `${name} between ${target?.from} and ${target?.to}`;
      case 'startsWith': return `${name} starts with ${target}`;
      case 'endsWith': return `${name} ends with ${target}`;
      case 'includes': return `${name} contains ${target}`;
      case 'regex': return `${name} matches ${target}`;
      default: return `${name} ${operator ?? 'condition'} ${JSON.stringify(target)}`;
    }
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
    
    let truncationNote: string | undefined;
    if ((prop.type === 'collection' || prop.type === 'fixedCollection') && Array.isArray(prop.options)) {
      // Child settings: name plus one line each, no deeper nesting
      simplified.options = this.summarizeChildren(prop);
      const total = this.uniqueVariants(prop.options).length;
      if (total > simplified.options.length) {
        truncationNote = `Lists ${simplified.options.length} of ${total} settings. ` +
          'get_node with mode "search_properties" or detail "full" shows the rest.';
      }
    } else if (prop.options && Array.isArray(prop.options)) {
      // Simplify options for select fields
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
    simplified.usageHint = truncationNote ?? this.generateUsageHint(prop);

    return simplified;
  }

  private static readonly MAX_CHILD_SETTINGS = 25;
  private static readonly MAX_NESTED_NAMES = 12;
  private static readonly MAX_INLINE_VALUES = 8;
  private static readonly MAX_LINE_DESCRIPTION = 120;

  /**
   * List the child settings of a collection (its properties) or a fixedCollection
   * (its groups) as name, label and one line. The line holds the first sentence of
   * the description, followed by the names of nested fields for a nested
   * collection or group, and the allowed values for an options field.
   */
  private static summarizeChildren(prop: any): Array<{ value: string; label: string; description?: string }> {
    return this.uniqueVariants(prop.options)
      .slice(0, this.MAX_CHILD_SETTINGS)
      .map((child: any) => {
        const line = this.oneLine(child);
        return {
          value: String(child.name),
          label: String(child.displayName || child.name),
          ...(line && { description: line })
        };
      });
  }

  private static oneLine(setting: any): string {
    const parts: string[] = [];
    const text = this.firstSentence(setting.description || setting.hint);
    if (text) parts.push(/[.!?…]$/.test(text) ? text : `${text}.`);

    const nested = this.nestedFields(setting);
    if (nested.length > 0) {
      const shown = nested.slice(0, this.MAX_NESTED_NAMES).map(field => this.fieldLabel(field));
      parts.push(`Fields: ${shown.join(', ')}${nested.length > shown.length ? ', …' : ''}.`);
    }

    const values = this.choiceValues(setting);
    if (values) parts.push(`Values: ${values}.`);

    // The setting's own display condition (e.g. one `size` per model), then the
    // condition of the merged collection it came from
    const conditions = [this.describeConditions([setting.displayOptions]), setting[APPLIES_WHEN]].filter(Boolean);
    if (conditions.length > 0) parts.push(`Only when ${conditions.join(' and ')}.`);

    return parts.join(' ');
  }

  /** Fields one level below a setting: a group's values, a collection's options, or a fixedCollection's group values. */
  private static nestedFields(setting: any): any[] {
    let fields: any[] = [];
    if (Array.isArray(setting.values)) {
      fields = setting.values;
    } else if (setting.type === 'collection' && Array.isArray(setting.options)) {
      fields = setting.options;
    } else if (setting.type === 'fixedCollection' && Array.isArray(setting.options)) {
      fields = setting.options.flatMap((group: any) => Array.isArray(group?.values) ? group.values : []);
    }
    return this.uniqueByName(fields.filter(field => field?.type !== 'notice'));
  }

  /**
   * Identity of a setting: its definition without the wording. The same name can
   * appear once per condition or per definition (DateTime's `timezone` is a string
   * for one operation and a boolean for another).
   */
  private static variantKey(item: any): string {
    const { description: _description, hint: _hint, placeholder: _placeholder, displayName: _displayName, ...shape } = item;
    const seen = new WeakSet<object>();
    return JSON.stringify(shape, (_key, value) => {
      if (typeof value !== 'object' || value === null) return value;
      if (seen.has(value)) return '[seen]'; // schemas from tests can be circular
      seen.add(value);
      return value;
    });
  }

  /** Settings that have a name, keeping the first of each definition. */
  private static uniqueVariants(items: any[]): any[] {
    const seen = new Set<string>();
    return items.filter(item => {
      if (!item?.name) return false;
      const key = this.variantKey(item);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  /** Items that have a name, keeping the first item of each name. */
  private static uniqueByName(items: any[]): any[] {
    const seen = new Set<string>();
    return items.filter(item => {
      if (!item?.name || seen.has(item.name)) return false;
      seen.add(item.name);
      return true;
    });
  }

  private static fieldLabel(field: any): string {
    const values = this.choiceValues(field);
    return values ? `${field.name} (${values})` : String(field.name);
  }

  private static choiceValues(field: any): string | undefined {
    if ((field.type !== 'options' && field.type !== 'multiOptions') || !Array.isArray(field.options)) return undefined;
    const values = field.options
      .map((option: any) => (typeof option === 'object' && option !== null ? option.value ?? option.name : option))
      .filter((value: unknown) => value !== undefined && value !== null && value !== '')
      .map((value: unknown) => {
        const text = String(value);
        // Quote values such as ", " or a newline so the line stays readable
        return /^[\w.@/:-]+$/.test(text) ? text : JSON.stringify(text);
      });
    if (values.length === 0) return undefined;
    const shown = values.slice(0, this.MAX_INLINE_VALUES);
    return shown.join('|') + (values.length > shown.length ? '|…' : '');
  }

  private static firstSentence(text: unknown): string {
    if (typeof text !== 'string') return '';
    // Strip HTML tags until none are left: one pass can leave a tag behind ("<<b>b>")
    let stripped = text;
    let previous: string;
    do {
      previous = stripped;
      stripped = stripped.replace(/<[^<>]*>/g, '');
    } while (stripped !== previous);
    const plain = stripped.replace(/\s+/g, ' ').trim();
    if (!plain) return '';
    // A sentence ends at . ! or ? before a space, except after "e.g", "i.e" and similar
    const sentence = plain.match(/^.*?(?<!\b(?:e\.g|i\.e|etc|vs|approx|incl))[.!?](?=\s|$)/i)?.[0] ?? plain;
    return sentence.length > this.MAX_LINE_DESCRIPTION
      ? `${sentence.slice(0, this.MAX_LINE_DESCRIPTION - 1).trimEnd()}…`
      : sentence;
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
                 p.type !== 'notice' &&
                 !p.name.startsWith('options') &&
                 p.displayOptions &&
                 Object.keys(p.displayOptions.show || {}).length === 1;
        })
        .slice(0, 10 - (required.length + common.length))
        .map(p => this.simplifyProperty(p));

      common.push(...additional);
    }

    // The `options` collection of a transform or utility node holds many of its
    // lesser-known features (dedupe scope, output format, raw body, ...). List it
    // last, child names with one line each, whatever its display conditions.
    // Service nodes with a `resource` selector are skipped: their options differ
    // per resource and operation, and the merged list would mostly be noise.
    const optionsCollection = properties.find(p => p.name === 'options' && p.type === 'collection');
    const isResourceBased = properties.some(p => p.name === 'resource');
    if (optionsCollection && !isResourceBased) {
      common.push(this.simplifyProperty(optionsCollection));
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