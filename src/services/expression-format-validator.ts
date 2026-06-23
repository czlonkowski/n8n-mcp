/**
 * Expression Format Validator for n8n expressions
 *
 * Combines universal expression validation with node-specific intelligence
 * to provide comprehensive expression format validation. Uses the
 * UniversalExpressionValidator for 100% reliable base validation and adds
 * node-specific resource locator detection on top.
 */

import { UniversalExpressionValidator, UniversalValidationResult } from './universal-expression-validator';
import { ConfidenceScorer } from './confidence-scorer';

export interface ExpressionFormatIssue {
  fieldPath: string;
  currentValue: any;
  correctedValue: any;
  issueType:
    | 'missing-prefix'
    | 'needs-resource-locator'
    | 'invalid-rl-structure'
    | 'mixed-format'
    | 'missing-cached-result-name';
  explanation: string;
  severity: 'error' | 'warning';
  confidence?: number; // 0.0 to 1.0, only for node-specific recommendations
}

export interface ResourceLocatorField {
  __rl: true;
  value: string;
  mode: string;
  cachedResultName?: string;
}

export interface ValidationContext {
  nodeType: string;
  nodeName: string;
  nodeId?: string;
}

export class ExpressionFormatValidator {
  private static readonly VALID_RL_MODES = ['id', 'url', 'expression', 'name', 'list'] as const;
  private static readonly MAX_RECURSION_DEPTH = 100;
  private static readonly EXPRESSION_PREFIX = '='; // Keep for resource locator generation

  /**
   * Known fields that commonly use resource locator format
   * Map of node type patterns to field names
   */
  private static readonly RESOURCE_LOCATOR_FIELDS: Record<string, string[]> = {
    'github': ['owner', 'repository', 'user', 'organization'],
    'googleSheets': ['sheetId', 'documentId', 'spreadsheetId', 'rangeDefinition'],
    'googleDrive': ['fileId', 'folderId', 'driveId'],
    'slack': ['channel', 'user', 'channelId', 'userId', 'teamId'],
    'notion': ['databaseId', 'pageId', 'blockId'],
    'airtable': ['baseId', 'tableId', 'viewId'],
    'monday': ['boardId', 'itemId', 'groupId'],
    'hubspot': ['contactId', 'companyId', 'dealId'],
    'salesforce': ['recordId', 'objectName'],
    'jira': ['projectKey', 'issueKey', 'boardId'],
    'gitlab': ['projectId', 'mergeRequestId', 'issueId'],
    'mysql': ['table', 'database', 'schema'],
    'postgres': ['table', 'database', 'schema'],
    'mongodb': ['collection', 'database'],
    's3': ['bucketName', 'key', 'fileName'],
    'ftp': ['path', 'fileName'],
    'ssh': ['path', 'fileName'],
    'redis': ['key'],
  };


  /**
   * Determine if a field should use resource locator format based on node type and field name
   */
  private static shouldUseResourceLocator(fieldName: string, nodeType: string): boolean {
    // Extract the base node type (e.g., 'github' from 'n8n-nodes-base.github')
    const nodeBase = nodeType.split('.').pop()?.toLowerCase() || '';

    // Check if this node type has resource locator fields
    for (const [pattern, fields] of Object.entries(this.RESOURCE_LOCATOR_FIELDS)) {
      // Use exact match or prefix matching for precision
      // This prevents false positives like 'postgresqlAdvanced' matching 'postgres'
      if ((nodeBase === pattern || nodeBase.startsWith(`${pattern}-`)) && fields.includes(fieldName)) {
        return true;
      }
    }

    // Don't apply resource locator to generic fields
    return false;
  }

  /**
   * Check if a value is a valid resource locator object
   */
  private static isResourceLocator(value: any): value is ResourceLocatorField {
    if (typeof value !== 'object' || value === null || value.__rl !== true) {
      return false;
    }

    if (!('value' in value) || !('mode' in value)) {
      return false;
    }

    // Validate mode is one of the allowed values
    if (typeof value.mode !== 'string' || !this.VALID_RL_MODES.includes(value.mode as any)) {
      return false;
    }

    return true;
  }

  /**
   * Generate the corrected value for an expression
   */
  private static generateCorrection(
    value: string,
    needsResourceLocator: boolean
  ): any {
    const correctedValue = value.startsWith(this.EXPRESSION_PREFIX)
      ? value
      : `${this.EXPRESSION_PREFIX}${value}`;

    if (needsResourceLocator) {
      // Generated correction always uses mode: 'expression', which is a raw
      // expression input in the n8n UI — there is no dropdown to populate, so
      // cachedResultName is intentionally omitted (#715). The
      // missing-cachedResultName warning below also skips this mode.
      return {
        __rl: true,
        value: correctedValue,
        mode: 'expression'
      };
    }

    return correctedValue;
  }

