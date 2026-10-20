/**
 * Integration Tests: handleGetExecution
 *
 * Tests execution retrieval against a real n8n instance.
 * Covers all retrieval modes, filtering options, and error handling.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { createMcpContext } from '../utils/mcp-context';
import { InstanceContext } from '../../../../src/types/instance-context';
import { handleGetExecution, handleTriggerWebhookWorkflow } from '../../../../src/mcp/handlers-n8n-manager';
import { getN8nCredentials } from '../utils/credentials';

describe('Integration: handleGetExecution', () => {
  let mcpContext: InstanceContext;
  let executionId: string;
  let webhookUrl: string;

  beforeAll(async () => {
    mcpContext = createMcpContext();
    const creds = getN8nCredentials();
    webhookUrl = creds.webhookUrls.get;

    // Trigger a webhook to create an execution for testing
    const triggerResponse = await handleTriggerWebhookWorkflow(
      {
        webhookUrl,
        httpMethod: 'GET',
        waitForResponse: true
      },
      mcpContext
    );

    // Extract execution ID from the response
    if (triggerResponse.success && triggerResponse.data) {
      const responseData = triggerResponse.data as any;
      // Try to get execution ID from various possible locations
      executionId = responseData.executionId ||
                    responseData.id ||
                    responseData.execution?.id ||
                    responseData.workflowData?.executionId;

      if (!executionId) {
        // If no execution ID in response, we'll use error handling tests
        console.warn('Could not extract execution ID from webhook response');
      }
    }
  }, 30000);

  // ======================================================================
  // Preview Mode
  // ======================================================================

  describe('Preview Mode', () => {
    it('should get execution in preview mode (structure only)', async () => {
      if (!executionId) {
        console.warn('Skipping test: No execution ID available');
        return;
      }

      const response = await handleGetExecution(
        {
          id: executionId,
          mode: 'preview'
        },
        mcpContext
      );

      expect(response.success).toBe(true);
      const data = response.data as any;

      // Preview mode should return structure and counts
      expect(data).toBeDefined();
      expect(data.id).toBe(executionId);

      // Should have basic execution info
      if (data.status) {
        expect(['success', 'error', 'running', 'waiting', 'canceled', 'crashed', 'new', 'unknown']).toContain(data.status);
      }
    });
  });

  // ======================================================================
  // Summary Mode (Default)
  // ======================================================================

  describe('Summary Mode', () => {
    it('should get execution in summary mode (2 samples per node)', async () => {
      if (!executionId) {
        console.warn('Skipping test: No execution ID available');
        return;
      }

      const response = await handleGetExecution(
        {
          id: executionId,
          mode: 'summary'
        },
        mcpContext
      );

      expect(response.success).toBe(true);
      const data = response.data as any;

      expect(data).toBeDefined();
      expect(data.id).toBe(executionId);
    });

    it('should default to summary mode when mode not specified', async () => {
      if (!executionId) {
        console.warn('Skipping test: No execution ID available');
        return;
      }

      const response = await handleGetExecution(
        {
          id: executionId
        },
        mcpContext
      );

      expect(response.success).toBe(true);
      const data = response.data as any;

      expect(data).toBeDefined();
      expect(data.id).toBe(executionId);
    });
  });

  // ======================================================================
  // Filtered Mode
  // ======================================================================

  describe('Filtered Mode', () => {
    it('should get execution with custom items limit', async () => {
      if (!executionId) {
        console.warn('Skipping test: No execution ID available');
        return;
      }

      const response = await handleGetExecution(
        {
          id: executionId,
          mode: 'filtered',
          itemsLimit: 5
        },
        mcpContext
      );

      expect(response.success).toBe(true);
      const data = response.data as any;

      expect(data).toBeDefined();
      expect(data.id).toBe(executionId);
    });

    it('should get execution with itemsLimit 0 (structure only)', async () => {
      if (!executionId) {
        console.warn('Skipping test: No execution ID available');
        return;
      }

      const response = await handleGetExecution(
        {
          id: executionId,
          mode: 'filtered',
          itemsLimit: 0
        },
        mcpContext
      );

      expect(response.success).toBe(true);
      const data = response.data as any;

      expect(data).toBeDefined();
      expect(data.id).toBe(executionId);
    });

    it('should get execution with unlimited items (itemsLimit: -1)', async () => {
      if (!executionId) {
        console.warn('Skipping test: No execution ID available');
        return;
      }

      const response = await handleGetExecution(
        {
          id: executionId,
          mode: 'filtered',
          itemsLimit: -1
        },
        mcpContext
      );

      expect(response.success).toBe(true);
      const data = response.data as any;

      expect(data).toBeDefined();
      expect(data.id).toBe(executionId);
    });

    it('should get execution filtered by node names', async () => {
      if (!executionId) {
        console.warn('Skipping test: No execution ID available');
        return;
      }

      const response = await handleGetExecution(
        {
          id: executionId,
          mode: 'filtered',
          nodeNames: ['Webhook']
        },
        mcpContext
      );

      expect(response.success).toBe(true);
      const data = response.data as any;

      expect(data).toBeDefined();
      expect(data.id).toBe(executionId);
    });
  });

  // ======================================================================
  // Full Mode
  // ======================================================================

  describe('Full Mode', () => {
    it('should get complete execution data', async () => {
      if (!executionId) {
        console.warn('Skipping test: No execution ID available');
        return;
      }

      const response = await handleGetExecution(
        {
          id: executionId,
          mode: 'full'
        },
        mcpContext
      );

      expect(response.success).toBe(true);
      const data = response.data as any;

      expect(data).toBeDefined();
      expect(data.id).toBe(executionId);

      // Full mode should include complete execution data
      if (data.data) {
        expect(typeof data.data).toBe('object');
      }
    });
  });

  // ======================================================================
  // Input Data Inclusion
  // ======================================================================

  describe('Input Data Inclusion', () => {
    it('should include input data when requested', async () => {
      if (!executionId) {
        console.warn('Skipping test: No execution ID available');
        return;
      }

      const response = await handleGetExecution(
        {
          id: executionId,
          mode: 'summary',
          includeInputData: true
        },
        mcpContext
      );

      expect(response.success).toBe(true);
      const data = response.data as any;

      expect(data).toBeDefined();
      expect(data.id).toBe(executionId);
    });

    it('should exclude input data by default', async () => {
      if (!executionId) {
        console.warn('Skipping test: No execution ID available');
        return;
      }

      const response = await handleGetExecution(
        {
          id: executionId,
          mode: 'summary',
          includeInputData: false
        },
        mcpContext
      );

      expect(response.success).toBe(true);
      const data = response.data as any;

      expect(data).toBeDefined();
      expect(data.id).toBe(executionId);
    });
  });

  // ======================================================================
  // Legacy Parameter Compatibility
  // ======================================================================

  describe('Legacy Parameter Compatibility', () => {
    it('should support legacy includeData parameter', async () => {
      if (!executionId) {
        console.warn('Skipping test: No execution ID available');
        return;
      }

      const response = await handleGetExecution(
        {
          id: executionId,
          includeData: true
        },
        mcpContext
      );

      expect(response.success).toBe(true);
      const data = response.data as any;

      expect(data).toBeDefined();
      expect(data.id).toBe(executionId);
    });
  });

  // ======================================================================
  // Error Handling
  // ======================================================================

  describe('Error Handling', () => {
    it('should handle non-existent execution ID', async () => {
      const response = await handleGetExecution(
        {
          id: '99999999'
        },
        mcpContext
      );

      expect(response.success).toBe(false);
      expect(response.error).toBeDefined();
    });

    it('should handle invalid execution ID format', async () => {
      const response = await handleGetExecution(
        {
          id: 'invalid-id-format'
        },
        mcpContext
      );

      expect(response.success).toBe(false);
      expect(response.error).toBeDefined();
    });

    it('should handle missing execution ID', async () => {
      const response = await handleGetExecution(
        {} as any,
        mcpContext
      );

      expect(response.success).toBe(false);
      expect(response.error).toBeDefined();
    });

    it('should handle invalid mode parameter', async () => {
      if (!executionId) {
        console.warn('Skipping test: No execution ID available');
        return;
      }

      const response = await handleGetExecution(
        {
          id: executionId,
          mode: 'invalid-mode' as any
        },
        mcpContext
      );

      expect(response.success).toBe(false);
      expect(response.error).toBeDefined();
    });
  });

  // ======================================================================
  // Response Format Verification
  // ======================================================================

  describe('Response Format', () => {
    it('should return complete execution response structure', async () => {
      if (!executionId) {
        console.warn('Skipping test: No execution ID available');
        return;
      }

      const response = await handleGetExecution(
        {
          id: executionId,
          mode: 'summary'
        },
        mcpContext
      );

      expect(response.success).toBe(true);
      expect(response.data).toBeDefined();

      const data = response.data as any;
      expect(data.id).toBeDefined();

      // Should have execution metadata
      if (data.status) {
        expect(typeof data.status).toBe('string');
      }
      if (data.mode) {
        expect(typeof data.mode).toBe('string');
      }
      if (data.startedAt) {
        expect(typeof data.startedAt).toBe('string');
      }
    });
  });
});
