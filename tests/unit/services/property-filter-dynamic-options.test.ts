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
