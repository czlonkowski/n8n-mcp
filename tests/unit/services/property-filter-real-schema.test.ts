import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import Database from 'better-sqlite3';
import { PropertyFilter, type SimplifiedProperty } from '@/services/property-filter';
import { decompressColumnJson } from '@/database/compressed-column';
import { filterPropertiesForVersion } from '@/parsers/version-display-gate';

// get_node "standard" against the node schemas in data/nodes.db. Synthetic fixtures
// can't catch schema drift: curated names that no longer exist (IF's
// `combineOperation`, Merge v1's `propertyName1`) were silently skipped for years.

const dbPath = path.join(__dirname, '../../../data/nodes.db');
const dbExists = fs.existsSync(dbPath);

describe.skipIf(!dbExists)('PropertyFilter essentials against the real node schemas', () => {
  let db: Database.Database;

  beforeAll(() => {
    db = new Database(dbPath, { readonly: true });
  });
  afterAll(() => db?.close());

  function load(nodeType: string): { properties: any[]; version: string } {
    const row = db.prepare('SELECT properties_schema, version FROM nodes WHERE node_type = ?')
      .get(nodeType) as { properties_schema: string; version: string } | undefined;
    if (!row) throw new Error(`${nodeType} is not in nodes.db`);
    return { properties: decompressColumnJson(row.properties_schema, []), version: row.version };
  }

  function standard(nodeType: string): SimplifiedProperty[] {
    const { properties, version } = load(nodeType);
    const result = PropertyFilter.getEssentials(properties, nodeType, version);
    return [...result.required, ...result.common];
  }

  function child(props: SimplifiedProperty[], parent: string, name: string) {
    return props.find(p => p.name === parent)?.options?.find(o => o.value === name);
  }

  it('every curated essential name exists at the node\'s current version', () => {
    const curated = (PropertyFilter as any).ESSENTIAL_PROPERTIES as Record<string, { required: string[]; common: string[] }>;
    const missing: string[] = [];
    for (const [nodeType, config] of Object.entries(curated)) {
      const { properties, version } = load(nodeType);
      const names = new Set<string>();
      const walk = (list: any[]) => {
        for (const prop of list ?? []) {
          if (!prop?.name) continue;
          names.add(prop.name);
          if (prop.type === 'collection') walk(prop.options);
          if (prop.type === 'fixedCollection') for (const group of prop.options ?? []) walk(group.values);
        }
      };
      walk(filterPropertiesForVersion(properties, version));
      for (const name of [...config.required, ...config.common]) {
        if (!names.has(name)) missing.push(`${nodeType}.${name}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('HTTP Request lists pagination, batching and response options', () => {
    const props = standard('nodes-base.httpRequest');
    expect(child(props, 'options', 'pagination')?.description).toContain('paginationMode');
    expect(child(props, 'options', 'response')?.description).toContain('neverError');
    expect(child(props, 'options', 'batching')?.description).toContain('batchSize');
    expect(props.map(p => p.name)).toContain('jsonBody');
  });

  it('Webhook shows its current options, not v1-only fields', () => {
    const props = standard('nodes-base.webhook');
    // responseCode moved into options after v1.1
    expect(props.map(p => p.name)).not.toContain('responseCode');
    for (const name of ['rawBody', 'onlyRunIf', 'ipWhitelist', 'responseCode']) {
      expect(child(props, 'options', name), name).toBeDefined();
    }
  });

  it('Merge shows the v3 combine settings', () => {
    const props = standard('nodes-base.merge');
    const names = props.map(p => p.name);
    expect(names).toEqual(expect.arrayContaining(['mode', 'combineBy', 'fieldsToMatchString', 'joinMode', 'numberInputs']));
    expect(names).not.toContain('propertyName1');
    const clash = child(props, 'options', 'clashHandling');
    expect(clash?.description).toContain('Only when');
  });

  it('IF shows its v2 settings', () => {
    const props = standard('nodes-base.if');
    expect(props.map(p => p.name)).toEqual(['conditions', 'looseTypeValidation', 'options']);
    expect(child(props, 'options', 'ignoreCase')).toBeDefined();
  });

  it('Summarize names its aggregations', () => {
    const line = child(standard('nodes-base.summarize'), 'fieldsToSummarize', 'values')?.description;
    expect(line).toMatch(/aggregation \([^)]*\bsum\b/);
  });

  it('OpenAI lists the image sizes of each model separately', () => {
    const sizes = standard('nodes-base.openAi')
      .find(p => p.name === 'options')?.options?.filter(o => o.value === 'size')
      .map(o => o.description);
    expect(sizes).toEqual(expect.arrayContaining([
      expect.stringMatching(/256x256.*model=dall-e-2/),
      expect.stringMatching(/1792x1024.*model=dall-e-3/),
    ]));
  });

  it('Date & Time keeps the string and boolean timezone settings apart', () => {
    const timezones = standard('nodes-base.dateTime')
      .find(p => p.name === 'options')?.options?.filter(o => o.value === 'timezone') ?? [];
    expect(timezones.length).toBeGreaterThanOrEqual(2);
    expect(timezones.every(o => o.description?.includes('Only when operation='))).toBe(true);
  });

  it('renders every display condition of every core node as text', () => {
    const coreNodes = db.prepare('SELECT node_type FROM nodes WHERE is_community = 0').all() as Array<{ node_type: string }>;
    const broken = coreNodes
      .filter(({ node_type }) => JSON.stringify(standard(node_type)).includes('[object Object]'))
      .map(({ node_type }) => node_type);
    expect(broken).toEqual([]);
    const quoted = child(standard('nodes-base.postgres'), 'options', 'treatQueryParametersInSingleQuotesAsText');
    expect(quoted?.description).toContain('queryReplacement is set');
  });

  it('Remove Duplicates shows its options, including the history scope', () => {
    const props = standard('nodes-base.removeDuplicates');
    expect(child(props, 'options', 'scope')).toBeDefined();
  });
});
