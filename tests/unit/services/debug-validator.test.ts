import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WorkflowValidator } from '@/services/workflow-validator';

// Mock dependencies - don't use vi.mock for complex mocks
vi.mock('@/services/expression-validator', () => ({
  ExpressionValidator: {
    validateNodeExpressions: () => ({
      valid: true,
      errors: [],
      warnings: [],
      variables: [],
      expressions: []
    })
  }
}));
vi.mock('@/utils/logger', () => ({
  Logger: vi.fn().mockImplementation(function () { return ({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn()
  }); })
}));

describe('Debug Validator Tests', () => {
  let validator: WorkflowValidator;
  let mockNodeRepository: any;
  let mockEnhancedConfigValidator: any;

  beforeEach(() => {
    // Create mock repository
    mockNodeRepository = {
      getNode: (nodeType: string) => {
        // Handle both n8n-nodes-base.set and nodes-base.set (normalized)
        if (nodeType === 'n8n-nodes-base.set' || nodeType === 'nodes-base.set') {
          return {
            name: 'Set',
            type: 'nodes-base.set',
            typeVersion: 1,
            properties: [],
            package: 'n8n-nodes-base',
            version: 1,
            displayName: 'Set'
          };
        }
        return null;
      }
    };
    
    // Create mock EnhancedConfigValidator
    mockEnhancedConfigValidator = {
      validateWithMode: () => ({
        valid: true,
        errors: [],
        warnings: [],
        suggestions: [],
        mode: 'operation',
        visibleProperties: [],
        hiddenProperties: []
      })
    };
    
    // Create validator instance
    validator = new WorkflowValidator(mockNodeRepository, mockEnhancedConfigValidator as any);
  });

  it('should handle nodes at extreme positions - debug', async () => {
    const workflow = {
      nodes: [
        { id: '1', name: 'FarLeft', type: 'n8n-nodes-base.set', position: [-999999, -999999] as [number, number], parameters: {} },
        { id: '2', name: 'FarRight', type: 'n8n-nodes-base.set', position: [999999, 999999] as [number, number], parameters: {} },
        { id: '3', name: 'Zero', type: 'n8n-nodes-base.set', position: [0, 0] as [number, number], parameters: {} }
      ],
      connections: {
        'FarLeft': {
          main: [[{ node: 'FarRight', type: 'main', index: 0 }]]
        },
        'FarRight': {
          main: [[{ node: 'Zero', type: 'main', index: 0 }]]
        }
      }
    };
    
    const result = await validator.validateWorkflow(workflow);
    
    
    // Test should pass with extreme positions
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should handle special characters in node names - debug', async () => {
    const workflow = {
      nodes: [
        { id: '1', name: 'Node@#$%', type: 'n8n-nodes-base.set', position: [0, 0] as [number, number], parameters: {} },
        { id: '2', name: 'Node 中文', type: 'n8n-nodes-base.set', position: [100, 0] as [number, number], parameters: {} },
        { id: '3', name: 'Node😊', type: 'n8n-nodes-base.set', position: [200, 0] as [number, number], parameters: {} }
      ],
      connections: {
        'Node@#$%': {
          main: [[{ node: 'Node 中文', type: 'main', index: 0 }]]
        },
        'Node 中文': {
          main: [[{ node: 'Node😊', type: 'main', index: 0 }]]
        }
      }
    };
    
    const result = await validator.validateWorkflow(workflow);
    
    
    // Test should pass with special characters in node names
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should handle non-array nodes - debug', async () => {
    const workflow = {
      nodes: 'not-an-array',
      connections: {}
    };
    const result = await validator.validateWorkflow(workflow as any);
    
    
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toContain('nodes must be an array');
  });
});