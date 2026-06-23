import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ExampleGenerator } from '@/services/example-generator';
import type { NodeExamples } from '@/services/example-generator';
import { validateConditionNodeStructure } from '@/services/n8n-validation';
import { validateNodeMetadata } from '@/services/node-sanitizer';
import { EnhancedConfigValidator } from '@/services/enhanced-config-validator';
import type { WorkflowNode } from '@/types/n8n-api';

// Mock the database
vi.mock('better-sqlite3');

// The IF node declares `conditions` as a `filter`-type property (verified in the
// node DB), which is what makes EnhancedConfigValidator enforce the combinator field.
const IF_FILTER_PROPERTIES = [
  { name: 'conditions', displayName: 'Conditions', type: 'filter' }
];

describe('ExampleGenerator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getExamples', () => {
    it('should return curated examples for HTTP Request node', () => {
      const examples = ExampleGenerator.getExamples('nodes-base.httpRequest');

      expect(examples).toHaveProperty('minimal');
      expect(examples).toHaveProperty('common');
      expect(examples).toHaveProperty('advanced');

      // Check minimal example
      expect(examples.minimal).toEqual({
        url: 'https://api.example.com/data'
      });

      // Check common example has required fields
      expect(examples.common).toMatchObject({
        method: 'POST',
        url: 'https://api.example.com/users',
        sendBody: true,
        contentType: 'json'
      });

      // Check advanced example has error handling
      expect(examples.advanced).toMatchObject({
        method: 'POST',
        onError: 'continueRegularOutput',
        retryOnFail: true,
        maxTries: 3
      });
    });

    it('should return curated examples for Webhook node', () => {
      const examples = ExampleGenerator.getExamples('nodes-base.webhook');

      expect(examples.minimal).toMatchObject({
        path: 'my-webhook',
        httpMethod: 'POST'
      });

      expect(examples.common).toMatchObject({
        responseMode: 'lastNode',
        responseData: 'allEntries',
        responseCode: 200
      });
    });

    it('should return curated examples for Code node', () => {
      const examples = ExampleGenerator.getExamples('nodes-base.code');

      expect(examples.minimal).toMatchObject({
        language: 'javaScript',
        jsCode: 'return [{json: {result: "success"}}];'
      });

      expect(examples.common?.jsCode).toContain('items.map');
      expect(examples.common?.jsCode).toContain('DateTime.now()');

      expect(examples.advanced?.jsCode).toContain('try');
      expect(examples.advanced?.jsCode).toContain('catch');
    });

    it('should generate basic examples for unconfigured nodes', () => {
      const essentials = {
        required: [
          { name: 'url', type: 'string' },
          { name: 'method', type: 'options', options: [{ value: 'GET' }, { value: 'POST' }] }
        ],
        common: [
          { name: 'timeout', type: 'number' }
        ]
      };

      const examples = ExampleGenerator.getExamples('nodes-base.unknownNode', essentials);

      expect(examples.minimal).toEqual({
        url: 'https://api.example.com',
        method: 'GET'
      });

      expect(examples.common).toBeUndefined();
      expect(examples.advanced).toBeUndefined();
    });

    it('should use common property if no required fields exist', () => {
      const essentials = {
        required: [],
        common: [
          { name: 'name', type: 'string' }
        ]
      };

      const examples = ExampleGenerator.getExamples('nodes-base.unknownNode', essentials);

      expect(examples.minimal).toEqual({
        name: 'John Doe'
      });
    });

    it('should return empty minimal object if no essentials provided', () => {
      const examples = ExampleGenerator.getExamples('nodes-base.unknownNode');

      expect(examples.minimal).toEqual({});
    });
  });

  describe('special example nodes', () => {
    it('should provide webhook processing example', () => {
      const examples = ExampleGenerator.getExamples('nodes-base.code.webhookProcessing');

      expect(examples.minimal?.jsCode).toContain('const webhookData = items[0].json.body');
      expect(examples.minimal?.jsCode).toContain('// ❌ WRONG');
      expect(examples.minimal?.jsCode).toContain('// ✅ CORRECT');
    });

    it('should provide data transformation examples', () => {
      const examples = ExampleGenerator.getExamples('nodes-base.code.dataTransform');

      expect(examples.minimal?.jsCode).toContain('CSV-like data to JSON');
      expect(examples.minimal?.jsCode).toContain('split');
    });

    it('should provide aggregation example', () => {
      const examples = ExampleGenerator.getExamples('nodes-base.code.aggregation');

      expect(examples.minimal?.jsCode).toContain('items.reduce');
      expect(examples.minimal?.jsCode).toContain('totalAmount');
    });

    it('should provide JMESPath filtering example', () => {
      const examples = ExampleGenerator.getExamples('nodes-base.code.jmespathFiltering');

      expect(examples.minimal?.jsCode).toContain('$jmespath');
      expect(examples.minimal?.jsCode).toContain('`100`'); // Backticks for numeric literals
      expect(examples.minimal?.jsCode).toContain('✅ CORRECT');
    });

    it('should provide Python example', () => {
      const examples = ExampleGenerator.getExamples('nodes-base.code.pythonExample');

      expect(examples.minimal?.pythonCode).toContain('_input.all()');
      expect(examples.minimal?.pythonCode).toContain('to_py()');
      expect(examples.minimal?.pythonCode).toContain('import json');
    });

    it('should provide AI tool example', () => {
      const examples = ExampleGenerator.getExamples('nodes-base.code.aiTool');

      expect(examples.minimal?.mode).toBe('runOnceForEachItem');
      expect(examples.minimal?.jsCode).toContain('calculate discount');
      expect(examples.minimal?.jsCode).toContain('$json.quantity');
    });

    it('should provide crypto usage example', () => {
      const examples = ExampleGenerator.getExamples('nodes-base.code.crypto');

      expect(examples.minimal?.jsCode).toContain("require('crypto')");
      expect(examples.minimal?.jsCode).toContain('randomBytes');
      expect(examples.minimal?.jsCode).toContain('createHash');
    });

    it('should provide static data example', () => {
      const examples = ExampleGenerator.getExamples('nodes-base.code.staticData');

      expect(examples.minimal?.jsCode).toContain('$getWorkflowStaticData');
      expect(examples.minimal?.jsCode).toContain('processCount');
    });
  });

  describe('database node examples', () => {
    it('should provide PostgreSQL examples', () => {
      const examples = ExampleGenerator.getExamples('nodes-base.postgres');

      expect(examples.minimal).toMatchObject({
        operation: 'executeQuery',
        query: 'SELECT * FROM users LIMIT 10'
      });

      expect(examples.advanced?.query).toContain('ON CONFLICT');
      expect(examples.advanced?.retryOnFail).toBe(true);
    });

    it('should provide MongoDB examples', () => {
      const examples = ExampleGenerator.getExamples('nodes-base.mongoDb');

      expect(examples.minimal).toMatchObject({
        operation: 'find',
        collection: 'users'
      });

      expect(examples.common).toMatchObject({
        operation: 'findOneAndUpdate',
        options: {
          upsert: true,
          returnNewDocument: true
        }
      });
    });

    it('should provide MySQL examples', () => {
      const examples = ExampleGenerator.getExamples('nodes-base.mySql');

      expect(examples.minimal?.query).toContain('SELECT * FROM products');
      expect(examples.common?.operation).toBe('insert');
    });
  });

  describe('communication node examples', () => {
    it('should provide Slack examples', () => {
      const examples = ExampleGenerator.getExamples('nodes-base.slack');

      expect(examples.minimal).toMatchObject({
        resource: 'message',
        operation: 'post',
        channel: '#general',
        text: 'Hello from n8n!'
      });

      expect(examples.common?.attachments).toBeDefined();
      expect(examples.common?.retryOnFail).toBe(true);
    });

    it('should provide Email examples', () => {
      const examples = ExampleGenerator.getExamples('nodes-base.emailSend');

      expect(examples.minimal).toMatchObject({
        fromEmail: 'sender@example.com',
        toEmail: 'recipient@example.com',
        subject: 'Test Email'
      });

      expect(examples.common?.html).toContain('<h1>Welcome!</h1>');
    });
  });

  describe('error handling patterns', () => {
    it('should provide modern error handling patterns', () => {
      const examples = ExampleGenerator.getExamples('error-handling.modern-patterns');

      expect(examples.minimal).toMatchObject({
        onError: 'continueRegularOutput'
      });

      expect(examples.advanced).toMatchObject({
        onError: 'stopWorkflow',
        retryOnFail: true,
        maxTries: 3
      });
    });

    it('should provide API retry patterns', () => {
      const examples = ExampleGenerator.getExamples('error-handling.api-with-retry');

      expect(examples.common?.retryOnFail).toBe(true);
      expect(examples.common?.maxTries).toBe(5);
      expect(examples.common?.alwaysOutputData).toBe(true);
    });

    it('should provide database error patterns', () => {
      const examples = ExampleGenerator.getExamples('error-handling.database-patterns');

      expect(examples.common).toMatchObject({
        retryOnFail: true,
        maxTries: 3,
        onError: 'stopWorkflow'
      });
    });

    it('should provide webhook error patterns', () => {
      const examples = ExampleGenerator.getExamples('error-handling.webhook-patterns');

      expect(examples.minimal?.alwaysOutputData).toBe(true);
      expect(examples.common?.responseCode).toBe(200);
    });
  });

  // Regression for issue #374: the IF example previously omitted conditions.options
  // and the combinator field, so generated configs failed n8n's own validators and
  // rendered an empty IF node. Run every IF example variant through the
  // condition-node validator, sanitizer metadata check, and EnhancedConfigValidator
  // (the one users actually hit, which enforces the filter combinator).
  describe('issue #374 — IF examples are valid for v2.2+', () => {
    it.each(['minimal', 'common'] as const)(
      'IF example "%s" passes all validators including EnhancedConfigValidator',
      (variant) => {
        const examples = ExampleGenerator.getExamples('nodes-base.if');
        const config = examples[variant]!;
        expect(config).toBeDefined();

        const node: WorkflowNode = {
          id: 'if-node',
          name: 'IF',
          type: 'n8n-nodes-base.if',
          typeVersion: 2.2,
          position: [0, 0],
          parameters: config
        };

        expect(validateConditionNodeStructure(node)).toEqual([]);
        expect(validateNodeMetadata(node)).toEqual([]);

        // EnhancedConfigValidator enforces the filter `combinator` field, which was
        // still missing before this fix. Without combinator this result is invalid.
        const result = EnhancedConfigValidator.validateWithMode(
          'nodes-base.if',
          config,
          IF_FILTER_PROPERTIES,
          'operation',
          'ai-friendly'
        );
        expect(result.valid).toBe(true);
        expect(
          result.errors.filter(e => /combinator|filter/i.test(`${e.property} ${e.message}`))
        ).toEqual([]);

        // The previously-missing options block and combinator must be present.
        expect(config.conditions.options).toEqual({
          version: 2,
          leftValue: '',
          caseSensitive: true,
          typeValidation: 'strict'
        });
        expect(config.conditions.combinator).toBe('and');
        for (const c of config.conditions.conditions) {
          expect(c).toHaveProperty('id');
        }
      }
    );
  });

  describe('getTaskExample', () => {
    it('should return minimal example for basic task', () => {
      const example = ExampleGenerator.getTaskExample('nodes-base.httpRequest', 'basic');

      expect(example).toEqual({
        url: 'https://api.example.com/data'
      });
    });

    it('should return common example for typical task', () => {
      const example = ExampleGenerator.getTaskExample('nodes-base.httpRequest', 'typical');

      expect(example).toMatchObject({
        method: 'POST',
        sendBody: true
      });
    });

    it('should return advanced example for complex task', () => {
      const example = ExampleGenerator.getTaskExample('nodes-base.httpRequest', 'complex');

      expect(example).toMatchObject({
        retryOnFail: true,
        maxTries: 3
      });
    });

    it('should default to common example for unknown task', () => {
      const example = ExampleGenerator.getTaskExample('nodes-base.httpRequest', 'unknown');

      expect(example).toMatchObject({
        method: 'POST' // This is from common example
      });
    });

    it('should return undefined for unknown node type', () => {
      const example = ExampleGenerator.getTaskExample('nodes-base.unknownNode', 'basic');

      expect(example).toBeUndefined();
    });
  });

  describe('default value generation', () => {
    it('should generate appropriate defaults for different property types', () => {
      const essentials = {
        required: [
          { name: 'url', type: 'string' },
          { name: 'port', type: 'number' },
          { name: 'enabled', type: 'boolean' },
          { name: 'method', type: 'options', options: [{ value: 'GET' }, { value: 'POST' }] },
          { name: 'data', type: 'json' }
        ],
        common: []
      };

      const examples = ExampleGenerator.getExamples('nodes-base.unknownNode', essentials);

      expect(examples.minimal).toEqual({
        url: 'https://api.example.com',
        port: 80,
        enabled: false,
        method: 'GET',
        data: '{\n  "key": "value"\n}'
      });
    });

    it('should use property defaults when available', () => {
      const essentials = {
        required: [
          { name: 'timeout', type: 'number', default: 5000 },
          { name: 'retries', type: 'number', default: 3 }
        ],
        common: []
      };

      const examples = ExampleGenerator.getExamples('nodes-base.unknownNode', essentials);

      expect(examples.minimal).toEqual({
        timeout: 5000,
        retries: 3
      });
    });

    it('should generate context-aware string defaults', () => {
      const essentials = {
        required: [
          { name: 'fromEmail', type: 'string' },
          { name: 'toEmail', type: 'string' },
          { name: 'webhookPath', type: 'string' },
          { name: 'username', type: 'string' },
          { name: 'apiKey', type: 'string' },
          { name: 'query', type: 'string' },
          { name: 'collection', type: 'string' }
        ],
        common: []
      };

      const examples = ExampleGenerator.getExamples('nodes-base.unknownNode', essentials);

      expect(examples.minimal).toEqual({
        fromEmail: 'sender@example.com',
        toEmail: 'recipient@example.com',
        webhookPath: 'my-webhook',
        username: 'John Doe',
        apiKey: 'myKey',
        query: 'SELECT * FROM table_name LIMIT 10',
        collection: 'users'
      });
    });

    it('should use placeholder as fallback for string defaults', () => {
      const essentials = {
        required: [
          { name: 'customField', type: 'string', placeholder: 'Enter custom value' }
        ],
        common: []
      };

      const examples = ExampleGenerator.getExamples('nodes-base.unknownNode', essentials);

      expect(examples.minimal).toEqual({
        customField: 'Enter custom value'
      });
    });
  });

  describe('edge cases', () => {
    it('should handle empty essentials object', () => {
      const essentials = {
        required: [],
        common: []
      };

      const examples = ExampleGenerator.getExamples('nodes-base.unknownNode', essentials);

      expect(examples.minimal).toEqual({});
    });

    it('should handle properties with missing options', () => {
      const essentials = {
        required: [
          { name: 'choice', type: 'options' } // No options array
        ],
        common: []
      };

      const examples = ExampleGenerator.getExamples('nodes-base.unknownNode', essentials);

      expect(examples.minimal).toEqual({
        choice: ''
      });
    });

    it('should handle collection and fixedCollection types', () => {
      const essentials = {
        required: [
          { name: 'headers', type: 'collection' },
          { name: 'options', type: 'fixedCollection' }
        ],
        common: []
      };

      const examples = ExampleGenerator.getExamples('nodes-base.unknownNode', essentials);

      expect(examples.minimal).toEqual({
        headers: {},
        options: {}
      });
    });
  });
});