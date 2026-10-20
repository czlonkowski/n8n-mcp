/**
 * Trigger detector - analyzes workflows to detect trigger type
 */

import { Workflow, WorkflowNode } from '../types/n8n-api';
import { normalizeNodeType } from '../utils/node-type-utils';
import { TriggerType, DetectedTrigger, TriggerDetectionResult } from './types';

/**
 * Node type patterns for each trigger type
 */
const WEBHOOK_PATTERNS = [
  'webhook',
  'webhooktrigger',
];

const FORM_PATTERNS = [
  'formtrigger',
  'form',
];

const CHAT_PATTERNS = [
  'chattrigger',
];

/**
 * Detect the trigger type from a workflow
 *
 * Priority order:
 * 1. Webhook trigger (most common for API access)
 * 2. Chat trigger (AI-specific)
 * 3. Form trigger
 *
 * Note: n8n's public API does not support direct workflow execution.
 * Only workflows with webhook/form/chat triggers can be triggered externally.
 */
export function detectTriggerFromWorkflow(workflow: Workflow): TriggerDetectionResult {
  if (!workflow.nodes || workflow.nodes.length === 0) {
    return {
      detected: false,
      reason: 'Workflow has no nodes',
    };
  }

  // Find all trigger nodes
  const triggerNodes = workflow.nodes.filter(node => !node.disabled && isTriggerNodeType(node.type));

  if (triggerNodes.length === 0) {
    return {
      detected: false,
      reason: 'No trigger nodes found in workflow',
    };
  }

  // Check for specific trigger types in priority order
  for (const node of triggerNodes) {
    const webhookTrigger = detectWebhookTrigger(node);
    if (webhookTrigger) {
      return {
        detected: true,
        trigger: webhookTrigger,
      };
    }
  }

  for (const node of triggerNodes) {
    const chatTrigger = detectChatTrigger(node);
    if (chatTrigger) {
      return {
        detected: true,
        trigger: chatTrigger,
      };
    }
  }

  for (const node of triggerNodes) {
    const formTrigger = detectFormTrigger(node);
    if (formTrigger) {
      return {
        detected: true,
        trigger: formTrigger,
      };
    }
  }

  // No externally-triggerable trigger found
  return {
    detected: false,
    reason: `Workflow has trigger nodes but none support external triggering (found: ${triggerNodes.map(n => n.type).join(', ')}). Only webhook, form, and chat triggers can be triggered via the API.`,
  };
}

/**
 * Classify ONE node the way `detectTriggerFromWorkflow` classifies a workflow.
 *
 * Returns the externally-triggerable kind of the node, or `null` when the node
 * is not a trigger at all (`n8n-nodes-base.set`), is a regular node whose name
 * merely looks trigger-like (`n8n-nodes-base.form`, the Form page node), or is
 * a trigger that cannot be driven from outside (`scheduleTrigger`).
 *
 * Used when the caller names a specific trigger node: the node it names — not
 * the workflow's first detected trigger — decides the shape of the input
 * payload. Unlike the workflow-level detector this does not skip disabled
 * nodes: naming a node explicitly is a deliberate choice, and refusing it here
 * would replace a clear error from n8n with a silently different payload shape.
 */
export function classifyTriggerNode(node: WorkflowNode): TriggerType | null {
  if (!isTriggerNodeType(node.type)) return null;
  // Same priority order as detectTriggerFromWorkflow.
  if (detectWebhookTrigger(node)) return 'webhook';
  if (detectChatTrigger(node)) return 'chat';
  if (detectFormTrigger(node)) return 'form';
  return null;
}

/**
 * Check if a node type is a trigger
 */
function isTriggerNodeType(nodeType: string): boolean {
  const normalized = normalizeNodeType(nodeType).toLowerCase();
  return (
    normalized.includes('trigger') ||
    normalized.includes('webhook') ||
    normalized === 'nodes-base.start'
  );
}

/**
 * Detect webhook trigger and extract configuration
 */
function detectWebhookTrigger(node: WorkflowNode): DetectedTrigger | null {
  const normalized = normalizeNodeType(node.type).toLowerCase();
  const nodeName = normalized.split('.').pop() || '';

  const isWebhook = WEBHOOK_PATTERNS.some(pattern =>
    nodeName === pattern || nodeName.includes(pattern)
  );

  if (!isWebhook) {
    return null;
  }

  // Extract webhook path from parameters
  const params = node.parameters || {};
  const webhookPath = extractWebhookPath(params, node.id, node.webhookId);
  const httpMethod = extractHttpMethod(params);

  return {
    type: 'webhook',
    node,
    webhookPath,
    httpMethod,
  };
}

/**
 * Detect form trigger and extract configuration
 */
function detectFormTrigger(node: WorkflowNode): DetectedTrigger | null {
  const normalized = normalizeNodeType(node.type).toLowerCase();
  const nodeName = normalized.split('.').pop() || '';

  const isForm = FORM_PATTERNS.some(pattern =>
    nodeName === pattern || nodeName.includes(pattern)
  );

  if (!isForm) {
    return null;
  }

  // Extract form fields from parameters
  const params = node.parameters || {};
  const formFields = extractFormFields(params);
  const webhookPath = extractWebhookPath(params, node.id, node.webhookId);

  return {
    type: 'form',
    node,
    webhookPath,
    formFields,
  };
}

