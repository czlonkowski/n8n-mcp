import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ExpressionExtensions } from 'n8n-workflow';
import { DateTime } from 'luxon';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { N8NDocumentationMCPServer } from '@/mcp/server';
import { closeSharedDatabase } from '@/database/shared-database';
import { SERVER_INSTRUCTIONS } from '@/mcp/native-first';
import {
  EXPRESSION_HELPERS,
  getExpressionHelpersGuide,
  type HelperType
} from '@/mcp/tool-docs/guides/expression-helpers';
import { getToolDocumentation } from '@/mcp/tools-documentation';

// The reference documents n8n-workflow's expression extensions. These checks run it
// against the bundled n8n-workflow, so an n8n update that renames, removes or changes
// a helper fails here instead of shipping wrong guidance to agents.

function functionsFor(type: HelperType): Record<string, (value: unknown, args: unknown[]) => unknown> {
  const extension = ExpressionExtensions.find(e => e.typeName === type);
  if (!extension) throw new Error(`n8n-workflow has no ${type} expression extensions`);
  return extension.functions as any;
}

/** Method names in a `call` such as "isEmail() / isUrl() / isNumeric()". */
function namesInCall(call: string): string[] {
  return call.split(' / ').map(part => part.trim().replace(/\(.*$/, ''));
}

describe('expression_helpers reference', () => {
  it.each(EXPRESSION_HELPERS.map(h => [`${h.type}.${h.call}`, h] as const))(
    'every method in %s exists in n8n-workflow',
    (_label, helper) => {
      const functions = functionsFor(helper.type);
      for (const name of namesInCall(helper.call)) {
        expect(typeof functions[name], `${helper.type}.${name}`).toBe('function');
      }
      expect(namesInCall(helper.call)).toContain(helper.name);
    }
  );

  const withExamples = EXPRESSION_HELPERS.filter(h => h.example);

  it.each(withExamples.map(h => [`${h.type}.${h.name}`, h] as const))(
    '%s returns the documented output',
    (_label, helper) => {
      const { input, args = [], output } = helper.example!;
      const receiver = helper.type === 'Date'
        ? DateTime.fromISO(input as string, { zone: 'utc' })
        : input;
      expect(functionsFor(helper.type)[helper.name](receiver, args)).toEqual(output);
    }
  );

  it('documents the failure cases it warns about', () => {
    expect(() => functionsFor('Array').sum(['1', 2], [])).toThrow();
    expect(() => functionsFor('String').parseJson('{not json', [])).toThrow();
    const start = DateTime.fromISO('2026-10-01T00:00:00Z', { zone: 'utc' });
    expect(functionsFor('Date').isBetween(start, ['2026-10-01T00:00:00Z', '2026-11-01T00:00:00Z'])).toBe(false);
  });

  it('is reachable as a tools_documentation topic at both depths', () => {
    const essentials = getToolDocumentation('expression_helpers', 'essentials');
    const full = getToolDocumentation('expression_helpers', 'full');
    expect(essentials).toBe(getExpressionHelpersGuide('essentials'));
    expect(full).toBe(getExpressionHelpersGuide('full'));
    expect(essentials).toContain('pluck(field, ...)');
    expect(full).toContain("[{\"price\":5},{\"price\":7}].pluck('price') → [5,7]");
    // Jobs across items point at nodes, not at helpers or Code
    expect(essentials).toContain('Remove Duplicates');
    expect(essentials).toContain('Summarize');
  });
});

const sourceDbPath = path.join(__dirname, '../../../data/nodes.db');

describe.skipIf(!fs.existsSync(sourceDbPath))('initialize instructions', () => {
  let server: N8NDocumentationMCPServer;
  let tmpDir: string;
  const previousDbPath = process.env.NODE_DB_PATH;

  beforeAll(async () => {
    // Work on a copy: opening the tracked database rewrites bytes in it.
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'n8n-mcp-instructions-'));
    const dbCopy = path.join(tmpDir, 'nodes.db');
    fs.copyFileSync(sourceDbPath, dbCopy);
    process.env.NODE_DB_PATH = dbCopy;
    server = new N8NDocumentationMCPServer();
    await (server as any).initialized;
  }, 60000);

  afterAll(async () => {
    await server?.close();
    await closeSharedDatabase();
    if (previousDbPath === undefined) delete process.env.NODE_DB_PATH;
    else process.env.NODE_DB_PATH = previousDbPath;
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('reach a client through the custom initialize handler', async () => {
    // server.ts replaces the SDK's initialize handler, so this is the path real clients take
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await (server as any).server.connect(serverTransport);
    const client = new Client({ name: 'instructions-test', version: '1.0.0' });
    await client.connect(clientTransport);
    try {
      expect(client.getInstructions()).toBe(SERVER_INSTRUCTIONS);
      expect(SERVER_INSTRUCTIONS).toContain('expression_helpers');
      expect(SERVER_INSTRUCTIONS).toMatch(/A Code node, only for/);
    } finally {
      await client.close();
    }
  });
});
