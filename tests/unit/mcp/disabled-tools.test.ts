import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { N8NDocumentationMCPServer } from '../../../src/mcp/server';
import { n8nDocumentationToolsFinal } from '../../../src/mcp/tools';
import { n8nManagementTools } from '../../../src/mcp/tools-n8n-manager';

// Mock the database and dependencies
vi.mock('../../../src/database/database-adapter');
vi.mock('../../../src/database/node-repository');
vi.mock('../../../src/templates/template-service');
vi.mock('../../../src/utils/logger');

/**
 * Test wrapper class that exposes private methods for unit testing.
 * This pattern is preferred over modifying production code visibility
 * or using reflection-based testing utilities.
 */
class TestableN8NMCPServer extends N8NDocumentationMCPServer {
  /**
   * Expose getDisabledTools() for testing environment variable parsing.
   * @returns Set of disabled tool names from DISABLED_TOOLS env var
   */
  public testGetDisabledTools(): Set<string> {
    return (this as any).getDisabledTools();
  }

  /**
   * Expose executeTool() for testing the defense-in-depth guard.
   * @param name - Tool name to execute
   * @param args - Tool arguments
   * @returns Tool execution result
   */
  public async testExecuteTool(name: string, args: any): Promise<any> {
    return (this as any).executeTool(name, args);
  }
}

