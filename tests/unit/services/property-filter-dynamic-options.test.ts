import { describe, it, expect } from 'vitest';
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
// There is no existing tests/unit test that opens the real database
// read-only for this kind of assertion (tests that load nodes.db live under
// tests/integration), so this reproduces the shape inline instead of adding
// a new database-backed unit test.
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
