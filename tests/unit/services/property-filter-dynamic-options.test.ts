import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import Database from 'better-sqlite3';
import { PropertyFilter } from '@/services/property-filter';

const props = [
  { name: 'user', displayName: 'User', type: 'options', typeOptions: { loadOptionsMethod: 'getUsers' }, default: '' },
  { name: 'sheetName', displayName: 'Sheet', type: 'resourceLocator', default: { mode: 'list', value: '' },
    typeOptions: { loadOptionsDependsOn: ['documentId.value'] },
    modes: [ { displayName: 'From list', name: 'list', type: 'list', typeOptions: { searchListMethod: 'sheetsSearch', searchable: true } }, { displayName: 'ID', name: 'id', type: 'string' } ] },
  { name: 'url', displayName: 'URL', type: 'string', default: '' },
];

describe('PropertyFilter dynamicOptions', () => {
  const simplified = PropertyFilter.getEssentials(props as any, 'nodes-base.testNode');
  const byName = (n: string) => [...simplified.required, ...simplified.common].find(p => p.name === n)!;
  it('exposes loadOptions methods', () => {
    expect(byName('user').dynamicOptions).toEqual({ methodName: 'getUsers', methodType: 'loadOptions', dependsOn: [] });
  });
  it('exposes listSearch methods from resource locator modes with the property-level dependsOn', () => {
    expect(byName('sheetName').dynamicOptions).toEqual({ methodName: 'sheetsSearch', methodType: 'listSearch', dependsOn: ['documentId.value'] });
  });
  it('omits the field for static properties', () => {
    expect(byName('url').dynamicOptions).toBeUndefined();
  });
});

// Shaped after the real `nodes-base.slack` schema (data/nodes.db, node_type =
// 'nodes-base.slack'). The node's channel resource-locator property is named
// `channelId`, not `channel` — ESSENTIAL_PROPERTIES['nodes-base.slack'] once
// named `channel`, so getEssentials() never surfaced the channel picker.
// Two complementary checks cover this: an inline fixture (below) pins the
// derivation rules against a hand-shaped schema snapshot, and a separate
// database-backed test further down opens the real, read-only data/nodes.db
// to guard the Slack essentials config against schema drift going forward
// (skipped when that file isn't present).
const slackProps = [
  { name: 'resource', displayName: 'Resource', type: 'options', default: 'message' },
  { name: 'operation', displayName: 'Operation', type: 'options', default: 'post' },
  {
    name: 'channelId', displayName: 'Channel', type: 'resourceLocator', default: { mode: 'list', value: '' },
    required: true, description: 'The Slack channel to send to',
    modes: [
      { displayName: 'From List', name: 'list', type: 'list', typeOptions: { searchListMethod: 'getChannels', searchable: true } },
      { displayName: 'By ID', name: 'id', type: 'string' }
    ]
  },
  { name: 'text', displayName: 'Message Text', type: 'string', default: '' },
  { name: 'attachments', displayName: 'Attachments', type: 'collection', default: {}, options: [] },
  { name: 'blocksUi', displayName: 'Blocks', type: 'string', default: '' },
];

describe('PropertyFilter essentials for nodes-base.slack', () => {
  const simplified = PropertyFilter.getEssentials(slackProps as any, 'nodes-base.slack');
  const byName = (n: string) => [...simplified.required, ...simplified.common].find(p => p.name === n);

  it('surfaces channelId (not the non-existent "channel") as a common property', () => {
    expect(byName('channel')).toBeUndefined();
    expect(byName('channelId')).toBeDefined();
  });

  it('exposes the channelId resource locator search method', () => {
    expect(byName('channelId')!.dynamicOptions).toEqual({ methodName: 'getChannels', methodType: 'listSearch', dependsOn: [] });
  });
});

// Regression test against the real database: an inline fixture (above) can
// verify the current behaviour, but it can't catch schema drift — the exact
// bug class that produced the `channel`/`channelId` mismatch in the first
// place. This opens data/nodes.db read-only and checks getEssentials() against
// the Slack node's actual, current property schema.
const dbPath = path.join(__dirname, '../../../data/nodes.db');
const dbExists = fs.existsSync(dbPath);

describe('PropertyFilter essentials for nodes-base.slack (real database)', () => {
  it.skipIf(!dbExists)('every ESSENTIAL_PROPERTIES name for nodes-base.slack exists in the real schema, and channelId resolves to a listSearch method', () => {
    const db = new Database(dbPath, { readonly: true });
    try {
      const row = db.prepare("SELECT properties_schema FROM nodes WHERE node_type = 'nodes-base.slack'").get() as { properties_schema: string } | undefined;
      expect(row).toBeDefined();
      const props = JSON.parse(row!.properties_schema);
      const schemaNames = new Set(props.map((p: any) => p.name));

      // ESSENTIAL_PROPERTIES is a private static field; reach in for this
      // schema-drift check rather than exporting it just for the test.
      const config = (PropertyFilter as any).ESSENTIAL_PROPERTIES['nodes-base.slack'];
      expect(config).toBeDefined();
      for (const name of [...config.required, ...config.common]) {
        expect(schemaNames.has(name)).toBe(true);
      }

      const simplified = PropertyFilter.getEssentials(props, 'nodes-base.slack');
      const channelId = [...simplified.required, ...simplified.common].find(p => p.name === 'channelId');
      expect(channelId).toBeDefined();
      expect(channelId!.dynamicOptions?.methodType).toBe('listSearch');
      expect(channelId!.dynamicOptions?.methodName).toBe('getChannels');
    } finally {
      db.close();
    }
  });
});
