import { describe, it, expect } from 'vitest';
import {
  validateConditionNodeStructure,
  validateOperatorStructure,
} from '@/services/n8n-validation';
import { EnhancedConfigValidator } from '@/services/enhanced-config-validator';

/**
 * Regression tests for validator false positives on IF/Switch/Filter nodes
 * (audit slug: n8n-validation-filter-rules).
 *
 * Live-verified n8n runtime semantics (n8n 2.62.0):
 * - `conditions.options` and all its sub-fields (version, leftValue,
 *   caseSensitive, typeValidation) are optional with defaults.
 * - Unary-ness is derived from the operation name; `singleValue` is
 *   UI-persisted metadata that the execution engine ignores.
 * - Legacy v1 operation names (equal, isNotEmpty, ...) inside a v2 filter
 *   structure silently evaluate to false — a genuine defect that must
 *   still be reported.
 */
describe('n8n-validation filter rules (false-positive regressions)', () => {
  describe('validateConditionNodeStructure — options are optional', () => {
    it('IF v2.2 without conditions.options and unary op lacking singleValue validates clean', () => {
      const node = {
        id: '1', name: 'IF', type: 'n8n-nodes-base.if', typeVersion: 2.2,
        position: [0, 0] as [number, number],
        parameters: {
          conditions: {
            conditions: [{
              id: 'c1',
              leftValue: '={{ $json.name }}',
              rightValue: '',
              operator: { type: 'string', operation: 'notEmpty' }
            }],
            combinator: 'and'
          }
        }
      };
      expect(validateConditionNodeStructure(node)).toHaveLength(0);
    });

    it('IF v2.3 with options missing the version sub-field validates clean', () => {
      const node = {
        id: '1', name: 'IF', type: 'n8n-nodes-base.if', typeVersion: 2.3,
        position: [0, 0] as [number, number],
        parameters: {
          conditions: {
            options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
            conditions: [{
              id: 'c1',
              leftValue: '={{ $json.x }}',
              rightValue: 'a',
              operator: { type: 'string', operation: 'equals' }
            }],
            combinator: 'and'
          }
        }
      };
      expect(validateConditionNodeStructure(node)).toHaveLength(0);
    });

    it('Switch v3.4 rule without options and with unary op validates clean', () => {
      const node = {
        id: '1', name: 'Switch', type: 'n8n-nodes-base.switch', typeVersion: 3.4,
        position: [0, 0] as [number, number],
        parameters: {
          rules: {
            rules: [{
              conditions: {
                conditions: [{
                  id: 'c1',
                  leftValue: '={{ $json.flag }}',
                  operator: { type: 'boolean', operation: 'true' }
                }],
                combinator: 'and'
              },
              outputKey: 'Branch 1'
            }]
          }
        }
      };
      expect(validateConditionNodeStructure(node)).toHaveLength(0);
    });
  });

  describe('validateOperatorStructure — singleValue is not required metadata', () => {
    it('unary operator without singleValue is valid', () => {
      const errors = validateOperatorStructure(
        { type: 'string', operation: 'notEmpty' },
        'conditions.conditions[0].operator'
      );
      expect(errors).toHaveLength(0);
    });

    it('binary operator with singleValue: true is valid', () => {
      const errors = validateOperatorStructure(
        { type: 'string', operation: 'equals', singleValue: true },
        'conditions.conditions[0].operator'
      );
      expect(errors).toHaveLength(0);
    });

    it('unary operator with singleValue: true remains valid', () => {
      const errors = validateOperatorStructure(
        { type: 'string', operation: 'empty', singleValue: true },
        'conditions.conditions[0].operator'
      );
      expect(errors).toHaveLength(0);
    });
  });

  describe('validateOperatorStructure — true positives still fire', () => {
    it('missing type still errors', () => {
      const errors = validateOperatorStructure(
        { operation: 'equals' },
        'conditions.conditions[0].operator'
      );
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some(e => e.includes('missing required field "type"'))).toBe(true);
    });

    it('operation name in the type field still errors', () => {
      const errors = validateOperatorStructure(
        { type: 'notEmpty' },
        'conditions.conditions[0].operator'
      );
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some(e => e.includes('invalid type "notEmpty"'))).toBe(true);
    });

    it('missing operation still errors', () => {
      const errors = validateOperatorStructure(
        { type: 'string' },
        'conditions.conditions[0].operator'
      );
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some(e => e.includes('missing required field "operation"'))).toBe(true);
    });

    it('non-object operator still errors', () => {
      const errors = validateOperatorStructure(undefined, 'conditions.conditions[0].operator');
      expect(errors.length).toBeGreaterThan(0);
    });
  });

  describe('validateConditionNodeStructure — true positives still fire', () => {
    it('IF v2.2 operator missing type still errors', () => {
      const node = {
        id: '1', name: 'IF', type: 'n8n-nodes-base.if', typeVersion: 2.2,
        position: [0, 0] as [number, number],
        parameters: {
          conditions: {
            conditions: [{
              id: 'c1',
              leftValue: '={{ $json.x }}',
              rightValue: 'a',
              operator: { operation: 'equals' }
            }],
            combinator: 'and'
          }
        }
      };
      const errors = validateConditionNodeStructure(node);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some(e => e.includes('type'))).toBe(true);
    });

    it('IF v1 legacy structure is not validated against v2 rules', () => {
      const node = {
        id: '1', name: 'IF', type: 'n8n-nodes-base.if', typeVersion: 1,
        position: [0, 0] as [number, number],
        parameters: {
          conditions: { string: [{ value1: '={{ $json.x }}', value2: 'a', operation: 'equal' }] }
        }
      };
      expect(validateConditionNodeStructure(node)).toHaveLength(0);
    });
  });

  describe('legacy v1 op name inside a v2 structure still errors (guard)', () => {
    // The detection lives in EnhancedConfigValidator.validateFilterOperations;
    // this guard proves the true positive survives the false-positive fixes.
    const filterProps = [{ name: 'conditions', type: 'filter', required: true }];

    it.each(['equal', 'isNotEmpty'])('legacy op "%s" in a v2 filter structure errors', (operation) => {
      const config = {
        conditions: {
          combinator: 'and',
          conditions: [{
            id: 'c1',
            leftValue: '={{ $json.x }}',
            rightValue: 'a',
            operator: { type: 'string', operation }
          }]
        }
      };
      const result = EnhancedConfigValidator.validateWithMode(
        'nodes-base.filter', config, filterProps, 'operation', 'ai-friendly'
      );
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.message.includes('not valid for type'))).toBe(true);
    });
  });
});
