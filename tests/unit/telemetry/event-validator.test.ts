import { describe, it, expect } from 'vitest';
import { TelemetryEventValidator } from '../../../src/telemetry/event-validator';
import type { WorkflowTelemetry } from '../../../src/telemetry/telemetry-types';

function makeWorkflowTelemetry(overrides: Partial<WorkflowTelemetry> = {}): WorkflowTelemetry {
  return {
    user_id: 'u'.repeat(32),
    workflow_hash: 'w'.repeat(16),
    node_count: 1,
    node_types: ['n8n-nodes-base.httpRequest'],
    has_trigger: false,
    has_webhook: false,
    complexity: 'simple',
    sanitized_workflow: {
      nodes: [
        {
          id: '1',
          name: 'HTTP',
          type: 'n8n-nodes-base.httpRequest',
          typeVersion: 4,
          position: [0, 0],
          parameters: { url: '[REDACTED_URL]', method: 'GET' },
        },
      ],
      connections: {},
    },
    ...overrides,
  };
}

describe('TelemetryEventValidator.validateWorkflow', () => {
  it('accepts a well-formed sanitized workflow', () => {
    const v = new TelemetryEventValidator();
    expect(v.validateWorkflow(makeWorkflowTelemetry())).not.toBeNull();
  });

  it('GHSA-f3rg-xqjj-cj9w: rejects a node missing required fields', () => {
    const v = new TelemetryEventValidator();
    const bad = makeWorkflowTelemetry({
      sanitized_workflow: {
        nodes: [{ name: 'HTTP', type: 'x', typeVersion: 1, position: [0, 0], parameters: {} }],
        connections: {},
      },
    });
    expect(v.validateWorkflow(bad)).toBeNull();
  });

  it('GHSA-f3rg-xqjj-cj9w: rejects unknown top-level node keys (.strict)', () => {
    const v = new TelemetryEventValidator();
    const bad = makeWorkflowTelemetry({
      sanitized_workflow: {
        nodes: [
          {
            id: '1',
            name: 'HTTP',
            type: 'n8n-nodes-base.httpRequest',
            typeVersion: 4,
            position: [0, 0],
            parameters: {},
            // An unknown sibling field that bypasses sanitization would silently
            // leak under the old z.array(z.any()) schema; .strict() catches it.
            rawWorkflow: { url: 'https://leaked.example.com/v1/customer/123' },
          },
        ],
        connections: {},
      },
    });
    expect(v.validateWorkflow(bad)).toBeNull();
  });

  it('accepts the full set of optional n8n node fields', () => {
    const v = new TelemetryEventValidator();
    const ok = makeWorkflowTelemetry({
      sanitized_workflow: {
        nodes: [
          {
            id: '1',
            name: 'HTTP',
            type: 'n8n-nodes-base.httpRequest',
            typeVersion: 4,
            position: [0, 0],
            parameters: {},
            disabled: false,
            notes: 'sanitized notes',
            notesInFlow: true,
            continueOnFail: false,
            retryOnFail: true,
            maxTries: 3,
            waitBetweenTries: 1000,
            alwaysOutputData: false,
            executeOnce: false,
            onError: 'continueRegularOutput',
            webhookId: 'wh-1',
          },
        ],
        connections: {},
      },
    });
    expect(v.validateWorkflow(ok)).not.toBeNull();
  });

  it('rejects workflows exceeding the 1000-node cap', () => {
    const v = new TelemetryEventValidator();
    const oversized = makeWorkflowTelemetry({
      sanitized_workflow: {
        nodes: Array.from({ length: 1001 }, (_, i) => ({
          id: String(i),
          name: `N${i}`,
          type: 'n8n-nodes-base.set',
          typeVersion: 1,
          position: [0, 0] as [number, number],
          parameters: {},
        })),
        connections: {},
      },
    });
    expect(v.validateWorkflow(oversized)).toBeNull();
  });
});

describe('TelemetryEventValidator.validateEvent string sanitization', () => {
  const message = (text: string) => {
    const v = new TelemetryEventValidator();
    const event = v.validateEvent({
      user_id: 'u',
      event: 'validation_details',
      properties: { nodeType: 'x', errorType: 'e', errorCategory: 'c', details: { message: text } },
    });
    return event?.properties.details.message as string;
  };

  it('handles long dotted text', () => {
    const start = performance.now();
    message('b.'.repeat(40_000));
    expect(performance.now() - start).toBeLessThan(2000);
  });

  it('removes an email whose local part is longer than 64 characters', () => {
    expect(message(`contact ${'a.'.repeat(50)}b@example.com now`)).toBe('contact [EMAIL] now');
    expect(message('contact jane.doe@example.com now')).toBe('contact [EMAIL] now');
  });

  it('caps string length at a whitespace boundary', () => {
    const out = message('word '.repeat(3_000));
    expect(out.length).toBeLessThanOrEqual(10_000 + ' [TRUNCATED]'.length);
    expect(out.endsWith('word [TRUNCATED]')).toBe(true);
  });

  it('sanitizes string elements of arrays like string values', () => {
    const v = new TelemetryEventValidator();
    const event = v.validateEvent({
      user_id: 'u',
      event: 'some_event',
      properties: { items: ['word '.repeat(4_000), 'mail jane.doe@example.com', 3] },
    });
    const items = event?.properties.items as any[];
    expect(items[0].endsWith('word [TRUNCATED]')).toBe(true);
    expect(items[1]).toBe('mail [EMAIL]');
    expect(items[2]).toBe(3);
  });

  it('drops a nested __proto__ key instead of replacing the copy\'s prototype', () => {
    const v = new TelemetryEventValidator();
    const event = v.validateEvent({
      user_id: 'u',
      event: 'some_event',
      properties: JSON.parse('{"nested":{"__proto__":{"injected":"x"},"ok":1}}'),
    });
    const nested = event?.properties.nested as any;
    expect(Object.getPrototypeOf(nested)).toBe(Object.prototype);
    expect(nested.injected).toBeUndefined();
    expect(nested.ok).toBe(1);
  });
});