describe('Disabled Tools Feature (Issue #410)', () => {
  let server: TestableN8NMCPServer;

  beforeEach(() => {
    // Set environment variable to use in-memory database
    process.env.NODE_DB_PATH = ':memory:';
  });

  afterEach(() => {
    delete process.env.NODE_DB_PATH;
    delete process.env.DISABLED_TOOLS;
    delete process.env.DISABLE_ENTERPRISE_TOOLS;
  });

  describe('DISABLE_ENTERPRISE_TOOLS', () => {
    it('leaves license-gated tools enabled by default', () => {
      server = new TestableN8NMCPServer();
      expect(server.testGetDisabledTools().has('n8n_manage_variables')).toBe(false);
    });

    it.each(['true', 'TRUE', '1', 'yes'])('disables license-gated tools when set to %s', (value) => {
      process.env.DISABLE_ENTERPRISE_TOOLS = value;
      server = new TestableN8NMCPServer();
      expect(server.testGetDisabledTools().has('n8n_manage_variables')).toBe(true);
    });

    it('combines with DISABLED_TOOLS', () => {
      process.env.DISABLE_ENTERPRISE_TOOLS = 'true';
      process.env.DISABLED_TOOLS = 'n8n_delete_workflow';
      server = new TestableN8NMCPServer();
      const disabled = server.testGetDisabledTools();
      expect(disabled.has('n8n_manage_variables')).toBe(true);
      expect(disabled.has('n8n_delete_workflow')).toBe(true);
    });

    it('ignores other values', () => {
      process.env.DISABLE_ENTERPRISE_TOOLS = 'false';
      server = new TestableN8NMCPServer();
      expect(server.testGetDisabledTools().has('n8n_manage_variables')).toBe(false);
    });

    it('names DISABLE_ENTERPRISE_TOOLS in the refusal', async () => {
      process.env.DISABLE_ENTERPRISE_TOOLS = 'true';
      server = new TestableN8NMCPServer();
      await expect(server.testExecuteTool('n8n_manage_variables', { action: 'list' }))
        .rejects.toThrow("Tool 'n8n_manage_variables' is disabled via DISABLE_ENTERPRISE_TOOLS environment variable");
    });
  });

  describe('getDisabledTools() - Environment Variable Parsing', () => {
    it('should return empty set when DISABLED_TOOLS is not set', () => {
      server = new TestableN8NMCPServer();
      const disabledTools = server.testGetDisabledTools();

      expect(disabledTools.size).toBe(0);
    });

    it('should return empty set when DISABLED_TOOLS is empty string', () => {
      process.env.DISABLED_TOOLS = '';
      server = new TestableN8NMCPServer();
      const disabledTools = server.testGetDisabledTools();

      expect(disabledTools.size).toBe(0);
    });

    it('should parse single disabled tool correctly', () => {
      process.env.DISABLED_TOOLS = 'n8n_diagnostic';
      server = new TestableN8NMCPServer();
      const disabledTools = server.testGetDisabledTools();

      expect(disabledTools.size).toBe(1);
      expect(disabledTools.has('n8n_diagnostic')).toBe(true);
    });

    it('should parse multiple disabled tools correctly', () => {
      process.env.DISABLED_TOOLS = 'n8n_diagnostic,n8n_health_check,search_nodes';
      server = new TestableN8NMCPServer();
      const disabledTools = server.testGetDisabledTools();

      expect(disabledTools.size).toBe(3);
      expect(disabledTools.has('n8n_diagnostic')).toBe(true);
      expect(disabledTools.has('n8n_health_check')).toBe(true);
      expect(disabledTools.has('search_nodes')).toBe(true);
    });

    it('should trim whitespace from tool names', () => {
      process.env.DISABLED_TOOLS = '  n8n_diagnostic  ,  n8n_health_check  ';
      server = new TestableN8NMCPServer();
      const disabledTools = server.testGetDisabledTools();

      expect(disabledTools.size).toBe(2);
      expect(disabledTools.has('n8n_diagnostic')).toBe(true);
      expect(disabledTools.has('n8n_health_check')).toBe(true);
    });

    it('should filter out empty entries from comma-separated list', () => {
      process.env.DISABLED_TOOLS = 'n8n_diagnostic,,n8n_health_check,,,search_nodes';
      server = new TestableN8NMCPServer();
      const disabledTools = server.testGetDisabledTools();

      expect(disabledTools.size).toBe(3);
      expect(disabledTools.has('n8n_diagnostic')).toBe(true);
      expect(disabledTools.has('n8n_health_check')).toBe(true);
      expect(disabledTools.has('search_nodes')).toBe(true);
    });

    it('should handle single comma correctly', () => {
      process.env.DISABLED_TOOLS = ',';
      server = new TestableN8NMCPServer();
      const disabledTools = server.testGetDisabledTools();

      expect(disabledTools.size).toBe(0);
    });

    it('should handle multiple commas without values', () => {
      process.env.DISABLED_TOOLS = ',,,';
      server = new TestableN8NMCPServer();
      const disabledTools = server.testGetDisabledTools();

      expect(disabledTools.size).toBe(0);
    });
  });

  describe('executeTool() - Disabled Tool Guard', () => {
    it('should throw error when calling disabled tool', async () => {
      process.env.DISABLED_TOOLS = 'tools_documentation';
      server = new TestableN8NMCPServer();

      await expect(async () => {
        await server.testExecuteTool('tools_documentation', {});
      }).rejects.toThrow("Tool 'tools_documentation' is disabled via DISABLED_TOOLS environment variable");
    });

    it('should allow calling enabled tool when others are disabled', async () => {
      process.env.DISABLED_TOOLS = 'n8n_diagnostic,n8n_health_check';
      server = new TestableN8NMCPServer();

      // This should not throw - tools_documentation is not disabled
      // The tool execution may fail for other reasons (like missing data),
      // but it should NOT fail due to being disabled
      try {
        await server.testExecuteTool('tools_documentation', {});
      } catch (error: any) {
        // Ensure the error is NOT about the tool being disabled
        expect(error.message).not.toContain('disabled via DISABLED_TOOLS');
      }
    });

    it('should throw error for all disabled tools in list', async () => {
      process.env.DISABLED_TOOLS = 'tool1,tool2,tool3';
      server = new TestableN8NMCPServer();

      for (const toolName of ['tool1', 'tool2', 'tool3']) {
        await expect(async () => {
          await server.testExecuteTool(toolName, {});
        }).rejects.toThrow(`Tool '${toolName}' is disabled via DISABLED_TOOLS environment variable`);
      }
    });
  });

  describe('Tool Filtering - Documentation Tools', () => {
    it('should filter disabled documentation tools from list', () => {
      // Find a documentation tool to disable
      const docTool = n8nDocumentationToolsFinal[0];
      if (!docTool) {
        throw new Error('No documentation tools available for testing');
      }

      process.env.DISABLED_TOOLS = docTool.name;
      server = new TestableN8NMCPServer();
      const disabledTools = server.testGetDisabledTools();

      expect(disabledTools.has(docTool.name)).toBe(true);
      expect(disabledTools.size).toBe(1);
    });

    it('should filter multiple disabled documentation tools', () => {
      const tool1 = n8nDocumentationToolsFinal[0];
      const tool2 = n8nDocumentationToolsFinal[1];

      if (!tool1 || !tool2) {
        throw new Error('Not enough documentation tools available for testing');
      }

      process.env.DISABLED_TOOLS = `${tool1.name},${tool2.name}`;
      server = new TestableN8NMCPServer();
      const disabledTools = server.testGetDisabledTools();

      expect(disabledTools.has(tool1.name)).toBe(true);
      expect(disabledTools.has(tool2.name)).toBe(true);
      expect(disabledTools.size).toBe(2);
    });
  });

  describe('Tool Filtering - Management Tools', () => {
    it('should filter disabled management tools from list', () => {
      // Find a management tool to disable
      const mgmtTool = n8nManagementTools[0];
      if (!mgmtTool) {
        throw new Error('No management tools available for testing');
      }

      process.env.DISABLED_TOOLS = mgmtTool.name;
      server = new TestableN8NMCPServer();
      const disabledTools = server.testGetDisabledTools();

      expect(disabledTools.has(mgmtTool.name)).toBe(true);
      expect(disabledTools.size).toBe(1);
    });

    it('should filter multiple disabled management tools', () => {
      const tool1 = n8nManagementTools[0];
      const tool2 = n8nManagementTools[1];

      if (!tool1 || !tool2) {
        throw new Error('Not enough management tools available for testing');
      }

      process.env.DISABLED_TOOLS = `${tool1.name},${tool2.name}`;
      server = new TestableN8NMCPServer();
      const disabledTools = server.testGetDisabledTools();

      expect(disabledTools.has(tool1.name)).toBe(true);
      expect(disabledTools.has(tool2.name)).toBe(true);
      expect(disabledTools.size).toBe(2);
    });
  });

  describe('Tool Filtering - Mixed Tools', () => {
    it('should filter disabled tools from both documentation and management lists', () => {
      const docTool = n8nDocumentationToolsFinal[0];
      const mgmtTool = n8nManagementTools[0];

      if (!docTool || !mgmtTool) {
        throw new Error('Tools not available for testing');
      }

      process.env.DISABLED_TOOLS = `${docTool.name},${mgmtTool.name}`;
      server = new TestableN8NMCPServer();
      const disabledTools = server.testGetDisabledTools();

      expect(disabledTools.has(docTool.name)).toBe(true);
      expect(disabledTools.has(mgmtTool.name)).toBe(true);
      expect(disabledTools.size).toBe(2);
    });
  });

  describe('Invalid Tool Names', () => {
    it('should gracefully handle non-existent tool names', () => {
      process.env.DISABLED_TOOLS = 'non_existent_tool,another_fake_tool';
      server = new TestableN8NMCPServer();
      const disabledTools = server.testGetDisabledTools();

      // Should still parse and store them, even if they don't exist
      expect(disabledTools.size).toBe(2);
      expect(disabledTools.has('non_existent_tool')).toBe(true);
      expect(disabledTools.has('another_fake_tool')).toBe(true);
    });

    it('should handle special characters in tool names', () => {
      process.env.DISABLED_TOOLS = 'tool-with-dashes,tool_with_underscores,tool.with.dots';
      server = new TestableN8NMCPServer();
      const disabledTools = server.testGetDisabledTools();

      expect(disabledTools.size).toBe(3);
      expect(disabledTools.has('tool-with-dashes')).toBe(true);
      expect(disabledTools.has('tool_with_underscores')).toBe(true);
      expect(disabledTools.has('tool.with.dots')).toBe(true);
    });
  });

  describe('Real-World Use Cases', () => {
    it('should support multi-tenant deployment use case - disable diagnostic tools', () => {
      process.env.DISABLED_TOOLS = 'n8n_diagnostic,n8n_health_check';
      server = new TestableN8NMCPServer();
      const disabledTools = server.testGetDisabledTools();

      expect(disabledTools.has('n8n_diagnostic')).toBe(true);
      expect(disabledTools.has('n8n_health_check')).toBe(true);
      expect(disabledTools.size).toBe(2);
    });

    it('should support security hardening use case - disable management tools', () => {
      // Disable potentially dangerous management tools
      const dangerousTools = [
        'n8n_delete_workflow',
        'n8n_update_full_workflow'
      ];

      process.env.DISABLED_TOOLS = dangerousTools.join(',');
      server = new TestableN8NMCPServer();
      const disabledTools = server.testGetDisabledTools();

      dangerousTools.forEach(tool => {
        expect(disabledTools.has(tool)).toBe(true);
      });
      expect(disabledTools.size).toBe(dangerousTools.length);
    });

    it('should support feature flag use case - disable experimental tools', () => {
      // Example: Disable experimental or beta features
      process.env.DISABLED_TOOLS = 'experimental_tool_1,beta_feature';
      server = new TestableN8NMCPServer();
      const disabledTools = server.testGetDisabledTools();

      expect(disabledTools.has('experimental_tool_1')).toBe(true);
      expect(disabledTools.has('beta_feature')).toBe(true);
      expect(disabledTools.size).toBe(2);
    });
  });
});
