import { describe, it, expect } from 'vitest';
import { UI_APP_CONFIGS } from '@/mcp/ui/app-configs';

describe('UI_APP_CONFIGS', () => {
  it('should have all required fields for every config', () => {
    for (const config of UI_APP_CONFIGS) {
      expect(config.id).toBeDefined();
      expect(typeof config.id).toBe('string');
      expect(config.id.length).toBeGreaterThan(0);

      expect(config.displayName).toBeDefined();
      expect(typeof config.displayName).toBe('string');
      expect(config.displayName.length).toBeGreaterThan(0);

      expect(config.description).toBeDefined();
      expect(typeof config.description).toBe('string');
      expect(config.description.length).toBeGreaterThan(0);

      expect(config.uri).toBeDefined();
      expect(typeof config.uri).toBe('string');

      expect(config.mimeType).toBeDefined();
      expect(typeof config.mimeType).toBe('string');

      expect(config.toolPatterns).toBeDefined();
      expect(Array.isArray(config.toolPatterns)).toBe(true);
    }
  });

  it('should have URIs following ui://n8n-mcp/{id} pattern', () => {
    for (const config of UI_APP_CONFIGS) {
      expect(config.uri).toBe(`ui://n8n-mcp/${config.id}`);
    }
  });

  it('should have unique IDs', () => {
    const ids = UI_APP_CONFIGS.map(c => c.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it('should have non-empty toolPatterns arrays', () => {
    for (const config of UI_APP_CONFIGS) {
      expect(config.toolPatterns.length).toBeGreaterThan(0);
      for (const pattern of config.toolPatterns) {
        expect(typeof pattern).toBe('string');
        expect(pattern.length).toBeGreaterThan(0);
      }
    }
  });

  it('should not have duplicate tool patterns across configs', () => {
    const allPatterns: string[] = [];
    for (const config of UI_APP_CONFIGS) {
      allPatterns.push(...config.toolPatterns);
    }
    const uniquePatterns = new Set(allPatterns);
    expect(uniquePatterns.size).toBe(allPatterns.length);
  });

  it('should not have duplicate tool patterns within a single config', () => {
    for (const config of UI_APP_CONFIGS) {
      const unique = new Set(config.toolPatterns);
      expect(unique.size).toBe(config.toolPatterns.length);
    }
  });

  it('should have consistent mimeType of text/html', () => {
    for (const config of UI_APP_CONFIGS) {
      expect(config.mimeType).toBe('text/html');
    }
  });

  it('should have URIs that start with the ui://n8n-mcp/ scheme', () => {
    for (const config of UI_APP_CONFIGS) {
      expect(config.uri).toMatch(/^ui:\/\/n8n-mcp\//);
    }
  });

  // Regression: verify expected configs are present
  it('should contain the operation-result config', () => {
    const config = UI_APP_CONFIGS.find(c => c.id === 'operation-result');
    expect(config).toBeDefined();
    expect(config!.displayName).toBe('Operation Result');
    expect(config!.toolPatterns).toContain('n8n_create_workflow');
    expect(config!.toolPatterns).toContain('n8n_update_full_workflow');
    expect(config!.toolPatterns).toContain('n8n_delete_workflow');
    expect(config!.toolPatterns).toContain('n8n_test_workflow');
    expect(config!.toolPatterns).toContain('n8n_deploy_template');
  });

  it('should contain the validation-summary config', () => {
    const config = UI_APP_CONFIGS.find(c => c.id === 'validation-summary');
    expect(config).toBeDefined();
    expect(config!.displayName).toBe('Validation Summary');
    expect(config!.toolPatterns).toContain('validate_node');
    expect(config!.toolPatterns).toContain('validate_workflow');
    expect(config!.toolPatterns).toContain('n8n_validate_workflow');
  });

  it('should have exactly 2 configs', () => {
    expect(UI_APP_CONFIGS.length).toBe(2);
  });

  it('should have IDs that are valid URI path segments (no spaces or special chars)', () => {
    for (const config of UI_APP_CONFIGS) {
      expect(config.id).toMatch(/^[a-z0-9-]+$/);
    }
  });
});
