import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NodeParser, normalizeNodeVersion } from '@/parsers/node-parser';
import { BreakingChangeDetector } from '@/services/breaking-change-detector';
import { getAllChangesForNode, getBreakingChangesForNode } from '@/services/breaking-changes-registry';
import { filterPropertiesForVersion } from '@/parsers/version-display-gate';
import { NodeMigrationService } from '@/services/node-migration-service';
import { NodeVersionService } from '@/services/node-version-service';
import { createTestDatabase, createTestNode, TestDatabase } from '@tests/utils/database-utils';

/**
 * Version history is recorded during rebuild: one row per typeVersion n8n accepts.
 * These tests use the real PropertyExtractor and a real SQLite database so they
 * exercise the same path as `npm run rebuild` followed by a version comparison.
 */

const property = (name: string, extra: Record<string, any> = {}) => ({
  displayName: name,
  name,
  type: 'string',
  default: '',
  ...extra
});

/** Mirrors n8n's VersionedNodeType: several keys may share one implementation. */
class FakeVersionedNode {
  description: any;
  nodeVersions: Record<string, any>;
  currentVersion: number;

  constructor() {
    this.description = {
      name: 'fakeVersioned',
      displayName: 'Fake Versioned',
      description: 'Base description',
      group: ['transform'],
      defaultVersion: 2
    };
    const v1 = {
      description: {
        name: 'fakeVersioned',
        displayName: 'Fake Versioned',
        version: 1,
        properties: [property('url'), property('legacyMode')]
      }
    };
    const v2 = {
      description: {
        name: 'fakeVersioned',
        displayName: 'Fake Versioned v2',
        description: 'Second implementation',
        version: [2, 2.1, 3],
        properties: [property('url'), property('timeout', { required: true })]
      }
    };
    this.nodeVersions = { 1: v1, 2: v2, 2.1: v2, 3: v2 };
    this.currentVersion = 2;
  }
}

/** One implementation serving 1, 1.1 and 2 with properties gated by @version. */
class FakeGatedNode {
  description: any;
  nodeVersions: Record<string, any>;
  currentVersion = 2;

  constructor() {
    this.description = { name: 'fakeGated', displayName: 'Fake Gated', group: ['transform'], defaultVersion: 2 };
    const impl = {
      description: {
        name: 'fakeGated',
        displayName: 'Fake Gated',
        version: [1, 1.1, 2],
        properties: [
          property('always'),
          property('legacyOnly', { displayOptions: { hide: { '@version': [{ _cnd: { gte: 1.1 } }] } } }),
          property('sinceOneOne', { displayOptions: { show: { '@version': [{ _cnd: { gte: 1.1 } }] } } }),
          property('onlyTwo', { displayOptions: { show: { resource: ['x'], '@version': [2] } } }),
          {
            displayName: 'Options', name: 'options', type: 'collection', default: {},
            options: [
              property('nestedOld', { displayOptions: { show: { '@version': [{ _cnd: { between: { from: 1, to: 1.1 } } }] } } }),
              property('nestedAlways')
            ]
          }
        ]
      }
    };
    this.nodeVersions = { 1: impl, 1.1: impl, 2: impl };
  }
}

class FakeArrayVersionNode {
  description = {
    name: 'fakeArray',
    displayName: 'Fake Array',
    group: ['transform'],
    version: [1, 1.1],
    defaultVersion: 1.1,
    properties: [property('mode')]
  };
}

class FakeScalarVersionNode {
  description = {
    name: 'fakeScalar',
    displayName: 'Fake Scalar',
    group: ['transform'],
    version: 1,
    properties: [property('mode')]
  };
}

describe('normalizeNodeVersion', () => {
  it('formats versions the way workflows store typeVersion', () => {
    expect(normalizeNodeVersion('1')).toBe('1');
    expect(normalizeNodeVersion('1.0')).toBe('1');
    expect(normalizeNodeVersion(4.1)).toBe('4.1');
    expect(normalizeNodeVersion('2.10')).toBe('2.1');
    expect(normalizeNodeVersion('beta')).toBe('beta');
  });
});

