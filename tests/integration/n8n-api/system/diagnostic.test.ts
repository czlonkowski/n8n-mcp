/**
 * Integration Tests: handleDiagnostic
 *
 * Tests system diagnostic functionality.
 * Covers environment checks, API status, and verbose mode.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createMcpContext } from '../utils/mcp-context';
import { InstanceContext } from '../../../../src/types/instance-context';
import { handleDiagnostic } from '../../../../src/mcp/handlers-n8n-manager';
import { DiagnosticResponse } from '../utils/response-types';

describe('Integration: handleDiagnostic', () => {
  let mcpContext: InstanceContext;

  beforeEach(() => {
    mcpContext = createMcpContext();
  });

  // ======================================================================
  // Basic Diagnostic
  // ======================================================================

  describe('Basic Diagnostic', () => {
    it('should run basic diagnostic check', async () => {
      const response = await handleDiagnostic(
        { params: { arguments: {} } },
        mcpContext
      );

      expect(response.success).toBe(true);
      expect(response.data).toBeDefined();

      const data = response.data as DiagnosticResponse;

      // Verify core diagnostic fields
      expect(data).toHaveProperty('timestamp');
      expect(data).toHaveProperty('environment');
      expect(data).toHaveProperty('apiConfiguration');
      expect(data).toHaveProperty('toolsAvailability');
      expect(data).toHaveProperty('versionInfo');
      expect(data).toHaveProperty('performance');

      // Verify timestamp format
      expect(typeof data.timestamp).toBe('string');
      const timestamp = new Date(data.timestamp);
      expect(timestamp.toString()).not.toBe('Invalid Date');

      // Verify version info
      expect(data.versionInfo).toBeDefined();
      if (data.versionInfo) {
        expect(data.versionInfo).toHaveProperty('current');
        expect(data.versionInfo).toHaveProperty('upToDate');
        // upToDate is a boolean only when the npm registry answered
        if (data.versionInfo.checkStatus === 'ok') {
          expect(typeof data.versionInfo.upToDate).toBe('boolean');
        } else {
          expect(data.versionInfo.upToDate).toBeNull();
        }
      }

      // Verify performance metrics
      expect(data.performance).toBeDefined();
      if (data.performance) {
        expect(data.performance).toHaveProperty('diagnosticResponseTimeMs');
        expect(typeof data.performance.diagnosticResponseTimeMs).toBe('number');
      }
    });

    it('should include environment variables', async () => {
      const response = await handleDiagnostic(
        { params: { arguments: {} } },
        mcpContext
      );

      const data = response.data as DiagnosticResponse;

      expect(data.environment).toBeDefined();
      expect(data.environment).toHaveProperty('N8N_API_URL');
      expect(data.environment).toHaveProperty('N8N_API_KEY');
      expect(data.environment).toHaveProperty('NODE_ENV');
      expect(data.environment).toHaveProperty('MCP_MODE');
      expect(data.environment).toHaveProperty('isDocker');
      expect(data.environment).toHaveProperty('cloudPlatform');
      expect(data.environment).toHaveProperty('nodeVersion');
      expect(data.environment).toHaveProperty('platform');

      // API key should be masked
      if (data.environment.N8N_API_KEY) {
        expect(data.environment.N8N_API_KEY).toBe('***configured***');
      }

      // Environment detection types
      expect(typeof data.environment.isDocker).toBe('boolean');
      expect(typeof data.environment.nodeVersion).toBe('string');
      expect(typeof data.environment.platform).toBe('string');
    });

    it('should check API configuration and connectivity', async () => {
      const response = await handleDiagnostic(
        { params: { arguments: {} } },
        mcpContext
      );

      const data = response.data as DiagnosticResponse;

      expect(data.apiConfiguration).toBeDefined();
      expect(data.apiConfiguration).toHaveProperty('configured');
      expect(data.apiConfiguration).toHaveProperty('status');

      // In test environment, API should be configured
      expect(data.apiConfiguration.configured).toBe(true);

      // Verify API status
      const status = data.apiConfiguration.status;
      expect(status).toHaveProperty('configured');
      expect(status).toHaveProperty('connected');

      // Should successfully connect to n8n API
      expect(status.connected).toBe(true);

      // If connected, should have version info
      if (status.connected) {
        expect(status).toHaveProperty('version');
      }

      // Config details should be present when configured
      if (data.apiConfiguration.configured) {
        expect(data.apiConfiguration).toHaveProperty('config');
        expect(data.apiConfiguration.config).toHaveProperty('baseUrl');
        expect(data.apiConfiguration.config).toHaveProperty('timeout');
        expect(data.apiConfiguration.config).toHaveProperty('maxRetries');
      }
    });

    it('should report tools availability', async () => {
      const response = await handleDiagnostic(
        { params: { arguments: {} } },
        mcpContext
      );

      const data = response.data as DiagnosticResponse;

      expect(data.toolsAvailability).toBeDefined();
      expect(data.toolsAvailability).toHaveProperty('documentationTools');
      expect(data.toolsAvailability).toHaveProperty('managementTools');
      expect(data.toolsAvailability).toHaveProperty('totalAvailable');

      // Documentation tools should always be available
      const docTools = data.toolsAvailability.documentationTools;
      expect(docTools.count).toBeGreaterThan(0);
      expect(docTools.enabled).toBe(true);
      expect(docTools.description).toBeDefined();

      // Management tools should be available when API configured
      const mgmtTools = data.toolsAvailability.managementTools;
      expect(mgmtTools).toHaveProperty('count');
      expect(mgmtTools).toHaveProperty('enabled');
      expect(mgmtTools).toHaveProperty('description');

      // In test environment, management tools should be enabled
      expect(mgmtTools.enabled).toBe(true);
      expect(mgmtTools.count).toBeGreaterThan(0);

      // Total should be sum of both
      expect(data.toolsAvailability.totalAvailable).toBe(
        docTools.count + mgmtTools.count
      );
    });

    it('should include troubleshooting information', async () => {
      const response = await handleDiagnostic(
        { params: { arguments: {} } },
        mcpContext
      );

      const data = response.data as DiagnosticResponse;

      // Should have either nextSteps (if API connected) or setupGuide (if not configured)
      const hasGuidance = data.nextSteps || data.setupGuide || data.troubleshooting;
      expect(hasGuidance).toBeDefined();

      if (data.nextSteps) {
        expect(data.nextSteps).toHaveProperty('message');
        expect(data.nextSteps).toHaveProperty('recommended');
        expect(Array.isArray(data.nextSteps.recommended)).toBe(true);
      }

      if (data.setupGuide) {
        expect(data.setupGuide).toHaveProperty('message');
        expect(data.setupGuide).toHaveProperty('whatYouCanDoNow');
        expect(data.setupGuide).toHaveProperty('whatYouCannotDo');
        expect(data.setupGuide).toHaveProperty('howToEnable');
      }

      if (data.troubleshooting) {
        expect(data.troubleshooting).toHaveProperty('issue');
        expect(data.troubleshooting).toHaveProperty('steps');
        expect(Array.isArray(data.troubleshooting.steps)).toBe(true);
      }
    });
  });

  // ======================================================================
  // Environment Detection
  // ======================================================================

  describe('Environment Detection', () => {
    it('should provide mode-specific debugging suggestions', async () => {
      const response = await handleDiagnostic(
        { params: { arguments: {} } },
        mcpContext
      );

      const data = response.data as DiagnosticResponse;

      // Mode-specific debug should always be present
      expect(data).toHaveProperty('modeSpecificDebug');
      expect(data.modeSpecificDebug).toBeDefined();
      expect(data.modeSpecificDebug).toHaveProperty('mode');
      expect(data.modeSpecificDebug).toHaveProperty('troubleshooting');
      expect(data.modeSpecificDebug).toHaveProperty('commonIssues');

      // Verify troubleshooting is an array with content
      expect(Array.isArray(data.modeSpecificDebug.troubleshooting)).toBe(true);
      expect(data.modeSpecificDebug.troubleshooting.length).toBeGreaterThan(0);

      // Verify common issues is an array with content
      expect(Array.isArray(data.modeSpecificDebug.commonIssues)).toBe(true);
      expect(data.modeSpecificDebug.commonIssues.length).toBeGreaterThan(0);

      // Mode should be either 'HTTP Server' or 'Standard I/O (Claude Desktop)'
      expect(['HTTP Server', 'Standard I/O (Claude Desktop)']).toContain(data.modeSpecificDebug.mode);
    });

    it('should include Docker debugging if IS_DOCKER is true', async () => {
      // Save original value
      const originalIsDocker = process.env.IS_DOCKER;

      try {
        // Set IS_DOCKER for this test
        process.env.IS_DOCKER = 'true';

        const response = await handleDiagnostic(
          { params: { arguments: {} } },
          mcpContext
        );

        const data = response.data as DiagnosticResponse;

        // Should have Docker debug section
        expect(data).toHaveProperty('dockerDebug');
        expect(data.dockerDebug).toBeDefined();
        expect(data.dockerDebug?.containerDetected).toBe(true);
        expect(data.dockerDebug?.troubleshooting).toBeDefined();
        expect(Array.isArray(data.dockerDebug?.troubleshooting)).toBe(true);
        expect(data.dockerDebug?.commonIssues).toBeDefined();
      } finally {
        // Restore original value
        if (originalIsDocker) {
          process.env.IS_DOCKER = originalIsDocker;
        } else {
          delete process.env.IS_DOCKER;
        }
      }
    });

    it('should not include Docker debugging if IS_DOCKER is false', async () => {
      // Save original value
      const originalIsDocker = process.env.IS_DOCKER;

      try {
        // Unset IS_DOCKER for this test
        delete process.env.IS_DOCKER;

        const response = await handleDiagnostic(
          { params: { arguments: {} } },
          mcpContext
        );

        const data = response.data as DiagnosticResponse;

        // Should not have Docker debug section
        expect(data.dockerDebug).toBeUndefined();
      } finally {
        // Restore original value
        if (originalIsDocker) {
          process.env.IS_DOCKER = originalIsDocker;
        }
      }
    });
  });

  // ======================================================================
  // Verbose Mode
  // ======================================================================

  describe('Verbose Mode', () => {
    it('should include additional debug info in verbose mode', async () => {
      const response = await handleDiagnostic(
        { params: { arguments: { verbose: true } } },
        mcpContext
      );

      expect(response.success).toBe(true);
      const data = response.data as DiagnosticResponse;

      // Verbose mode should add debug section
      expect(data).toHaveProperty('debug');
      expect(data.debug).toBeDefined();

      // Verify debug information
      expect(data.debug).toBeDefined();
      expect(data.debug).toHaveProperty('processEnv');
      expect(data.debug).toHaveProperty('nodeVersion');
      expect(data.debug).toHaveProperty('platform');
      expect(data.debug).toHaveProperty('workingDirectory');

      // Process env should list relevant environment variables
      expect(Array.isArray(data.debug?.processEnv)).toBe(true);

      // Node version should be a string
      expect(typeof data.debug?.nodeVersion).toBe('string');
      expect(data.debug?.nodeVersion).toMatch(/^v\d+\.\d+\.\d+/);

      // Platform should be a string (linux, darwin, win32, etc.)
      expect(typeof data.debug?.platform).toBe('string');
      expect(data.debug && data.debug.platform.length).toBeGreaterThan(0);

      // Working directory should be a path
      expect(typeof data.debug?.workingDirectory).toBe('string');
      expect(data.debug && data.debug.workingDirectory.length).toBeGreaterThan(0);
    });

    it('should not include debug info when verbose is false', async () => {
      const response = await handleDiagnostic(
        { params: { arguments: { verbose: false } } },
        mcpContext
      );

      expect(response.success).toBe(true);
      const data = response.data as DiagnosticResponse;

      // Debug section should not be present
      expect(data.debug).toBeUndefined();
    });

    it('should not include debug info by default', async () => {
      const response = await handleDiagnostic(
        { params: { arguments: {} } },
        mcpContext
      );

      expect(response.success).toBe(true);
      const data = response.data as DiagnosticResponse;

      // Debug section should not be present when verbose not specified
      expect(data.debug).toBeUndefined();
    });
  });

  // ======================================================================
  // Response Format Verification
  // ======================================================================

  describe('Response Format', () => {
    it('should return complete diagnostic response structure', async () => {
      const response = await handleDiagnostic(
        { params: { arguments: {} } },
        mcpContext
      );

      expect(response.success).toBe(true);
      expect(response.data).toBeDefined();

      const data = response.data as DiagnosticResponse;

      // Verify all required fields (always present)
      const requiredFields = [
        'timestamp',
        'environment',
        'apiConfiguration',
        'toolsAvailability',
        'versionInfo',
        'performance'
      ];

      requiredFields.forEach(field => {
        expect(data).toHaveProperty(field);
        expect(data[field]).toBeDefined();
      });

      // Context-specific fields (at least one should be present)
      const hasContextualGuidance = data.nextSteps || data.setupGuide || data.troubleshooting;
      expect(hasContextualGuidance).toBeDefined();

      // Verify data types
      expect(typeof data.timestamp).toBe('string');
      expect(typeof data.environment).toBe('object');
      expect(typeof data.apiConfiguration).toBe('object');
      expect(typeof data.toolsAvailability).toBe('object');
      expect(typeof data.versionInfo).toBe('object');
      expect(typeof data.performance).toBe('object');
    });
  });
});
