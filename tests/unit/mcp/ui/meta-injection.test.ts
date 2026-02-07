import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UIAppRegistry } from '@/mcp/ui/registry';

vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

import { existsSync, readFileSync } from 'fs';

const mockExistsSync = vi.mocked(existsSync);
const mockReadFileSync = vi.mocked(readFileSync);

describe('UI Meta Injection on Tool Definitions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    UIAppRegistry.reset();
  });

  describe('when HTML is loaded', () => {
    beforeEach(() => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('<html>ui content</html>');
      UIAppRegistry.load();
    });

    it('should add _meta.ui.resourceUri to matching tool definitions', () => {
      const tools: any[] = [
        { name: 'n8n_create_workflow', description: 'Create workflow', inputSchema: { type: 'object', properties: {} } },
      ];

      UIAppRegistry.injectToolMeta(tools);

      expect(tools[0]._meta).toBeDefined();
      expect(tools[0]._meta.ui.resourceUri).toBe('ui://n8n-mcp/operation-result');
    });

    it('should add _meta.ui.resourceUri to validation tool definitions', () => {
      const tools: any[] = [
        { name: 'validate_workflow', description: 'Validate', inputSchema: { type: 'object', properties: {} } },
      ];

      UIAppRegistry.injectToolMeta(tools);

      expect(tools[0]._meta).toBeDefined();
      expect(tools[0]._meta.ui.resourceUri).toBe('ui://n8n-mcp/validation-summary');
    });

    it('should NOT add _meta to non-matching tool definitions', () => {
      const tools: any[] = [
        { name: 'get_node_info', description: 'Get info', inputSchema: { type: 'object', properties: {} } },
      ];

      UIAppRegistry.injectToolMeta(tools);

      expect(tools[0]._meta).toBeUndefined();
    });

    it('should inject _meta on matching tools and skip non-matching in a mixed list', () => {
      const tools: any[] = [
        { name: 'n8n_create_workflow', description: 'Create', inputSchema: { type: 'object', properties: {} } },
        { name: 'get_node_info', description: 'Info', inputSchema: { type: 'object', properties: {} } },
        { name: 'validate_node', description: 'Validate', inputSchema: { type: 'object', properties: {} } },
      ];

      UIAppRegistry.injectToolMeta(tools);

      expect(tools[0]._meta).toBeDefined();
      expect(tools[0]._meta.ui.resourceUri).toBe('ui://n8n-mcp/operation-result');
      expect(tools[1]._meta).toBeUndefined();
      expect(tools[2]._meta).toBeDefined();
      expect(tools[2]._meta.ui.resourceUri).toBe('ui://n8n-mcp/validation-summary');
    });

    it('should produce _meta with exact shape { ui: { resourceUri: string } }', () => {
      const tools: any[] = [
        { name: 'n8n_create_workflow', description: 'Create', inputSchema: { type: 'object', properties: {} } },
      ];

      UIAppRegistry.injectToolMeta(tools);

      expect(tools[0]._meta).toEqual({
        ui: {
          resourceUri: 'ui://n8n-mcp/operation-result',
        },
      });
      expect(Object.keys(tools[0]._meta)).toEqual(['ui']);
      expect(Object.keys(tools[0]._meta.ui)).toEqual(['resourceUri']);
      expect(typeof tools[0]._meta.ui.resourceUri).toBe('string');
    });
  });

  describe('when HTML is not loaded', () => {
    beforeEach(() => {
      mockExistsSync.mockReturnValue(false);
      UIAppRegistry.load();
    });

    it('should NOT add _meta even for matching tools', () => {
      const tools: any[] = [
        { name: 'n8n_create_workflow', description: 'Create', inputSchema: { type: 'object', properties: {} } },
      ];

      UIAppRegistry.injectToolMeta(tools);

      expect(tools[0]._meta).toBeUndefined();
    });

    it('should NOT add _meta for validation tools without HTML', () => {
      const tools: any[] = [
        { name: 'validate_node', description: 'Validate', inputSchema: { type: 'object', properties: {} } },
      ];

      UIAppRegistry.injectToolMeta(tools);

      expect(tools[0]._meta).toBeUndefined();
    });
  });

  describe('when registry has not been loaded at all', () => {
    it('should NOT add _meta because registry is not loaded', () => {
      const tools: any[] = [
        { name: 'n8n_create_workflow', description: 'Create', inputSchema: { type: 'object', properties: {} } },
      ];

      UIAppRegistry.injectToolMeta(tools);

      expect(tools[0]._meta).toBeUndefined();
    });
  });

  describe('empty tool list', () => {
    beforeEach(() => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('<html>ui</html>');
      UIAppRegistry.load();
    });

    it('should handle an empty tools array without error', () => {
      const tools: any[] = [];
      UIAppRegistry.injectToolMeta(tools);
      expect(tools.length).toBe(0);
    });
  });
});