describe('NodeParser.parseVersions', () => {
  const parser = new NodeParser();

  it('emits one row per nodeVersions key, marking n8n\'s current version', () => {
    const versions = parser.parseVersions(FakeVersionedNode as any, 'n8n-nodes-base');

    expect(versions.map(v => v.version)).toEqual(['1', '2', '2.1', '3']);
    expect(versions.map(v => v.isCurrentMax)).toEqual([false, true, false, false]);
    expect(versions.every(v => v.nodeType === 'nodes-base.fakeVersioned')).toBe(true);
    expect(versions[1].displayName).toBe('Fake Versioned v2');
    expect(versions[1].description).toBe('Second implementation');
    expect(versions[0].description).toBe('Base description');
  });

  it('stores each version\'s own properties and diffs names against the previous version', () => {
    const [v1, v2, v21] = parser.parseVersions(FakeVersionedNode as any, 'n8n-nodes-base');

    expect(v1.properties.map((p: any) => p.name)).toEqual(['url', 'legacyMode']);
    expect(v2.properties.map((p: any) => p.name)).toEqual(['url', 'timeout']);
    expect(v1.addedProperties).toEqual([]);
    expect(v2.addedProperties).toEqual(['timeout']);
    expect(v2.deprecatedProperties).toEqual(['legacyMode']);
    // 2.1 shares the v2 implementation, so nothing changes
    expect(v21.addedProperties).toEqual([]);
    expect(v21.deprecatedProperties).toEqual([]);
  });

  it('expands a plain node\'s version array into rows sharing one description', () => {
    const versions = parser.parseVersions(FakeArrayVersionNode as any, 'n8n-nodes-base');

    expect(versions.map(v => [v.version, v.isCurrentMax])).toEqual([['1', false], ['1.1', true]]);
    expect(versions[0].properties).toEqual(versions[1].properties);
  });

  it('materializes @version display gates so shared implementations differ per version', () => {
    const [v1, v11, v2] = parser.parseVersions(FakeGatedNode as any, 'n8n-nodes-base');
    const names = (v: any) => v.properties.map((p: any) => p.name);
    const nested = (v: any) => v.properties.find((p: any) => p.name === 'options').options.map((o: any) => o.name);

    expect(names(v1)).toEqual(['always', 'legacyOnly', 'options']);
    expect(names(v11)).toEqual(['always', 'sinceOneOne', 'options']);
    expect(names(v2)).toEqual(['always', 'sinceOneOne', 'onlyTwo', 'options']);
    expect(nested(v1)).toEqual(['nestedOld', 'nestedAlways']);
    expect(nested(v2)).toEqual(['nestedAlways']);
    expect(v11.addedProperties).toEqual(['sinceOneOne']);
    expect(v11.deprecatedProperties).toEqual(['legacyOnly']);
    expect(v2.addedProperties).toEqual(['onlyTwo']);
  });

  it('leaves properties without @version gates and non-numeric versions alone', () => {
    const props = [property('a', { displayOptions: { show: { resource: ['x'] } } }), property('b')];
    expect(filterPropertiesForVersion(props, '2')).toEqual(props);
    expect(filterPropertiesForVersion(props, 'beta')).toBe(props);
  });

  it('skips version keys a numeric typeVersion can never select', () => {
    class Odd {
      description = { name: 'odd', displayName: 'Odd', group: ['transform'] };
      nodeVersions = {
        1: { description: { name: 'odd', displayName: 'Odd', version: 1, properties: [] } },
        beta: { description: { name: 'odd', displayName: 'Odd', version: 'beta', properties: [] } }
      };
      currentVersion = 1;
    }
    expect(parser.parseVersions(Odd as any, 'n8n-nodes-base').map(v => v.version)).toEqual(['1']);
  });

  it('records nothing for a node with a single scalar version', () => {
    expect(parser.parseVersions(FakeScalarVersionNode as any, 'n8n-nodes-base')).toEqual([]);
  });
});

