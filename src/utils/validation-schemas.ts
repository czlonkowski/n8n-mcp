/**
 * Zod validation schemas for MCP tool parameters
 * Provides robust input validation with detailed error messages
 */

// Simple validation without zod for now, since it's not installed
// We can use TypeScript's built-in validation with better error messages

export class ValidationError extends Error {
  constructor(message: string, public field?: string, public value?: any) {
    super(message);
    this.name = 'ValidationError';
  }
}

// SECURITY (GHSA-8g7g-hmwm-6rv2): validate caller-supplied URL path segment.
const API_PATH_SEGMENT_PATTERN = /^[A-Za-z0-9_-]+$/;
const API_PATH_SEGMENT_MAX_LENGTH = 128;

export function encodeApiPathSegment(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ValidationError(
      `${fieldName} is required and must be a non-empty string`,
      fieldName,
      value
    );
  }
  if (value.length > API_PATH_SEGMENT_MAX_LENGTH) {
    throw new ValidationError(
      `${fieldName} exceeds maximum length of ${API_PATH_SEGMENT_MAX_LENGTH} characters`,
      fieldName
    );
  }
  if (!API_PATH_SEGMENT_PATTERN.test(value)) {
    throw new ValidationError(
      `Invalid ${fieldName}: must contain only alphanumeric characters, hyphens, or underscores`,
      fieldName,
      value
    );
  }
  return encodeURIComponent(value);
}

export interface ValidationResult {
  valid: boolean;
  errors: Array<{
    field: string;
    message: string;
    value?: any;
  }>;
}

/**
 * Basic validation utilities
 */
