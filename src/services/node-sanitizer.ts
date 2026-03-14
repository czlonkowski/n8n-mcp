/**
 * Node Sanitizer Service
 *
 * Ensures nodes have complete metadata required by n8n UI.
 * Based on n8n AI Workflow Builder patterns:
 * - Merges node type defaults with user parameters
 * - Auto-adds required metadata for filter-based nodes (IF v2.2+, Switch v3.2+)
 * - Fixes operator structure
 * - Prevents "Could not find property option" errors
 */

import { INodeParameters } from 'n8n-workflow';
import { logger } from '../utils/logger';
import { WorkflowNode } from '../types/n8n-api';

/**
 * Sanitize a single node by adding required metadata
 */
export function sanitizeNode(node: WorkflowNode): WorkflowNode {
  const sanitized = { ...node };

  // Apply node-specific sanitization
  if (isFilterBasedNode(node.type, node.typeVersion)) {
    sanitized.parameters = sanitizeFilterBasedNode(
      sanitized.parameters as INodeParameters,
      node.type,
      node.typeVersion
    );
  }

  return sanitized;
}

/**
 * Sanitize all nodes in a workflow
 */
export function sanitizeWorkflowNodes(workflow: any): any {
  if (!workflow.nodes || !Array.isArray(workflow.nodes)) {
    return workflow;
  }

  return {
    ...workflow,
    nodes: workflow.nodes.map(sanitizeNode)
  };
}

/**
 * Check if node is filter-based (IF v2.2+, Switch v3.2+)
 */
function isFilterBasedNode(nodeType: string, typeVersion: number): boolean {
  if (nodeType === 'n8n-nodes-base.if') {
    return typeVersion >= 2.2;
  }
  if (nodeType === 'n8n-nodes-base.switch') {
    return typeVersion >= 3.2;
  }
  return false;
}

/**
 * Sanitize filter-based nodes (IF v2.2+, Switch v3.2+)
 * Ensures conditions.options has complete structure
 */
function sanitizeFilterBasedNode(
  parameters: INodeParameters,
  nodeType: string,
  typeVersion: number
): INodeParameters {
  const sanitized = { ...parameters };

  // Handle IF node
  if (nodeType === 'n8n-nodes-base.if' && typeVersion >= 2.2) {
    sanitized.conditions = sanitizeFilterConditions(sanitized.conditions as any);
  }

  // Handle Switch node
  if (nodeType === 'n8n-nodes-base.switch' && typeVersion >= 3.2) {
    if (sanitized.rules && typeof sanitized.rules === 'object') {
      const rules = sanitized.rules as any;
      if (rules.rules && Array.isArray(rules.rules)) {
        rules.rules = rules.rules.map((rule: any) => ({
          ...rule,
          conditions: sanitizeFilterConditions(rule.conditions)
        }));
      }
    }
  }

  return sanitized;
}

/**
 * Sanitize filter conditions structure
 */
function sanitizeFilterConditions(conditions: any): any {
  if (!conditions || typeof conditions !== 'object') {
    return conditions;
  }

  const sanitized = { ...conditions };

  // Ensure options has complete structure
  if (!sanitized.options) {
    sanitized.options = {};
  }

  // Add required filter options metadata
  const requiredOptions = {
    version: 2,
    leftValue: '',
    caseSensitive: true,
    typeValidation: 'strict'
  };

  // Merge with existing options, preserving user values
  sanitized.options = {
    ...requiredOptions,
    ...sanitized.options
  };

  // Sanitize conditions array
  if (sanitized.conditions && Array.isArray(sanitized.conditions)) {
    sanitized.conditions = sanitized.conditions.map(sanitizeCondition);
  }

  return sanitized;
}

/**
 * Sanitize a single condition
 */
function sanitizeCondition(condition: any): any {
  if (!condition || typeof condition !== 'object') {
    return condition;
  }

  const sanitized = { ...condition };

  // Ensure condition has an ID
  if (!sanitized.id) {
    sanitized.id = generateConditionId();
  }

  // Sanitize operator structure
  if (sanitized.operator) {
    sanitized.operator = sanitizeOperator(sanitized.operator);
  }

  return sanitized;
}

/**
 * Sanitize operator structure
 * Ensures operator has correct format: {type, operation, singleValue?}
 */
function sanitizeOperator(operator: any): any {
  if (!operator || typeof operator !== 'object') {
    return operator;
  }

  const sanitized = { ...operator };

  // Fix common mistake: type field used for operation name
  // WRONG: {type: "isNotEmpty"}
  // RIGHT: {type: "string", operation: "isNotEmpty"}
  if (sanitized.type && !sanitized.operation) {
    // Check if type value looks like an operation (lowercase, no dots)
    const typeValue = sanitized.type as string;
    if (isOperationName(typeValue)) {
      logger.debug(`Fixing operator structure: converting type="${typeValue}" to operation`);

      // Infer data type from operation
      const dataType = inferDataType(typeValue);
      sanitized.type = dataType;
      sanitized.operation = typeValue;
    }
  }

  // Set singleValue based on operator type
  if (sanitized.operation) {
    if (isUnaryOperator(sanitized.operation)) {
      // Unary operators require singleValue: true
      sanitized.singleValue = true;
    } else {
      // Binary operators should NOT have singleValue (or it should be false/undefined)
      // Remove it to prevent UI errors
      delete sanitized.singleValue;
    }
  }

  return sanitized;
}

