import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import path from 'path';
import os from 'os';
import { SkillResourceRegistry } from '@/mcp/skills/registry';

function createFixture(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'n8n-mcp-skills-test-'));
  const skillsDir = path.join(root, 'data', 'skills');

  const skillA = path.join(skillsDir, 'sample-skill');
  mkdirSync(skillA, { recursive: true });
  writeFileSync(
    path.join(skillA, 'SKILL.md'),
    `---
name: sample-skill
description: A sample skill for tests
---

# Sample Skill

Body content goes here.
`,
  );
  writeFileSync(
    path.join(skillA, 'EXTRA.md'),
    `# Extra Notes

Supporting file content.
`,
  );

  const skillB = path.join(skillsDir, 'another-skill');
  mkdirSync(skillB, { recursive: true });
  writeFileSync(
    path.join(skillB, 'SKILL.md'),
    `# Another Skill

No frontmatter, so description comes from heading.
`,
  );

  // Non-markdown file should be ignored
  writeFileSync(path.join(skillB, 'notes.txt'), 'ignore me');

  return root;
}

describe('SkillResourceRegistry', () => {
  let fixtureRoot: string;

  beforeEach(() => {
    SkillResourceRegistry.reset();
    fixtureRoot = createFixture();
  });

  afterEach(() => {
    SkillResourceRegistry.reset();
    rmSync(fixtureRoot, { recursive: true, force: true });
  });

  describe('load()', () => {
    it('loads markdown files from data/skills/', () => {
      SkillResourceRegistry.load(fixtureRoot);
      const all = SkillResourceRegistry.getAll();
      expect(all).toHaveLength(3);
      expect(all.map(s => s.uri).sort()).toEqual([
        'skill://n8n-mcp/another-skill/SKILL.md',
        'skill://n8n-mcp/sample-skill/EXTRA.md',
        'skill://n8n-mcp/sample-skill/SKILL.md',
      ]);
    });

    it('ignores non-markdown files', () => {
      SkillResourceRegistry.load(fixtureRoot);
      const all = SkillResourceRegistry.getAll();
      expect(all.some(s => s.file.endsWith('.txt'))).toBe(false);
    });

    it('handles a missing skills directory without throwing', () => {
      const emptyRoot = mkdtempSync(path.join(os.tmpdir(), 'n8n-mcp-empty-'));
      try {
        SkillResourceRegistry.load(emptyRoot);
        expect(SkillResourceRegistry.getAll()).toEqual([]);
      } finally {
        rmSync(emptyRoot, { recursive: true, force: true });
      }
    });

    it('uses frontmatter description for SKILL.md when present', () => {
      SkillResourceRegistry.load(fixtureRoot);
      const skill = SkillResourceRegistry.getByUri('skill://n8n-mcp/sample-skill/SKILL.md');
      expect(skill?.description).toBe('A sample skill for tests');
      expect(skill?.name).toBe('sample-skill');
    });

    it('falls back to first heading when frontmatter is absent', () => {
      SkillResourceRegistry.load(fixtureRoot);
      const skill = SkillResourceRegistry.getByUri('skill://n8n-mcp/another-skill/SKILL.md');
      expect(skill?.description).toBe('Another Skill');
    });

    it('parses CRLF frontmatter', () => {
      const crlfRoot = mkdtempSync(path.join(os.tmpdir(), 'n8n-mcp-crlf-'));
      const skillDir = path.join(crlfRoot, 'data', 'skills', 'crlf-skill');
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(
        path.join(skillDir, 'SKILL.md'),
        '---\r\nname: crlf-skill\r\ndescription: CRLF frontmatter works\r\n---\r\n\r\n# Body\r\n',
      );
      try {
        SkillResourceRegistry.load(crlfRoot);
        const skill = SkillResourceRegistry.getByUri('skill://n8n-mcp/crlf-skill/SKILL.md');
        expect(skill?.description).toBe('CRLF frontmatter works');
        expect(skill?.name).toBe('crlf-skill');
      } finally {
        rmSync(crlfRoot, { recursive: true, force: true });
      }
    });

    it('uses text/markdown mime type', () => {
      SkillResourceRegistry.load(fixtureRoot);
      for (const skill of SkillResourceRegistry.getAll()) {
        expect(skill.mimeType).toBe('text/markdown');
      }
    });

    it('preserves file content verbatim', () => {
      SkillResourceRegistry.load(fixtureRoot);
      const extra = SkillResourceRegistry.getByUri('skill://n8n-mcp/sample-skill/EXTRA.md');
      expect(extra?.content).toContain('Supporting file content.');
    });
  });

  describe('getByUri()', () => {
    beforeEach(() => SkillResourceRegistry.load(fixtureRoot));

    it('resolves bare skill URI to SKILL.md', () => {
      const skill = SkillResourceRegistry.getByUri('skill://n8n-mcp/sample-skill');
      expect(skill?.file).toBe('SKILL.md');
    });

    it('returns null for unknown skill name', () => {
      expect(SkillResourceRegistry.getByUri('skill://n8n-mcp/nonexistent')).toBeNull();
    });

    it('returns null for unknown file within an existing skill', () => {
      expect(
        SkillResourceRegistry.getByUri('skill://n8n-mcp/sample-skill/MISSING.md'),
      ).toBeNull();
    });

    it('returns null for URIs outside the skill scheme', () => {
      expect(SkillResourceRegistry.getByUri('ui://n8n-mcp/something')).toBeNull();
    });

    it('rejects path-traversal attempts in the URI', () => {
      // A crafted bare URI with `..` slips through neither the Map lookup
      // (no such key) nor the bare-name fallback (which forbids `/`).
      expect(
        SkillResourceRegistry.getByUri('skill://n8n-mcp/../../../etc/passwd'),
      ).toBeNull();
      expect(
        SkillResourceRegistry.getByUri('skill://n8n-mcp/sample-skill/../another-skill/SKILL.md'),
      ).toBeNull();
    });

    it('returns null before load() is called', () => {
      SkillResourceRegistry.reset();
      expect(
        SkillResourceRegistry.getByUri('skill://n8n-mcp/sample-skill/SKILL.md'),
      ).toBeNull();
    });
  });

  describe('getTemplates()', () => {
    it('returns two URI templates when skills are loaded', () => {
      SkillResourceRegistry.load(fixtureRoot);
      const templates = SkillResourceRegistry.getTemplates();
      expect(templates).toHaveLength(2);
      expect(templates.map(t => t.uriTemplate)).toEqual([
        'skill://n8n-mcp/{name}',
        'skill://n8n-mcp/{name}/{file}',
      ]);
      for (const t of templates) {
        expect(t.mimeType).toBe('text/markdown');
      }
    });

    it('returns empty array when no skills are loaded', () => {
      const emptyRoot = mkdtempSync(path.join(os.tmpdir(), 'n8n-mcp-empty-'));
      try {
        SkillResourceRegistry.load(emptyRoot);
        expect(SkillResourceRegistry.getTemplates()).toEqual([]);
      } finally {
        rmSync(emptyRoot, { recursive: true, force: true });
      }
    });
  });

  describe('reset()', () => {
    it('clears entries and loaded state', () => {
      SkillResourceRegistry.load(fixtureRoot);
      expect(SkillResourceRegistry.getAll().length).toBeGreaterThan(0);
      SkillResourceRegistry.reset();
      expect(SkillResourceRegistry.getAll()).toEqual([]);
      expect(
        SkillResourceRegistry.getByUri('skill://n8n-mcp/sample-skill/SKILL.md'),
      ).toBeNull();
    });
  });
});
