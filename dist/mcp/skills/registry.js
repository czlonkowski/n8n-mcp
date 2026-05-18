"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SkillResourceRegistry = void 0;
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
const logger_1 = require("../../utils/logger");
const SKILL_URI_PREFIX = 'skill://n8n-mcp/';
const MIME_TYPE = 'text/markdown';
function parseFrontmatter(raw) {
    const content = raw.replace(/\r\n/g, '\n');
    if (!content.startsWith('---\n'))
        return {};
    const end = content.indexOf('\n---', 4);
    if (end === -1)
        return {};
    const block = content.slice(4, end);
    const result = {};
    for (const line of block.split('\n')) {
        const sep = line.indexOf(':');
        if (sep === -1)
            continue;
        const key = line.slice(0, sep).trim();
        const value = line.slice(sep + 1).trim().replace(/^["']|["']$/g, '');
        if (key === 'name')
            result.name = value;
        else if (key === 'description')
            result.description = value;
    }
    return result;
}
function deriveDescription(content, fallback) {
    for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('---'))
            continue;
        if (trimmed.startsWith('#'))
            return trimmed.replace(/^#+\s*/, '').trim() || fallback;
        return trimmed;
    }
    return fallback;
}
function humanize(slug) {
    return slug
        .replace(/[-_]+/g, ' ')
        .replace(/\.md$/i, '')
        .replace(/\b\w/g, (c) => c.toUpperCase());
}
class SkillResourceRegistry {
    static load(rootDir) {
        this.entries.clear();
        const packageRoot = rootDir ?? path_1.default.resolve(__dirname, '..', '..', '..');
        const skillsDir = path_1.default.join(packageRoot, 'data', 'skills');
        if (!(0, fs_1.existsSync)(skillsDir)) {
            this.loaded = true;
            logger_1.logger.info(`Skill Resource Registry: no skills directory at ${skillsDir} (skipping)`);
            return;
        }
        let skillCount = 0;
        for (const skillName of (0, fs_1.readdirSync)(skillsDir)) {
            const skillPath = path_1.default.join(skillsDir, skillName);
            if (!(0, fs_1.statSync)(skillPath).isDirectory())
                continue;
            for (const file of (0, fs_1.readdirSync)(skillPath)) {
                if (!file.endsWith('.md'))
                    continue;
                const filePath = path_1.default.join(skillPath, file);
                try {
                    const content = (0, fs_1.readFileSync)(filePath, 'utf-8');
                    const isMain = file === 'SKILL.md';
                    const front = isMain ? parseFrontmatter(content) : {};
                    const description = front.description
                        ?? deriveDescription(content, `${humanize(skillName)} — ${file}`);
                    const displayName = isMain
                        ? front.name ?? humanize(skillName)
                        : `${humanize(skillName)} — ${humanize(file)}`;
                    const uri = `${SKILL_URI_PREFIX}${skillName}/${file}`;
                    this.entries.set(uri, {
                        skillName,
                        file,
                        uri,
                        name: displayName,
                        description,
                        mimeType: MIME_TYPE,
                        content,
                    });
                }
                catch (err) {
                    logger_1.logger.warn(`Failed to load skill file: ${filePath}`, err);
                }
            }
            skillCount++;
        }
        this.loaded = true;
        logger_1.logger.info(`Skill Resource Registry loaded: ${skillCount} skills, ${this.entries.size} files`);
    }
    static getAll() {
        if (!this.loaded)
            return [];
        return Array.from(this.entries.values());
    }
    static getByUri(uri) {
        if (!this.loaded)
            return null;
        const direct = this.entries.get(uri);
        if (direct)
            return direct;
        if (!uri.startsWith(SKILL_URI_PREFIX))
            return null;
        const remainder = uri.slice(SKILL_URI_PREFIX.length);
        if (remainder.includes('/'))
            return null;
        return this.entries.get(`${SKILL_URI_PREFIX}${remainder}/SKILL.md`) ?? null;
    }
    static getTemplates() {
        if (!this.loaded || this.entries.size === 0)
            return [];
        return [
            {
                uriTemplate: `${SKILL_URI_PREFIX}{name}`,
                name: 'n8n skill (main)',
                description: 'Primary SKILL.md document for an n8n-mcp skill',
                mimeType: MIME_TYPE,
            },
            {
                uriTemplate: `${SKILL_URI_PREFIX}{name}/{file}`,
                name: 'n8n skill (supporting file)',
                description: 'A markdown file inside a specific n8n-mcp skill',
                mimeType: MIME_TYPE,
            },
        ];
    }
    static reset() {
        this.entries.clear();
        this.loaded = false;
    }
}
exports.SkillResourceRegistry = SkillResourceRegistry;
SkillResourceRegistry.entries = new Map();
SkillResourceRegistry.loaded = false;
//# sourceMappingURL=registry.js.map