  /**
   * n8n resource-locator modes that render a dropdown showing cachedResultName as
   * the selected label. In `expression`/`url` modes the user types a raw
   * expression / URL and there is no cached label to display, so the warning
   * does not apply.
   */
  private static readonly MODES_USING_CACHED_NAME: ReadonlyArray<string> = ['id', 'list', 'name'];

  /**
   * Emit a warning when a __rl resource-locator field is well-formed but missing
   * cachedResultName in a mode where the n8n UI renders a dropdown. The workflow
   * runs fine, but the dropdown shows "Choose..." and downstream metadata fetches
   * (e.g. Airtable column list) never fire — users see "No columns found" with
   * no obvious cause (#715).
   */
  private static checkCachedResultName(
    value: ResourceLocatorField,
    path: string
  ): ExpressionFormatIssue | null {
    if (!this.MODES_USING_CACHED_NAME.includes(value.mode)) {
      return null;
    }
    if (typeof value.cachedResultName === 'string' && value.cachedResultName !== '') {
      return null;
    }
    return {
      fieldPath: path,
      currentValue: value,
      correctedValue: { ...value, cachedResultName: '<set to the resource display name>' },
      issueType: 'missing-cached-result-name',
      explanation:
        'resource locator is missing cachedResultName. The workflow will run, but the n8n UI dropdown will show "Choose..." instead of the selected value, and dependent metadata fetches (e.g. column lists) will not fire. Set cachedResultName to the human-readable display name of the resource. (#715)',
      severity: 'warning'
    };
  }

  /**
   * Validate and fix expression format for a single value
   */
  static validateAndFix(
    value: any,
    fieldPath: string,
    context: ValidationContext
  ): ExpressionFormatIssue | null {
    // Skip non-string values unless they're resource locators
    if (typeof value !== 'string' && !this.isResourceLocator(value)) {
      return null;
    }

    // Handle resource locator objects
    if (this.isResourceLocator(value)) {
      // Use universal validator for the value inside RL
      const universalResults = UniversalExpressionValidator.validate(value.value);
      const invalidResult = universalResults.find(r => !r.isValid && r.needsPrefix);

      if (invalidResult) {
        return {
          fieldPath,
          currentValue: value,
          correctedValue: {
            ...value,
            value: UniversalExpressionValidator.getCorrectedValue(value.value)
          },
          issueType: 'missing-prefix',
          explanation: `Resource locator value: ${invalidResult.explanation}`,
          severity: 'error'
        };
      }
      return null;
    }

    // First, use universal validator for 100% reliable validation
    const universalResults = UniversalExpressionValidator.validate(value);
    const invalidResults = universalResults.filter(r => !r.isValid);

    // If universal validator found issues, report them
    if (invalidResults.length > 0) {
      // Prioritize prefix issues
      const prefixIssue = invalidResults.find(r => r.needsPrefix);
      if (prefixIssue) {
        // Check if this field should use resource locator format with confidence scoring
        const fieldName = fieldPath.split('.').pop() || '';
        const confidenceScore = ConfidenceScorer.scoreResourceLocatorRecommendation(
          fieldName,
          context.nodeType,
          value
        );

        // Only suggest resource locator for high confidence matches when there's a prefix issue
        if (confidenceScore.value >= 0.8) {
          return {
            fieldPath,
            currentValue: value,
            correctedValue: this.generateCorrection(value, true),
            issueType: 'needs-resource-locator',
            explanation: `Field '${fieldName}' contains expression but needs resource locator format with '${this.EXPRESSION_PREFIX}' prefix for evaluation.`,
            severity: 'error',
            confidence: confidenceScore.value
          };
        } else {
          return {
            fieldPath,
            currentValue: value,
            correctedValue: UniversalExpressionValidator.getCorrectedValue(value),
            issueType: 'missing-prefix',
            explanation: prefixIssue.explanation,
            severity: 'error'
          };
        }
      }

      // Report other validation issues
      const firstIssue = invalidResults[0];
      return {
        fieldPath,
        currentValue: value,
        correctedValue: value,
        issueType: 'mixed-format',
        explanation: firstIssue.explanation,
        severity: 'error'
      };
    }

    // Universal validation passed, now check for node-specific improvements
    // Only if the value has expressions
    const hasExpression = universalResults.some(r => r.hasExpression);
    if (hasExpression && typeof value === 'string') {
      const fieldName = fieldPath.split('.').pop() || '';
      const confidenceScore = ConfidenceScorer.scoreResourceLocatorRecommendation(
        fieldName,
        context.nodeType,
        value
      );

      // Only suggest resource locator for medium-high confidence as a warning
      if (confidenceScore.value >= 0.5) {
        // Has prefix but should use resource locator format
        return {
          fieldPath,
          currentValue: value,
          correctedValue: this.generateCorrection(value, true),
          issueType: 'needs-resource-locator',
          explanation: `Field '${fieldName}' should use resource locator format for better compatibility. (Confidence: ${Math.round(confidenceScore.value * 100)}%)`,
          severity: 'warning',
          confidence: confidenceScore.value
        };
      }
    }

    return null;
  }

