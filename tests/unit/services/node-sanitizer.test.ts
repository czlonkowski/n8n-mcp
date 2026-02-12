/**
 * Node Sanitizer Tests
 * Tests for auto-adding required metadata to filter-based nodes
 */

import { describe, it, expect } from 'vitest';
import { sanitizeNode, validateNodeMetadata } from '../../../src/services/node-sanitizer';
import { WorkflowNode } from '../../../src/types/n8n-api';

describe('Node Sanitizer', () => {
  describe('sanitizeNode', () => {
    it('should add complete filter options to IF v2.2 node', () => {
      const node: WorkflowNode = {
        id: 'test-if',
        name: 'IF Node',
        type: 'n8n-nodes-base.if',
        typeVersion: 2.2,
        position: [0, 0],
        parameters: {
          conditions: {
            conditions: [
              {
                id: 'condition1',
                leftValue: '={{ $json.value }}',
                rightValue: '',
                operator: {
                  type: 'string',
                  operation: 'isNotEmpty'
                }
              }
            ]
          }
        }
      };

      const sanitized = sanitizeNode(node);

      // Check that options were added
      expect(sanitized.parameters.conditions).toHaveProperty('options');
      const options = (sanitized.parameters.conditions as any).options;

      expect(options).toEqual({
        version: 2,
        leftValue: '',
        caseSensitive: true,
        typeValidation: 'strict'
      });
    });

    it('should preserve existing options while adding missing fields', () => {
      const node: WorkflowNode = {
        id: 'test-if-partial',
        name: 'IF Node Partial',
        type: 'n8n-nodes-base.if',
        typeVersion: 2.2,
        position: [0, 0],
        parameters: {
          conditions: {
            options: {
              caseSensitive: false // User-provided value
            },
            conditions: []
          }
        }
      };

      const sanitized = sanitizeNode(node);
      const options = (sanitized.parameters.conditions as any).options;

      // Should preserve user value
      expect(options.caseSensitive).toBe(false);

      // Should add missing fields
      expect(options.version).toBe(2);
      expect(options.leftValue).toBe('');
      expect(options.typeValidation).toBe('strict');
    });

    it('should fix invalid operator structure (type field misuse)', () => {
      const node: WorkflowNode = {
        id: 'test-if-bad-operator',
        name: 'IF Bad Operator',
        type: 'n8n-nodes-base.if',
        typeVersion: 2.2,
        position: [0, 0],
        parameters: {
          conditions: {
            conditions: [
              {
                id: 'condition1',
                leftValue: '={{ $json.value }}',
                rightValue: '',
                operator: {
                  type: 'isNotEmpty' // WRONG: type should be data type, not operation
                }
              }
            ]
          }
        }
      };

      const sanitized = sanitizeNode(node);
      const condition = (sanitized.parameters.conditions as any).conditions[0];

      // Should fix operator structure
      expect(condition.operator.type).toBe('boolean'); // Inferred data type (isEmpty/isNotEmpty are boolean ops)
      expect(condition.operator.operation).toBe('isNotEmpty'); // Moved to operation field
    });

    it('should add singleValue for unary operators', () => {
      const node: WorkflowNode = {
        id: 'test-if-unary',
        name: 'IF Unary',
        type: 'n8n-nodes-base.if',
        typeVersion: 2.2,
        position: [0, 0],
        parameters: {
          conditions: {
            conditions: [
              {
                id: 'condition1',
                leftValue: '={{ $json.value }}',
                rightValue: '',
                operator: {
                  type: 'string',
                  operation: 'isNotEmpty'
                  // Missing singleValue
                }
              }
            ]
          }
        }
      };

      const sanitized = sanitizeNode(node);
      const condition = (sanitized.parameters.conditions as any).conditions[0];

      expect(condition.operator.singleValue).toBe(true);
    });

    it('should sanitize Switch v3.2 node rules', () => {
      const node: WorkflowNode = {
        id: 'test-switch',
        name: 'Switch Node',
        type: 'n8n-nodes-base.switch',
        typeVersion: 3.2,
        position: [0, 0],
        parameters: {
          mode: 'rules',
          rules: {
            rules: [
              {
                outputKey: 'audio',
                conditions: {
                  conditions: [
                    {
                      id: 'cond1',
                      leftValue: '={{ $json.fileType }}',
                      rightValue: 'audio',
                      operator: {
                        type: 'string',
                        operation: 'equals'
                      }
                    }
                  ]
                }
              }
            ]
          }
        }
      };

      const sanitized = sanitizeNode(node);
      const rule = (sanitized.parameters.rules as any).rules[0];

      // Check that options were added to rule conditions
      expect(rule.conditions).toHaveProperty('options');
      expect(rule.conditions.options).toEqual({
        version: 2,
        leftValue: '',
        caseSensitive: true,
        typeValidation: 'strict'
      });
    });

    it('should not modify non-filter nodes', () => {
      const node: WorkflowNode = {
        id: 'test-http',
        name: 'HTTP Request',
        type: 'n8n-nodes-base.httpRequest',
        typeVersion: 4.2,
        position: [0, 0],
        parameters: {
          method: 'GET',
          url: 'https://example.com'
        }
      };

      const sanitized = sanitizeNode(node);

      // Should return unchanged
      expect(sanitized).toEqual(node);
    });

    it('should not modify old IF versions', () => {
      const node: WorkflowNode = {
        id: 'test-if-old',
        name: 'Old IF',
        type: 'n8n-nodes-base.if',
        typeVersion: 2.0, // Pre-filter version
        position: [0, 0],
        parameters: {
          conditions: []
        }
      };

      const sanitized = sanitizeNode(node);

      // Should return unchanged
      expect(sanitized).toEqual(node);
    });

    it('should add singleValue for object type unary operators', () => {
      const node: WorkflowNode = {
        id: 'test-if-object-unary',
        name: 'IF Object Empty',
        type: 'n8n-nodes-base.if',
        typeVersion: 2.2,
        position: [0, 0],
        parameters: {
          conditions: {
            conditions: [
              {
                id: 'condition1',
                leftValue: '={{ $json.value }}',
                rightValue: '',
                operator: {
                  type: 'object',
                  operation: 'empty'
                  // Missing singleValue
                }
              }
            ]
          }
        }
      };

      const sanitized = sanitizeNode(node);
      const condition = (sanitized.parameters.conditions as any).conditions[0];

      expect(condition.operator.singleValue).toBe(true);
    });

    it('should preserve singleValue on object/empty operator', () => {
      const node: WorkflowNode = {
        id: 'test-if-object-preserve',
        name: 'IF Object Preserve',
        type: 'n8n-nodes-base.if',
        typeVersion: 2.2,
        position: [0, 0],
        parameters: {
          conditions: {
            conditions: [
              {
                id: 'condition1',
                leftValue: '={{ $json.value }}',
                rightValue: '',
                operator: {
                  type: 'object',
                  operation: 'empty',
                  singleValue: true
                }
              }
            ]
          }
        }
      };

      const sanitized = sanitizeNode(node);
      const condition = (sanitized.parameters.conditions as any).conditions[0];

      // Must NOT strip singleValue from object/empty (it's unary, not binary)
      expect(condition.operator.singleValue).toBe(true);
      expect(condition.operator.type).toBe('object');
      expect(condition.operator.operation).toBe('empty');
    });

    it('should remove singleValue from binary operators like "equals"', () => {
      const node: WorkflowNode = {
        id: 'test-if-binary',
        name: 'IF Binary Operator',
        type: 'n8n-nodes-base.if',
        typeVersion: 2.2,
        position: [0, 0],
        parameters: {
          conditions: {
            conditions: [
              {
                id: 'condition1',
                leftValue: '={{ $json.value }}',
                rightValue: 'test',
                operator: {
                  type: 'string',
                  operation: 'equals',
                  singleValue: true // WRONG: equals is binary, not unary
                }
              }
            ]
          }
        }
      };

      const sanitized = sanitizeNode(node);
      const condition = (sanitized.parameters.conditions as any).conditions[0];

      // Should remove singleValue from binary operator
      expect(condition.operator.singleValue).toBeUndefined();
      expect(condition.operator.type).toBe('string');
      expect(condition.operator.operation).toBe('equals');
    });
  });

  describe('validateNodeMetadata', () => {
    it('should detect missing conditions.options', () => {
      const node: WorkflowNode = {
        id: 'test',
        name: 'IF Missing Options',
        type: 'n8n-nodes-base.if',
        typeVersion: 2.2,
        position: [0, 0],
        parameters: {
          conditions: {
            conditions: []
            // Missing options
          }
        }
      };

      const issues = validateNodeMetadata(node);

      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0]).toBe('Missing conditions.options');
    });

    it('should detect missing operator.type', () => {
      const node: WorkflowNode = {
        id: 'test',
        name: 'IF Bad Operator',
        type: 'n8n-nodes-base.if',
        typeVersion: 2.2,
        position: [0, 0],
        parameters: {
          conditions: {
            options: {
              version: 2,
              leftValue: '',
              caseSensitive: true,
              typeValidation: 'strict'
            },
            conditions: [
              {
                id: 'cond1',
                leftValue: '={{ $json.value }}',
                rightValue: '',
                operator: {
                  operation: 'equals'
                  // Missing type
                }
              }
            ]
          }
        }
      };

      const issues = validateNodeMetadata(node);

      expect(issues.length).toBeGreaterThan(0);
      expect(issues.some(issue => issue.includes("missing required field 'type'"))).toBe(true);
    });

    it('should detect invalid operator.type value', () => {
      const node: WorkflowNode = {
        id: 'test',
        name: 'IF Invalid Type',
        type: 'n8n-nodes-base.if',
        typeVersion: 2.2,
        position: [0, 0],
        parameters: {
          conditions: {
            options: {
              version: 2,
              leftValue: '',
              caseSensitive: true,
              typeValidation: 'strict'
            },
            conditions: [
              {
                id: 'cond1',
                leftValue: '={{ $json.value }}',
                rightValue: '',
                operator: {
                  type: 'isNotEmpty', // WRONG: operation name, not data type
                  operation: 'isNotEmpty'
                }
              }
            ]
          }
        }
      };

      const issues = validateNodeMetadata(node);

      expect(issues.some(issue => issue.includes('invalid type "isNotEmpty"'))).toBe(true);
    });

    it('should detect missing singleValue for unary operators', () => {
      const node: WorkflowNode = {
        id: 'test',
        name: 'IF Missing SingleValue',
        type: 'n8n-nodes-base.if',
        typeVersion: 2.2,
        position: [0, 0],
        parameters: {
          conditions: {
            options: {
              version: 2,
              leftValue: '',
              caseSensitive: true,
              typeValidation: 'strict'
            },
            conditions: [
              {
                id: 'cond1',
                leftValue: '={{ $json.value }}',
                rightValue: '',
                operator: {
                  type: 'string',
                  operation: 'isNotEmpty'
                  // Missing singleValue: true
                }
              }
            ]
          }
        }
      };

      const issues = validateNodeMetadata(node);

      expect(issues.length).toBeGreaterThan(0);
      expect(issues.some(issue => issue.includes('requires singleValue: true'))).toBe(true);
    });

    it('should detect singleValue on binary operators', () => {
      const node: WorkflowNode = {
        id: 'test',
        name: 'IF Binary with SingleValue',
        type: 'n8n-nodes-base.if',
        typeVersion: 2.2,
        position: [0, 0],
        parameters: {
          conditions: {
            options: {
              version: 2,
              leftValue: '',
              caseSensitive: true,
              typeValidation: 'strict'
            },
            conditions: [
              {
                id: 'cond1',
                leftValue: '={{ $json.value }}',
                rightValue: 'test',
                operator: {
                  type: 'string',
                  operation: 'equals',
                  singleValue: true  // WRONG: equals is binary
                }
              }
            ]
          }
        }
      };

      const issues = validateNodeMetadata(node);

      expect(issues.length).toBeGreaterThan(0);
      expect(issues.some(issue => issue.includes('should not have singleValue: true'))).toBe(true);
    });

    it('should return empty array for valid node', () => {
      const node: WorkflowNode = {
        id: 'test',
        name: 'Valid IF',
        type: 'n8n-nodes-base.if',
        typeVersion: 2.2,
        position: [0, 0],
        parameters: {
          conditions: {
            options: {
              version: 2,
              leftValue: '',
              caseSensitive: true,
              typeValidation: 'strict'
            },
            conditions: [
              {
                id: 'cond1',
                leftValue: '={{ $json.value }}',
                rightValue: '',
                operator: {
                  type: 'string',
                  operation: 'isNotEmpty',
                  singleValue: true
                }
              }
            ]
          }
        }
      };

      const issues = validateNodeMetadata(node);

      expect(issues).toEqual([]);
    });

  });
});
