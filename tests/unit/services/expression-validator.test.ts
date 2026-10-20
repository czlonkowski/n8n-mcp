import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ExpressionValidator } from '@/services/expression-validator';

describe('ExpressionValidator', () => {
  const defaultContext = {
    availableNodes: [],
    currentNodeName: 'TestNode',
    isInLoop: false,
    hasInputData: true
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('validateExpression', () => {
    it('should be a static method that validates expressions', () => {
      expect(typeof ExpressionValidator.validateExpression).toBe('function');
    });

    it('should return a validation result', () => {
      const result = ExpressionValidator.validateExpression('{{ $json.field }}', defaultContext);
      
      expect(result).toHaveProperty('valid');
      expect(result).toHaveProperty('errors');
      expect(result).toHaveProperty('warnings');
      expect(result).toHaveProperty('usedVariables');
      expect(result).toHaveProperty('usedNodes');
    });

    it('should validate expressions with proper syntax', () => {
      const validExpr = '{{ $json.field }}';
      const result = ExpressionValidator.validateExpression(validExpr, defaultContext);
      
      expect(result).toBeDefined();
      expect(Array.isArray(result.errors)).toBe(true);
    });

    it('should detect malformed expressions', () => {
      // Missing closing braces on an =-prefixed value (n8n treats unprefixed
      // values as literal text, so only =-values get bracket errors)
      const invalidExpr = '={{ $json.field';
      const result = ExpressionValidator.validateExpression(invalidExpr, defaultContext);

      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('validateNodeExpressions', () => {
    it('should validate all expressions in node parameters', () => {
      const parameters = {
        field1: '{{ $json.data }}',
        nested: {
          field2: 'regular text',
          field3: '{{ $node["Webhook"].json }}'
        }
      };

      const result = ExpressionValidator.validateNodeExpressions(parameters, defaultContext);

      expect(result).toHaveProperty('valid');
      expect(result).toHaveProperty('errors');
      expect(result).toHaveProperty('warnings');
    });

    it('should collect errors from invalid expressions', () => {
      const parameters = {
        badExpr: '={{ $json.field', // Missing closing on an evaluated (=) value
        goodExpr: '{{ $json.field }}'
      };

      const result = ExpressionValidator.validateNodeExpressions(parameters, defaultContext);

      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('expression patterns', () => {
    it('should recognize n8n variable patterns', () => {
      const expressions = [
        '{{ $json }}',
        '{{ $json.field }}',
        '{{ $node["NodeName"].json }}',
        '{{ $workflow.id }}',
        '{{ $now }}',
        '{{ $itemIndex }}'
      ];

      expressions.forEach(expr => {
        const result = ExpressionValidator.validateExpression(expr, defaultContext);
        expect(result).toBeDefined();
      });
    });
  });

  describe('context validation', () => {
    it('should use available nodes from context', () => {
      const contextWithNodes = {
        ...defaultContext,
        availableNodes: ['Webhook', 'Function', 'Slack']
      };

      const expr = '{{ $node["Webhook"].json }}';
      const result = ExpressionValidator.validateExpression(expr, contextWithNodes);

      expect(result.usedNodes.has('Webhook')).toBe(true);
    });
  });

  describe('bare expression detection', () => {
    it('should warn on bare $json.name', () => {
      const params = { value: '$json.name' };
      const result = ExpressionValidator.validateNodeExpressions(params, defaultContext);
      expect(result.warnings.some(w => w.includes('unwrapped expression'))).toBe(true);
    });

    it('should warn on bare $node["Webhook"].json', () => {
      const params = { value: '$node["Webhook"].json' };
      const result = ExpressionValidator.validateNodeExpressions(params, defaultContext);
      expect(result.warnings.some(w => w.includes('unwrapped expression'))).toBe(true);
    });

    it('should warn on bare $now', () => {
      const params = { value: '$now' };
      const result = ExpressionValidator.validateNodeExpressions(params, defaultContext);
      expect(result.warnings.some(w => w.includes('unwrapped expression'))).toBe(true);
    });

    it('should warn on bare $execution.id', () => {
      const params = { value: '$execution.id' };
      const result = ExpressionValidator.validateNodeExpressions(params, defaultContext);
      expect(result.warnings.some(w => w.includes('unwrapped expression'))).toBe(true);
    });

    it('should warn on bare $env.API_KEY', () => {
      const params = { value: '$env.API_KEY' };
      const result = ExpressionValidator.validateNodeExpressions(params, defaultContext);
      expect(result.warnings.some(w => w.includes('unwrapped expression'))).toBe(true);
    });

    it('should warn on bare $input.item.json.field', () => {
      const params = { value: '$input.item.json.field' };
      const result = ExpressionValidator.validateNodeExpressions(params, defaultContext);
      expect(result.warnings.some(w => w.includes('unwrapped expression'))).toBe(true);
    });

    it('should NOT warn on properly wrapped ={{ $json.name }}', () => {
      const params = { value: '={{ $json.name }}' };
      const result = ExpressionValidator.validateNodeExpressions(params, defaultContext);
      expect(result.warnings.some(w => w.includes('unwrapped expression'))).toBe(false);
    });

    it('should NOT warn on properly wrapped {{ $json.name }}', () => {
      const params = { value: '{{ $json.name }}' };
      const result = ExpressionValidator.validateNodeExpressions(params, defaultContext);
      expect(result.warnings.some(w => w.includes('unwrapped expression'))).toBe(false);
    });

    it('should NOT warn when $json appears mid-string', () => {
      const params = { value: 'The $json data is ready' };
      const result = ExpressionValidator.validateNodeExpressions(params, defaultContext);
      expect(result.warnings.some(w => w.includes('unwrapped expression'))).toBe(false);
    });

    it('should NOT warn on plain text', () => {
      const params = { value: 'Hello World' };
      const result = ExpressionValidator.validateNodeExpressions(params, defaultContext);
      expect(result.warnings.some(w => w.includes('unwrapped expression'))).toBe(false);
    });

    it('should detect bare expression in nested structure', () => {
      const params = {
        assignments: {
          assignments: [{ value: '$json.name' }]
        }
      };
      const result = ExpressionValidator.validateNodeExpressions(params, defaultContext);
      expect(result.warnings.some(w => w.includes('unwrapped expression'))).toBe(true);
    });
  });

  describe('code field exclusion', () => {
    it('should skip jsCode fields and not flag curly braces as expression brackets', () => {
      const params = {
        language: 'javaScript',
        jsCode: 'const obj = {a: 1};\nreturn [{json: obj}];'
      };
      const result = ExpressionValidator.validateNodeExpressions(params, defaultContext);
      const bracketErrors = result.errors.filter(e => e.includes('bracket'));
      expect(bracketErrors).toHaveLength(0);
    });

    it('should skip pythonCode fields', () => {
      const params = {
        language: 'python',
        pythonCode: 'result = {"key": "value"}\nreturn [{"json": result}]'
      };
      const result = ExpressionValidator.validateNodeExpressions(params, defaultContext);
      const bracketErrors = result.errors.filter(e => e.includes('bracket'));
      expect(bracketErrors).toHaveLength(0);
    });

    it('should still validate expressions in other fields of Code nodes', () => {
      const params = {
        language: 'javaScript',
        jsCode: 'return [{json: {ok: true}}];',
        someOtherField: '={{ $json.data }}'
      };
      const result = ExpressionValidator.validateNodeExpressions(params, defaultContext);
      // The expression in someOtherField should still be validated
      expect(result.valid).toBeDefined();
    });
  });

  describe('template literals inside expressions (#338, audit A4)', () => {
    // n8n's Tournament engine evaluates {{ }} content as full JavaScript,
    // including backtick template literals with ${} interpolation.
    it('accepts a ternary selecting backtick template literals (live-verified httpRequest body shape)', () => {
      const params = {
        body: '={{ $json.vat_id ? `<value>${$json.vat_id}</value>` : `<value>${$json.customer_email}</value>` }}'
      };
      const result = ExpressionValidator.validateNodeExpressions(params, defaultContext);

      expect(result.errors).toEqual([]);
      expect(result.valid).toBe(true);
    });

    it('accepts .map() with a template literal', () => {
      const params = { value: '={{ [1,2,3].map(i => `v${i}`).join(",") }}' };
      const result = ExpressionValidator.validateNodeExpressions(params, defaultContext);

      expect(result.errors).toEqual([]);
    });
  });

  describe('stale common-mistake warnings removed (audit B4)', () => {
    it('does not warn on optional chaining', () => {
      const params = { value: '={{ $json.user?.profile?.name }}' };
      const result = ExpressionValidator.validateNodeExpressions(params, defaultContext);

      expect(result.warnings).toEqual([]);
    });

    it('does not warn on bracket access with a dashed key', () => {
      const params = { value: "={{ $json['some-prop'] }}" };
      const result = ExpressionValidator.validateNodeExpressions(params, defaultContext);

      expect(result.warnings).toEqual([]);
    });

    it('does not warn on a field literally named test', () => {
      const params = { value: '={{ $json.test }}' };
      const result = ExpressionValidator.validateNodeExpressions(params, defaultContext);

      expect(result.warnings).toEqual([]);
    });

    it('still warns on a probable missing $ prefix', () => {
      const params = { value: '={{ json.field }}' };
      const result = ExpressionValidator.validateNodeExpressions(params, defaultContext);

      expect(result.warnings.some(w => w.includes('missing $ prefix'))).toBe(true);
    });

    it('does not warn about a missing $ prefix for words inside string literals (#1115)', () => {
      const result = ExpressionValidator.validateNodeExpressions(
        { value: `={{ $jmespath($('Split Customers').all(), "[?json.country=='PL'].json.name") }}` },
        { availableNodes: ['Split Customers'], hasInputData: true, isInLoop: false }
      );
      expect(result.warnings.filter(w => w.includes('missing $ prefix'))).toEqual([]);
      expect(result.errors).toEqual([]);
    });

    it('still warns when the bare word sits outside the string literal', () => {
      const result = ExpressionValidator.validateNodeExpressions(
        { value: `={{ json.name + "json" }}` },
        { availableNodes: [], hasInputData: true, isInLoop: false }
      );
      expect(result.warnings.some(w => w.includes('missing $ prefix'))).toBe(true);
    });
  });

  describe('bracket balance on literal and JSON-body fields (audit A6)', () => {
    it('does not error on =-prefixed JSON body with stray closing braces', () => {
      const params = {
        body: '={"chat_id": {{ $json.id }}, "reply_markup": {"keyboard": {{ $json.kb }}}}'
      };
      const result = ExpressionValidator.validateNodeExpressions(params, defaultContext);

      expect(result.errors).toEqual([]);
    });

    it('does not error on an unprefixed literal with unbalanced braces', () => {
      const params = {
        html: '<p>{{ $json.title }}</p> <style>.a{color:red}}</style>'
      };
      const result = ExpressionValidator.validateNodeExpressions(params, defaultContext);

      expect(result.errors).toEqual([]);
    });

    it('still errors on an =-prefixed expression with a dangling {{', () => {
      const params = { value: '={{ $json.name' };
      const result = ExpressionValidator.validateNodeExpressions(params, defaultContext);

      expect(result.errors.some(e => e.includes('Unmatched expression brackets'))).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('should handle empty expressions', () => {
      const result = ExpressionValidator.validateExpression('{{ }}', defaultContext);
      // The implementation might consider empty expressions as valid
      expect(result).toBeDefined();
      expect(Array.isArray(result.errors)).toBe(true);
    });

    it('should handle non-expression text', () => {
      const result = ExpressionValidator.validateExpression('regular text without expressions', defaultContext);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should handle nested expressions', () => {
      const expr = '{{ $json[{{ $json.index }}] }}'; // Nested expressions not allowed
      const result = ExpressionValidator.validateExpression(expr, defaultContext);
      expect(result).toBeDefined();
    });
  });
  describe('$jmespath inside expressions (#1114)', () => {
    const context = { availableNodes: [], hasInputData: true, isInLoop: false };
    const validate = (value: string) => ExpressionValidator.validateNodeExpressions({ value }, context);

    it('accepts a well-formed query', () => {
      const result = validate("={{ $jmespath($json, \"customers[?revenue > `100000` && country == 'PL'].name\") }}");
      expect(result.errors).toEqual([]);
      expect(result.warnings).toEqual([]);
    });

    it('errors on a bare literal, and/or, and a single = because n8n resolves those to null', () => {
      expect(validate('={{ $jmespath($json, "customers[?revenue > 100000].name") }}').errors).toEqual([
        'value: JMESPath literal 100000 must be wrapped in backticks; n8n resolves the expression to null instead of reporting the parse error. Write > `100000`',
      ]);
      expect(validate('={{ $jmespath($json, "a[?x == `1` and y == `2`]") }}').errors[0]).toContain('no "and" operator');
      expect(validate('={{ $jmespath($json, "a[?x = `1`]") }}').errors[0]).toContain('single =');
    });

    it('warns on a double-quoted right-hand side', () => {
      const result = validate(`={{ $jmespath($json, 'customers[?country=="PL"].name') }}`);
      expect(result.errors).toEqual([]);
      expect(result.warnings).toEqual([
        `value: JMESPath treats "PL" as an identifier, so this compares against the field named PL rather than the string; that usually matches nothing. Use a string literal: == 'PL'`,
      ]);
    });

    it('errors on reversed arguments', () => {
      expect(validate('={{ $jmespath("a.b", $json) }}').errors).toEqual([
        'value: $jmespath arguments are reversed: use $jmespath(data, "query"); n8n resolves the expression to null',
      ]);
    });

    it('reports the same mistake once per expression', () => {
      const result = validate('={{ $jmespath($json, "a[?b > 1]") + $jmespath($json, "c[?d > 1]") }}');
      expect(result.errors).toHaveLength(1);
    });

    it('says nothing about a dynamic query', () => {
      expect(validate('={{ $jmespath($json, $json.query) }}').errors).toEqual([]);
    });
  });

});