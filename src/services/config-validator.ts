/**
 * Configuration Validator Service
 *
 * Validates node configurations to catch errors before execution.
 * Provides helpful suggestions and identifies missing or misconfigured properties.
 */

import { shouldSkipLiteralValidation } from '../utils/expression-utils.js';

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
  suggestions: string[];
  visibleProperties: string[];
  hiddenProperties: string[];
  autofix?: Record<string, any>;
}

export interface ValidationError {
  type: 'missing_required' | 'invalid_type' | 'invalid_value' | 'incompatible' | 'invalid_configuration' | 'syntax_error';
  property: string;
  message: string;
  fix?: string;
  suggestion?: string;
}

export interface ValidationWarning {
  type: 'missing_common' | 'deprecated' | 'inefficient' | 'security' | 'best_practice' | 'invalid_value';
  property?: string;
  message: string;
  suggestion?: string;
}

export class ConfigValidator {
  /**
   * UI-only property types that should not be validated as configuration
   */
  private static readonly UI_ONLY_TYPES = ['notice', 'callout', 'infoBox', 'info'];

  /**
   * Validate a node configuration
   */
  static validate(
    nodeType: string,
    config: Record<string, any>,
    properties: any[],
    userProvidedKeys?: Set<string> // NEW: Track user-provided properties to avoid warning about defaults
  ): ValidationResult {
    // Input validation
    if (!config || typeof config !== 'object') {
      throw new TypeError('Config must be a non-null object');
    }
    if (!properties || !Array.isArray(properties)) {
      throw new TypeError('Properties must be a non-null array');
    }

    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];
    const suggestions: string[] = [];
    const visibleProperties: string[] = [];
    const hiddenProperties: string[] = [];
    const autofix: Record<string, any> = {};
    
    // Check required properties
    this.checkRequiredProperties(properties, config, errors);
    
    // Check property visibility
    const { visible, hidden } = this.getPropertyVisibility(properties, config);
    visibleProperties.push(...visible);
    hiddenProperties.push(...hidden);
    
    // Validate property types and values
    this.validatePropertyTypes(properties, config, errors);
    
    // Node-specific validations
    this.performNodeSpecificValidation(nodeType, config, errors, warnings, suggestions, autofix);
    
    // Check for common issues
    this.checkCommonIssues(nodeType, config, properties, warnings, suggestions, userProvidedKeys);

    // Security checks
    this.performSecurityChecks(nodeType, config, warnings);
    