/**
 * Detect chat trigger and extract configuration
 */
function detectChatTrigger(node: WorkflowNode): DetectedTrigger | null {
  const normalized = normalizeNodeType(node.type).toLowerCase();
  const nodeName = normalized.split('.').pop() || '';

  const isChat = CHAT_PATTERNS.some(pattern =>
    nodeName === pattern || nodeName.includes(pattern)
  );

  if (!isChat) {
    return null;
  }

  // Extract chat configuration
  const params = node.parameters || {};
  const responseMode = (params.options as any)?.responseMode || 'lastNode';
  const webhookPath = extractWebhookPath(params, node.id, node.webhookId);

  return {
    type: 'chat',
    node,
    webhookPath,
    chatConfig: {
      responseMode,
    },
  };
}

/**
 * Extract webhook path from node parameters
 *
 * Priority:
 * 1. Explicit path parameter in node config
 * 2. HTTP method specific path
 * 3. webhookId on the node (n8n assigns this for all webhook-like triggers)
 * 4. Fallback to node ID
 */
function extractWebhookPath(params: Record<string, unknown>, nodeId: string, webhookId?: string): string {
  // Check for explicit path parameter
  if (typeof params.path === 'string' && params.path) {
    return params.path;
  }

  // Check for httpMethod specific path
  if (typeof params.httpMethod === 'string') {
    const methodPath = params[`path_${params.httpMethod.toLowerCase()}`];
    if (typeof methodPath === 'string' && methodPath) {
      return methodPath;
    }
  }

  // Use webhookId if available (n8n assigns this for chat/form/webhook triggers)
  if (typeof webhookId === 'string' && webhookId) {
    return webhookId;
  }

  // Default: use node ID as path (n8n default behavior)
  return nodeId;
}

/**
 * Extract HTTP method from webhook parameters
 */
function extractHttpMethod(params: Record<string, unknown>): string {
  if (typeof params.httpMethod === 'string') {
    return params.httpMethod.toUpperCase();
  }
  return 'POST'; // Default to POST
}

/**
 * Extract form field names from form trigger parameters
 */
function extractFormFields(params: Record<string, unknown>): string[] {
  const fields: string[] = [];

  // Check for formFields parameter (common pattern)
  if (Array.isArray(params.formFields)) {
    for (const field of params.formFields) {
      if (field && typeof field.fieldLabel === 'string') {
        fields.push(field.fieldLabel);
      } else if (field && typeof field.fieldName === 'string') {
        fields.push(field.fieldName);
      }
    }
  }

  // Check for fields in options
  const options = params.options as Record<string, unknown> | undefined;
  if (options && Array.isArray(options.formFields)) {
    for (const field of options.formFields) {
      if (field && typeof field.fieldLabel === 'string') {
        fields.push(field.fieldLabel);
      }
    }
  }

  return fields;
}

/**
 * Build the trigger URL based on detected trigger and n8n base URL
 *
 * @param baseUrl - n8n instance base URL (e.g., https://n8n.example.com)
 * @param trigger - Detected trigger information
 * @param mode - 'production' uses /webhook/, 'test' uses /webhook-test/
 */
export function buildTriggerUrl(
  baseUrl: string,
  trigger: DetectedTrigger,
  mode: 'production' | 'test' = 'production'
): string {
  const cleanBaseUrl = baseUrl.replace(/\/+$/, ''); // Remove trailing slashes

  switch (trigger.type) {
    case 'webhook': {
      const prefix = mode === 'test' ? 'webhook-test' : 'webhook';
      const path = trigger.webhookPath || trigger.node.id;
      return `${cleanBaseUrl}/${prefix}/${path}`;
    }

    case 'chat': {
      // Chat triggers use /webhook/<webhookId>/chat endpoint
      const prefix = mode === 'test' ? 'webhook-test' : 'webhook';
      const path = trigger.webhookPath || trigger.node.id;
      return `${cleanBaseUrl}/${prefix}/${path}/chat`;
    }

    case 'form': {
      // Form triggers use /form/<webhookId> endpoint
      const prefix = mode === 'test' ? 'form-test' : 'form';
      const path = trigger.webhookPath || trigger.node.id;
      return `${cleanBaseUrl}/${prefix}/${path}`;
    }

    default:
      throw new Error(`Cannot build URL for trigger type: ${trigger.type}`);
  }
}

/**
 * Get a human-readable description of the detected trigger
 */
export function describeTrigger(trigger: DetectedTrigger): string {
  switch (trigger.type) {
    case 'webhook':
      return `Webhook trigger (${trigger.httpMethod || 'POST'} /${trigger.webhookPath || trigger.node.id})`;

    case 'form':
      const fieldCount = trigger.formFields?.length || 0;
      return `Form trigger (${fieldCount} fields)`;

    case 'chat':
      return `Chat trigger (${trigger.chatConfig?.responseMode || 'lastNode'} mode)`;

    default:
      return 'Unknown trigger';
  }
}
