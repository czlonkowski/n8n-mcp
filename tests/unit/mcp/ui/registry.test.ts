import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UIAppRegistry } from '@/mcp/ui/registry';
import { UI_APP_CONFIGS } from '@/mcp/ui/app-configs';

vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

import { existsSync, readFileSync } from 'fs';

const mockExistsSync = vi.mocked(existsSync);
const mockReadFileSync = vi.mocked(readFileSync);

describe('UIAppRegistry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    UIAppRegistry.reset();
  });

  describe('load()', () => {
    it('should load HTML files when dist directory exists', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('<html>test</html>');

      UIAppRegistry.load();

      const apps = UIAppRegistry.getAllApps();
      expect(apps.length).toBe(UI_APP_CONFIGS.length);
      for (const app of apps) {
        expect(app.html).toBe('<html>test</html>');
      }
    });

    it('should handle missing dist directory gracefully', () => {
      mockExistsSync.mockReturnValue(false);

      UIAppRegistry.load();

      const apps = UIAppRegistry.getAllApps();
      expect(apps.length).toBe(UI_APP_CONFIGS.length);
      for (const app of apps) {
        expect(app.html).toBeNull();
      }
    });

    it('should handle read errors gracefully', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockImplementation(() => {
        throw new Error('Permission denied');
      });

      UIAppRegistry.load();

      const apps = UIAppRegistry.getAllApps();
      expect(apps.length).toBe(UI_APP_CONFIGS.length);
      for (const app of apps) {
        expect(app.html).toBeNull();
      }
    });

    it('should set loaded flag so getters work', () => {
      expect(UIAppRegistry.getAllApps()).toEqual([]);
      expect(UIAppRegistry.getAppById('operation-result')).toBeNull();
      expect(UIAppRegistry.getAppForTool('n8n_create_workflow')).toBeNull();

      mockExistsSync.mockReturnValue(false);
      UIAppRegistry.load();

      expect(UIAppRegistry.getAllApps().length).toBeGreaterThan(0);
    });

    it('should replace previous entries when called twice', () => {
      // First load: files exist
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('<html>first</html>');
      UIAppRegistry.load();

      expect(UIAppRegistry.getAppById('operation-result')!.html).toBe('<html>first</html>');

      // Second load: files missing
      mockExistsSync.mockReturnValue(false);
      UIAppRegistry.load();

      expect(UIAppRegistry.getAppById('operation-result')!.html).toBeNull();
    });

    it('should handle empty HTML file content', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('');

      UIAppRegistry.load();

      const app = UIAppRegistry.getAppById('operation-result');
      expect(app).not.toBeNull();
      // Empty string is still a string, not null
      expect(app!.html).toBe('');
    });

    it('should build the correct number of tool index entries', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('<html>app</html>');
      UIAppRegistry.load();

      // Every tool pattern from every config should be resolvable
      for (const config of UI_APP_CONFIGS) {
        for (const pattern of config.toolPatterns) {
          const entry = UIAppRegistry.getAppForTool(pattern);
          expect(entry).not.toBeNull();
          expect(entry!.config.id).toBe(config.id);
        }
      }
    });

    it('should call existsSync for each config', () => {
      mockExistsSync.mockReturnValue(false);
      UIAppRegistry.load();

      expect(mockExistsSync).toHaveBeenCalledTimes(UI_APP_CONFIGS.length);
    });

    it('should only call readFileSync when existsSync returns true', () => {
      mockExistsSync.mockReturnValue(false);
      UIAppRegistry.load();

      expect(mockReadFileSync).not.toHaveBeenCalled();
    });
  });

  describe('getAppForTool()', () => {
    it('should return null before load() is called', () => {
      const entry = UIAppRegistry.getAppForTool('n8n_create_workflow');
      expect(entry).toBeNull();
    });

    describe('after loading', () => {
      beforeEach(() => {
        mockExistsSync.mockReturnValue(true);
        mockReadFileSync.mockReturnValue('<html>loaded</html>');
        UIAppRegistry.load();
      });

      it('should return correct entry for known tool patterns', () => {
        const entry = UIAppRegistry.getAppForTool('n8n_create_workflow');
        expect(entry).not.toBeNull();
        expect(entry!.config.id).toBe('operation-result');
      });

      it('should return correct entry for validation tools', () => {
        const entry = UIAppRegistry.getAppForTool('validate_node');
        expect(entry).not.toBeNull();
        expect(entry!.config.id).toBe('validation-summary');
      });

      it('should return null for unknown tools', () => {
        const entry = UIAppRegistry.getAppForTool('unknown_tool');
        expect(entry).toBeNull();
      });

      it('should return null for empty string tool name', () => {
        const entry = UIAppRegistry.getAppForTool('');
        expect(entry).toBeNull();
      });

      // Regression: verify specific tools ARE mapped so config changes break the test
      it('should map n8n_create_workflow to operation-result', () => {
        expect(UIAppRegistry.getAppForTool('n8n_create_workflow')!.config.id).toBe('operation-result');
      });

      it('should map n8n_update_full_workflow to operation-result', () => {
        expect(UIAppRegistry.getAppForTool('n8n_update_full_workflow')!.config.id).toBe('operation-result');
      });

      it('should map n8n_update_partial_workflow to operation-result', () => {
        expect(UIAppRegistry.getAppForTool('n8n_update_partial_workflow')!.config.id).toBe('operation-result');
      });

      it('should map n8n_delete_workflow to operation-result', () => {
        expect(UIAppRegistry.getAppForTool('n8n_delete_workflow')!.config.id).toBe('operation-result');
      });

      it('should map n8n_test_workflow to operation-result', () => {
        expect(UIAppRegistry.getAppForTool('n8n_test_workflow')!.config.id).toBe('operation-result');
      });

      it('should map n8n_autofix_workflow to operation-result', () => {
        expect(UIAppRegistry.getAppForTool('n8n_autofix_workflow')!.config.id).toBe('operation-result');
      });

      it('should map n8n_deploy_template to operation-result', () => {
        expect(UIAppRegistry.getAppForTool('n8n_deploy_template')!.config.id).toBe('operation-result');
      });

      it('should map validate_node to validation-summary', () => {
        expect(UIAppRegistry.getAppForTool('validate_node')!.config.id).toBe('validation-summary');
      });

      it('should map validate_workflow to validation-summary', () => {
        expect(UIAppRegistry.getAppForTool('validate_workflow')!.config.id).toBe('validation-summary');
      });

      it('should map n8n_validate_workflow to validation-summary', () => {
        expect(UIAppRegistry.getAppForTool('n8n_validate_workflow')!.config.id).toBe('validation-summary');
      });
    });
  });

  describe('getAppById()', () => {
    it('should return null before load() is called', () => {
      const entry = UIAppRegistry.getAppById('operation-result');
      expect(entry).toBeNull();
    });

    describe('after loading', () => {
      beforeEach(() => {
        mockExistsSync.mockReturnValue(true);
        mockReadFileSync.mockReturnValue('<html>app</html>');
        UIAppRegistry.load();
      });

      it('should return correct entry for operation-result', () => {
        const entry = UIAppRegistry.getAppById('operation-result');
        expect(entry).not.toBeNull();
        expect(entry!.config.displayName).toBe('Operation Result');
        expect(entry!.html).toBe('<html>app</html>');
      });

      it('should return correct entry for validation-summary', () => {
        const entry = UIAppRegistry.getAppById('validation-summary');
        expect(entry).not.toBeNull();
        expect(entry!.config.displayName).toBe('Validation Summary');
      });

      it('should return null for unknown id', () => {
        const entry = UIAppRegistry.getAppById('nonexistent');
        expect(entry).toBeNull();
      });

      it('should return null for empty string id', () => {
        const entry = UIAppRegistry.getAppById('');
        expect(entry).toBeNull();
      });
    });
  });

  describe('getAllApps()', () => {
    it('should return empty array before load() is called', () => {
      const apps = UIAppRegistry.getAllApps();
      expect(apps).toEqual([]);
    });

    it('should return all entries after load', () => {
      mockExistsSync.mockReturnValue(false);
      UIAppRegistry.load();

      const apps = UIAppRegistry.getAllApps();
      expect(apps.length).toBe(UI_APP_CONFIGS.length);
      expect(apps.map(a => a.config.id)).toContain('operation-result');
      expect(apps.map(a => a.config.id)).toContain('validation-summary');
    });

    it('should include entries with null html when dist is missing', () => {
      mockExistsSync.mockReturnValue(false);
      UIAppRegistry.load();

      const apps = UIAppRegistry.getAllApps();
      for (const app of apps) {
        expect(app.html).toBeNull();
      }
      // Entries are still present even with null html
      expect(apps.length).toBe(UI_APP_CONFIGS.length);
    });

    it('should return entries with full config objects', () => {
      mockExistsSync.mockReturnValue(false);
      UIAppRegistry.load();

      for (const app of UIAppRegistry.getAllApps()) {
        expect(app.config).toBeDefined();
        expect(app.config.id).toBeDefined();
        expect(app.config.displayName).toBeDefined();
        expect(app.config.uri).toBeDefined();
        expect(app.config.mimeType).toBeDefined();
        expect(app.config.toolPatterns).toBeDefined();
        expect(app.config.description).toBeDefined();
      }
    });
  });

  describe('injectToolMeta()', () => {
    it('should not modify tools before load() is called', () => {
      const tools: any[] = [
        { name: 'n8n_create_workflow', description: 'Create', inputSchema: { type: 'object', properties: {} } },
      ];
      UIAppRegistry.injectToolMeta(tools);
      expect(tools[0]._meta).toBeUndefined();
    });

    describe('after loading with HTML', () => {
      beforeEach(() => {
        mockExistsSync.mockReturnValue(true);
        mockReadFileSync.mockReturnValue('<html>loaded</html>');
        UIAppRegistry.load();
      });

      it('should set _meta.ui.resourceUri on matching operation tools', () => {
        const tools: any[] = [
          { name: 'n8n_create_workflow', description: 'Create', inputSchema: { type: 'object', properties: {} } },
        ];
        UIAppRegistry.injectToolMeta(tools);
        expect(tools[0]._meta).toEqual({ ui: { resourceUri: 'ui://n8n-mcp/operation-result' } });
      });

      it('should set _meta.ui.resourceUri on matching validation tools', () => {
        const tools: any[] = [
          { name: 'validate_node', description: 'Validate', inputSchema: { type: 'object', properties: {} } },
        ];
        UIAppRegistry.injectToolMeta(tools);
        expect(tools[0]._meta).toEqual({ ui: { resourceUri: 'ui://n8n-mcp/validation-summary' } });
      });

      it('should not set _meta on tools without a matching UI app', () => {
        const tools: any[] = [
          { name: 'search_nodes', description: 'Search', inputSchema: { type: 'object', properties: {} } },
        ];
        UIAppRegistry.injectToolMeta(tools);
        expect(tools[0]._meta).toBeUndefined();
      });

      it('should handle a mix of matching and non-matching tools', () => {
        const tools: any[] = [
          { name: 'n8n_delete_workflow', description: 'Delete', inputSchema: { type: 'object', properties: {} } },
          { name: 'get_node_essentials', description: 'Essentials', inputSchema: { type: 'object', properties: {} } },
          { name: 'validate_workflow', description: 'Validate', inputSchema: { type: 'object', properties: {} } },
        ];
        UIAppRegistry.injectToolMeta(tools);
        expect(tools[0]._meta?.ui?.resourceUri).toBe('ui://n8n-mcp/operation-result');
        expect(tools[1]._meta).toBeUndefined();
        expect(tools[2]._meta?.ui?.resourceUri).toBe('ui://n8n-mcp/validation-summary');
      });
    });

    describe('after loading without HTML', () => {
      beforeEach(() => {
        mockExistsSync.mockReturnValue(false);
        UIAppRegistry.load();
      });

      it('should not set _meta when HTML is not available', () => {
        const tools: any[] = [
          { name: 'n8n_create_workflow', description: 'Create', inputSchema: { type: 'object', properties: {} } },
        ];
        UIAppRegistry.injectToolMeta(tools);
        expect(tools[0]._meta).toBeUndefined();
      });
    });
  });

  describe('reset()', () => {
    it('should clear loaded state so getters return defaults', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('<html>x</html>');
      UIAppRegistry.load();

      expect(UIAppRegistry.getAllApps().length).toBeGreaterThan(0);

      UIAppRegistry.reset();

      expect(UIAppRegistry.getAllApps()).toEqual([]);
      expect(UIAppRegistry.getAppById('operation-result')).toBeNull();
      expect(UIAppRegistry.getAppForTool('n8n_create_workflow')).toBeNull();
    });
  });
});