    return {
      valid: errors.length === 0,
      errors,
      warnings,
      suggestions,
      visibleProperties,
      hiddenProperties,
      autofix: Object.keys(autofix).length > 0 ? autofix : undefined
    };
  }

  /**
   * Validate multiple node configurations in batch
   * Useful for validating entire workflows or multiple nodes at once
   * 
   * @param configs - Array of configurations to validate
   * @returns Array of validation results in the same order as input
   */
  static validateBatch(
    configs: Array<{
      nodeType: string;
      config: Record<string, any>;
      properties: any[];
    }>
  ): ValidationResult[] {
    return configs.map(({ nodeType, config, properties }) => 
      this.validate(nodeType, config, properties)
    );
  }
  
  /**
   * Check for missing required properties
   */
  private static checkRequiredProperties(
    properties: any[],
    config: Record<string, any>,
    errors: ValidationError[]
  ): void {
    for (const prop of properties) {
      if (!prop || !prop.name) continue; // Skip invalid properties

      if (prop.required) {
        const value = config[prop.name];

        // Check if property is missing or has null/undefined value
        if (!(prop.name in config)) {
          errors.push({
            type: 'missing_required',
            property: prop.name,
            message: `Required property '${prop.displayName || prop.name}' is missing`,
            fix: `Add ${prop.name} to your configuration`
          });
        } else if (value === null || value === undefined) {
          errors.push({
            type: 'invalid_type',
            property: prop.name,
            message: `Required property '${prop.displayName || prop.name}' cannot be null or undefined`,
            fix: `Provide a valid value for ${prop.name}`
          });
        } else if (typeof value === 'string' && value.trim() === '') {
          // Check for empty strings which are invalid for required string properties
          errors.push({
            type: 'missing_required',
            property: prop.name,
            message: `Required property '${prop.displayName || prop.name}' cannot be empty`,
            fix: `Provide a valid value for ${prop.name}`
          });
        }
      }
    }
  }
  
  /**
   * Get visible and hidden properties based on displayOptions
   */
  private static getPropertyVisibility(
    properties: any[], 
    config: Record<string, any>
  ): { visible: string[]; hidden: string[] } {
    const visible: string[] = [];
    const hidden: string[] = [];
    
    for (const prop of properties) {
      if (this.isPropertyVisible(prop, config)) {
        visible.push(prop.name);
      } else {
        hidden.push(prop.name);
      }
    }
    
    return { visible, hidden };
  }
  
  /**
   * Evaluate a single _cnd conditional operator from n8n displayOptions.
   * Supports: eq, not, gte, lte, gt, lt, between, startsWith, endsWith, includes, regex, exists
   */
  private static evaluateCondition(
    condition: { _cnd: Record<string, any> },
    configValue: any
  ): boolean {
    const cnd = condition._cnd;

    if ('eq' in cnd) return configValue === cnd.eq;
    if ('not' in cnd) return configValue !== cnd.not;
    if ('gte' in cnd) return configValue >= cnd.gte;
    if ('lte' in cnd) return configValue <= cnd.lte;
    if ('gt' in cnd) return configValue > cnd.gt;
    if ('lt' in cnd) return configValue < cnd.lt;
    if ('between' in cnd) {
      const between = cnd.between;
      if (!between || typeof between.from === 'undefined' || typeof between.to === 'undefined') {
        return false; // Invalid between structure
      }
      return configValue >= between.from && configValue <= between.to;
    }
    if ('startsWith' in cnd) {
      return typeof configValue === 'string' && configValue.startsWith(cnd.startsWith);
    }
    if ('endsWith' in cnd) {
      return typeof configValue === 'string' && configValue.endsWith(cnd.endsWith);
    }
    if ('includes' in cnd) {
      return typeof configValue === 'string' && configValue.includes(cnd.includes);
    }
    if ('regex' in cnd) {
      if (typeof configValue !== 'string') return false;
      try {
        return new RegExp(cnd.regex).test(configValue);
      } catch {
        return false; // Invalid regex pattern
      }
    }
    if ('exists' in cnd) {
      return configValue !== undefined && configValue !== null;
    }

    // Unknown operator - default to not matching (conservative)
    return false;
  }

  /**
   * Check if a config value matches an expected value.
   * Handles both plain values and _cnd conditional operators.
   */
  private static valueMatches(expectedValue: any, configValue: any): boolean {
    // Check if this is a _cnd conditional
    if (expectedValue && typeof expectedValue === 'object' && '_cnd' in expectedValue) {
      return this.evaluateCondition(expectedValue, configValue);
    }
    // Plain value comparison
    return configValue === expectedValue;
  }

  /**
   * Check if a property is visible given current config.
   * Supports n8n's _cnd conditional operators in displayOptions.
   */
  public static isPropertyVisible(prop: any, config: Record<string, any>): boolean {
    if (!prop.displayOptions) return true;

    // Check show conditions - property visible only if ALL conditions match
    if (prop.displayOptions.show) {
      for (const [key, values] of Object.entries(prop.displayOptions.show)) {
        const configValue = config[key];
        const expectedValues = Array.isArray(values) ? values : [values];

        // Check if ANY expected value matches (OR logic within a key)
        const anyMatch = expectedValues.some(expected =>
          this.valueMatches(expected, configValue)
        );

        if (!anyMatch) {
          return false;
        }
      }
    }

    // Check hide conditions - property hidden if ANY condition matches
    if (prop.displayOptions.hide) {
      for (const [key, values] of Object.entries(prop.displayOptions.hide)) {
        const configValue = config[key];
        const expectedValues = Array.isArray(values) ? values : [values];

        // Check if ANY expected value matches (property should be hidden)
        const anyMatch = expectedValues.some(expected =>
          this.valueMatches(expected, configValue)
        );

        if (anyMatch) {
          return false;
        }
      }
    }

    return true;
  }
  
  /**
   * Validate property types and values
   */
  private static validatePropertyTypes(
    properties: any[], 
    config: Record<string, any>, 
    errors: ValidationError[]
  ): void {
    for (const [key, value] of Object.entries(config)) {
      const candidates = properties.filter(p => p && p.name === key);
      if (candidates.length === 0) continue;

      // Several definitions can share a name (one per resource/operation);
      // validate against the one visible for the current config rather than
      // whichever happens to come first in the schema array.
      const prop = candidates.find(p => this.isPropertyVisible(p, config)) ?? candidates[0];

      // A value equal to a same-named definition's schema default was injected
      // by default resolution rather than set by the user; type-checking it
      // against a different variant's type produces false errors.
      if (candidates.some(p => 'default' in p && JSON.stringify(value) === JSON.stringify(p.default))) {
        continue;
      }

      // Type validation
      if (prop.type === 'string' && typeof value !== 'string') {
        errors.push({
          type: 'invalid_type',
          property: key,
          message: `Property '${key}' must be a string, got ${typeof value}`,
          fix: `Change ${key} to a string value`
        });
      } else if (prop.type === 'number' && typeof value !== 'number') {
        errors.push({
          type: 'invalid_type',
          property: key,
          message: `Property '${key}' must be a number, got ${typeof value}`,
          fix: `Change ${key} to a number`
        });
      } else if (prop.type === 'boolean' && typeof value !== 'boolean') {
        errors.push({
          type: 'invalid_type',
          property: key,
          message: `Property '${key}' must be a boolean, got ${typeof value}`,
          fix: `Change ${key} to true or false`
        });
      } else if (prop.type === 'resourceLocator') {
        // resourceLocator validation: Used by AI model nodes (OpenAI, Anthropic, etc.)
        // Must be an object with required properties:
        //   - mode: string ('list' | 'id' | 'url')
        //   - value: any (the actual model/resource identifier)
        // Common mistake: passing string directly instead of object structure
        if (typeof value !== 'object' || value === null || Array.isArray(value)) {
          const fixValue = typeof value === 'string' ? value : JSON.stringify(value);
          errors.push({
            type: 'invalid_type',
            property: key,
            message: `Property '${key}' is a resourceLocator and must be an object with 'mode' and 'value' properties, got ${typeof value}`,
            fix: `Change ${key} to { mode: "list", value: ${JSON.stringify(fixValue)} } or { mode: "id", value: ${JSON.stringify(fixValue)} }`
          });
        } else {
          // Check required properties. An empty-string mode is a UI-persisted
          // artifact that n8n tolerates (the value/expression still resolves),
          // so only undefined/null count as a missing mode.
          if (value.mode === undefined || value.mode === null) {
            errors.push({
              type: 'missing_required',
              property: `${key}.mode`,
              message: `resourceLocator '${key}' is missing required property 'mode'`,
              fix: `Add mode property: { mode: "list", value: ${JSON.stringify(value.value || '')} }`
            });
          } else if (typeof value.mode !== 'string') {
            errors.push({
              type: 'invalid_type',
              property: `${key}.mode`,
              message: `resourceLocator '${key}.mode' must be a string, got ${typeof value.mode}`,
              fix: `Set mode to a valid string value`
            });
          } else if (value.mode !== '' && prop.modes) {
            // Schema-based validation: Check if mode exists in the modes definition
            // In n8n, modes are defined at the top level of resourceLocator properties
            // Modes can be defined in different ways:
            // 1. Array of mode objects: [{name: 'list', ...}, {name: 'id', ...}, {name: 'name', ...}]
            // 2. Object with mode keys: { list: {...}, id: {...}, url: {...}, name: {...} }
            const modes = prop.modes;

            // Validate modes structure before processing to prevent crashes
            if (!modes || typeof modes !== 'object') {
              // Invalid schema structure - skip validation to prevent false positives
              continue;
            }

            let allowedModes: string[] = [];

            if (Array.isArray(modes)) {
              // Array format (most common in n8n): extract name property from each mode object
              allowedModes = modes
                .map(m => (typeof m === 'object' && m !== null) ? m.name : m)
                .filter(m => typeof m === 'string' && m.length > 0);
            } else {
              // Object format: extract keys as mode names
              allowedModes = Object.keys(modes).filter(k => k.length > 0);
            }

            // Only validate if we successfully extracted modes
            if (allowedModes.length > 0 && !allowedModes.includes(value.mode)) {
              errors.push({
                type: 'invalid_value',
                property: `${key}.mode`,
                message: `resourceLocator '${key}.mode' must be one of [${allowedModes.join(', ')}], got '${value.mode}'`,
                fix: `Change mode to one of: ${allowedModes.join(', ')}`
              });
            }
          }
          // If no modes defined at property level, skip mode validation
          // This prevents false positives for nodes with dynamic/runtime-determined modes

          if (value.value === undefined) {
            errors.push({
              type: 'missing_required',
              property: `${key}.value`,
              message: `resourceLocator '${key}' is missing required property 'value'`,
              fix: `Add value property to specify the ${prop.displayName || key}`
            });
          }
        }
      }

      // Options validation
      if (prop.type === 'options' && prop.options) {
        const validValues = prop.options.map((opt: any) =>
          typeof opt === 'string' ? opt : opt.value
        );

        // Expression values resolve at runtime and cannot be enum-checked
        const isExpression = typeof value === 'string' && value.startsWith('=');
        // Dynamic option lists are fetched at runtime; the static list is
        // empty or incomplete, so enum-checking rejects valid values
        const hasDynamicOptions = !!(prop.typeOptions?.loadOptionsMethod || prop.typeOptions?.loadOptions);
        // Legacy Code-node language value that n8n still executes
        // (renamed to pythonNative but kept for backwards compatibility)
        const isLegacyCodeLanguage = key === 'language' && value === 'python' && validValues.includes('pythonNative');

        if (
          validValues.length > 0 &&
          !isExpression &&
          !hasDynamicOptions &&
          !isLegacyCodeLanguage &&
          !validValues.includes(value)
        ) {
          errors.push({
            type: 'invalid_value',
            property: key,
            message: `Invalid value for '${key}'. Must be one of: ${validValues.join(', ')}`,
            fix: `Change ${key} to one of the valid options`
          });
        }
      }
    }
  }
  
  /**
   * Perform node-specific validation
   */
  private static performNodeSpecificValidation(
    nodeType: string,
    config: Record<string, any>,
    errors: ValidationError[],
    warnings: ValidationWarning[],
    suggestions: string[],
    autofix: Record<string, any>
  ): void {
    switch (nodeType) {
      case 'nodes-base.httpRequest':
        this.validateHttpRequest(config, errors, warnings, suggestions, autofix);
        break;
      
      case 'nodes-base.webhook':
        this.validateWebhook(config, warnings, suggestions);
        break;
        
      case 'nodes-base.postgres':
      case 'nodes-base.mysql':
        this.validateDatabase(config, warnings, suggestions);
        break;
        
      case 'nodes-base.code':
        this.validateCode(config, errors, warnings);
        break;
    }
  }
  
  /**
   * Validate HTTP Request configuration
   */
  private static validateHttpRequest(
    config: Record<string, any>,
    errors: ValidationError[],
    warnings: ValidationWarning[],
    suggestions: string[],
    autofix: Record<string, any>
  ): void {
    // URL validation
    if (config.url && typeof config.url === 'string') {
      // Skip validation for expressions - they will be evaluated at runtime
      if (!shouldSkipLiteralValidation(config.url)) {
        if (!config.url.startsWith('http://') && !config.url.startsWith('https://')) {
          errors.push({
            type: 'invalid_value',
            property: 'url',
            message: 'URL must start with http:// or https://',
            fix: 'Add https:// to the beginning of your URL'
          });
        }
      }
    }
    
    // POST/PUT/PATCH without body
    if (['POST', 'PUT', 'PATCH'].includes(config.method) && !config.sendBody) {
      warnings.push({
        type: 'missing_common',
        property: 'sendBody',
        message: `${config.method} requests typically send a body`,
        suggestion: 'Set sendBody=true and configure the body content'
      });
      
      autofix.sendBody = true;
      autofix.contentType = 'json';
    }
    
    // Authentication warnings
    if (!config.authentication || config.authentication === 'none') {
      if (config.url?.includes('api.') || config.url?.includes('/api/')) {
        warnings.push({
          type: 'security',
          message: 'API endpoints typically require authentication',
          suggestion: 'Consider setting authentication if the API requires it'
        });
      }
    }
    
    // JSON body validation
    if (config.sendBody && config.contentType === 'json' && config.jsonBody) {
      // Skip validation for expressions - they will be evaluated at runtime
      if (!shouldSkipLiteralValidation(config.jsonBody)) {
        try {
          JSON.parse(config.jsonBody);
        } catch (e) {
          const errorMsg = e instanceof Error ? e.message : 'Unknown parsing error';
          errors.push({
            type: 'invalid_value',
            property: 'jsonBody',
            message: `jsonBody contains invalid JSON: ${errorMsg}`,
            fix: 'Fix JSON syntax error and ensure valid JSON format'
          });
        }
      }
    }
  }
  
  /**
   * Validate Webhook configuration
   */
  private static validateWebhook(
    config: Record<string, any>,
    warnings: ValidationWarning[],
    suggestions: string[]
  ): void {
    // Basic webhook validation - moved detailed validation to NodeSpecificValidators
    if (config.responseMode === 'responseNode' && !config.responseData) {
      suggestions.push('When using responseMode=responseNode, add a "Respond to Webhook" node to send custom responses');
    }
  }
  
  /**
   * Validate database queries
   */
  private static validateDatabase(
    config: Record<string, any>,
    warnings: ValidationWarning[],
    suggestions: string[]
  ): void {
    if (config.query) {
      const query = config.query.toLowerCase();
      
      // SQL injection warning
      if (query.includes('${') || query.includes('{{')) {
        warnings.push({
          type: 'security',
          message: 'Query contains template expressions that might be vulnerable to SQL injection',
          suggestion: 'Use parameterized queries with additionalFields.queryParams instead'
        });
      }
      
      // DELETE without WHERE
      if (query.includes('delete') && !query.includes('where')) {
        warnings.push({
          type: 'security',
          message: 'DELETE query without WHERE clause will delete all records',
          suggestion: 'Add a WHERE clause to limit the deletion'
        });
      }
      
      // SELECT * warning
      if (query.includes('select *')) {
        suggestions.push('Consider selecting specific columns instead of * for better performance');
      }
    }
  }
  
  /**
   * Validate Code node
   */
  private static validateCode(
    config: Record<string, any>,
    errors: ValidationError[],
    warnings: ValidationWarning[]
  ): void {
    const codeField = config.language === 'python' ? 'pythonCode' : 'jsCode';
    const code = config[codeField];
    
    if (!code || code.trim() === '') {
      errors.push({
        type: 'missing_required',
        property: codeField,
        message: 'Code cannot be empty',
        fix: 'Add your code logic'
      });
      return;
    }
    
    // Security checks
    if (code?.includes('eval(') || code?.includes('exec(')) {
      warnings.push({
        type: 'security',
        message: 'Code contains eval/exec which can be a security risk',
        suggestion: 'Avoid using eval/exec with untrusted input'
      });
    }
    
    // Basic syntax validation
    if (config.language === 'python') {
      this.validatePythonSyntax(code, errors, warnings);
    } else {
      this.validateJavaScriptSyntax(code, errors, warnings);
    }
    
    // n8n-specific patterns
    this.validateN8nCodePatterns(code, config.language || 'javascript', errors, warnings);
  }
  
  /**
   * Check for common configuration issues
   */
  private static checkCommonIssues(
    nodeType: string,
    config: Record<string, any>,
    properties: any[],
    warnings: ValidationWarning[],
    suggestions: string[],
    userProvidedKeys?: Set<string> // NEW: Only warn about user-provided properties
  ): void {
    // Skip visibility checks for Code nodes as they have simple property structure
    if (nodeType === 'nodes-base.code') {
      // Code nodes don't have complex displayOptions, so skip visibility warnings
      return;
    }

    // Check for properties that won't be used
    const visibleProps = properties.filter(p => this.isPropertyVisible(p, config));
    const configuredKeys = Object.keys(config);

    for (const key of configuredKeys) {
      // Skip internal properties that are always present
      if (key === '@version' || key.startsWith('_')) {
        continue;
      }

      // CRITICAL FIX: Only warn about properties the user actually provided, not defaults
      if (userProvidedKeys && !userProvidedKeys.has(key)) {
        continue; // Skip properties that were added as defaults
      }

      // Find the property definition
      const prop = properties.find(p => p.name === key);

      // Skip UI-only properties (notice, callout, etc.) - they're not configuration
      if (prop && this.UI_ONLY_TYPES.includes(prop.type)) {
        continue;
      }

      // Check if property is visible with current settings
      if (!visibleProps.find(p => p.name === key)) {
        const value = config[key];

        // A property with no value (or still at its schema default) has no
        // runtime effect regardless of visibility — warning about such
        // UI-persisted leftovers is pure noise.
        if (value === null || value === undefined || value === '') {
          continue;
        }
        if (prop && 'default' in prop && JSON.stringify(value) === JSON.stringify(prop.default)) {
          continue;
        }

        // Get visibility requirements for better error message
        const visibilityReq = this.getVisibilityRequirement(prop, config);

        warnings.push({
          type: 'inefficient',
          property: key,
          message: `Property '${prop?.displayName || key}' won't be used - not visible with current settings`,
          suggestion: visibilityReq || 'Remove this property or adjust other settings to make it visible'
        });
      }
    }
    
    // Suggest commonly used properties
    const commonProps = ['authentication', 'errorHandling', 'timeout'];
    for (const prop of commonProps) {
      const propDef = properties.find(p => p.name === prop);
      if (propDef && this.isPropertyVisible(propDef, config) && !(prop in config)) {
        suggestions.push(`Consider setting '${prop}' for better control`);
      }
    }
  }
  
  /**
   * Perform security checks
   */
  private static performSecurityChecks(
    nodeType: string,
    config: Record<string, any>,
    warnings: ValidationWarning[]
  ): void {
    // Check for hardcoded credentials
    const sensitivePatterns = [
      /api[_-]?key/i,
      /password/i,
      /secret/i,
      /token/i,
      /credential/i
    ];
    
    for (const [key, value] of Object.entries(config)) {
      if (typeof value === 'string') {
        for (const pattern of sensitivePatterns) {
          if (pattern.test(key) && value.length > 0 && !value.includes('{{')) {
            warnings.push({
              type: 'security',
              property: key,
              message: `Hardcoded ${key} detected`,
              suggestion: 'Use n8n credentials or expressions instead of hardcoding sensitive values'
            });
            break;
          }
        }
      }
    }
  }
  
  /**
   * Get visibility requirement for a property
   * Explains what needs to be set for the property to be visible
   */
  private static getVisibilityRequirement(prop: any, config: Record<string, any>): string | undefined {
    if (!prop || !prop.displayOptions?.show) {
      return undefined;
    }

    const requirements: string[] = [];
    for (const [field, values] of Object.entries(prop.displayOptions.show)) {
      const expectedValues = Array.isArray(values) ? values : [values];
      const currentValue = config[field];

      // Only include if the current value doesn't match
      if (!expectedValues.includes(currentValue)) {
        const valueStr = expectedValues.length === 1
          ? `"${expectedValues[0]}"`
          : expectedValues.map(v => `"${v}"`).join(' or ');
        requirements.push(`${field}=${valueStr}`);
      }
    }

    if (requirements.length === 0) {
      return undefined;
    }

    return `Requires: ${requirements.join(', ')}`;
  }

  /**
   * Basic JavaScript syntax validation
   */
  private static validateJavaScriptSyntax(
    code: string,
    errors: ValidationError[],
    warnings: ValidationWarning[]
  ): void {
    // Check for common syntax errors
    const openBraces = (code.match(/\{/g) || []).length;
    const closeBraces = (code.match(/\}/g) || []).length;
    if (openBraces !== closeBraces) {
      errors.push({
        type: 'invalid_value',
        property: 'jsCode',
        message: 'Unbalanced braces detected',
        fix: 'Check that all { have matching }'
      });
    }
    
    const openParens = (code.match(/\(/g) || []).length;
    const closeParens = (code.match(/\)/g) || []).length;
    if (openParens !== closeParens) {
      errors.push({
        type: 'invalid_value',
        property: 'jsCode',
        message: 'Unbalanced parentheses detected',
        fix: 'Check that all ( have matching )'
      });
    }
    
    // Check for unterminated strings
    const stringMatches = code.match(/(["'`])(?:(?=(\\?))\2.)*?\1/g) || [];
    const quotesInStrings = stringMatches.join('').match(/["'`]/g)?.length || 0;
    const totalQuotes = (code.match(/["'`]/g) || []).length;
    if ((totalQuotes - quotesInStrings) % 2 !== 0) {
      warnings.push({
        type: 'inefficient',
        message: 'Possible unterminated string detected',
        suggestion: 'Check that all strings are properly closed'
      });
    }
  }
  
  /**
   * Basic Python syntax validation
   */
  private static validatePythonSyntax(
    code: string,
    errors: ValidationError[],
    warnings: ValidationWarning[]
  ): void {
    // Check indentation consistency
    const lines = code.split('\n');
    const indentTypes = new Set<string>();
    
    lines.forEach(line => {
      const indent = line.match(/^(\s+)/);
      if (indent) {
        if (indent[1].includes('\t')) indentTypes.add('tabs');
        if (indent[1].includes(' ')) indentTypes.add('spaces');
      }
    });
    
    if (indentTypes.size > 1) {
      errors.push({
        type: 'syntax_error',
        property: 'pythonCode',
        message: 'Mixed indentation (tabs and spaces)',
        fix: 'Use either tabs or spaces consistently, not both'
      });
    }
    
    // Check for unmatched brackets in Python
    const openSquare = (code.match(/\[/g) || []).length;
    const closeSquare = (code.match(/\]/g) || []).length;
    if (openSquare !== closeSquare) {
      errors.push({
        type: 'syntax_error',
        property: 'pythonCode',
        message: 'Unmatched bracket - missing ] or extra [',
        fix: 'Check that all [ have matching ]'
      });
    }
    
    // Check for unmatched curly braces
    const openCurly = (code.match(/\{/g) || []).length;
    const closeCurly = (code.match(/\}/g) || []).length;
    if (openCurly !== closeCurly) {
      errors.push({
        type: 'syntax_error',
        property: 'pythonCode',
        message: 'Unmatched bracket - missing } or extra {',
        fix: 'Check that all { have matching }'
      });
    }
    
    // Check for colons after control structures
    const controlStructures = /^\s*(if|elif|else|for|while|def|class|try|except|finally|with)\s+.*[^:]\s*$/gm;
    if (controlStructures.test(code)) {
      warnings.push({
        type: 'inefficient',
        message: 'Missing colon after control structure',
        suggestion: 'Add : at the end of if/for/def/class statements'
      });
    }
  }
  
  /**
   * Validate n8n-specific code patterns
   */
  private static validateN8nCodePatterns(
    code: string,
    language: string,
    errors: ValidationError[],
    warnings: ValidationWarning[]
  ): void {
    // Check for return statement
    const hasReturn = language === 'python' 
      ? /return\s+/.test(code)
      : /return\s+/.test(code);
    
    if (!hasReturn) {
      warnings.push({
        type: 'missing_common',
        message: 'No return statement found',
        suggestion: 'Code node must return data. Example: return [{json: {result: "success"}}]'
      });
    }
    
    // Check return format for JavaScript
    if (language === 'javascript' && hasReturn) {
      // Check for common incorrect return patterns
      if (/return\s+items\s*;/.test(code) && !code.includes('.map') && !code.includes('json:')) {
        warnings.push({
          type: 'best_practice',
          message: 'Returning items directly - ensure each item has {json: ...} structure',
          suggestion: 'If modifying items, use: return items.map(item => ({json: {...item.json, newField: "value"}}))'
        });
      }
      
      // Check for return without array
      if (/return\s+{[^}]+}\s*;/.test(code) && !code.includes('[') && !code.includes(']')) {
        warnings.push({
          type: 'invalid_value',
          message: 'Return value must be an array',
          suggestion: 'Wrap your return object in an array: return [{json: {your: "data"}}]'
        });
      }
      
      // Check for direct data return without json wrapper
      if (/return\s+\[['"`]/.test(code) || /return\s+\[\d/.test(code)) {
        warnings.push({
          type: 'invalid_value',
          message: 'Items must be objects with json property',
          suggestion: 'Use format: return [{json: {value: "data"}}] not return ["data"]'
        });
      }
    }
    
    // Check return format for Python
    if (language === 'python' && hasReturn) {
      // DEBUG: Log to see if we're entering this block
      if (code.includes('result = {"data": "value"}')) {
        console.log('DEBUG: Processing Python code with result variable');
        console.log('DEBUG: Language:', language);
        console.log('DEBUG: Has return:', hasReturn);
      }
      // Check for common incorrect patterns
      if (/return\s+items\s*$/.test(code) && !code.includes('json') && !code.includes('dict')) {
        warnings.push({
          type: 'best_practice',
          message: 'Returning items directly - ensure each item is a dict with "json" key',
          suggestion: 'Use: return [{"json": item.json} for item in items]'
        });
      }
      
      // Check for dict return without list
      if (/return\s+{['"]/.test(code) && !code.includes('[') && !code.includes(']')) {
        warnings.push({
          type: 'invalid_value',
          message: 'Return value must be a list',
          suggestion: 'Wrap your return dict in a list: return [{"json": {"your": "data"}}]'
        });
      }
      
      // Check for returning objects without json key
      if (/return\s+(?!.*\[).*{(?!.*["']json["'])/.test(code)) {
        warnings.push({
          type: 'invalid_value',
          message: 'Must return array of objects with json key',
          suggestion: 'Use format: return [{"json": {"data": "value"}}]'
        });
      }
      
      // Check for returning variable that might contain invalid format
      const returnMatch = code.match(/return\s+(\w+)\s*(?:#|$)/m);
      if (returnMatch) {
        const varName = returnMatch[1];
        // Check if this variable is assigned a dict without being in a list
        const assignmentRegex = new RegExp(`${varName}\\s*=\\s*{[^}]+}`, 'm');
        if (assignmentRegex.test(code) && !new RegExp(`${varName}\\s*=\\s*\\[`).test(code)) {
          warnings.push({
            type: 'invalid_value',
            message: 'Must return array of objects with json key',
            suggestion: `Wrap ${varName} in a list with json key: return [{"json": ${varName}}]`
          });
        }
      }
    }
    
    // Check for common n8n variables and patterns
    if (language === 'javascript') {
      // Check if accessing items/input
      if (!code.includes('items') && !code.includes('$input') && !code.includes('$json')) {
        warnings.push({
          type: 'missing_common',
          message: 'Code doesn\'t reference input data',
          suggestion: 'Access input with: items, $input.all(), or $json (in single-item mode)'
        });
      }
      
      // Check for common mistakes with $json
      if (code.includes('$json') && !code.includes('mode')) {
        warnings.push({
          type: 'best_practice',
          message: '$json only works in "Run Once for Each Item" mode',
          suggestion: 'For all items mode, use: items[0].json or loop through items'
        });
      }
      
      // Check for undefined variable usage
      const commonVars = ['$node', '$workflow', '$execution', '$prevNode', 'DateTime', 'jmespath'];
      const usedVars = commonVars.filter(v => code.includes(v));
      
      // Check for incorrect $helpers usage patterns
      if (code.includes('$helpers.getWorkflowStaticData')) {
        // Check if it's missing parentheses
        if (/\$helpers\.getWorkflowStaticData(?!\s*\()/.test(code)) {
          errors.push({
            type: 'invalid_value',
            property: 'jsCode',
            message: 'getWorkflowStaticData requires parentheses: $helpers.getWorkflowStaticData()',
            fix: 'Add parentheses: $helpers.getWorkflowStaticData()'
          });
        } else {
          warnings.push({
            type: 'invalid_value',
            message: '$helpers.getWorkflowStaticData() is incorrect - causes "$helpers is not defined" error',
            suggestion: 'Use $getWorkflowStaticData() as a standalone function (no $helpers prefix)'
          });
        }
      }
      
      // Check for $helpers usage without checking availability
      if (code.includes('$helpers') && !code.includes('typeof $helpers')) {
        warnings.push({
          type: 'best_practice',
          message: '$helpers is only available in Code nodes with mode="runOnceForEachItem"',
          suggestion: 'Check availability first: if (typeof $helpers !== "undefined" && $helpers.httpRequest) { ... }'
        });
      }
      
      // Check for async without await
      if ((code.includes('fetch(') || code.includes('Promise') || code.includes('.then(')) && !code.includes('await')) {
        warnings.push({
          type: 'best_practice',
          message: 'Async operation without await - will return a Promise instead of actual data',
          suggestion: 'Use await with async operations: const result = await fetch(...);'
        });
      }
      
      // Check for crypto usage without require
      if ((code.includes('crypto.') || code.includes('randomBytes') || code.includes('randomUUID')) && !code.includes('require')) {
        warnings.push({
          type: 'invalid_value',
          message: 'Using crypto without require statement',
          suggestion: 'Add: const crypto = require("crypto"); at the beginning (ignore editor warnings)'
        });
      }
      
      // Check for console.log (informational)
      if (code.includes('console.log')) {
        warnings.push({
          type: 'best_practice',
          message: 'console.log output appears in n8n execution logs',
          suggestion: 'Remove console.log statements in production or use them sparingly'
        });
      }
    } else if (language === 'python') {
      // Python-specific checks
      if (!code.includes('items') && !code.includes('_input')) {
        warnings.push({
          type: 'missing_common',
          message: 'Code doesn\'t reference input items',
          suggestion: 'Access input data with: items variable'
        });
      }
      
      // Check for print statements
      if (code.includes('print(')) {
        warnings.push({
          type: 'best_practice',
          message: 'print() output appears in n8n execution logs',
          suggestion: 'Remove print statements in production or use them sparingly'
        });
      }
      
      // Check for common Python mistakes
      if (code.includes('import requests') || code.includes('import pandas')) {
        warnings.push({
          type: 'invalid_value',
          message: 'External libraries not available in Code node',
          suggestion: 'Only Python standard library is available. For HTTP requests, use JavaScript with $helpers.httpRequest'
        });
      }
    }
    
    // Check for infinite loops
    if (/while\s*\(\s*true\s*\)|while\s+True:/.test(code)) {
      warnings.push({
        type: 'security',
        message: 'Infinite loop detected',
        suggestion: 'Add a break condition or use a for loop with limits'
      });
    }
    
    // Check for error handling
    if (!code.includes('try') && !code.includes('catch') && !code.includes('except')) {
      if (code.length > 200) { // Only suggest for non-trivial code
        warnings.push({
          type: 'best_practice',
          message: 'No error handling found',
          suggestion: 'Consider adding try/catch (JavaScript) or try/except (Python) for robust error handling'
        });
      }
    }
  }
}