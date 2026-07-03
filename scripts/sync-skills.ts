#!/usr/bin/env npx tsx
/**
 * Copy markdown skill files from the sibling n8n-skills repo into
 * data/skills/ so they ship inside the n8n-mcp npm/Docker artifacts.
 *
 * Source defaults to ../n8n-skills/skills relative to this repo root.
 * Override with N8N_SKILLS_SOURCE.
 */
import { promises as fs } from 'fs';
import { existsSync } from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..');
const CANDIDATE_SOURCES = [
  path.resolve(REPO_ROOT, '..', 'n8n-skills', 'skills'),
  path.resolve(REPO_ROOT, '..', '..', 'n8n-skills', 'skills'),
];
const SOURCE = process.env.N8N_SKILLS_SOURCE
  ? path.resolve(process.env.N8N_SKILLS_SOURCE)
  : CANDIDATE_SOURCES.find((p) => existsSync(p)) ?? CANDIDATE_SOURCES[0];
const DEST = path.join(REPO_ROOT, 'data', 'skills');

async function copyMarkdownTree(src: string, dst: string): Promise<number> {
  const entries = await fs.readdir(src, { withFileTypes: true });
  let copied = 0;
  await fs.mkdir(dst, { recursive: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const dstPath = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      // Skill-creator eval workspaces (skills/*-workspace/) are local debris,
      // untracked in n8n-skills and excluded from its dist builds — skip them.
      if (entry.name.endsWith('-workspace')) continue;
      copied += await copyMarkdownTree(srcPath, dstPath);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      await fs.copyFile(srcPath, dstPath);
      copied++;
    }
  }
  return copied;
}

async function clearDestination(dir: string): Promise<void> {
  if (!existsSync(dir)) return;
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      await fs.rm(path.join(dir, entry.name), { recursive: true, force: true });
    }
  }
}

async function main(): Promise<void> {
  console.log(`Syncing skills from: ${SOURCE}`);
  console.log(`              into: ${DEST}`);

  if (!existsSync(SOURCE)) {
    if (existsSync(DEST)) {
      console.warn(`Source not found, keeping existing ${DEST} unchanged.`);
      return;
    }
    console.error(`Source directory not found: ${SOURCE}`);
    console.error('Set N8N_SKILLS_SOURCE or clone n8n-skills next to n8n-mcp.');
    process.exit(1);
  }

  await clearDestination(DEST);
  const count = await copyMarkdownTree(SOURCE, DEST);
  console.log(`Synced ${count} markdown files.`);
}

main().catch((err) => {
  console.error('sync-skills failed:', err);
  process.exit(1);
});
