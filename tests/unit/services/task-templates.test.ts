import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TaskTemplates } from '@/services/task-templates';
import type { TaskTemplate } from '@/services/task-templates';
import { validateConditionNodeStructure } from '@/services/n8n-validation';
import { validateNodeMetadata } from '@/services/node-sanitizer';
import { EnhancedConfigValidator } from '@/services/enhanced-config-validator';
import type { WorkflowNode } from '@/types/n8n-api';

// Mock the database
vi.mock('better-sqlite3');

// Property definitions matching how the real nodes declare these fields, so
// EnhancedConfigValidator runs its filter/structure checks the way users hit them.
// The IF node declares `conditions` as a `filter`-type property (verified in the node DB),
// which is what triggers the combinator requirement.
const IF_FILTER_PROPERTIES = [
  { name: 'conditions', displayName: 'Conditions', type: 'filter' }
];
const AGENT_PROPERTIES = [
  { name: 'promptType', displayName: 'Prompt', type: 'options', options: [{ value: 'define' }, { value: 'auto' }] },
  { name: 'text', displayName: 'Text', type: 'string' },
  { name: 'options', displayName: 'Options', type: 'collection' }
];

describe('TaskTemplates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getTaskTemplate', () => {
    it('should return template for get_api_data task', () => {
      const template = TaskTemplates.getTaskTemplate('get_api_data');

      expect(template).toBeDefined();
      expect(template?.task).toBe('get_api_data');
      expect(template?.nodeType).toBe('nodes-base.httpRequest');
      expect(template?.configuration).toMatchObject({
        method: 'GET',
        retryOnFail: true,
        maxTries: 3
      });
    });

    it('should return template for webhook tasks', () => {
      const template = TaskTemplates.getTaskTemplate('receive_webhook');

      expect(template).toBeDefined();
      expect(template?.nodeType).toBe('nodes-base.webhook');
      expect(template?.configuration).toMatchObject({
        httpMethod: 'POST',
        responseMode: 'lastNode',
        alwaysOutputData: true
      });
    });

    it('should return template for database tasks', () => {
      const template = TaskTemplates.getTaskTemplate('query_postgres');

      expect(template).toBeDefined();
      expect(template?.nodeType).toBe('nodes-base.postgres');
      expect(template?.configuration).toMatchObject({
        operation: 'executeQuery',
        onError: 'continueRegularOutput'
      });
    });

    it('should return undefined for unknown task', () => {
      const template = TaskTemplates.getTaskTemplate('unknown_task');

      expect(template).toBeUndefined();
    });

    it('should have getTemplate alias working', () => {
      const template1 = TaskTemplates.getTaskTemplate('get_api_data');
      const template2 = TaskTemplates.getTemplate('get_api_data');

      expect(template1).toEqual(template2);
    });
  });

  describe('template structure', () => {
    it('should have all required fields in templates', () => {
      const allTasks = TaskTemplates.getAllTasks();

      allTasks.forEach(task => {
        const template = TaskTemplates.getTaskTemplate(task);
        
        expect(template).toBeDefined();
        expect(template?.task).toBe(task);
        expect(template?.description).toBeTruthy();
        expect(template?.nodeType).toBeTruthy();
        expect(template?.configuration).toBeDefined();
        expect(template?.userMustProvide).toBeDefined();
        expect(Array.isArray(template?.userMustProvide)).toBe(true);
      });
    });

    it('should have proper user must provide structure', () => {
      const template = TaskTemplates.getTaskTemplate('post_json_request');

      expect(template?.userMustProvide).toHaveLength(2);
      expect(template?.userMustProvide[0]).toMatchObject({
        property: 'url',
        description: expect.any(String),
        example: 'https://api.example.com/users'
      });
    });

    it('should have optional enhancements where applicable', () => {
      const template = TaskTemplates.getTaskTemplate('get_api_data');

      expect(template?.optionalEnhancements).toBeDefined();
      expect(template?.optionalEnhancements?.length).toBeGreaterThan(0);
      expect(template?.optionalEnhancements?.[0]).toHaveProperty('property');
      expect(template?.optionalEnhancements?.[0]).toHaveProperty('description');
    });

    it('should have notes for complex templates', () => {
      const template = TaskTemplates.getTaskTemplate('post_json_request');

      expect(template?.notes).toBeDefined();
      expect(template?.notes?.length).toBeGreaterThan(0);
      expect(template?.notes?.[0]).toContain('JSON');
    });
  });

  describe('special templates', () => {
    it('should have process_webhook_data template with detailed code', () => {
      const template = TaskTemplates.getTaskTemplate('process_webhook_data');

      expect(template?.nodeType).toBe('nodes-base.code');
      expect(template?.configuration.jsCode).toContain('items[0].json.body');
      expect(template?.configuration.jsCode).toContain('❌ WRONG');
      expect(template?.configuration.jsCode).toContain('✅ CORRECT');
      expect(template?.notes?.[0]).toContain('WEBHOOK DATA IS AT items[0].json.body');
    });

    it('should have AI agent workflow template', () => {
      const template = TaskTemplates.getTaskTemplate('ai_agent_workflow');

      // Must use the full package-prefixed node type and the current
      // promptType + options.systemMessage shape (see issue #374).
      expect(template?.nodeType).toBe('@n8n/n8n-nodes-langchain.agent');
      expect(template?.configuration).toMatchObject({
        promptType: 'define',
        text: '={{ $json.query }}',
        options: { systemMessage: expect.any(String) }
      });
      expect(template?.configuration).not.toHaveProperty('systemMessage');
      expect(template?.configuration).not.toHaveProperty('outputType');
    });

    it('should have error handling pattern templates', () => {
      const template = TaskTemplates.getTaskTemplate('modern_error_handling_patterns');

      expect(template).toBeDefined();
      expect(template?.configuration).toHaveProperty('onError', 'continueRegularOutput');
      expect(template?.configuration).toHaveProperty('retryOnFail', true);
      expect(template?.notes).toBeDefined();
    });

    it('should have AI tool templates', () => {
      const template = TaskTemplates.getTaskTemplate('custom_ai_tool');

      expect(template?.nodeType).toBe('nodes-base.code');
      expect(template?.configuration.mode).toBe('runOnceForEachItem');
      expect(template?.configuration.jsCode).toContain('$json');
    });
  });

  describe('getAllTasks', () => {
    it('should return all task names', () => {
      const tasks = TaskTemplates.getAllTasks();

      expect(Array.isArray(tasks)).toBe(true);
      expect(tasks.length).toBeGreaterThan(20);
      expect(tasks).toContain('get_api_data');
      expect(tasks).toContain('receive_webhook');
      expect(tasks).toContain('query_postgres');
    });
  });

  describe('getTasksForNode', () => {
    it('should return tasks for HTTP Request node', () => {
      const tasks = TaskTemplates.getTasksForNode('nodes-base.httpRequest');

      expect(tasks).toContain('get_api_data');
      expect(tasks).toContain('post_json_request');
      expect(tasks).toContain('call_api_with_auth');
      expect(tasks).toContain('api_call_with_retry');
    });

    it('should return tasks for Code node', () => {
      const tasks = TaskTemplates.getTasksForNode('nodes-base.code');

      expect(tasks).toContain('transform_data');
      expect(tasks).toContain('process_webhook_data');
      expect(tasks).toContain('custom_ai_tool');
      expect(tasks).toContain('aggregate_data');
    });

    it('should return tasks for Webhook node', () => {
      const tasks = TaskTemplates.getTasksForNode('nodes-base.webhook');

      expect(tasks).toContain('receive_webhook');
      expect(tasks).toContain('webhook_with_response');
      expect(tasks).toContain('webhook_with_error_handling');
    });

    it('should return empty array for unknown node', () => {
      const tasks = TaskTemplates.getTasksForNode('nodes-base.unknownNode');

      expect(tasks).toEqual([]);
    });
  });

  describe('searchTasks', () => {
    it('should find tasks by name', () => {
      const tasks = TaskTemplates.searchTasks('webhook');

      expect(tasks).toContain('receive_webhook');
      expect(tasks).toContain('webhook_with_response');
      expect(tasks).toContain('process_webhook_data');
    });

    it('should find tasks by description', () => {
      const tasks = TaskTemplates.searchTasks('resilient');

      expect(tasks.length).toBeGreaterThan(0);
      expect(tasks.some(t => {
        const template = TaskTemplates.getTaskTemplate(t);
        return template?.description.toLowerCase().includes('resilient');
      })).toBe(true);
    });

    it('should find tasks by node type', () => {
      const tasks = TaskTemplates.searchTasks('postgres');

      expect(tasks).toContain('query_postgres');
      expect(tasks).toContain('insert_postgres_data');
    });

    it('should be case insensitive', () => {
      const tasks1 = TaskTemplates.searchTasks('WEBHOOK');
      const tasks2 = TaskTemplates.searchTasks('webhook');

      expect(tasks1).toEqual(tasks2);
    });

    it('should return empty array for no matches', () => {
      const tasks = TaskTemplates.searchTasks('xyz123nonexistent');

      expect(tasks).toEqual([]);
    });
  });

  describe('getTaskCategories', () => {
    it('should return all task categories', () => {
      const categories = TaskTemplates.getTaskCategories();

      expect(Object.keys(categories)).toContain('HTTP/API');
      expect(Object.keys(categories)).toContain('Webhooks');
      expect(Object.keys(categories)).toContain('Database');
      expect(Object.keys(categories)).toContain('AI/LangChain');
      expect(Object.keys(categories)).toContain('Data Processing');
      expect(Object.keys(categories)).toContain('Communication');
      expect(Object.keys(categories)).toContain('Error Handling');
    });

    it('should have tasks assigned to categories', () => {
      const categories = TaskTemplates.getTaskCategories();

      expect(categories['HTTP/API']).toContain('get_api_data');
      expect(categories['Webhooks']).toContain('receive_webhook');
      expect(categories['Database']).toContain('query_postgres');
      expect(categories['AI/LangChain']).toContain('chat_with_ai');
    });

    it('should have tasks in multiple categories where appropriate', () => {
      const categories = TaskTemplates.getTaskCategories();

      // process_webhook_data should be in both Webhooks and Data Processing
      expect(categories['Webhooks']).toContain('process_webhook_data');
      expect(categories['Data Processing']).toContain('process_webhook_data');
    });
  });

  describe('error handling templates', () => {
    it('should have proper retry configuration', () => {
      const template = TaskTemplates.getTaskTemplate('api_call_with_retry');

      expect(template?.configuration).toMatchObject({
        retryOnFail: true,
        maxTries: 5,
        waitBetweenTries: 2000,
        alwaysOutputData: true
      });
    });

    it('should have database transaction safety template', () => {
      const template = TaskTemplates.getTaskTemplate('database_transaction_safety');

      expect(template?.configuration).toMatchObject({
        onError: 'continueErrorOutput',
        retryOnFail: false, // Transactions should not be retried
        alwaysOutputData: true
      });
    });

    it('should have AI rate limit handling', () => {
      const template = TaskTemplates.getTaskTemplate('ai_rate_limit_handling');

      expect(template?.configuration).toMatchObject({
        retryOnFail: true,
        maxTries: 5,
        waitBetweenTries: 5000 // Longer wait for rate limits
      });
    });
  });

  describe('code node templates', () => {
    it('should have aggregate data template', () => {
      const template = TaskTemplates.getTaskTemplate('aggregate_data');

      expect(template?.configuration.jsCode).toContain('stats');
      expect(template?.configuration.jsCode).toContain('average');
      expect(template?.configuration.jsCode).toContain('median');
    });

    it('should have batch processing template', () => {
      const template = TaskTemplates.getTaskTemplate('batch_process_with_api');

      expect(template?.configuration.jsCode).toContain('BATCH_SIZE');
      expect(template?.configuration.jsCode).toContain('$helpers.httpRequest');
    });

    it('should have error safe transform template', () => {
      const template = TaskTemplates.getTaskTemplate('error_safe_transform');

      expect(template?.configuration.jsCode).toContain('required fields');
      expect(template?.configuration.jsCode).toContain('validation');
      expect(template?.configuration.jsCode).toContain('summary');
    });

    it('should have async processing template', () => {
      const template = TaskTemplates.getTaskTemplate('async_data_processing');

      expect(template?.configuration.jsCode).toContain('CONCURRENT_LIMIT');
      expect(template?.configuration.jsCode).toContain('Promise.all');
    });

    it('should have Python data analysis template', () => {
      const template = TaskTemplates.getTaskTemplate('python_data_analysis');

      expect(template?.configuration.language).toBe('python');
      expect(template?.configuration.pythonCode).toContain('_input.all()');
      expect(template?.configuration.pythonCode).toContain('statistics');
    });
  });

  describe('template configurations', () => {
    it('should have proper error handling defaults', () => {
      const apiTemplate = TaskTemplates.getTaskTemplate('get_api_data');
      const webhookTemplate = TaskTemplates.getTaskTemplate('receive_webhook');
      const dbWriteTemplate = TaskTemplates.getTaskTemplate('insert_postgres_data');

      // API calls should continue on error
      expect(apiTemplate?.configuration.onError).toBe('continueRegularOutput');
      
      // Webhooks should always respond
      expect(webhookTemplate?.configuration.onError).toBe('continueRegularOutput');
      expect(webhookTemplate?.configuration.alwaysOutputData).toBe(true);
      
      // Database writes should stop on error
      expect(dbWriteTemplate?.configuration.onError).toBe('stopWorkflow');
    });

    it('should have appropriate retry configurations', () => {
      const apiTemplate = TaskTemplates.getTaskTemplate('get_api_data');
      const dbTemplate = TaskTemplates.getTaskTemplate('query_postgres');
      const aiTemplate = TaskTemplates.getTaskTemplate('chat_with_ai');

      // API calls: moderate retries
      expect(apiTemplate?.configuration.maxTries).toBe(3);
      expect(apiTemplate?.configuration.waitBetweenTries).toBe(1000);

      // Database reads: can retry
      expect(dbTemplate?.configuration.retryOnFail).toBe(true);

      // AI calls: longer waits for rate limits
      expect(aiTemplate?.configuration.waitBetweenTries).toBe(5000);
    });
  });

  // Regression for issue #374: the static generator emitted invalid IF and
  // AI Agent configs. These tests run the generated configs through the same
  // validators n8n-mcp enforces so the bug cannot silently return.
  describe('issue #374 — generated configs are valid', () => {
    it('filter_data IF config passes the condition-node validator and sanitizer metadata check', () => {
      const template = TaskTemplates.getTaskTemplate('filter_data');
      expect(template).toBeDefined();

      // IF v2.2+ is what the validator/sanitizer guard on; the template config
      // must satisfy the conditions.options + per-condition id requirements.
      const node: WorkflowNode = {
        id: 'filter-data-node',
        name: 'Filter Data',
        type: 'n8n-nodes-base.if',
        typeVersion: 2.2,
        position: [0, 0],
        parameters: template!.configuration
      };

      expect(validateConditionNodeStructure(node)).toEqual([]);
      expect(validateNodeMetadata(node)).toEqual([]);

      // EnhancedConfigValidator is the validator users actually hit. It requires a
      // `combinator` on filter-type properties — the field that was still missing
      // before this fix. This assertion fails without combinator, passes with it.
      const result = EnhancedConfigValidator.validateWithMode(
        'nodes-base.if',
        template!.configuration,
        IF_FILTER_PROPERTIES,
        'operation',
        'ai-friendly'
      );
      expect(result.valid).toBe(true);
      expect(
        result.errors.filter(e => /combinator|filter/i.test(`${e.property} ${e.message}`))
      ).toEqual([]);

      // Explicit checks on the fields that were previously missing.
      const conditions = template!.configuration.conditions;
      expect(conditions.options).toEqual({
        version: 2,
        leftValue: '',
        caseSensitive: true,
        typeValidation: 'strict'
      });
      expect(conditions.combinator).toBe('and');
      expect(conditions.conditions[0]).toHaveProperty('id');
    });

    it.each(['ai_agent_workflow', 'multi_tool_ai_agent'])(
      '%s uses the package-prefixed agent type and current promptType/options shape',
      (taskName) => {
        const template = TaskTemplates.getTaskTemplate(taskName);
        expect(template).toBeDefined();

        // Correct, package-prefixed node type (was missing the @n8n/ prefix).
        expect(template!.nodeType).toBe('@n8n/n8n-nodes-langchain.agent');

        // Current shape: promptType + text + options.systemMessage, matching the
        // 1.5k real-world agent nodes in the template DB (systemMessage lives
        // under the options collection in the current node).
        expect(template!.configuration).toMatchObject({
          promptType: 'define',
          text: expect.stringContaining('{{'),
          options: { systemMessage: expect.any(String) }
        });

        // Validate through EnhancedConfigValidator: the options.systemMessage shape
        // must produce a clean result. (The node-specific-validators top-level
        // systemMessage hint is only an info-level suggestion and must not flip valid.)
        const result = EnhancedConfigValidator.validateWithMode(
          template!.nodeType,
          template!.configuration,
          AGENT_PROPERTIES,
          'operation',
          'ai-friendly'
        );
        expect(result.valid).toBe(true);
      }
    );
  });
});