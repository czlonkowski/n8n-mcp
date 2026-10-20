import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BreakingChangeDetector, type DetectedChange, type VersionUpgradeAnalysis } from '@/services/breaking-change-detector';
import { NodeRepository } from '@/database/node-repository';
import * as BreakingChangesRegistry from '@/services/breaking-changes-registry';

vi.mock('@/database/node-repository');
vi.mock('@/services/breaking-changes-registry');

describe('BreakingChangeDetector', () => {
  let detector: BreakingChangeDetector;
  let mockRepository: NodeRepository;

  const createMockVersionData = (version: string, properties: any[] = []) => ({
    nodeType: 'nodes-base.httpRequest',
    version,
    packageName: 'n8n-nodes-base',
    displayName: 'HTTP Request',
    isCurrentMax: false,
    propertiesSchema: properties,
    breakingChanges: [],
    deprecatedProperties: [],
    addedProperties: []
  });

  const createMockProperty = (name: string, type: string = 'string', required = false) => ({
    name,
    displayName: name,
    type,
    required,
    default: null
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockRepository = new NodeRepository({} as any);
    detector = new BreakingChangeDetector(mockRepository);
  });

  describe('analyzeVersionUpgrade', () => {
    it('should combine registry and dynamic changes', async () => {
      const registryChange: BreakingChangesRegistry.BreakingChange = {
        nodeType: 'nodes-base.httpRequest',
        fromVersion: '1.0',
        toVersion: '2.0',
        propertyName: 'registryProp',
        changeType: 'removed',
        isBreaking: true,
        migrationHint: 'From registry',
        autoMigratable: true,
        severity: 'HIGH',
        migrationStrategy: { type: 'remove_property' }
      };

      vi.spyOn(BreakingChangesRegistry, 'getAllChangesForNode').mockReturnValue([registryChange]);

      const v1 = createMockVersionData('1.0', [createMockProperty('dynamicProp')]);
      const v2 = createMockVersionData('2.0', []);

      vi.spyOn(mockRepository, 'getNodeVersion')
        .mockReturnValueOnce(v1)
        .mockReturnValueOnce(v2);

      const result = await detector.analyzeVersionUpgrade('nodes-base.httpRequest', '1.0', '2.0');

      expect(result.changes.length).toBeGreaterThan(0);
      expect(result.changes.some(c => c.source === 'registry')).toBe(true);
      expect(result.changes.some(c => c.source === 'dynamic')).toBe(true);
    });

    it('should detect breaking changes', async () => {
      const breakingChange: BreakingChangesRegistry.BreakingChange = {
        nodeType: 'nodes-base.httpRequest',
        fromVersion: '1.0',
        toVersion: '2.0',
        propertyName: 'criticalProp',
        changeType: 'removed',
        isBreaking: true,
        migrationHint: 'This is breaking',
        autoMigratable: false,
        severity: 'HIGH',
        migrationStrategy: undefined
      };

      vi.spyOn(BreakingChangesRegistry, 'getAllChangesForNode').mockReturnValue([breakingChange]);
      vi.spyOn(mockRepository, 'getNodeVersion').mockReturnValue(null);

      const result = await detector.analyzeVersionUpgrade('nodes-base.httpRequest', '1.0', '2.0');

      expect(result.hasBreakingChanges).toBe(true);
    });

    it('should calculate auto-migratable and manual counts', async () => {
      const changes: BreakingChangesRegistry.BreakingChange[] = [
        {
          nodeType: 'nodes-base.httpRequest',
          fromVersion: '1.0',
          toVersion: '2.0',
          propertyName: 'autoProp',
          changeType: 'added',
          isBreaking: false,
          migrationHint: 'Auto',
          autoMigratable: true,
          severity: 'LOW',
          migrationStrategy: { type: 'add_property', defaultValue: null }
        },
        {
          nodeType: 'nodes-base.httpRequest',
          fromVersion: '1.0',
          toVersion: '2.0',
          propertyName: 'manualProp',
          changeType: 'requirement_changed',
          isBreaking: true,
          migrationHint: 'Manual',
          autoMigratable: false,
          severity: 'HIGH',
          migrationStrategy: undefined
        }
      ];

      vi.spyOn(BreakingChangesRegistry, 'getAllChangesForNode').mockReturnValue(changes);
      vi.spyOn(mockRepository, 'getNodeVersion').mockReturnValue(null);

      const result = await detector.analyzeVersionUpgrade('nodes-base.httpRequest', '1.0', '2.0');

      expect(result.autoMigratableCount).toBe(1);
      expect(result.manualRequiredCount).toBe(1);
    });

    it('should determine overall severity', async () => {
      const highSeverityChange: BreakingChangesRegistry.BreakingChange = {
        nodeType: 'nodes-base.httpRequest',
        fromVersion: '1.0',
        toVersion: '2.0',
        propertyName: 'criticalProp',
        changeType: 'removed',
        isBreaking: true,
        migrationHint: 'Critical',
        autoMigratable: false,
        severity: 'HIGH',
        migrationStrategy: undefined
      };

      vi.spyOn(BreakingChangesRegistry, 'getAllChangesForNode').mockReturnValue([highSeverityChange]);
      vi.spyOn(mockRepository, 'getNodeVersion').mockReturnValue(null);

      const result = await detector.analyzeVersionUpgrade('nodes-base.httpRequest', '1.0', '2.0');

      expect(result.overallSeverity).toBe('HIGH');
    });

    it('should generate recommendations', async () => {
      const changes: BreakingChangesRegistry.BreakingChange[] = [
        {
          nodeType: 'nodes-base.httpRequest',
          fromVersion: '1.0',
          toVersion: '2.0',
          propertyName: 'prop1',
          changeType: 'removed',
          isBreaking: true,
          migrationHint: 'Remove this',
          autoMigratable: true,
          severity: 'MEDIUM',
          migrationStrategy: { type: 'remove_property' }
        },
        {
          nodeType: 'nodes-base.httpRequest',
          fromVersion: '1.0',
          toVersion: '2.0',
          propertyName: 'prop2',
          changeType: 'requirement_changed',
          isBreaking: true,
          migrationHint: 'Manual work needed',
          autoMigratable: false,
          severity: 'HIGH',
          migrationStrategy: undefined
        }
      ];

      vi.spyOn(BreakingChangesRegistry, 'getAllChangesForNode').mockReturnValue(changes);
      vi.spyOn(mockRepository, 'getNodeVersion').mockReturnValue(null);

      const result = await detector.analyzeVersionUpgrade('nodes-base.httpRequest', '1.0', '2.0');

      expect(result.recommendations.length).toBeGreaterThan(0);
      expect(result.recommendations.some(r => r.includes('breaking change'))).toBe(true);
      expect(result.recommendations.some(r => r.includes('automatically migrated'))).toBe(true);
      expect(result.recommendations.some(r => r.includes('manual intervention'))).toBe(true);
    });
  });

  describe('dynamic change detection', () => {
    it('should detect added properties', async () => {
      vi.spyOn(BreakingChangesRegistry, 'getAllChangesForNode').mockReturnValue([]);

      const v1 = createMockVersionData('1.0', []);
      const v2 = createMockVersionData('2.0', [createMockProperty('newProp')]);

      vi.spyOn(mockRepository, 'getNodeVersion')
        .mockReturnValueOnce(v1)
        .mockReturnValueOnce(v2);

      const result = await detector.analyzeVersionUpgrade('nodes-base.httpRequest', '1.0', '2.0');

      const addedChange = result.changes.find(c => c.changeType === 'added');
      expect(addedChange).toBeDefined();
      expect(addedChange?.propertyName).toBe('parameters.newProp');
      expect(addedChange?.source).toBe('dynamic');
    });

    it('should mark required added properties as breaking', async () => {
      vi.spyOn(BreakingChangesRegistry, 'getAllChangesForNode').mockReturnValue([]);

      const v1 = createMockVersionData('1.0', []);
      const v2 = createMockVersionData('2.0', [createMockProperty('requiredProp', 'string', true)]);

      vi.spyOn(mockRepository, 'getNodeVersion')
        .mockReturnValueOnce(v1)
        .mockReturnValueOnce(v2);

      const result = await detector.analyzeVersionUpgrade('nodes-base.httpRequest', '1.0', '2.0');

      const addedChange = result.changes.find(c => c.changeType === 'added');
      expect(addedChange?.isBreaking).toBe(true);
      expect(addedChange?.severity).toBe('HIGH');
      expect(addedChange?.autoMigratable).toBe(false);
    });

    it('should mark optional added properties as non-breaking', async () => {
      vi.spyOn(BreakingChangesRegistry, 'getAllChangesForNode').mockReturnValue([]);

      const v1 = createMockVersionData('1.0', []);
      const v2 = createMockVersionData('2.0', [createMockProperty('optionalProp', 'string', false)]);

      vi.spyOn(mockRepository, 'getNodeVersion')
        .mockReturnValueOnce(v1)
        .mockReturnValueOnce(v2);

      const result = await detector.analyzeVersionUpgrade('nodes-base.httpRequest', '1.0', '2.0');

      const addedChange = result.changes.find(c => c.changeType === 'added');
      expect(addedChange?.isBreaking).toBe(false);
      expect(addedChange?.severity).toBe('LOW');
      expect(addedChange?.autoMigratable).toBe(true);
    });

    it('should detect removed properties', async () => {
      vi.spyOn(BreakingChangesRegistry, 'getAllChangesForNode').mockReturnValue([]);

      const v1 = createMockVersionData('1.0', [createMockProperty('oldProp')]);
      const v2 = createMockVersionData('2.0', []);

      vi.spyOn(mockRepository, 'getNodeVersion')
        .mockReturnValueOnce(v1)
        .mockReturnValueOnce(v2);

      const result = await detector.analyzeVersionUpgrade('nodes-base.httpRequest', '1.0', '2.0');

      const removedChange = result.changes.find(c => c.changeType === 'removed');
      expect(removedChange).toBeDefined();
      expect(removedChange?.propertyName).toBe('parameters.oldProp');
      expect(removedChange?.isBreaking).toBe(true);
      // Schema diffs cannot tell a removal from a rename, so nothing is deleted automatically
      expect(removedChange?.autoMigratable).toBe(false);
    });

    it('should detect requirement changes', async () => {
      vi.spyOn(BreakingChangesRegistry, 'getAllChangesForNode').mockReturnValue([]);

      const v1 = createMockVersionData('1.0', [createMockProperty('prop', 'string', false)]);
      const v2 = createMockVersionData('2.0', [createMockProperty('prop', 'string', true)]);

      vi.spyOn(mockRepository, 'getNodeVersion')
        .mockReturnValueOnce(v1)
        .mockReturnValueOnce(v2);

      const result = await detector.analyzeVersionUpgrade('nodes-base.httpRequest', '1.0', '2.0');

      const requirementChange = result.changes.find(c => c.changeType === 'requirement_changed');
      expect(requirementChange).toBeDefined();
      expect(requirementChange?.isBreaking).toBe(true);
      expect(requirementChange?.oldValue).toBe('optional');
      expect(requirementChange?.newValue).toBe('required');
    });

    it('should detect when property becomes optional', async () => {
      vi.spyOn(BreakingChangesRegistry, 'getAllChangesForNode').mockReturnValue([]);

      const v1 = createMockVersionData('1.0', [createMockProperty('prop', 'string', true)]);
      const v2 = createMockVersionData('2.0', [createMockProperty('prop', 'string', false)]);

      vi.spyOn(mockRepository, 'getNodeVersion')
        .mockReturnValueOnce(v1)
        .mockReturnValueOnce(v2);

      const result = await detector.analyzeVersionUpgrade('nodes-base.httpRequest', '1.0', '2.0');

      const requirementChange = result.changes.find(c => c.changeType === 'requirement_changed');
      expect(requirementChange).toBeDefined();
      expect(requirementChange?.isBreaking).toBe(false);
      expect(requirementChange?.severity).toBe('LOW');
    });

    it('should handle missing version data gracefully', async () => {
      vi.spyOn(BreakingChangesRegistry, 'getAllChangesForNode').mockReturnValue([]);
      vi.spyOn(mockRepository, 'getNodeVersion').mockReturnValue(null);

      const result = await detector.analyzeVersionUpgrade('nodes-base.httpRequest', '1.0', '2.0');

      expect(result.changes.filter(c => c.source === 'dynamic')).toHaveLength(0);
    });

    it('should handle missing properties schema', async () => {
      vi.spyOn(BreakingChangesRegistry, 'getAllChangesForNode').mockReturnValue([]);

      const v1 = { ...createMockVersionData('1.0'), propertiesSchema: null };
      const v2 = { ...createMockVersionData('2.0'), propertiesSchema: null };

      vi.spyOn(mockRepository, 'getNodeVersion')
        .mockReturnValueOnce(v1 as any)
        .mockReturnValueOnce(v2 as any);

      const result = await detector.analyzeVersionUpgrade('nodes-base.httpRequest', '1.0', '2.0');

      expect(result.changes.filter(c => c.source === 'dynamic')).toHaveLength(0);
    });
  });

  describe('change merging and deduplication', () => {
    it('should prioritize registry changes over dynamic', async () => {
      const registryChange: BreakingChangesRegistry.BreakingChange = {
        nodeType: 'nodes-base.httpRequest',
        fromVersion: '1.0',
        toVersion: '2.0',
        propertyName: 'sharedProp',
        changeType: 'removed',
        isBreaking: true,
        migrationHint: 'From registry',
        autoMigratable: true,
        severity: 'HIGH',
        migrationStrategy: { type: 'remove_property' }
      };

      vi.spyOn(BreakingChangesRegistry, 'getAllChangesForNode').mockReturnValue([registryChange]);

      const v1 = createMockVersionData('1.0', [createMockProperty('sharedProp')]);
      const v2 = createMockVersionData('2.0', []);

      vi.spyOn(mockRepository, 'getNodeVersion')
        .mockReturnValueOnce(v1)
        .mockReturnValueOnce(v2);

      const result = await detector.analyzeVersionUpgrade('nodes-base.httpRequest', '1.0', '2.0');

      const sharedChanges = result.changes.filter(c => c.propertyName === 'sharedProp');
      expect(sharedChanges).toHaveLength(1);
      expect(sharedChanges[0].source).toBe('registry');
    });

    it('should sort changes by severity', async () => {
      const changes: BreakingChangesRegistry.BreakingChange[] = [
        {
          nodeType: 'nodes-base.httpRequest',
          fromVersion: '1.0',
          toVersion: '2.0',
          propertyName: 'lowProp',
          changeType: 'added',
          isBreaking: false,
          migrationHint: 'Low',
          autoMigratable: true,
          severity: 'LOW',
          migrationStrategy: { type: 'add_property', defaultValue: null }
        },
        {
          nodeType: 'nodes-base.httpRequest',
          fromVersion: '1.0',
          toVersion: '2.0',
          propertyName: 'highProp',
          changeType: 'removed',
          isBreaking: true,
          migrationHint: 'High',
          autoMigratable: false,
          severity: 'HIGH',
          migrationStrategy: undefined
        },
        {
          nodeType: 'nodes-base.httpRequest',
          fromVersion: '1.0',
          toVersion: '2.0',
          propertyName: 'medProp',
          changeType: 'renamed',
          isBreaking: true,
          migrationHint: 'Medium',
          autoMigratable: true,
          severity: 'MEDIUM',
          migrationStrategy: { type: 'rename_property', sourceProperty: 'old', targetProperty: 'new' }
        }
      ];

      vi.spyOn(BreakingChangesRegistry, 'getAllChangesForNode').mockReturnValue(changes);
      vi.spyOn(mockRepository, 'getNodeVersion').mockReturnValue(null);

      const result = await detector.analyzeVersionUpgrade('nodes-base.httpRequest', '1.0', '2.0');

      expect(result.changes[0].severity).toBe('HIGH');
      expect(result.changes[result.changes.length - 1].severity).toBe('LOW');
    });
  });

  describe('hasBreakingChanges', () => {
    it('should return true when breaking changes exist', () => {
      const breakingChange: BreakingChangesRegistry.BreakingChange = {
        nodeType: 'nodes-base.httpRequest',
        fromVersion: '1.0',
        toVersion: '2.0',
        propertyName: 'prop',
        changeType: 'removed',
        isBreaking: true,
        migrationHint: 'Breaking',
        autoMigratable: false,
        severity: 'HIGH',
        migrationStrategy: undefined
      };

      vi.spyOn(BreakingChangesRegistry, 'getBreakingChangesForNode').mockReturnValue([breakingChange]);

      const result = detector.hasBreakingChanges('nodes-base.httpRequest', '1.0', '2.0');

      expect(result).toBe(true);
    });

    it('should return false when no breaking changes', () => {
      vi.spyOn(BreakingChangesRegistry, 'getBreakingChangesForNode').mockReturnValue([]);

      const result = detector.hasBreakingChanges('nodes-base.httpRequest', '1.0', '2.0');

      expect(result).toBe(false);
    });
  });

  describe('getChangedProperties', () => {
    it('should return list of changed property names', () => {
      const changes: BreakingChangesRegistry.BreakingChange[] = [
        {
          nodeType: 'nodes-base.httpRequest',
          fromVersion: '1.0',
          toVersion: '2.0',
          propertyName: 'prop1',
          changeType: 'added',
          isBreaking: false,
          migrationHint: '',
          autoMigratable: true,
          severity: 'LOW',
          migrationStrategy: undefined
        },
        {
          nodeType: 'nodes-base.httpRequest',
          fromVersion: '1.0',
          toVersion: '2.0',
          propertyName: 'prop2',
          changeType: 'removed',
          isBreaking: true,
          migrationHint: '',
          autoMigratable: true,
          severity: 'MEDIUM',
          migrationStrategy: undefined
        }
      ];

      vi.spyOn(BreakingChangesRegistry, 'getAllChangesForNode').mockReturnValue(changes);

      const result = detector.getChangedProperties('nodes-base.httpRequest', '1.0', '2.0');

      expect(result).toEqual(['prop1', 'prop2']);
    });

    it('should return empty array when no changes', () => {
      vi.spyOn(BreakingChangesRegistry, 'getAllChangesForNode').mockReturnValue([]);

      const result = detector.getChangedProperties('nodes-base.httpRequest', '1.0', '2.0');

      expect(result).toEqual([]);
    });
  });

  describe('recommendations generation', () => {
    it('should recommend safe upgrade when no breaking changes', async () => {
      const changes: BreakingChangesRegistry.BreakingChange[] = [
        {
          nodeType: 'nodes-base.httpRequest',
          fromVersion: '1.0',
          toVersion: '2.0',
          propertyName: 'prop',
          changeType: 'added',
          isBreaking: false,
          migrationHint: 'Safe',
          autoMigratable: true,
          severity: 'LOW',
          migrationStrategy: { type: 'add_property', defaultValue: null }
        }
      ];

      vi.spyOn(BreakingChangesRegistry, 'getAllChangesForNode').mockReturnValue(changes);
      vi.spyOn(mockRepository, 'getNodeVersion').mockReturnValue(null);

      const result = await detector.analyzeVersionUpgrade('nodes-base.httpRequest', '1.0', '2.0');

      expect(result.recommendations.some(r => r.includes('No breaking changes'))).toBe(true);
      expect(result.recommendations.some(r => r.includes('safe'))).toBe(true);
    });

    it('should warn about breaking changes', async () => {
      const changes: BreakingChangesRegistry.BreakingChange[] = [
        {
          nodeType: 'nodes-base.httpRequest',
          fromVersion: '1.0',
          toVersion: '2.0',
          propertyName: 'prop',
          changeType: 'removed',
          isBreaking: true,
          migrationHint: 'Breaking',
          autoMigratable: false,
          severity: 'HIGH',
          migrationStrategy: undefined
        }
      ];

      vi.spyOn(BreakingChangesRegistry, 'getAllChangesForNode').mockReturnValue(changes);
      vi.spyOn(mockRepository, 'getNodeVersion').mockReturnValue(null);

      const result = await detector.analyzeVersionUpgrade('nodes-base.httpRequest', '1.0', '2.0');

      expect(result.recommendations.some(r => r.includes('breaking change'))).toBe(true);
    });

    it('should list manual changes required', async () => {
      const changes: BreakingChangesRegistry.BreakingChange[] = [
        {
          nodeType: 'nodes-base.httpRequest',
          fromVersion: '1.0',
          toVersion: '2.0',
          propertyName: 'manualProp',
          changeType: 'requirement_changed',
          isBreaking: true,
          migrationHint: 'Manually configure this',
          autoMigratable: false,
          severity: 'HIGH',
          migrationStrategy: undefined
        }
      ];

      vi.spyOn(BreakingChangesRegistry, 'getAllChangesForNode').mockReturnValue(changes);
      vi.spyOn(mockRepository, 'getNodeVersion').mockReturnValue(null);

      const result = await detector.analyzeVersionUpgrade('nodes-base.httpRequest', '1.0', '2.0');

      expect(result.recommendations.some(r => r.includes('manual intervention'))).toBe(true);
      expect(result.recommendations.some(r => r.includes('manualProp'))).toBe(true);
    });
  });

  describe('nested properties', () => {
    it('should flatten nested properties for comparison', async () => {
      vi.spyOn(BreakingChangesRegistry, 'getAllChangesForNode').mockReturnValue([]);

      const nestedProp = {
        name: 'parent',
        displayName: 'Parent',
        type: 'options',
        options: [
          createMockProperty('child1'),
          createMockProperty('child2')
        ]
      };

      const v1 = createMockVersionData('1.0', [nestedProp]);
      const v2 = createMockVersionData('2.0', []);

      vi.spyOn(mockRepository, 'getNodeVersion')
        .mockReturnValueOnce(v1)
        .mockReturnValueOnce(v2);

      const result = await detector.analyzeVersionUpgrade('nodes-base.httpRequest', '1.0', '2.0');

      // Should detect removal of parent and nested properties
      expect(result.changes.some(c => c.propertyName.includes('parent'))).toBe(true);
    });
  });

  describe('overall severity calculation', () => {
    it('should return HIGH when any change is HIGH severity', async () => {
      const changes: BreakingChangesRegistry.BreakingChange[] = [
        {
          nodeType: 'nodes-base.httpRequest',
          fromVersion: '1.0',
          toVersion: '2.0',
          propertyName: 'lowProp',
          changeType: 'added',
          isBreaking: false,
          migrationHint: '',
          autoMigratable: true,
          severity: 'LOW',
          migrationStrategy: undefined
        },
        {
          nodeType: 'nodes-base.httpRequest',
          fromVersion: '1.0',
          toVersion: '2.0',
          propertyName: 'highProp',
          changeType: 'removed',
          isBreaking: true,
          migrationHint: '',
          autoMigratable: false,
          severity: 'HIGH',
          migrationStrategy: undefined
        }
      ];

      vi.spyOn(BreakingChangesRegistry, 'getAllChangesForNode').mockReturnValue(changes);
      vi.spyOn(mockRepository, 'getNodeVersion').mockReturnValue(null);

      const result = await detector.analyzeVersionUpgrade('nodes-base.httpRequest', '1.0', '2.0');

      expect(result.overallSeverity).toBe('HIGH');
    });

    it('should return MEDIUM when no HIGH but has MEDIUM', async () => {
      const changes: BreakingChangesRegistry.BreakingChange[] = [
        {
          nodeType: 'nodes-base.httpRequest',
          fromVersion: '1.0',
          toVersion: '2.0',
          propertyName: 'lowProp',
          changeType: 'added',
          isBreaking: false,
          migrationHint: '',
          autoMigratable: true,
          severity: 'LOW',
          migrationStrategy: undefined
        },
        {
          nodeType: 'nodes-base.httpRequest',
          fromVersion: '1.0',
          toVersion: '2.0',
          propertyName: 'medProp',
          changeType: 'renamed',
          isBreaking: true,
          migrationHint: '',
          autoMigratable: true,
          severity: 'MEDIUM',
          migrationStrategy: undefined
        }
      ];

      vi.spyOn(BreakingChangesRegistry, 'getAllChangesForNode').mockReturnValue(changes);
      vi.spyOn(mockRepository, 'getNodeVersion').mockReturnValue(null);

      const result = await detector.analyzeVersionUpgrade('nodes-base.httpRequest', '1.0', '2.0');

      expect(result.overallSeverity).toBe('MEDIUM');
    });

    it('should return LOW when all changes are LOW severity', async () => {
      const changes: BreakingChangesRegistry.BreakingChange[] = [
        {
          nodeType: 'nodes-base.httpRequest',
          fromVersion: '1.0',
          toVersion: '2.0',
          propertyName: 'prop',
          changeType: 'added',
          isBreaking: false,
          migrationHint: '',
          autoMigratable: true,
          severity: 'LOW',
          migrationStrategy: undefined
        }
      ];

      vi.spyOn(BreakingChangesRegistry, 'getAllChangesForNode').mockReturnValue(changes);
      vi.spyOn(mockRepository, 'getNodeVersion').mockReturnValue(null);

      const result = await detector.analyzeVersionUpgrade('nodes-base.httpRequest', '1.0', '2.0');

      expect(result.overallSeverity).toBe('LOW');
    });
  });
});
