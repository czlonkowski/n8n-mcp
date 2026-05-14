"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.UIAppRegistry = void 0;
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
const logger_1 = require("../../utils/logger");
const app_configs_1 = require("./app-configs");
class UIAppRegistry {
    static load() {
        const packageRoot = path_1.default.resolve(__dirname, '..', '..', '..');
        const distDir = path_1.default.join(packageRoot, 'ui-apps', 'dist');
        this.entries.clear();
        this.toolIndex.clear();
        for (const config of app_configs_1.UI_APP_CONFIGS) {
            let html = null;
            const htmlPath = path_1.default.join(distDir, config.id, 'index.html');
            if ((0, fs_1.existsSync)(htmlPath)) {
                try {
                    html = (0, fs_1.readFileSync)(htmlPath, 'utf-8');
                    logger_1.logger.info(`Loaded UI app: ${config.id}`);
                }
                catch (err) {
                    logger_1.logger.warn(`Failed to read UI app HTML: ${config.id}`, err);
                }
            }
            const entry = { config, html };
            this.entries.set(config.id, entry);
            for (const pattern of config.toolPatterns) {
                this.toolIndex.set(pattern, entry);
            }
        }
        this.loaded = true;
        logger_1.logger.info(`UI App Registry loaded: ${this.entries.size} apps, ${this.toolIndex.size} tool mappings`);
    }
    static getAppForTool(toolName) {
        if (!this.loaded)
            return null;
        return this.toolIndex.get(toolName) ?? null;
    }
    static getAppById(id) {
        if (!this.loaded)
            return null;
        return this.entries.get(id) ?? null;
    }
    static getAllApps() {
        if (!this.loaded)
            return [];
        return Array.from(this.entries.values());
    }
    static injectToolMeta(tools) {
        if (!this.loaded)
            return;
        for (const tool of tools) {
            const entry = this.toolIndex.get(tool.name);
            if (entry && entry.html) {
                tool._meta = {
                    ...(tool._meta ?? {}),
                    ui: { resourceUri: entry.config.uri },
                    'ui/resourceUri': entry.config.uri,
                };
            }
        }
    }
    static reset() {
        this.entries.clear();
        this.toolIndex.clear();
        this.loaded = false;
    }
}
exports.UIAppRegistry = UIAppRegistry;
UIAppRegistry.entries = new Map();
UIAppRegistry.toolIndex = new Map();
UIAppRegistry.loaded = false;
//# sourceMappingURL=registry.js.map