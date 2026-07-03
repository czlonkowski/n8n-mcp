import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ExpressionValidator } from '@/services/expression-validator';

// Mock the database
vi.mock('better-sqlite3');

describe('ExpressionValidator - Edge Cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Null and Undefined Handling', () => {
    it('should handle null expression gracefully', () => {
      const context = { availableNodes: ['Node1'] };
      const result = ExpressionValidator.validateExpression(null as any, context);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should handle undefined expression gracefully', () => {
      const context = { availableNodes: ['Node1'] };
      const result = ExpressionValidator.validateExpression(undefined as any, context);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should handle null context gracefully', () => {
      const result = ExpressionValidator.validateExpression('{{ $json.data }}', null as any);
      expect(result).toBeDefined();
      // With null context, it will likely have errors about missing context
      expect(result.valid).toBe(false);
    });

    it('should handle undefined context gracefully', () => {
      const result = ExpressionValidator.validateExpression('{{ $json.data }}', undefined as any);
      expect(result).toBeDefined();
      // With undefined context, it will likely have errors about missing context
      expect(result.valid).toBe(false);
    });
  });

  describe('Boundary Value Testing', () => {
    it('should handle empty string expression', () => {
      const context = { availableNodes: [] };
      const result = ExpressionValidator.validateExpression('', context);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
      expect(result.usedVariables.size).toBe(0);
    });

    it('should handle extremely long expressions', () => {
      const longExpression = '{{ ' + '$json.field'.repeat(1000) + ' }}';
      const context = { availableNodes: ['Node1'] };
      
      const start = Date.now();
      const result = ExpressionValidator.validateExpression(longExpression, context);
      const duration = Date.now() - start;
      
      expect(result).toBeDefined();
      expect(duration).toBeLessThan(1000); // Should process within 1 second
    });

    it('should handle deeply nested property access', () => {
      const deepExpression = '{{ $json' + '.property'.repeat(50) + ' }}';
      const context = { availableNodes: ['Node1'] };
      
      const result = ExpressionValidator.validateExpression(deepExpression, context);
      expect(result.valid).toBe(true);
      expect(result.usedVariables.has('$json')).toBe(true);
    });

    it('should handle many different variables in one expression', () => {
      const complexExpression = `{{
        $json.data + 
        $node["Node1"].json.value +
        $input.item.field +
        $items("Node2", 0)[0].data +
        $parameter["apiKey"] +
        $env.API_URL +
        $workflow.name +
        $execution.id +
        $itemIndex +
        $now
      }}`;
      
      const context = { 
        availableNodes: ['Node1', 'Node2'],
        hasInputData: true
      };
      
      const result = ExpressionValidator.validateExpression(complexExpression, context);
      expect(result.usedVariables.size).toBeGreaterThan(5);
      expect(result.usedNodes.has('Node1')).toBe(true);
      expect(result.usedNodes.has('Node2')).toBe(true);
    });
  });

  describe('Invalid Syntax Handling', () => {
    it('should detect unclosed expressions in =-prefixed values', () => {
      const expressions = [
        '={{ $json.field',
        '={{ $json.field }'
      ];

      const context = { availableNodes: [] };

      expressions.forEach(expr => {
        const result = ExpressionValidator.validateExpression(expr, context);
        expect(result.errors.some(e => e.includes('Unmatched'))).toBe(true);
      });
    });

    it('should not flag unprefixed values or stray closing braces (n8n renders them as literal text)', () => {
      const expressions = [
        '{{ $json.field',      // no = prefix: n8n never evaluates it
        '$json.field }}',      // stray closer, no opener
        '{ $json.field }}',    // single-brace opener (tpl-6191 shape)
        '=$json.field }}',     // = prefix but no {{ — leftover }} is literal
        '={ $json.field }}'    // = prefix, single-brace opener
      ];

      const context = { availableNodes: [] };

      expressions.forEach(expr => {
        const result = ExpressionValidator.validateExpression(expr, context);
        expect(result.errors.some(e => e.includes('Unmatched')), expr).toBe(false);
      });
    });

    it('should detect nested expressions', () => {
      const nestedExpression = '{{ $json.field + {{ $node["Node1"].json }} }}';
      const context = { availableNodes: ['Node1'] };
      
      const result = ExpressionValidator.validateExpression(nestedExpression, context);
      expect(result.errors.some(e => e.includes('Nested expressions'))).toBe(true);
    });

    it('should detect empty expressions', () => {
      const emptyExpression = 'Value: {{}}';
      const context = { availableNodes: [] };
      
      const result = ExpressionValidator.validateExpression(emptyExpression, context);
      expect(result.errors.some(e => e.includes('Empty expression'))).toBe(true);
    });

    it('should handle malformed node references', () => {
      const expressions = [
        '{{ $node[].json }}',
        '{{ $node[""].json }}',
        '{{ $node[Node1].json }}', // Missing quotes
        '{{ $node["Node1" ].json }}' // Extra space - this might actually be valid
      ];
      
      const context = { availableNodes: ['Node1'] };
      
      expressions.forEach(expr => {
        const result = ExpressionValidator.validateExpression(expr, context);
        // Some of these might generate warnings or errors
        expect(result).toBeDefined();
      });
    });
  });

  describe('Special Characters and Unicode', () => {
    it('should handle special characters in node names', () => {
      const specialNodes = ['Node-123', 'Node_Test', 'Node@Special', 'Node 中文', 'Node😊'];
      const context = { availableNodes: specialNodes };
      
      specialNodes.forEach(nodeName => {
        const expression = `{{ $node["${nodeName}"].json.value }}`;
        const result = ExpressionValidator.validateExpression(expression, context);
        expect(result.usedNodes.has(nodeName)).toBe(true);
        expect(result.errors.filter(e => e.includes(nodeName))).toHaveLength(0);
      });
    });

    it('should handle Unicode in property names', () => {
      const expression = '{{ $json.名前 + $json.שם + $json.имя }}';
      const context = { availableNodes: [] };
      
      const result = ExpressionValidator.validateExpression(expression, context);
      expect(result.usedVariables.has('$json')).toBe(true);
    });
  });

  describe('Context Validation', () => {
    it('should warn about $input when no input data available', () => {
      const expression = '{{ $input.item.data }}';
      const context = { 
        availableNodes: [],
        hasInputData: false
      };
      
      const result = ExpressionValidator.validateExpression(expression, context);
      expect(result.warnings.some(w => w.includes('$input'))).toBe(true);
    });

    it('should handle references to non-existent nodes', () => {
      const expression = '{{ $node["NonExistentNode"].json.value }}';
      const context = { availableNodes: ['Node1', 'Node2'] };
      
      const result = ExpressionValidator.validateExpression(expression, context);
      expect(result.errors.some(e => e.includes('NonExistentNode'))).toBe(true);
    });

    it('should validate $items function references', () => {
      const expression = '{{ $items("NonExistentNode", 0)[0].json }}';
      const context = { availableNodes: ['Node1', 'Node2'] };
      
      const result = ExpressionValidator.validateExpression(expression, context);
      expect(result.errors.some(e => e.includes('NonExistentNode'))).toBe(true);
    });
  });

  describe('Complex Expression Patterns', () => {
    it('should handle JavaScript operations in expressions', () => {
      const expressions = [
        '{{ $json.count > 10 ? "high" : "low" }}',
        '{{ Math.round($json.price * 1.2) }}',
        '{{ $json.items.filter(item => item.active).length }}',
        '{{ new Date($json.timestamp).toISOString() }}',
        '{{ $json.name.toLowerCase().replace(" ", "-") }}'
      ];
      
      const context = { availableNodes: [] };
      
      expressions.forEach(expr => {
        const result = ExpressionValidator.validateExpression(expr, context);
        expect(result.usedVariables.has('$json')).toBe(true);
      });
    });

    it('should handle array access patterns', () => {
      const expressions = [
        '{{ $json[0] }}',
        '{{ $json.items[5].name }}',
        '{{ $node["Node1"].json[0].data[1] }}',
        '{{ $json["items"][0]["name"] }}'
      ];
      
      const context = { availableNodes: ['Node1'] };
      
      expressions.forEach(expr => {
        const result = ExpressionValidator.validateExpression(expr, context);
        expect(result.usedVariables.size).toBeGreaterThan(0);
      });
    });
  });

  describe('validateNodeExpressions', () => {
    it('should validate all expressions in node parameters', () => {
      const parameters = {
        field1: '{{ $json.data }}',
        field2: 'static value',
        nested: {
          field3: '{{ $node["Node1"].json.value }}',
          array: [
            '{{ $json.item1 }}',
            'not an expression',
            '{{ $json.item2 }}'
          ]
        }
      };
      
      const context = { availableNodes: ['Node1'] };
      const result = ExpressionValidator.validateNodeExpressions(parameters, context);
      
      expect(result.usedVariables.has('$json')).toBe(true);
      expect(result.usedNodes.has('Node1')).toBe(true);
      expect(result.valid).toBe(true);
    });

    it('should handle null/undefined in parameters', () => {
      const parameters = {
        field1: null,
        field2: undefined,
        field3: '',
        field4: '{{ $json.data }}'
      };
      
      const context = { availableNodes: [] };
      const result = ExpressionValidator.validateNodeExpressions(parameters, context);
      
      expect(result.usedVariables.has('$json')).toBe(true);
      expect(result.errors.length).toBe(0);
    });

    it('should handle circular references in parameters', () => {
      const parameters: any = {
        field1: '{{ $json.data }}'
      };
      parameters.circular = parameters;
      
      const context = { availableNodes: [] };
      // Should not throw
      expect(() => {
        ExpressionValidator.validateNodeExpressions(parameters, context);
      }).not.toThrow();
    });

    it('should aggregate errors from multiple expressions', () => {
      const parameters = {
        field1: '{{ $node["Missing1"].json }}',
        field2: '{{ $node["Missing2"].json }}',
        field3: '{{ }}', // Empty expression
        field4: '{{ $json.valid }}'
      };
      
      const context = { availableNodes: ['ValidNode'] };
      const result = ExpressionValidator.validateNodeExpressions(parameters, context);
      
      expect(result.valid).toBe(false);
      // Should have at least 3 errors: 2 missing nodes + 1 empty expression
      expect(result.errors.length).toBeGreaterThanOrEqual(3);
      expect(result.usedVariables.has('$json')).toBe(true);
    });
  });

  describe('Performance Edge Cases', () => {
    it('should handle recursive parameter structures efficiently', () => {
      const createNestedObject = (depth: number): any => {
        if (depth === 0) return '{{ $json.value }}';
        return {
          level: depth,
          expression: `{{ $json.level${depth} }}`,
          nested: createNestedObject(depth - 1)
        };
      };
      
      const deepParameters = createNestedObject(100);
      const context = { availableNodes: [] };
      
      const start = Date.now();
      const result = ExpressionValidator.validateNodeExpressions(deepParameters, context);
      const duration = Date.now() - start;
      
      expect(result).toBeDefined();
      expect(duration).toBeLessThan(1000); // Should complete within 1 second
    });

    it('should handle large arrays of expressions', () => {
      const parameters = {
        items: Array(1000).fill(null).map((_, i) => `{{ $json.item${i} }}`)
      };
      
      const context = { availableNodes: [] };
      const result = ExpressionValidator.validateNodeExpressions(parameters, context);
      
      expect(result.usedVariables.has('$json')).toBe(true);
      expect(result.valid).toBe(true);
    });
  });

  describe('Error Message Quality', () => {
    it('should provide helpful error messages', () => {
      const testCases = [
        {
          expression: '{{ $node["Node With Spaces"].json }}',
          context: { availableNodes: ['NodeWithSpaces'] },
          expectedError: 'Node With Spaces'
        },
        {
          expression: '{{ $items("WrongNode", -1) }}',
          context: { availableNodes: ['RightNode'] },
          expectedError: 'WrongNode'
        }
      ];
      
      testCases.forEach(({ expression, context, expectedError }) => {
        const result = ExpressionValidator.validateExpression(expression, context);
        const hasRelevantError = result.errors.some(e => e.includes(expectedError));
        expect(hasRelevantError).toBe(true);
      });
    });
  });
});