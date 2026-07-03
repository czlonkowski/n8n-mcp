/**
 * Workflow Fixed Collection Validation Tests
 * Tests that workflow validation catches fixedCollection structure errors at the workflow level
 */

import { describe, test, expect, beforeEach, vi } from 'vitest';
import { WorkflowValidator } from '../../../src/services/workflow-validator';
import { EnhancedConfigValidator } from '../../../src/services/enhanced-config-validator';
import { NodeRepository } from '../../../src/database/node-repository';

describe('Workflow FixedCollection Validation', () => {
  let validator: WorkflowValidator;
  let mockNodeRepository: any;

  beforeEach(() => {
    // Create mock repository that returns basic node info for common nodes
    mockNodeRepository = {
      getNode: vi.fn().mockImplementation((type: string) => {
        const normalizedType = type.replace('n8n-nodes-base.', '').replace('nodes-base.', '');
        switch (normalizedType) {
          case 'webhook':
            return {
              nodeType: 'nodes-base.webhook',
              displayName: 'Webhook',
              properties: [
                { name: 'path', type: 'string', required: true },
                { name: 'httpMethod', type: 'options' }
              ]
            };
          case 'switch':
            return {
              nodeType: 'nodes-base.switch',
              displayName: 'Switch',
              properties: [
                { name: 'rules', type: 'fixedCollection', required: true }
              ]
            };
          case 'if':
            return {
              nodeType: 'nodes-base.if',
              displayName: 'If',
              properties: [
                { name: 'conditions', type: 'filter', required: true }
              ]
            };
          case 'filter':
            return {
              nodeType: 'nodes-base.filter',
              displayName: 'Filter',
              properties: [
                { name: 'conditions', type: 'filter', required: true }
              ]
            };
          default:
            return null;
        }
      })
    };
    
    validator = new WorkflowValidator(mockNodeRepository, EnhancedConfigValidator);
  });

  test('should catch invalid Switch node structure in workflow validation', async () => {
    const workflow = {
      name: 'Test Workflow with Invalid Switch',
      nodes: [
        {
          id: 'webhook',
          name: 'Webhook',
          type: 'n8n-nodes-base.webhook',
          position: [0, 0] as [number, number],
          parameters: {
            path: 'test-webhook'
          }
        },
        {
          id: 'switch',
          name: 'Switch',
          type: 'n8n-nodes-base.switch',
          position: [200, 0] as [number, number],
          parameters: {
            // This is the problematic structure that causes "propertyValues[itemName] is not iterable"
            rules: {
              conditions: {
                values: [
                  {
                    value1: '={{$json.status}}',
                    operation: 'equals',
                    value2: 'active'
                  }
                ]
              }
            }
          }
        }
      ],
      connections: {
        Webhook: {
          main: [[{ node: 'Switch', type: 'main', index: 0 }]]
        }
      }
    };

    const result = await validator.validateWorkflow(workflow, {
      validateNodes: true,
      profile: 'ai-friendly'
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    
    const switchError = result.errors.find(e => e.nodeId === 'switch');
    expect(switchError).toBeDefined();
    expect(switchError!.message).toContain('propertyValues[itemName] is not iterable');
    expect(switchError!.message).toContain('Invalid structure for nodes-base.switch node');
  });

  test('should catch invalid If node structure in workflow validation', async () => {
    const workflow = {
      name: 'Test Workflow with Invalid If',
      nodes: [
        {
          id: 'webhook',
          name: 'Webhook',
          type: 'n8n-nodes-base.webhook',
          position: [0, 0] as [number, number],
          parameters: {
            path: 'test-webhook'
          }
        },
        {
          id: 'if',
          name: 'If',
          type: 'n8n-nodes-base.if',
          position: [200, 0] as [number, number],
          parameters: {
            // This is the problematic structure
            conditions: {
              values: [
                {
                  value1: '={{$json.age}}',
                  operation: 'largerEqual',
                  value2: 18
                }
              ]
            }
          }
        }
      ],
      connections: {
        Webhook: {
          main: [[{ node: 'If', type: 'main', index: 0 }]]
        }
      }
    };

    const result = await validator.validateWorkflow(workflow, {
      validateNodes: true,
      profile: 'ai-friendly'
    });

    expect(result.valid).toBe(false);

    // The invalid nested structure (conditions.values) is the one real defect.
    // The former "missing combinator"/"missing conditions" companions were
    // false positives (n8n defaults the combinator; audit A3) and are gone.
    expect(result.errors).toHaveLength(1);

    // All errors should be for the If node
    const ifErrors = result.errors.filter(e => e.nodeId === 'if');
    expect(ifErrors).toHaveLength(1);

    // Check for the main structure error
    const structureError = ifErrors.find(e => e.message.includes('Invalid structure'));
    expect(structureError).toBeDefined();
    expect(structureError!.message).toContain('conditions.values');
    expect(structureError!.message).toContain('propertyValues[itemName] is not iterable');
  });

  test('should accept valid Switch node structure in workflow validation', async () => {
    const workflow = {
      name: 'Test Workflow with Valid Switch',
      nodes: [
        {
          id: 'webhook',
          name: 'Webhook',
          type: 'n8n-nodes-base.webhook',
          position: [0, 0] as [number, number],
          parameters: {
            path: 'test-webhook'
          }
        },
        {
          id: 'switch',
          name: 'Switch',
          type: 'n8n-nodes-base.switch',
          position: [200, 0] as [number, number],
          parameters: {
            // This is the correct structure
            rules: {
              values: [
                {
                  conditions: {
                    value1: '={{$json.status}}',
                    operation: 'equals',
                    value2: 'active'
                  },
                  outputKey: 'active'
                }
              ]
            }
          }
        }
      ],
      connections: {
        Webhook: {
          main: [[{ node: 'Switch', type: 'main', index: 0 }]]
        }
      }
    };

    const result = await validator.validateWorkflow(workflow, {
      validateNodes: true,
      profile: 'ai-friendly'
    });

    // Should not have fixedCollection structure errors
    const hasFixedCollectionError = result.errors.some(e => 
      e.message.includes('propertyValues[itemName] is not iterable')
    );
    expect(hasFixedCollectionError).toBe(false);
  });

  test('should catch multiple fixedCollection errors in a single workflow', async () => {
    const workflow = {
      name: 'Test Workflow with Multiple Invalid Structures',
      nodes: [
        {
          id: 'webhook',
          name: 'Webhook',
          type: 'n8n-nodes-base.webhook',
          position: [0, 0] as [number, number],
          parameters: {
            path: 'test-webhook'
          }
        },
        {
          id: 'switch',
          name: 'Switch',
          type: 'n8n-nodes-base.switch',
          position: [200, 0] as [number, number],
          parameters: {
            rules: {
              conditions: {
                values: [{ value1: 'test', operation: 'equals', value2: 'test' }]
              }
            }
          }
        },
        {
          id: 'if',
          name: 'If',
          type: 'n8n-nodes-base.if',
          position: [400, 0] as [number, number],
          parameters: {
            conditions: {
              values: [{ value1: 'test', operation: 'equals', value2: 'test' }]
            }
          }
        },
        {
          id: 'filter',
          name: 'Filter',
          type: 'n8n-nodes-base.filter',
          position: [600, 0] as [number, number],
          parameters: {
            conditions: {
              values: [{ value1: 'test', operation: 'equals', value2: 'test' }]
            }
          }
        }
      ],
      connections: {
        Webhook: {
          main: [[{ node: 'Switch', type: 'main', index: 0 }]]
        },
        Switch: {
          main: [
            [{ node: 'If', type: 'main', index: 0 }],
            [{ node: 'Filter', type: 'main', index: 0 }]
          ]
        }
      }
    };

    const result = await validator.validateWorkflow(workflow, {
      validateNodes: true,
      profile: 'ai-friendly'
    });

    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(3); // At least one error for each problematic node
    
    // Check that each problematic node has an error
    const switchError = result.errors.find(e => e.nodeId === 'switch');
    const ifError = result.errors.find(e => e.nodeId === 'if');
    const filterError = result.errors.find(e => e.nodeId === 'filter');
    
    expect(switchError).toBeDefined();
    expect(ifError).toBeDefined();
    expect(filterError).toBeDefined();
  });

  test('should provide helpful statistics about fixedCollection errors', async () => {
    const workflow = {
      name: 'Test Workflow Statistics',
      nodes: [
        {
          id: 'webhook',
          name: 'Webhook',
          type: 'n8n-nodes-base.webhook',
          position: [0, 0] as [number, number],
          parameters: { path: 'test' }
        },
        {
          id: 'bad-switch',
          name: 'Bad Switch',
          type: 'n8n-nodes-base.switch',
          position: [200, 0] as [number, number],
          parameters: {
            rules: {
              conditions: { values: [{ value1: 'test', operation: 'equals', value2: 'test' }] }
            }
          }
        },
        {
          id: 'good-switch',
          name: 'Good Switch',
          type: 'n8n-nodes-base.switch',
          position: [400, 0] as [number, number],
          parameters: {
            rules: {
              values: [{ conditions: { value1: 'test', operation: 'equals', value2: 'test' }, outputKey: 'out' }]
            }
          }
        }
      ],
      connections: {
        Webhook: {
          main: [
            [{ node: 'Bad Switch', type: 'main', index: 0 }],
            [{ node: 'Good Switch', type: 'main', index: 0 }]
          ]
        }
      }
    };

    const result = await validator.validateWorkflow(workflow, {
      validateNodes: true,
      profile: 'ai-friendly'
    });

    expect(result.statistics.totalNodes).toBe(3);
    expect(result.statistics.enabledNodes).toBe(3);
    expect(result.valid).toBe(false); // Should be invalid due to the bad switch
    
    // Should have at least one error for the bad switch
    const badSwitchError = result.errors.find(e => e.nodeId === 'bad-switch');
    expect(badSwitchError).toBeDefined();
    
    // Should not have errors for the good switch or webhook
    const goodSwitchError = result.errors.find(e => e.nodeId === 'good-switch');
    const webhookError = result.errors.find(e => e.nodeId === 'webhook');
    
    // These might have other validation errors, but not fixedCollection errors
    if (goodSwitchError) {
      expect(goodSwitchError.message).not.toContain('propertyValues[itemName] is not iterable');
    }
    if (webhookError) {
      expect(webhookError.message).not.toContain('propertyValues[itemName] is not iterable');
    }
  });

  test('should work with different validation profiles', async () => {
    const workflow = {
      name: 'Test Profile Compatibility',
      nodes: [
        {
          id: 'switch',
          name: 'Switch',
          type: 'n8n-nodes-base.switch',
          position: [0, 0] as [number, number],
          parameters: {
            rules: {
              conditions: {
                values: [{ value1: 'test', operation: 'equals', value2: 'test' }]
              }
            }
          }
        }
      ],
      connections: {}
    };

    const profiles: Array<'strict' | 'runtime' | 'ai-friendly' | 'minimal'> = 
      ['strict', 'runtime', 'ai-friendly', 'minimal'];

    for (const profile of profiles) {
      const result = await validator.validateWorkflow(workflow, {
        validateNodes: true,
        profile
      });

      // All profiles should catch this critical error
      const hasCriticalError = result.errors.some(e => 
        e.message.includes('propertyValues[itemName] is not iterable')
      );
      
      expect(hasCriticalError, `Profile ${profile} should catch critical fixedCollection error`).toBe(true);
      expect(result.valid, `Profile ${profile} should mark workflow as invalid`).toBe(false);
    }
  });
});