/**
 * Check if string looks like an operation name (not a data type)
 */
function isOperationName(value: string): boolean {
  // Operation names are lowercase and don't contain dots
  // Data types are: string, number, boolean, dateTime, array, object
  const dataTypes = ['string', 'number', 'boolean', 'dateTime', 'array', 'object'];
  return !dataTypes.includes(value) && /^[a-z][a-zA-Z]*$/.test(value);
}

/**
 * Infer data type from operation name
 */
function inferDataType(operation: string): string {
  // Boolean operations
  const booleanOps = ['true', 'false', 'isEmpty', 'isNotEmpty'];
  if (booleanOps.includes(operation)) {
    return 'boolean';
  }

  // Number operations (partial match to catch variants like "greaterThan" containing "gt")
  const numberOps = ['isNumeric', 'gt', 'gte', 'lt', 'lte'];
  if (numberOps.some(op => operation.includes(op))) {
    return 'number';
  }

  // Date operations (partial match to catch variants like "isAfter" containing "after")
  const dateOps = ['after', 'before', 'afterDate', 'beforeDate'];
  if (dateOps.some(op => operation.includes(op))) {
    return 'dateTime';
  }

  // Object operations: empty/notEmpty/exists/notExists are generic object-level checks
  // (distinct from isEmpty/isNotEmpty which are boolean-typed operations)
  const objectOps = ['empty', 'notEmpty', 'exists', 'notExists'];
  if (objectOps.includes(operation)) {
    return 'object';
  }

  // Default to string
  return 'string';
}

/**
 * Check if operator is unary (requires singleValue: true)
 */
function isUnaryOperator(operation: string): boolean {
  const unaryOps = [
    'isEmpty',
    'isNotEmpty',
    'true',
    'false',
    'isNumeric',
    'empty',
    'notEmpty',
    'exists',
    'notExists'
  ];
  return unaryOps.includes(operation);
}

/**
 * Generate unique condition ID
 */
function generateConditionId(): string {
  return `condition-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Validate that a node has complete metadata
 * Returns array of issues found
 */
export function validateNodeMetadata(node: WorkflowNode): string[] {
  const issues: string[] = [];

  if (!isFilterBasedNode(node.type, node.typeVersion)) {
    return issues; // Not a filter-based node
  }

  // Check IF node
  if (node.type === 'n8n-nodes-base.if') {
    const conditions = (node.parameters.conditions as any);
    if (!conditions?.options) {
      issues.push('Missing conditions.options');
    } else {
      const required = ['version', 'leftValue', 'typeValidation', 'caseSensitive'];
      for (const field of required) {
        if (!(field in conditions.options)) {
          issues.push(`Missing conditions.options.${field}`);
        }
      }
    }

    // Check operators
    if (conditions?.conditions && Array.isArray(conditions.conditions)) {
      for (let i = 0; i < conditions.conditions.length; i++) {
        const condition = conditions.conditions[i];
        const operatorIssues = validateOperator(condition.operator, `conditions.conditions[${i}].operator`);
        issues.push(...operatorIssues);
      }
    }
  }

  // Check Switch node
  if (node.type === 'n8n-nodes-base.switch') {
    const rules = (node.parameters.rules as any);
    if (rules?.rules && Array.isArray(rules.rules)) {
      for (let i = 0; i < rules.rules.length; i++) {
        const rule = rules.rules[i];
        if (!rule.conditions?.options) {
          issues.push(`Missing rules.rules[${i}].conditions.options`);
        } else {
          const required = ['version', 'leftValue', 'typeValidation', 'caseSensitive'];
          for (const field of required) {
            if (!(field in rule.conditions.options)) {
              issues.push(`Missing rules.rules[${i}].conditions.options.${field}`);
            }
          }
        }

        // Check operators
        if (rule.conditions?.conditions && Array.isArray(rule.conditions.conditions)) {
          for (let j = 0; j < rule.conditions.conditions.length; j++) {
            const condition = rule.conditions.conditions[j];
            const operatorIssues = validateOperator(
              condition.operator,
              `rules.rules[${i}].conditions.conditions[${j}].operator`
            );
            issues.push(...operatorIssues);
          }
        }
      }
    }
  }

  return issues;
}

/**
 * Validate operator structure
 */
function validateOperator(operator: any, path: string): string[] {
  const issues: string[] = [];

  if (!operator || typeof operator !== 'object') {
    issues.push(`${path}: operator is missing or not an object`);
    return issues;
  }

  if (!operator.type) {
    issues.push(`${path}: missing required field 'type'`);
  } else if (!['string', 'number', 'boolean', 'dateTime', 'array', 'object'].includes(operator.type)) {
    issues.push(`${path}: invalid type "${operator.type}" (must be data type, not operation)`);
  }

  if (!operator.operation) {
    issues.push(`${path}: missing required field 'operation'`);
  }

  // Check singleValue based on operator type
  if (operator.operation) {
    if (isUnaryOperator(operator.operation)) {
      // Unary operators MUST have singleValue: true
      if (operator.singleValue !== true) {
        issues.push(`${path}: unary operator "${operator.operation}" requires singleValue: true`);
      }
    } else {
      // Binary operators should NOT have singleValue
      if (operator.singleValue === true) {
        issues.push(`${path}: binary operator "${operator.operation}" should not have singleValue: true (only unary operators need this)`);
      }
    }
  }

  return issues;
}
