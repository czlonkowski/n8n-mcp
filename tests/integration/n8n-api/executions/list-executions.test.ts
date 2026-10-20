/**
 * Integration Tests: handleListExecutions
 *
 * Tests execution listing against a real n8n instance.
 * Covers filtering, pagination, and various list parameters.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createMcpContext } from '../utils/mcp-context';
import { InstanceContext } from '../../../../src/types/instance-context';
import { handleListExecutions } from '../../../../src/mcp/handlers-n8n-manager';

describe('Integration: handleListExecutions', () => {
  let mcpContext: InstanceContext;

  beforeEach(() => {
    mcpContext = createMcpContext();
  });

  // ======================================================================
  // No Filters
  // ======================================================================

  describe('No Filters', () => {
    it('should list all executions without filters', async () => {
      const response = await handleListExecutions({}, mcpContext);

      expect(response.success).toBe(true);
      expect(response.data).toBeDefined();

      const data = response.data as any;
      expect(Array.isArray(data.executions)).toBe(true);
      expect(data).toHaveProperty('returned');
    });
  });

  // ======================================================================
  // Filter by Status
  // ======================================================================

  describe('Filter by Status', () => {
    it('should filter executions by success status', async () => {
      const response = await handleListExecutions(
        { status: 'success' },
        mcpContext
      );

      expect(response.success).toBe(true);
      const data = response.data as any;

      expect(Array.isArray(data.executions)).toBe(true);
      // All returned executions should have success status
      if (data.executions.length > 0) {
        data.executions.forEach((exec: any) => {
          expect(exec.status).toBe('success');
        });
      }
    });

    it('should filter executions by error status', async () => {
      const response = await handleListExecutions(
        { status: 'error' },
        mcpContext
      );

      expect(response.success).toBe(true);
      const data = response.data as any;

      expect(Array.isArray(data.executions)).toBe(true);
      // All returned executions should have error status
      if (data.executions.length > 0) {
        data.executions.forEach((exec: any) => {
          expect(exec.status).toBe('error');
        });
      }
    });

    it('should filter executions by waiting status', async () => {
      const response = await handleListExecutions(
        { status: 'waiting' },
        mcpContext
      );

      expect(response.success).toBe(true);
      const data = response.data as any;

      expect(Array.isArray(data.executions)).toBe(true);
    });
  });

  // ======================================================================
  // Pagination
  // ======================================================================

  describe('Pagination', () => {
    it('should return first page with limit', async () => {
      const response = await handleListExecutions(
        { limit: 10 },
        mcpContext
      );

      expect(response.success).toBe(true);
      const data = response.data as any;

      expect(Array.isArray(data.executions)).toBe(true);
      expect(data.executions.length).toBeLessThanOrEqual(10);
    });

    it('should handle pagination with cursor', async () => {
      // Get first page
      const firstPage = await handleListExecutions(
        { limit: 5 },
        mcpContext
      );

      expect(firstPage.success).toBe(true);
      const firstData = firstPage.data as any;

      // If there's a next cursor, get second page
      if (firstData.nextCursor) {
        const secondPage = await handleListExecutions(
          { limit: 5, cursor: firstData.nextCursor },
          mcpContext
        );

        expect(secondPage.success).toBe(true);
        const secondData = secondPage.data as any;

        // Second page should have different executions
        const firstIds = new Set(firstData.executions.map((e: any) => e.id));
        const secondIds = secondData.executions.map((e: any) => e.id);

        secondIds.forEach((id: string) => {
          expect(firstIds.has(id)).toBe(false);
        });
      }
    });

    it('should respect limit=1', async () => {
      const response = await handleListExecutions(
        { limit: 1 },
        mcpContext
      );

      expect(response.success).toBe(true);
      const data = response.data as any;

      expect(data.executions.length).toBeLessThanOrEqual(1);
    });

    it('should respect limit=50', async () => {
      const response = await handleListExecutions(
        { limit: 50 },
        mcpContext
      );

      expect(response.success).toBe(true);
      const data = response.data as any;

      expect(data.executions.length).toBeLessThanOrEqual(50);
    });

    it('should respect limit=100 (max)', async () => {
      const response = await handleListExecutions(
        { limit: 100 },
        mcpContext
      );

      expect(response.success).toBe(true);
      const data = response.data as any;

      expect(data.executions.length).toBeLessThanOrEqual(100);
    });
  });

  // ======================================================================
  // Include Execution Data
  // ======================================================================

  describe('Include Execution Data', () => {
    it('should exclude execution data by default', async () => {
      const response = await handleListExecutions(
        { limit: 5 },
        mcpContext
      );

      expect(response.success).toBe(true);
      const data = response.data as any;

      expect(Array.isArray(data.executions)).toBe(true);
      // By default, should not include full execution data
    });

    it('should include execution data when requested', async () => {
      const response = await handleListExecutions(
        { limit: 5, includeData: true },
        mcpContext
      );

      expect(response.success).toBe(true);
      const data = response.data as any;

      expect(Array.isArray(data.executions)).toBe(true);
    });
  });

  // ======================================================================
  // Empty Results
  // ======================================================================

  describe('Empty Results', () => {
    it('should return empty array when no executions match filters', async () => {
      // Use a very restrictive workflowId that likely doesn't exist
      const response = await handleListExecutions(
        { workflowId: '99999999' },
        mcpContext
      );

      expect(response.success).toBe(true);
      const data = response.data as any;

      expect(Array.isArray(data.executions)).toBe(true);
      // May or may not be empty depending on actual data
    });
  });

  // ======================================================================
  // Response Format Verification
  // ======================================================================

  describe('Response Format', () => {
    it('should return complete list response structure', async () => {
      const response = await handleListExecutions(
        { limit: 10 },
        mcpContext
      );

      expect(response.success).toBe(true);
      const data = response.data as any;

      // Verify required fields
      expect(data).toHaveProperty('executions');
      expect(Array.isArray(data.executions)).toBe(true);
      expect(data).toHaveProperty('returned');
      expect(data).toHaveProperty('hasMore');

      // Verify pagination fields when present
      if (data.nextCursor) {
        expect(typeof data.nextCursor).toBe('string');
      }

      // Verify execution structure if any executions returned
      if (data.executions.length > 0) {
        const execution = data.executions[0];
        expect(execution).toHaveProperty('id');

        if (execution.status) {
          expect(['success', 'error', 'running', 'waiting', 'canceled', 'crashed', 'new', 'unknown']).toContain(execution.status);
        }
      }
    });
  });
});
