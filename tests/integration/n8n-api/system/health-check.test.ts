/**
 * Integration Tests: handleHealthCheck
 *
 * Tests API health check against a real n8n instance.
 * Covers connectivity verification and feature availability.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createMcpContext } from '../utils/mcp-context';
import { InstanceContext } from '../../../../src/types/instance-context';
import { handleHealthCheck } from '../../../../src/mcp/handlers-n8n-manager';
import { HealthCheckResponse } from '../utils/response-types';

describe('Integration: handleHealthCheck', () => {
  let mcpContext: InstanceContext;

  beforeEach(() => {
    mcpContext = createMcpContext();
  });

  // ======================================================================
  // Successful Health Check
  // ======================================================================

  describe('API Available', () => {
    it('should successfully check n8n API health', async () => {
      const response = await handleHealthCheck(mcpContext);

      expect(response.success).toBe(true);
      expect(response.data).toBeDefined();

      const data = response.data as HealthCheckResponse;

      // Verify required fields
      expect(data).toHaveProperty('status');
      expect(data).toHaveProperty('apiUrl');
      expect(data).toHaveProperty('mcpVersion');
      expect(data).toHaveProperty('versionCheck');
      expect(data).toHaveProperty('performance');
      expect(data).toHaveProperty('nextSteps');

      // Status should be a string (e.g., "ok", "healthy")
      if (data.status) {
        expect(typeof data.status).toBe('string');
      }

      // API URL should match configuration
      expect(data.apiUrl).toBeDefined();
      expect(typeof data.apiUrl).toBe('string');

      // MCP version should be defined
      expect(data.mcpVersion).toBeDefined();
      expect(typeof data.mcpVersion).toBe('string');

      // Version check should be present
      expect(data.versionCheck).toBeDefined();
      expect(data.versionCheck).toHaveProperty('current');
      expect(data.versionCheck).toHaveProperty('upToDate');
      expect(typeof data.versionCheck.upToDate).toBe('boolean');

      // Performance metrics should be present
      expect(data.performance).toBeDefined();
      expect(data.performance).toHaveProperty('responseTimeMs');
      expect(typeof data.performance.responseTimeMs).toBe('number');
      expect(data.performance.responseTimeMs).toBeGreaterThan(0);

      // Next steps should be present
      expect(data.nextSteps).toBeDefined();
      expect(Array.isArray(data.nextSteps)).toBe(true);
    });

    it('should include feature availability information', async () => {
      const response = await handleHealthCheck(mcpContext);

      expect(response.success).toBe(true);
      const data = response.data as HealthCheckResponse;

      // Check for feature information
      // Note: Features may vary by n8n instance configuration
      if (data.features) {
        expect(typeof data.features).toBe('object');
      }

      // Check for version information
      if (data.n8nVersion) {
        expect(typeof data.n8nVersion).toBe('string');
      }

      if (data.supportedN8nVersion) {
        expect(typeof data.supportedN8nVersion).toBe('string');
      }

      // One of the two is always there: n8n has withheld its version from API clients since
      // 1.119.0, and an instance that does not report one says so rather than staying silent.
      expect(data.n8nVersion === undefined).toBe(data.n8nVersionNote !== undefined);
      if (data.n8nVersionNote) {
        expect(data.n8nVersionNote).toContain('version');
      }
    });
  });

  // ======================================================================
  // Response Format Verification
  // ======================================================================

  describe('Response Format', () => {
    it('should return complete health check response structure', async () => {
      const response = await handleHealthCheck(mcpContext);

      expect(response.success).toBe(true);
      expect(response.data).toBeDefined();

      const data = response.data as HealthCheckResponse;

      // Verify all expected fields are present
      const expectedFields = ['status', 'apiUrl', 'mcpVersion'];
      expectedFields.forEach(field => {
        expect(data).toHaveProperty(field);
      });

      // Optional fields that may be present
      const optionalFields = ['instanceId', 'n8nVersion', 'features', 'supportedN8nVersion', 'n8nVersionNote'];
      optionalFields.forEach(field => {
        if (data[field] !== undefined) {
          expect(data[field]).not.toBeNull();
        }
      });
    });
  });
});