  /**
   * Validate all expressions in a node's parameters recursively
   */
  static validateNodeParameters(
    parameters: any,
    context: ValidationContext
  ): ExpressionFormatIssue[] {
    const issues: ExpressionFormatIssue[] = [];
    const visited = new WeakSet();

    this.validateRecursive(parameters, '', context, issues, visited);

    return issues;
  }

  /**
   * Recursively validate parameters for expression format issues
   */
  private static validateRecursive(
    obj: any,
    path: string,
    context: ValidationContext,
    issues: ExpressionFormatIssue[],
    visited: WeakSet<object>,
    depth = 0
  ): void {
    // Prevent excessive recursion
    if (depth > this.MAX_RECURSION_DEPTH) {
      issues.push({
        fieldPath: path,
        currentValue: obj,
        correctedValue: obj,
        issueType: 'mixed-format',
        explanation: `Maximum recursion depth (${this.MAX_RECURSION_DEPTH}) exceeded. Object may have circular references or be too deeply nested.`,
        severity: 'warning'
      });
      return;
    }

    // Handle circular references
    if (obj && typeof obj === 'object') {
      if (visited.has(obj)) return;
      visited.add(obj);
    }

    // Check current value
    const issue = this.validateAndFix(obj, path, context);
    if (issue) {
      issues.push(issue);
    }

    // Recurse into objects and arrays
    if (Array.isArray(obj)) {
      obj.forEach((item, index) => {
        const newPath = path ? `${path}[${index}]` : `[${index}]`;
        this.validateRecursive(item, newPath, context, issues, visited, depth + 1);
      });
    } else if (obj && typeof obj === 'object') {
      // Resource locator: do not recurse into __rl internals, but emit the
      // missing-cachedResultName warning before short-circuiting (#715).
      if (this.isResourceLocator(obj)) {
        const cachedNameIssue = this.checkCachedResultName(obj, path);
        if (cachedNameIssue) issues.push(cachedNameIssue);
        return;
      }

      Object.entries(obj).forEach(([key, value]) => {
        // Skip special keys
        if (key.startsWith('__')) return;

        // Skip raw code fields — they hold JavaScript / Python source, not n8n expressions.
        // The bracket-balance check in UniversalExpressionValidator counts {{ vs }} occurrences
        // and false-positives on JS object literals like `[{json:{x:1}}]` (#746).
        // Mirrors the existing guard in expression-validator.ts.
        if (key === 'jsCode' || key === 'pythonCode' || key === 'functionCode') return;

        const newPath = path ? `${path}.${key}` : key;
        this.validateRecursive(value, newPath, context, issues, visited, depth + 1);
      });
    }
  }

  /**
   * Generate a detailed error message with examples
   */
  static formatErrorMessage(issue: ExpressionFormatIssue, context: ValidationContext): string {
    let message = `Expression format ${issue.severity} in node '${context.nodeName}':\n`;
    message += `Field '${issue.fieldPath}' ${issue.explanation}\n\n`;

    message += `Current (incorrect):\n`;
    if (typeof issue.currentValue === 'string') {
      message += `"${issue.fieldPath}": "${issue.currentValue}"\n\n`;
    } else {
      message += `"${issue.fieldPath}": ${JSON.stringify(issue.currentValue, null, 2)}\n\n`;
    }

    // For missing-cachedResultName the correctedValue carries a `<placeholder>`
    // string that must be filled in by the caller — labeling it "Fixed (correct)"
    // would be misleading, since copy-pasting the placeholder verbatim would not
    // resolve the issue (the autofix half handles real resolution in PR 4b).
    const fixedLabel = issue.issueType === 'missing-cached-result-name'
      ? 'Suggested shape (replace the placeholder with the actual resource display name):'
      : 'Fixed (correct):';
    message += `${fixedLabel}\n`;
    if (typeof issue.correctedValue === 'string') {
      message += `"${issue.fieldPath}": "${issue.correctedValue}"`;
    } else {
      message += `"${issue.fieldPath}": ${JSON.stringify(issue.correctedValue, null, 2)}`;
    }

    return message;
  }
}