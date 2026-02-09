import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { logger } from '../../utils/logger';
import type { UIAppConfig, UIAppEntry } from './types';
import { UI_APP_CONFIGS } from './app-configs';

export class UIAppRegistry {
  private static entries: Map<string, UIAppEntry> = new Map();
  private static toolIndex: Map<string, UIAppEntry> = new Map();
  private static loaded = false;

  static load(): void {
    // Resolve dist directory relative to package root
    // In production: package-root/ui-apps/dist/
    // __dirname will be src/mcp/ui or dist/mcp/ui
    const packageRoot = path.resolve(__dirname, '..', '..', '..');
    const distDir = path.join(packageRoot, 'ui-apps', 'dist');

    this.entries.clear();
    this.toolIndex.clear();

    for (const config of UI_APP_CONFIGS) {
      let html: string | null = null;
      const htmlPath = path.join(distDir, config.id, 'index.html');

      if (existsSync(htmlPath)) {
        try {
          html = readFileSync(htmlPath, 'utf-8');
          logger.info(`Loaded UI app: ${config.id}`);
        } catch (err) {
          logger.warn(`Failed to read UI app HTML: ${config.id}`, err);
        }
      }

      const entry: UIAppEntry = { config, html };
      this.entries.set(config.id, entry);

      // Build tool -> entry index
      for (const pattern of config.toolPatterns) {
        this.toolIndex.set(pattern, entry);
      }
    }

    this.loaded = true;
    logger.info(`UI App Registry loaded: ${this.entries.size} apps, ${this.toolIndex.size} tool mappings`);
  }

  static getAppForTool(toolName: string): UIAppEntry | null {
    if (!this.loaded) return null;
    return this.toolIndex.get(toolName) ?? null;
  }

  static getAppById(id: string): UIAppEntry | null {
    if (!this.loaded) return null;
    return this.entries.get(id) ?? null;
  }

  static getAllApps(): UIAppEntry[] {
    if (!this.loaded) return [];
    return Array.from(this.entries.values());
  }

  /**
   * Enrich tool definitions with _meta.ui.resourceUri for tools that have
   * a matching UI app. Per MCP ext-apps spec, this goes on the tool
   * definition (tools/list), not the tool call response.
   *
   * Sets both nested (_meta.ui.resourceUri) and flat (_meta["ui/resourceUri"])
   * keys for compatibility with hosts that read either format.
   */
  static injectToolMeta(tools: Array<{ name: string; [key: string]: any }>): void {
    if (!this.loaded) return;
    for (const tool of tools) {
      const entry = this.toolIndex.get(tool.name);
      if (entry && entry.html) {
        tool._meta = {
          ui: { resourceUri: entry.config.uri },
          'ui/resourceUri': entry.config.uri,
        };
      }
    }
  }

  /** Reset registry state. Intended for testing only. */
  static reset(): void {
    this.entries.clear();
    this.toolIndex.clear();
    this.loaded = false;
  }
}
