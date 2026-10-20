/**
 * Unit tests for trigger detection
 */
import { describe, it, expect } from 'vitest';
import { detectTriggerFromWorkflow, buildTriggerUrl, describeTrigger, classifyTriggerNode } from '../../../src/triggers/trigger-detector';
import type { Workflow } from '../../../src/types/n8n-api';

// Helper to create a workflow with a specific trigger node
function createWorkflowWithTrigger(triggerType: string, params: Record<string, unknown> = {}): Workflow {
  return {
    id: 'test-workflow',
    name: 'Test Workflow',
    active: true,
    nodes: [
      {
        id: 'trigger-node',
        name: 'Trigger',
        type: triggerType,
        typeVersion: 1,
        position: [0, 0],
        parameters: params,
      },
      {
        id: 'action-node',
        name: 'Action',
        type: 'n8n-nodes-base.noOp',
        typeVersion: 1,
        position: [200, 0],
        parameters: {},
      },
    ],
    connections: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    settings: {},
    staticData: undefined,
  } as Workflow;
}

describe('Trigger Detector', () => {
  describe('detectTriggerFromWorkflow', () => {
    describe('webhook detection', () => {
      it('should detect n8n-nodes-base.webhook as webhook trigger', () => {
        const workflow = createWorkflowWithTrigger('n8n-nodes-base.webhook', {
          path: 'my-webhook',
          httpMethod: 'POST',
        });

        const result = detectTriggerFromWorkflow(workflow);

        expect(result.detected).toBe(true);
        expect(result.trigger?.type).toBe('webhook');
        expect(result.trigger?.webhookPath).toBe('my-webhook');
        expect(result.trigger?.httpMethod).toBe('POST');
      });

      it('should detect webhook node with httpMethod from parameters', () => {
        const workflow = createWorkflowWithTrigger('n8n-nodes-base.webhook', {
          path: 'get-data',
          httpMethod: 'GET',
        });

        const result = detectTriggerFromWorkflow(workflow);

        expect(result.detected).toBe(true);
        expect(result.trigger?.type).toBe('webhook');
        expect(result.trigger?.httpMethod).toBe('GET');
      });

      it('should default httpMethod to POST when not specified', () => {
        const workflow = createWorkflowWithTrigger('n8n-nodes-base.webhook', {
          path: 'test-path',
        });

        const result = detectTriggerFromWorkflow(workflow);

        expect(result.detected).toBe(true);
        expect(result.trigger?.type).toBe('webhook');
        // Default is POST when not specified
        expect(result.trigger?.httpMethod).toBe('POST');
      });
    });

    describe('form detection', () => {
      it('should detect n8n-nodes-base.formTrigger as form trigger', () => {
        const workflow = createWorkflowWithTrigger('n8n-nodes-base.formTrigger', {
          path: 'my-form',
        });

        const result = detectTriggerFromWorkflow(workflow);

        expect(result.detected).toBe(true);
        expect(result.trigger?.type).toBe('form');
        expect(result.trigger?.node?.parameters?.path).toBe('my-form');
      });
    });

    describe('chat detection', () => {
      it('should detect @n8n/n8n-nodes-langchain.chatTrigger as chat trigger', () => {
        const workflow = createWorkflowWithTrigger('@n8n/n8n-nodes-langchain.chatTrigger', {
          path: 'chat-endpoint',
        });

        const result = detectTriggerFromWorkflow(workflow);

        expect(result.detected).toBe(true);
        expect(result.trigger?.type).toBe('chat');
      });

      it('should detect n8n-nodes-langchain.chatTrigger as chat trigger', () => {
        const workflow = createWorkflowWithTrigger('n8n-nodes-langchain.chatTrigger', {
          webhookPath: 'ai-chat',
        });

        const result = detectTriggerFromWorkflow(workflow);

        expect(result.detected).toBe(true);
        expect(result.trigger?.type).toBe('chat');
      });
    });

    describe('non-triggerable workflows', () => {
      it('should return not detected for schedule trigger', () => {
        const workflow = createWorkflowWithTrigger('n8n-nodes-base.scheduleTrigger', {
          rule: { interval: [{ field: 'hours', value: 1 }] },
        });

        const result = detectTriggerFromWorkflow(workflow);

        expect(result.detected).toBe(false);
        // Fallback reason may be undefined for non-input triggers
      });

      it('should return not detected for manual trigger', () => {
        const workflow = createWorkflowWithTrigger('n8n-nodes-base.manualTrigger', {});

        const result = detectTriggerFromWorkflow(workflow);

        expect(result.detected).toBe(false);
      });

      it('should return not detected for email trigger', () => {
        const workflow = createWorkflowWithTrigger('n8n-nodes-base.emailReadImap', {
          mailbox: 'INBOX',
        });

        const result = detectTriggerFromWorkflow(workflow);

        expect(result.detected).toBe(false);
      });
    });

    describe('workflows without triggers', () => {
      it('should return not detected for workflow with no trigger node', () => {
        const workflow: Workflow = {
          id: 'test-workflow',
          name: 'Test Workflow',
          active: true,
          nodes: [
            {
              id: 'action-node',
              name: 'Action',
              type: 'n8n-nodes-base.noOp',
              typeVersion: 1,
              position: [0, 0],
              parameters: {},
            },
          ],
          connections: {},
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          settings: {},
          staticData: undefined,
        } as Workflow;

        const result = detectTriggerFromWorkflow(workflow);

        expect(result.detected).toBe(false);
      });
    });
  });

  describe('buildTriggerUrl', () => {
    it('should build webhook URL correctly', () => {
      const baseUrl = 'https://n8n.example.com';
      const trigger = {
        type: 'webhook' as const,
        node: {
          id: 'trigger',
          name: 'Webhook',
          type: 'n8n-nodes-base.webhook',
          typeVersion: 1,
          position: [0, 0] as [number, number],
          parameters: { path: 'my-webhook' },
        },
        webhookPath: 'my-webhook',
      };

      const url = buildTriggerUrl(baseUrl, trigger, 'production');

      expect(url).toBe('https://n8n.example.com/webhook/my-webhook');
    });

    it('should build test webhook URL correctly', () => {
      const baseUrl = 'https://n8n.example.com/';
      const trigger = {
        type: 'webhook' as const,
        node: {
          id: 'trigger',
          name: 'Webhook',
          type: 'n8n-nodes-base.webhook',
          typeVersion: 1,
          position: [0, 0] as [number, number],
          parameters: { path: 'test-path' },
        },
        webhookPath: 'test-path',
      };

      const url = buildTriggerUrl(baseUrl, trigger, 'test');

      expect(url).toBe('https://n8n.example.com/webhook-test/test-path');
    });

    it('should build form URL with node ID when webhookPath not set', () => {
      const baseUrl = 'https://n8n.example.com';
      const trigger = {
        type: 'form' as const,
        node: {
          id: 'trigger',
          name: 'Form',
          type: 'n8n-nodes-base.formTrigger',
          typeVersion: 1,
          position: [0, 0] as [number, number],
          parameters: { path: 'my-form' },
        },
        // webhookPath is undefined - should use node.id
      };

      const url = buildTriggerUrl(baseUrl, trigger, 'production');

      // When webhookPath is not set, uses node.id as fallback
      expect(url).toContain('/form/');
    });

    it('should build chat URL correctly with /chat suffix', () => {
      const baseUrl = 'https://n8n.example.com';
      const trigger = {
        type: 'chat' as const,
        node: {
          id: 'trigger',
          name: 'Chat',
          type: '@n8n/n8n-nodes-langchain.chatTrigger',
          typeVersion: 1,
          position: [0, 0] as [number, number],
          parameters: { path: 'ai-chat' },
        },
        webhookPath: 'ai-chat',
      };

      const url = buildTriggerUrl(baseUrl, trigger, 'production');

      // Chat triggers use /webhook/<webhookId>/chat endpoint
      expect(url).toBe('https://n8n.example.com/webhook/ai-chat/chat');
    });
  });

  describe('describeTrigger', () => {
    it('should describe webhook trigger', () => {
      const trigger = {
        type: 'webhook' as const,
        node: {
          id: 'trigger',
          name: 'My Webhook',
          type: 'n8n-nodes-base.webhook',
          typeVersion: 1,
          position: [0, 0] as [number, number],
          parameters: { path: 'my-webhook' },
        },
        webhookPath: 'my-webhook',
        httpMethod: 'POST' as const,
      };

      const description = describeTrigger(trigger);

      // Case-insensitive check
      expect(description.toLowerCase()).toContain('webhook');
      expect(description).toContain('POST');
      expect(description).toContain('my-webhook');
    });

    it('should describe form trigger', () => {
      const trigger = {
        type: 'form' as const,
        node: {
          id: 'trigger',
          name: 'Contact Form',
          type: 'n8n-nodes-base.formTrigger',
          typeVersion: 1,
          position: [0, 0] as [number, number],
          parameters: { path: 'contact' },
        },
        webhookPath: 'contact',
      };

      const description = describeTrigger(trigger);

      // Case-insensitive check
      expect(description.toLowerCase()).toContain('form');
    });

    it('should describe chat trigger', () => {
      const trigger = {
        type: 'chat' as const,
        node: {
          id: 'trigger',
          name: 'AI Chat',
          type: '@n8n/n8n-nodes-langchain.chatTrigger',
          typeVersion: 1,
          position: [0, 0] as [number, number],
          parameters: {},
        },
      };

      const description = describeTrigger(trigger);

      // Case-insensitive check
      expect(description.toLowerCase()).toContain('chat');
    });

  });

  describe('classifyTriggerNode', () => {
    const node = (type: string, name = 'Trigger') => ({
      id: 'node-1',
      name,
      type,
      typeVersion: 1,
      position: [0, 0] as [number, number],
      parameters: {},
    });

    it('classifies webhook trigger nodes', () => {
      expect(classifyTriggerNode(node('n8n-nodes-base.webhook'))).toBe('webhook');
    });

    it('classifies chat trigger nodes', () => {
      expect(classifyTriggerNode(node('@n8n/n8n-nodes-langchain.chatTrigger'))).toBe('chat');
    });

    it('classifies form trigger nodes', () => {
      expect(classifyTriggerNode(node('n8n-nodes-base.formTrigger'))).toBe('form');
    });

    it('returns null for a node that is not a trigger', () => {
      expect(classifyTriggerNode(node('n8n-nodes-base.set'))).toBeNull();
      // The Form page node is a regular node, not the form trigger.
      expect(classifyTriggerNode(node('n8n-nodes-base.form'))).toBeNull();
    });

    it('returns null for a trigger that cannot be driven externally', () => {
      expect(classifyTriggerNode(node('n8n-nodes-base.scheduleTrigger'))).toBeNull();
    });
  });

});