describe('version rows through the repository', () => {
  let db: TestDatabase;

  beforeEach(async () => {
    db = await createTestDatabase({ inMemory: true });
  });

  afterEach(async () => {
    await db.cleanup();
  });

  const saveAll = () => {
    // node_versions references nodes; better-sqlite3 enforces foreign keys by default
    db.nodeRepository.saveNode(createTestNode({
      nodeType: 'nodes-base.fakeVersioned',
      displayName: 'Fake Versioned',
      version: '2',
      isVersioned: true
    }));
    const parser = new NodeParser();
    for (const v of parser.parseVersions(FakeVersionedNode as any, 'n8n-nodes-base')) {
      db.nodeRepository.saveNodeVersion({
        nodeType: v.nodeType,
        version: v.version,
        packageName: v.packageName,
        displayName: v.displayName,
        isCurrentMax: v.isCurrentMax,
        propertiesSchema: v.properties,
        addedProperties: v.addedProperties,
        deprecatedProperties: v.deprecatedProperties
      });
    }
  };

  it('round-trips rows and resolves "1.0" style lookups to stored "1"', () => {
    saveAll();

    expect(db.nodeRepository.getNodeVersions('nodes-base.fakeVersioned')).toHaveLength(4);
    expect(db.nodeRepository.getLatestNodeVersion('nodes-base.fakeVersioned')?.version).toBe('2');
    expect(db.nodeRepository.getNodeVersion('nodes-base.fakeVersioned', '1.0')?.version).toBe('1');
    expect(db.nodeRepository.getNodeVersion('nodes-base.fakeVersioned', '2.1')?.addedProperties).toEqual([]);
  });

  it('resolves Tool variants to the base node\'s version rows', () => {
    saveAll();

    // Only a generated variant (is_tool_variant + tool_variant_of) is redirected
    db.nodeRepository.saveNode(createTestNode({
      nodeType: 'nodes-base.fakeVersionedTool', displayName: 'Fake Versioned Tool', version: '2',
      isVersioned: true, isToolVariant: true, toolVariantOf: 'nodes-base.fakeVersioned'
    }));
    // A real node whose name merely ends in Tool keeps its own (here: absent) rows
    db.nodeRepository.saveNode(createTestNode({ nodeType: 'nodes-base.realTool', displayName: 'Real Tool', version: '1', isVersioned: false }));
    expect(db.nodeRepository.hasVersionMetadata('nodes-base.realTool')).toBe(false);

    expect(db.nodeRepository.hasVersionMetadata('nodes-base.fakeVersionedTool')).toBe(true);
    expect(db.nodeRepository.getNodeVersions('nodes-base.fakeVersionedTool').map(v => v.version)).toEqual(['3', '2.1', '2', '1']);
    expect(db.nodeRepository.getLatestNodeVersion('nodes-base.fakeVersionedTool')?.version).toBe('2');
    expect(db.nodeRepository.getNodeVersion('nodes-base.fakeVersionedTool', '1')?.version).toBe('1');
  });

  it('never deletes or invents configured values from a schema diff', async () => {
    saveAll();
    const detector = new BreakingChangeDetector(db.nodeRepository);
    const migrations = new NodeMigrationService(new NodeVersionService(db.nodeRepository, detector), detector);
    const node = {
      id: 'n1', name: 'Fake', type: 'nodes-base.fakeVersioned', typeVersion: 1,
      position: [0, 0], parameters: { url: 'https://example.com', legacyMode: true }
    };

    const result = await migrations.migrateNode(node as any, '1', '2');

    // A removed property may have been renamed and a required one cannot be guessed:
    // both are left for a person, the node itself is untouched apart from the version
    expect(result.success).toBe(false);
    expect(result.updatedNode.parameters).toEqual(node.parameters);
    expect(Object.keys(result.updatedNode).sort()).toEqual(['id', 'name', 'parameters', 'position', 'type', 'typeVersion']);
    expect(result.remainingIssues.join(' ')).toContain('parameters.timeout');
    expect(result.remainingIssues.join(' ')).toContain('parameters.legacyMode');
  });

  it('lets the detector diff stored schemas instead of relying on the registry alone', async () => {
    saveAll();
    const detector = new BreakingChangeDetector(db.nodeRepository);

    const analysis = await detector.analyzeVersionUpgrade('nodes-base.fakeVersioned', '1', '2');
    const dynamic = analysis.changes.filter(c => c.source === 'dynamic');

    // Paths are node-root relative like the registry's, so migrations hit node.parameters
    expect(dynamic.map(c => [c.propertyName, c.changeType, c.isBreaking])).toEqual(
      expect.arrayContaining([
        ['parameters.timeout', 'added', true],
        ['parameters.legacyMode', 'removed', true]
      ])
    );
    expect(analysis.hasBreakingChanges).toBe(true);
  });
});

describe('breaking-changes registry version ranges', () => {
  it('includes every registry transition inside a multi-step upgrade', () => {
    const webhook = getBreakingChangesForNode('n8n-nodes-base.webhook', '1', '2.1');
    const steps = new Set(webhook.map(c => `${c.fromVersion}->${c.toVersion}`));
    expect(steps.has('1.0->2.0')).toBe(true);
    expect(steps.has('2.0->2.1')).toBe(true);
  });

  it('excludes transitions outside the requested range', () => {
    expect(getAllChangesForNode('n8n-nodes-base.webhook', '2', '2.1').every(c => c.fromVersion === '2.0')).toBe(true);
    expect(getAllChangesForNode('n8n-nodes-base.executeWorkflow', '1.1', '1.3')).toEqual([]);
  });
});
