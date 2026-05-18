import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import path from 'path';
import { logger } from '../../utils/logger';
import type { SkillResource } from './types';

const SKILL_URI_PREFIX = 'skill://n8n-mcp/';
const MIME_TYPE = 'text/markdown';

interface ParsedFrontmatter {
  name?: string;
  description?: string;
}

function parseFrontmatter(raw: string): ParsedFrontmatter {
  const content = raw.replace(/\r\n/g, '\n');
  if (!content.startsWith('---\n')) return {};
  const end = content.indexOf('\n---', 4);
  if (end === -1) return {};
  const block = content.slice(4, end);
  const result: ParsedFrontmatter = {};
  for (const line of block.split('\n')) {
    const sep = line.indexOf(':');
    if (sep === -1) continue;
    const key = line.slice(0, sep).trim();
    const value = line.slice(sep + 1).trim().replace(/^["']|["']$/g, '');
    if (key === 'name') result.name = value;
    else if (key === 'description') result.description = value;
  }
  return result;
}

function deriveDescription(content: string, fallback: string): string {
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('---')) continue;
    if (trimmed.startsWith('#')) return trimmed.replace(/^#+\s*/, '').trim() || fallback;
    return trimmed;
  }
  return fallback;
}

function humanize(slug: string): string {
  return slug
    .replace(/[-_]+/g, ' ')
    .replace(/\.md$/i, '')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export class SkillResourceRegistry {
  private static entries: Map<string, SkillResource> = new Map();
  private static loaded = false;

  static load(rootDir?: string): void {
    this.entries.clear();
    const packageRoot = rootDir ?? path.resolve(__dirname, '..', '..', '..');
    const skillsDir = path.join(packageRoot, 'data', 'skills');

    if (!existsSync(skillsDir)) {
      this.loaded = true;
      logger.info(`Skill Resource Registry: no skills directory at ${skillsDir} (skipping)`);
      return;
    }

    let skillCount = 0;
    for (const skillName of readdirSync(skillsDir)) {
      const skillPath = path.join(skillsDir, skillName);
      if (!statSync(skillPath).isDirectory()) continue;

      for (const file of readdirSync(skillPath)) {
        if (!file.endsWith('.md')) continue;
        const filePath = path.join(skillPath, file);
        try {
          const content = readFileSync(filePath, 'utf-8');
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
        } catch (err) {
          logger.warn(`Failed to load skill file: ${filePath}`, err);
        }
      }
      skillCount++;
    }

    this.loaded = true;
    logger.info(
      `Skill Resource Registry loaded: ${skillCount} skills, ${this.entries.size} files`,
    );
  }

  static getAll(): SkillResource[] {
    if (!this.loaded) return [];
    return Array.from(this.entries.values());
  }

  static getByUri(uri: string): SkillResource | null {
    if (!this.loaded) return null;
    const direct = this.entries.get(uri);
    if (direct) return direct;
    if (!uri.startsWith(SKILL_URI_PREFIX)) return null;
    // Accept bare skill://n8n-mcp/{name} as alias for SKILL.md
    const remainder = uri.slice(SKILL_URI_PREFIX.length);
    if (remainder.includes('/')) return null;
    return this.entries.get(`${SKILL_URI_PREFIX}${remainder}/SKILL.md`) ?? null;
  }

  static getTemplates(): Array<{
    uriTemplate: string;
    name: string;
    description: string;
    mimeType: string;
  }> {
    if (!this.loaded || this.entries.size === 0) return [];
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

  /** Reset registry state. Intended for testing only. */
  static reset(): void {
    this.entries.clear();
    this.loaded = false;
  }
}
