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
