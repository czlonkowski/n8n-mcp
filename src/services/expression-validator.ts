/**
 * Expression Validator for n8n expressions
 * Validates expression syntax, variable references, and context availability
 */

import { extractBracketExpressions } from '../utils/expression-utils';

interface ExpressionValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  usedVariables: Set<string>;
  usedNodes: Set<string>;
}

interface ExpressionContext {
  availableNodes: string[];
  currentNodeName?: string;
  isInLoop?: boolean;
  hasInputData?: boolean;
}

export class ExpressionValidator {
  // Bare n8n variable references missing {{ }} wrappers
  private static readonly BARE_EXPRESSION_PATTERNS: Array<{ pattern: RegExp; name: string }> = [
    { pattern: /^\$json[.\[]/, name: '$json' },
    { pattern: /^\$node\[/, name: '$node' },
    { pattern: /^\$input\./, name: '$input' },
    { pattern: /^\$execution\./, name: '$execution' },
    { pattern: /^\$workflow\./, name: '$workflow' },
    { pattern: /^\$prevNode\./, name: '$prevNode' },
    { pattern: /^\$env\./, name: '$env' },
    { pattern: /^\$(now|today|itemIndex|runIndex)$/, name: 'built-in variable' },
  ];

  // Expression extraction is now handled by the linear-time
  // `extractBracketExpressions` helper in utils/expression-utils.
  private static readonly VARIABLE_PATTERNS = {
    json: /\$json(\.[a-zA-Z_][\w]*|\["[^"]+"\]|\['[^']+'\]|\[\d+\])*/g,
    node: /\$node\["([^"]+)"\]\.json/g,
    input: /\$input\.item(\.[a-zA-Z_][\w]*|\["[^"]+"\]|\['[^']+'\]|\[\d+\])*/g,
    items: /\$items\("([^"]+)"(?:,\s*(-?\d+))?\)/g,
    parameter: /\$parameter\["([^"]+)"\]/g,
    env: /\$env\.([a-zA-Z_][\w]*)/g,
    workflow: /\$workflow\.(id|name|active)/g,
    execution: /\$execution\.(id|mode|resumeUrl)/g,
    prevNode: /\$prevNode\.(name|outputIndex|runIndex)/g,
    itemIndex: /\$itemIndex/g,
    runIndex: /\$runIndex/g,
    now: /\$now/g,
    today: /\$today/g,
  };

  /**
   * Validate a single expression
   */
  static validateExpression(
    expression: string,
    context: ExpressionContext
  ): ExpressionValidationResult {
    const result: ExpressionValidationResult = {
      valid: true,
      errors: [],
      warnings: [],
      usedVariables: new Set(),
      usedNodes: new Set(),
    };

    // Handle null/undefined expression
    if (!expression) {
      return result;
    }

    // Handle null/undefined context
    if (!context) {
      result.valid = false;
      result.errors.push('Validation context is required');
      return result;
    }

    // Check for basic syntax errors
    const syntaxErrors = this.checkSyntaxErrors(expression);
    result.errors.push(...syntaxErrors);

    // Extract all expressions
    const expressions = this.extractExpressions(expression);
    
    for (const expr of expressions) {
      // Validate each expression
      this.validateSingleExpression(expr, context, result);
    }

    // Check for undefined node references
    this.checkNodeReferences(result, context);

    result.valid = result.errors.length === 0;
    return result;
  }

  /**
   * Check for basic syntax errors
   */
  private static checkSyntaxErrors(expression: string): string[] {
    const errors: string[] = [];

    // Check for unmatched brackets
    const openBrackets = (expression.match(/\{\{/g) || []).length;
    const closeBrackets = (expression.match(/\}\}/g) || []).length;
    
    if (openBrackets !== closeBrackets) {
      errors.push('Unmatched expression brackets {{ }}');
    }

    // Check for truly nested expressions (not supported in n8n)
    // This means {{ inside another {{ }}, like {{ {{ $json }} }}
    // NOT multiple expressions like {{ $json.a }} text {{ $json.b }} (which is valid)
    const nestedPattern = /\{\{[^}]*\{\{/;
    if (nestedPattern.test(expression)) {
      errors.push('Nested expressions are not supported (expression inside another expression)');
    }

    // Check for empty expressions
    const emptyExpressionPattern = /\{\{\s*\}\}/;
    if (emptyExpressionPattern.test(expression)) {
      errors.push('Empty expression found');
    }

    return errors;
  }

  /**
   * Extract all expressions from a string.
   *
   * Uses the shared linear-time `extractBracketExpressions` helper
   * instead of the old `EXPRESSION_PATTERN.exec()` loop to avoid
   * CodeQL js/polynomial-redos. Strips the `{{` / `}}` delimiters
   * and trims whitespace to preserve the previous contract.
   */
  private static extractExpressions(text: string): string[] {
    return extractBracketExpressions(text).map(match => match.slice(2, -2).trim());
  }

  /**
   * Validate a single expression content
   */
  private static validateSingleExpression(
    expr: string,
    context: ExpressionContext,
    result: ExpressionValidationResult
  ): void {
    // Check for $json usage
    let match;
    const jsonPattern = new RegExp(this.VARIABLE_PATTERNS.json.source, this.VARIABLE_PATTERNS.json.flags);
    while ((match = jsonPattern.exec(expr)) !== null) {
      result.usedVariables.add('$json');

      if (!context.hasInputData && !context.isInLoop) {
        result.warnings.push(
          'Using $json but node might not have input data'
        );
      }

      // Check for suspicious property names that might be test/invalid data
      const fullMatch = match[0];
      if (fullMatch.includes('.invalid') || fullMatch.includes('.undefined') ||
          fullMatch.includes('.null') || fullMatch.includes('.test')) {
        result.warnings.push(
          `Property access '${fullMatch}' looks suspicious - verify this property exists in your data`
        );
      }
    }

    // Check for $node references
    const nodePattern = new RegExp(this.VARIABLE_PATTERNS.node.source, this.VARIABLE_PATTERNS.node.flags);
    while ((match = nodePattern.exec(expr)) !== null) {
      const nodeName = match[1];
      result.usedNodes.add(nodeName);
      result.usedVariables.add('$node');
    }

    // Check for $input usage
    const inputPattern = new RegExp(this.VARIABLE_PATTERNS.input.source, this.VARIABLE_PATTERNS.input.flags);
    while ((match = inputPattern.exec(expr)) !== null) {
      result.usedVariables.add('$input');
      
      if (!context.hasInputData) {
        result.warnings.push(
          '$input is only available when the node has input data'
        );
      }
    }

    // Check for $items usage
    const itemsPattern = new RegExp(this.VARIABLE_PATTERNS.items.source, this.VARIABLE_PATTERNS.items.flags);
    while ((match = itemsPattern.exec(expr)) !== null) {
      const nodeName = match[1];
      result.usedNodes.add(nodeName);
      result.usedVariables.add('$items');
    }

    // Check for other variables
    for (const [varName, pattern] of Object.entries(this.VARIABLE_PATTERNS)) {
      if (['json', 'node', 'input', 'items'].includes(varName)) continue;
      
      const testPattern = new RegExp(pattern.source, pattern.flags);
      if (testPattern.test(expr)) {
        result.usedVariables.add(`$${varName}`);
      }
    }

    // Check for common mistakes
    this.checkCommonMistakes(expr, result);
  }

  /**
   * Check for common expression mistakes
   */
  private static checkCommonMistakes(
    expr: string,
    result: ExpressionValidationResult
  ): void {
    // Check for missing $ prefix - but exclude cases where $ is already present OR it's property access (e.g., .json)
    // The pattern now excludes:
    // - Immediately preceded by $ (e.g., $json) - handled by (?<!\$)
    // - Preceded by a dot (e.g., .json in $('Node').item.json.field) - handled by (?<!\.)
    // - Inside word characters (e.g., myJson) - handled by (?<!\w)
    // - Inside bracket notation (e.g., ['json']) - handled by (?<![)
    // - After opening bracket or quote (e.g., "json" or ['json'])
    const missingPrefixPattern = /(?<![.$\w['])\b(json|node|input|items|workflow|execution)\b(?!\s*[:''])/;
    if (expr.match(missingPrefixPattern)) {
      result.warnings.push(
        'Possible missing $ prefix for variable (e.g., use $json instead of json)'
      );
    }

    // Check for incorrect array access
    if (expr.includes('$json[') && !expr.match(/\$json\[\d+\]/)) {
      result.warnings.push(
        'Array access should use numeric index: $json[0] or property access: $json.property'
      );
    }

    // Check for Python-style property access
    if (expr.match(/\$json\['[^']+'\]/)) {
      result.warnings.push(
        "Consider using dot notation: $json.property instead of $json['property']"
      );
    }

    // Check for undefined/null access attempts
    if (expr.match(/\?\./)) {
      result.warnings.push(
        'Optional chaining (?.) is not supported in n8n expressions'
      );
    }

    // Check for template literals
    if (expr.includes('${')) {
      result.errors.push(
        'Template literals ${} are not supported. Use string concatenation instead'
      );
    }
  }

  /**
   * Check that all referenced nodes exist
   */
  private static checkNodeReferences(
    result: ExpressionValidationResult,
    context: ExpressionContext
  ): void {
    for (const nodeName of result.usedNodes) {
      if (!context.availableNodes.includes(nodeName)) {
        result.errors.push(
          `Referenced node "${nodeName}" not found in workflow`
        );
      }
    }
  }

  /**
   * Validate all expressions in a node's parameters
   */
  static validateNodeExpressions(
    parameters: any,
    context: ExpressionContext
  ): ExpressionValidationResult {
    const combinedResult: ExpressionValidationResult = {
      valid: true,
      errors: [],
      warnings: [],
      usedVariables: new Set(),
      usedNodes: new Set(),
    };

    const visited = new WeakSet();
    this.validateParametersRecursive(parameters, context, combinedResult, '', visited);
    
    combinedResult.valid = combinedResult.errors.length === 0;
    return combinedResult;
  }

  /**
   * Detect bare n8n variable references missing {{ }} wrappers.
   * Emits warnings since the value is technically valid as a literal string.
   */
  private static checkBareExpression(
    value: string,
    path: string,
    result: ExpressionValidationResult
  ): void {
    if (value.includes('{{') || value.startsWith('=')) {
      return;
    }

    const trimmed = value.trim();
    for (const { pattern, name } of this.BARE_EXPRESSION_PATTERNS) {
      if (pattern.test(trimmed)) {
        result.warnings.push(
          (path ? `${path}: ` : '') +
          `Possible unwrapped expression: "${trimmed}" looks like an n8n ${name} reference. ` +
          `Use "={{ ${trimmed} }}" to evaluate it as an expression.`
        );
        return;
      }
    }
  }

  /**
   * Recursively validate expressions in parameters
   */
  private static validateParametersRecursive(
    obj: any,
    context: ExpressionContext,
    result: ExpressionValidationResult,
    path: string = '',
    visited: WeakSet<object> = new WeakSet()
  ): void {
    // Handle circular references
    if (obj && typeof obj === 'object') {
      if (visited.has(obj)) {
        return; // Skip already visited objects
      }
      visited.add(obj);
    }
    
    if (typeof obj === 'string') {
      // Detect bare expressions missing {{ }} wrappers
      this.checkBareExpression(obj, path, result);

      if (obj.includes('{{')) {
        const validation = this.validateExpression(obj, context);
        
        // Add path context to errors
        validation.errors.forEach(error => {
          result.errors.push(path ? `${path}: ${error}` : error);
        });
        
        validation.warnings.forEach(warning => {
          result.warnings.push(path ? `${path}: ${warning}` : warning);
        });
        
        // Merge used variables and nodes
        validation.usedVariables.forEach(v => result.usedVariables.add(v));
        validation.usedNodes.forEach(n => result.usedNodes.add(n));
      }
    } else if (Array.isArray(obj)) {
      obj.forEach((item, index) => {
        this.validateParametersRecursive(
          item,
          context,
          result,
          `${path}[${index}]`,
          visited
        );
      });
    } else if (obj && typeof obj === 'object') {
      Object.entries(obj).forEach(([key, value]) => {
        const newPath = path ? `${path}.${key}` : key;
        this.validateParametersRecursive(value, context, result, newPath, visited);
      });
    }
  }
}