export class Validator {
  /**
   * Validate that a value is a non-empty string
   */
  static validateString(value: any, fieldName: string, required: boolean = true): ValidationResult {
    const errors: Array<{field: string, message: string, value?: any}> = [];
    
    if (required && (value === undefined || value === null)) {
      errors.push({
        field: fieldName,
        message: `${fieldName} is required`,
        value
      });
    } else if (value !== undefined && value !== null && typeof value !== 'string') {
      errors.push({
        field: fieldName,
        message: `${fieldName} must be a string, got ${typeof value}`,
        value
      });
    } else if (required && typeof value === 'string' && value.trim().length === 0) {
      errors.push({
        field: fieldName,
        message: `${fieldName} cannot be empty`,
        value
      });
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Validate that a value is a valid object (not null, not array)
   */
  static validateObject(value: any, fieldName: string, required: boolean = true): ValidationResult {
    const errors: Array<{field: string, message: string, value?: any}> = [];
    
    if (required && (value === undefined || value === null)) {
      errors.push({
        field: fieldName,
        message: `${fieldName} is required`,
        value
      });
    } else if (value !== undefined && value !== null) {
      if (typeof value !== 'object') {
        errors.push({
          field: fieldName,
          message: `${fieldName} must be an object, got ${typeof value}`,
          value
        });
      } else if (Array.isArray(value)) {
        errors.push({
          field: fieldName,
          message: `${fieldName} must be an object, not an array`,
          value
        });
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Validate that a value is an array
   */
  static validateArray(value: any, fieldName: string, required: boolean = true): ValidationResult {
    const errors: Array<{field: string, message: string, value?: any}> = [];
    
    if (required && (value === undefined || value === null)) {
      errors.push({
        field: fieldName,
        message: `${fieldName} is required`,
        value
      });
    } else if (value !== undefined && value !== null && !Array.isArray(value)) {
      errors.push({
        field: fieldName,
        message: `${fieldName} must be an array, got ${typeof value}`,
        value
      });
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Validate that a value is a number
   */
  static validateNumber(value: any, fieldName: string, required: boolean = true, min?: number, max?: number): ValidationResult {
    const errors: Array<{field: string, message: string, value?: any}> = [];
    
    if (required && (value === undefined || value === null)) {
      errors.push({
        field: fieldName,
        message: `${fieldName} is required`,
        value
      });
    } else if (value !== undefined && value !== null) {
      if (typeof value !== 'number' || isNaN(value)) {
        errors.push({
          field: fieldName,
          message: `${fieldName} must be a number, got ${typeof value}`,
          value
        });
      } else {
        if (min !== undefined && value < min) {
          errors.push({
            field: fieldName,
            message: `${fieldName} must be at least ${min}, got ${value}`,
            value
          });
        }
        if (max !== undefined && value > max) {
          errors.push({
            field: fieldName,
            message: `${fieldName} must be at most ${max}, got ${value}`,
            value
          });
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Validate that a value is one of allowed values
   */
  static validateEnum<T>(value: any, fieldName: string, allowedValues: T[], required: boolean = true): ValidationResult {
    const errors: Array<{field: string, message: string, value?: any}> = [];
    
    if (required && (value === undefined || value === null)) {
      errors.push({
        field: fieldName,
        message: `${fieldName} is required`,
        value
      });
    } else if (value !== undefined && value !== null && !allowedValues.includes(value)) {
      errors.push({
        field: fieldName,
        message: `${fieldName} must be one of: ${allowedValues.join(', ')}, got "${value}"`,
        value
      });
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Combine multiple validation results
   */
  static combineResults(...results: ValidationResult[]): ValidationResult {
    const allErrors = results.flatMap(r => r.errors);
    return {
      valid: allErrors.length === 0,
      errors: allErrors
    };
  }

  /**
   * Create a detailed error message from validation result
   */
  static formatErrors(result: ValidationResult, toolName?: string): string {
    if (result.valid) return '';
    
    const prefix = toolName ? `${toolName}: ` : '';
    const errors = result.errors.map(e => `  • ${e.field}: ${e.message}`).join('\n');
    
    return `${prefix}Validation failed:\n${errors}`;
  }
}

/**
 * Tool-specific validation schemas
 */
export class ToolValidation {
  /**
   * Validate parameters for validate_node_operation tool
   */
  static validateNodeOperation(args: any): ValidationResult {
    const nodeTypeResult = Validator.validateString(args.nodeType, 'nodeType');
    const configResult = Validator.validateObject(args.config, 'config');
    const profileResult = Validator.validateEnum(
      args.profile, 
      'profile', 
      ['minimal', 'runtime', 'ai-friendly', 'strict'], 
      false // optional
    );

    return Validator.combineResults(nodeTypeResult, configResult, profileResult);
  }

  /**
   * Validate parameters for validate_node_minimal tool
   */
  static validateNodeMinimal(args: any): ValidationResult {
    const nodeTypeResult = Validator.validateString(args.nodeType, 'nodeType');
    const configResult = Validator.validateObject(args.config, 'config');

    return Validator.combineResults(nodeTypeResult, configResult);
  }

  /**
   * Validate parameters for validate_workflow tool
   */
  static validateWorkflow(args: any): ValidationResult {
    const workflowResult = Validator.validateObject(args.workflow, 'workflow');
    
    // Validate workflow structure if it's an object
    let nodesResult: ValidationResult = { valid: true, errors: [] };
    let connectionsResult: ValidationResult = { valid: true, errors: [] };
    
    if (workflowResult.valid && args.workflow) {
      nodesResult = Validator.validateArray(args.workflow.nodes, 'workflow.nodes');
      connectionsResult = Validator.validateObject(args.workflow.connections, 'workflow.connections');
    }

    const optionsResult = args.options ? 
      Validator.validateObject(args.options, 'options', false) : 
      { valid: true, errors: [] };

    return Validator.combineResults(workflowResult, nodesResult, connectionsResult, optionsResult);
  }

  /**
   * Validate parameters for search_nodes tool
   */
  static validateSearchNodes(args: any): ValidationResult {
    const queryResult = Validator.validateString(args.query, 'query');
    const limitResult = Validator.validateNumber(args.limit, 'limit', false, 1, 200);
    const modeResult = Validator.validateEnum(
      args.mode, 
      'mode', 
      ['OR', 'AND', 'FUZZY'], 
      false
    );

    return Validator.combineResults(queryResult, limitResult, modeResult);
  }

  /**
   * Validate parameters for list_node_templates tool
   */
  static validateListNodeTemplates(args: any): ValidationResult {
    const nodeTypesResult = Validator.validateArray(args.nodeTypes, 'nodeTypes');
    const limitResult = Validator.validateNumber(args.limit, 'limit', false, 1, 50);

    return Validator.combineResults(nodeTypesResult, limitResult);
  }

  /**
   * Validate parameters for n8n workflow operations
   */
  static validateWorkflowId(args: any): ValidationResult {
    return Validator.validateString(args.id, 'id');
  }

  /**
   * Validate parameters for n8n_create_workflow tool
   */
  static validateCreateWorkflow(args: any): ValidationResult {
    const nameResult = Validator.validateString(args.name, 'name');
    const nodesResult = Validator.validateArray(args.nodes, 'nodes');
    const connectionsResult = Validator.validateObject(args.connections, 'connections');
    const settingsResult = args.settings ? 
      Validator.validateObject(args.settings, 'settings', false) : 
      { valid: true, errors: [] };

    return Validator.combineResults(nameResult, nodesResult, connectionsResult, settingsResult);
  }
}