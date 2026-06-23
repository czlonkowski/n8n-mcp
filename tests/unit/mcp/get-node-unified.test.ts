import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { N8NDocumentationMCPServer } from '../../../src/mcp/server';
import { TypeStructureService } from '../../../src/services/type-structure-service';

/**
 * Comprehensive unit tests for unified get_node tool (v2.24.0)
 * Tests all detail levels, version modes, parameter validation, and helper methods
 * Target: >80% coverage of get_node functionality
 */

describe('Unified get_node Tool', () => {
  let server: N8NDocumentationMCPServer;

  beforeEach(async () => {
    process.env.NODE_DB_PATH = ':memory:';
    server = new N8NDocumentationMCPServer();
    await (server as any).initialized;

    // Populate in-memory database with test nodes
    const testNodes = [
      {
        node_type: 'nodes-base.httpRequest',
        package_name: 'n8n-nodes-base',
        display_name: 'HTTP Request',
        description: 'Makes an HTTP request',
        category: 'Core Nodes',
        is_ai_tool: 1,
        is_trigger: 0,
        is_webhook: 0,
        is_versioned: 1,
        version: '4.2',
        properties_schema: JSON.stringify([
          {
            name: 'url',
            displayName: 'URL',
            type: 'string',
            required: true,
            default: ''
          },
          {
            name: 'method',
            displayName: 'Method',
            type: 'options',
            options: [
              { name: 'GET', value: 'GET' },
              { name: 'POST', value: 'POST' }
            ],
            default: 'GET'
          }
        ]),
        operations: JSON.stringify([])
      },
      {
        node_type: 'nodes-base.webhook',
        package_name: 'n8n-nodes-base',
        display_name: 'Webhook',
        description: 'Starts workflow on webhook call',
        category: 'Core Nodes',
        is_ai_tool: 0,
        is_trigger: 1,
        is_webhook: 1,
        is_versioned: 1,
        version: '2.0',
        properties_schema: JSON.stringify([
          {
            name: 'path',
            displayName: 'Path',
            type: 'string',
            required: true,
            default: ''
          }
        ]),
        operations: JSON.stringify([])
      },
      {
        node_type: 'nodes-langchain.agent',
        package_name: '@n8n/n8n-nodes-langchain',
        display_name: 'AI Agent',
        description: 'AI Agent node',
        category: 'AI',
        is_ai_tool: 1,
        is_trigger: 0,
        is_webhook: 0,
        is_versioned: 1,
        version: '1.0',
        properties_schema: JSON.stringify([]),
        operations: JSON.stringify([])
      }
    ];

    const db = (server as any).db;
    if (db) {
      const insertStmt = db.prepare(`
        INSERT INTO nodes (
          node_type, package_name, display_name, description, category,
          is_ai_tool, is_trigger, is_webhook, is_versioned, version,
          properties_schema, operations
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const node of testNodes) {
        insertStmt.run(
          node.node_type,
          node.package_name,
          node.display_name,
          node.description,
          node.category,
          node.is_ai_tool,
          node.is_trigger,
          node.is_webhook,
          node.is_versioned,
          node.version,
          node.properties_schema,
          node.operations
        );
      }

      // Add version history data for testing version modes
      const versionInsertStmt = db.prepare(`
        INSERT INTO node_versions (
          node_type, version, package_name, display_name, is_current_max, released_at,
          breaking_changes, deprecated_properties, added_properties
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      // HTTP Request versions
      versionInsertStmt.run(
        'nodes-base.httpRequest',
        '4.1',
        'n8n-nodes-base',
        'HTTP Request',
        0,
        '2023-01-01',
        JSON.stringify([]),
        JSON.stringify([]),
        JSON.stringify([])
      );
      versionInsertStmt.run(
        'nodes-base.httpRequest',
        '4.2',
        'n8n-nodes-base',
        'HTTP Request',
        1,
        '2023-06-01',
        JSON.stringify(['Changed authentication method']),
        JSON.stringify(['oldAuth']),
        JSON.stringify(['newAuth'])
      );

      // Add property change data for version comparison
      const changeInsertStmt = db.prepare(`
        INSERT INTO version_property_changes (
          node_type, from_version, to_version, property_name,
          change_type, is_breaking, old_value, new_value,
          migration_hint, auto_migratable, migration_strategy
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      changeInsertStmt.run(
        'nodes-base.httpRequest',
        '4.1',
        '4.2',
        'authentication',
        'type_changed',
        1,
        'basic',
        'oauth2',
        'Update authentication configuration',
        0,
        null
      );
      changeInsertStmt.run(
        'nodes-base.httpRequest',
        '4.1',
        '4.2',
        'timeout',
        'added',
        0,
        null,
        '30000',
        null,
        1,
        'default_value'
      );
    }
  });

  afterEach(() => {
    delete process.env.NODE_DB_PATH;
  });

  describe('Parameter Validation', () => {
    it('should throw error for invalid detail level', async () => {
      await expect(
        (server as any).getNode('nodes-base.httpRequest', 'invalid', 'info')
      ).rejects.toThrow('Invalid detail level "invalid"');
    });

    it('should throw error for invalid mode', async () => {
      await expect(
        (server as any).getNode('nodes-base.httpRequest', 'standard', 'invalid')
      ).rejects.toThrow('Invalid mode "invalid"');
    });

    it('should accept all valid detail levels', async () => {
      await expect(
        (server as any).getNode('nodes-base.httpRequest', 'minimal', 'info')
      ).resolves.toBeDefined();

      await expect(
        (server as any).getNode('nodes-base.httpRequest', 'standard', 'info')
      ).resolves.toBeDefined();

      await expect(
        (server as any).getNode('nodes-base.httpRequest', 'full', 'info')
      ).resolves.toBeDefined();
    });

    it('should accept all valid modes', async () => {
      const validModes = ['info', 'versions', 'compare', 'breaking', 'migrations'];

      for (const mode of validModes) {
        if (mode === 'info') {
          await expect(
            (server as any).getNode('nodes-base.httpRequest', 'standard', mode)
          ).resolves.toBeDefined();
        } else if (mode === 'versions') {
          await expect(
            (server as any).getNode('nodes-base.httpRequest', 'standard', mode)
          ).resolves.toBeDefined();
        }
      }
    });

    it('should use default values for optional parameters', async () => {
      const result = await (server as any).getNode('nodes-base.httpRequest');

      expect(result).toBeDefined();
      expect(result.versionInfo).toBeDefined(); // standard mode includes version info
    });

    it('should normalize node type before processing', async () => {
      // Test short form
      const result1 = await (server as any).getNode('httpRequest', 'minimal', 'info');
      expect(result1.nodeType).toBe('nodes-base.httpRequest');

      // Test full form
      const result2 = await (server as any).getNode('n8n-nodes-base.httpRequest', 'minimal', 'info');
      expect(result2.nodeType).toBe('nodes-base.httpRequest');

      // Test with langchain package
      const result3 = await (server as any).getNode('agent', 'minimal', 'info');
      expect(result3.nodeType).toBe('nodes-langchain.agent');
    });
  });

  describe('Info Mode - minimal detail', () => {
    it('should return only basic metadata for minimal detail', async () => {
      const result = await (server as any).getNode('nodes-base.httpRequest', 'minimal', 'info');

      expect(result).toHaveProperty('nodeType');
      expect(result).toHaveProperty('workflowNodeType');
      expect(result).toHaveProperty('displayName');
      expect(result).toHaveProperty('description');
      expect(result).toHaveProperty('category');
      expect(result).toHaveProperty('package');
      expect(result).toHaveProperty('isAITool');
      expect(result).toHaveProperty('isTrigger');
      expect(result).toHaveProperty('isWebhook');
    });

    it('should not include version info in minimal detail', async () => {
      const result = await (server as any).getNode('nodes-base.httpRequest', 'minimal', 'info');

      expect(result).not.toHaveProperty('versionInfo');
      expect(result).not.toHaveProperty('properties');
      expect(result).not.toHaveProperty('requiredProperties');
      expect(result).not.toHaveProperty('commonProperties');
    });

    it('should return correct node metadata values', async () => {
      const result = await (server as any).getNode('nodes-base.httpRequest', 'minimal', 'info');

      expect(result.nodeType).toBe('nodes-base.httpRequest');
      expect(result.displayName).toBe('HTTP Request');
      expect(result.description).toBe('Makes an HTTP request');
      expect(result.category).toBe('Core Nodes');
      expect(result.package).toBe('n8n-nodes-base');
      expect(result.isAITool).toBe(true);
      expect(result.isTrigger).toBe(false);
      expect(result.isWebhook).toBe(false);
    });

    it('should return correct workflow node type', async () => {
      const result = await (server as any).getNode('nodes-base.httpRequest', 'minimal', 'info');

      expect(result.workflowNodeType).toBe('n8n-nodes-base.httpRequest');
    });

    it('should handle webhook node correctly', async () => {
      const result = await (server as any).getNode('nodes-base.webhook', 'minimal', 'info');

      expect(result.isTrigger).toBe(true);
      expect(result.isWebhook).toBe(true);
    });

    it('should handle langchain nodes correctly', async () => {
      const result = await (server as any).getNode('nodes-langchain.agent', 'minimal', 'info');

      expect(result.nodeType).toBe('nodes-langchain.agent');
      expect(result.workflowNodeType).toBe('@n8n/n8n-nodes-langchain.agent');
      expect(result.package).toBe('@n8n/n8n-nodes-langchain');
    });

    it('should throw error for non-existent node', async () => {
      await expect(
        (server as any).getNode('nodes-base.nonexistent', 'minimal', 'info')
      ).rejects.toThrow('Node nodes-base.nonexistent not found');
    });

    it('should try alternative forms if node not found', async () => {
      // This tests the fallback logic in handleInfoMode for minimal detail
      const result = await (server as any).getNode('httpRequest', 'minimal', 'info');
      expect(result.nodeType).toBe('nodes-base.httpRequest');
    });
  });

  describe('Info Mode - standard detail', () => {
    it('should return essentials with version info for standard detail', async () => {
      const result = await (server as any).getNode('nodes-base.httpRequest', 'standard', 'info');

      expect(result).toHaveProperty('nodeType');
      expect(result).toHaveProperty('displayName');
      expect(result).toHaveProperty('description');
      expect(result).toHaveProperty('category');
      expect(result).toHaveProperty('requiredProperties');
      expect(result).toHaveProperty('commonProperties');
      expect(result).toHaveProperty('versionInfo');
    });

    it('should include version summary in standard detail', async () => {
      const result = await (server as any).getNode('nodes-base.httpRequest', 'standard', 'info');

      expect(result.versionInfo).toBeDefined();
      expect(result.versionInfo).toHaveProperty('currentVersion');
      expect(result.versionInfo).toHaveProperty('totalVersions');
      expect(result.versionInfo).toHaveProperty('hasVersionHistory');
    });

    it('should not include examples by default in standard detail', async () => {
      const result = await (server as any).getNode('nodes-base.httpRequest', 'standard', 'info');

      expect(result.examples).toBeUndefined();
    });

    it('should include examples when includeExamples is true', async () => {
      const result = await (server as any).getNode(
        'nodes-base.httpRequest',
        'standard',
        'info',
        false,
        true
      );

      // Examples will be empty array if no templates, but property should exist
      expect(result).toHaveProperty('examples');
    });

    it('should not include type info by default', async () => {
      const result = await (server as any).getNode('nodes-base.httpRequest', 'standard', 'info');

      if (result.requiredProperties && result.requiredProperties.length > 0) {
        expect(result.requiredProperties[0]).not.toHaveProperty('typeInfo');
      }
      if (result.commonProperties && result.commonProperties.length > 0) {
        expect(result.commonProperties[0]).not.toHaveProperty('typeInfo');
      }
    });

    it('should include type info when includeTypeInfo is true', async () => {
      const result = await (server as any).getNode(
        'nodes-base.httpRequest',
        'standard',
        'info',
        true,
        false
      );

      // Check if type info is added to properties
      const hasTypeInfo =
        (result.requiredProperties?.some((p: any) => p.typeInfo)) ||
        (result.commonProperties?.some((p: any) => p.typeInfo));

      // Type info should be added if properties have type field
      if (result.requiredProperties?.length > 0 || result.commonProperties?.length > 0) {
        expect(hasTypeInfo).toBe(true);
      }
    });

    it('should include both type info and examples when both parameters are true', async () => {
      const result = await (server as any).getNode(
        'nodes-base.httpRequest',
        'standard',
        'info',
        true,
        true
      );

      expect(result).toHaveProperty('examples');
      expect(result.versionInfo).toBeDefined();
    });
  });

  describe('Info Mode - full detail', () => {
    it('should return complete node info with version info for full detail', async () => {
      const result = await (server as any).getNode('nodes-base.httpRequest', 'full', 'info');

      expect(result).toHaveProperty('nodeType');
      expect(result).toHaveProperty('displayName');
      expect(result).toHaveProperty('description');
      expect(result).toHaveProperty('category');
      expect(result).toHaveProperty('properties');
      expect(result).toHaveProperty('versionInfo');
    });

    it('should include version summary in full detail', async () => {
      const result = await (server as any).getNode('nodes-base.httpRequest', 'full', 'info');

      expect(result.versionInfo).toBeDefined();
      expect(result.versionInfo).toHaveProperty('currentVersion');
      expect(result.versionInfo).toHaveProperty('totalVersions');
      expect(result.versionInfo).toHaveProperty('hasVersionHistory');
    });

    it('should include complete properties array', async () => {
      const result = await (server as any).getNode('nodes-base.httpRequest', 'full', 'info');

      expect(result.properties).toBeDefined();
      expect(Array.isArray(result.properties)).toBe(true);
    });

    it('should enrich properties with type info when includeTypeInfo is true', async () => {
      const result = await (server as any).getNode(
        'nodes-base.httpRequest',
        'full',
        'info',
        true
      );

      if (result.properties && result.properties.length > 0) {
        const hasTypeInfo = result.properties.some((p: any) => p.typeInfo);
        expect(hasTypeInfo).toBe(true);
      }
    });

    it('should not enrich properties with type info by default', async () => {
      const result = await (server as any).getNode('nodes-base.httpRequest', 'full', 'info');

      if (result.properties && result.properties.length > 0) {
        expect(result.properties[0]).not.toHaveProperty('typeInfo');
      }
    });

    it('should ignore includeExamples parameter in full detail', async () => {
      // includeExamples only applies to standard detail
      const result = await (server as any).getNode(
        'nodes-base.httpRequest',
        'full',
        'info',
        false,
        true
      );

      // Full detail returns complete properties, not examples
      expect(result).toHaveProperty('properties');
      expect(result).not.toHaveProperty('examples');
    });
  });

  describe('Version Mode - versions', () => {
    it('should return version history for versions mode', async () => {
      const result = await (server as any).getNode(
        'nodes-base.httpRequest',
        'standard',
        'versions'
      );

      expect(result).toHaveProperty('nodeType');
      expect(result).toHaveProperty('totalVersions');
      expect(result).toHaveProperty('versions');
      expect(result).toHaveProperty('available');
    });

    it('should include version details in version history', async () => {
      const result = await (server as any).getNode(
        'nodes-base.httpRequest',
        'standard',
        'versions'
      );

      expect(result.totalVersions).toBeGreaterThan(0);
      expect(Array.isArray(result.versions)).toBe(true);

      if (result.versions.length > 0) {
        const version = result.versions[0];
        expect(version).toHaveProperty('version');
        expect(version).toHaveProperty('isCurrent');
        expect(version).toHaveProperty('hasBreakingChanges');
        expect(version).toHaveProperty('breakingChangesCount');
        expect(version).toHaveProperty('deprecatedProperties');
        expect(version).toHaveProperty('addedProperties');
      }
    });

    it('should ignore detail level in versions mode', async () => {
      const resultMinimal = await (server as any).getNode(
        'nodes-base.httpRequest',
        'minimal',
        'versions'
      );
      const resultFull = await (server as any).getNode(
        'nodes-base.httpRequest',
        'full',
        'versions'
      );

      // Both should return same structure
      expect(resultMinimal).toEqual(resultFull);
    });

    it('should handle node with no version history', async () => {
      const result = await (server as any).getNode(
        'nodes-base.webhook',
        'standard',
        'versions'
      );

      // Webhook node has no version history in our test data
      expect(result.totalVersions).toBe(0);
      expect(result.available).toBe(false);
      // Unavailable shape surfaces the reason so callers can tell
      // "no data" apart from "no changes" (regression for QA #1/#12).
      expect(result.reason).toBeDefined();
      expect(result.reason).toMatch(/not populated/i);
    });
  });

  describe('Version Mode - compare', () => {
    it('should throw error if fromVersion is missing', async () => {
      await expect(
        (server as any).getNode('nodes-base.httpRequest', 'standard', 'compare')
      ).rejects.toThrow('fromVersion is required for compare mode');
    });

    it('should include nodeType in error message for missing fromVersion', async () => {
      await expect(
        (server as any).getNode('nodes-base.httpRequest', 'standard', 'compare')
      ).rejects.toThrow('nodeType: nodes-base.httpRequest');
    });

    it('should compare versions with fromVersion only', async () => {
      const result = await (server as any).getNode(
        'nodes-base.httpRequest',
        'standard',
        'compare',
        false,
        false,
        '4.1'
      );

      expect(result).toHaveProperty('nodeType');
      expect(result).toHaveProperty('fromVersion');
      expect(result).toHaveProperty('toVersion');
      expect(result).toHaveProperty('totalChanges');
      expect(result).toHaveProperty('breakingChanges');
      expect(result).toHaveProperty('changes');
    });

    it('should use latest version as toVersion by default', async () => {
      const result = await (server as any).getNode(
        'nodes-base.httpRequest',
        'standard',
        'compare',
        false,
        false,
        '4.1'
      );

      expect(result.toVersion).toBe('4.2');
    });

    it('should compare specific versions when toVersion is provided', async () => {
      const result = await (server as any).getNode(
        'nodes-base.httpRequest',
        'standard',
        'compare',
        false,
        false,
        '4.1',
        '4.2'
      );

      expect(result.fromVersion).toBe('4.1');
      expect(result.toVersion).toBe('4.2');
    });

    it('should return change details in compare mode', async () => {
      const result = await (server as any).getNode(
        'nodes-base.httpRequest',
        'standard',
        'compare',
        false,
        false,
        '4.1',
        '4.2'
      );

      expect(result.totalChanges).toBeGreaterThan(0);
      expect(Array.isArray(result.changes)).toBe(true);

      if (result.changes.length > 0) {
        const change = result.changes[0];
        expect(change).toHaveProperty('property');
        expect(change).toHaveProperty('changeType');
        expect(change).toHaveProperty('isBreaking');
        expect(change).toHaveProperty('severity');
      }
    });
  });

  describe('Version Mode - breaking', () => {
    it('should throw error if fromVersion is missing', async () => {
      await expect(
        (server as any).getNode('nodes-base.httpRequest', 'standard', 'breaking')
      ).rejects.toThrow('fromVersion is required for breaking mode');
    });

    it('should include nodeType in error message for missing fromVersion', async () => {
      await expect(
        (server as any).getNode('nodes-base.httpRequest', 'standard', 'breaking')
      ).rejects.toThrow('nodeType: nodes-base.httpRequest');
    });

    it('should return breaking changes only', async () => {
      const result = await (server as any).getNode(
        'nodes-base.httpRequest',
        'standard',
        'breaking',
        false,
        false,
        '4.1'
      );

      expect(result).toHaveProperty('nodeType');
      expect(result).toHaveProperty('fromVersion');
      expect(result).toHaveProperty('toVersion');
      expect(result).toHaveProperty('totalBreakingChanges');
      expect(result).toHaveProperty('changes');
      expect(result).toHaveProperty('upgradeSafe');
    });

    it('should mark upgradeSafe as false when breaking changes exist', async () => {
      const result = await (server as any).getNode(
        'nodes-base.httpRequest',
        'standard',
        'breaking',
        false,
        false,
        '4.1',
        '4.2'
      );

      if (result.totalBreakingChanges > 0) {
        expect(result.upgradeSafe).toBe(false);
      }
    });

    it('should include breaking change details', async () => {
      const result = await (server as any).getNode(
        'nodes-base.httpRequest',
        'standard',
        'breaking',
        false,
        false,
        '4.1',
        '4.2'
      );

      if (result.changes.length > 0) {
        const change = result.changes[0];
        expect(change).toHaveProperty('fromVersion');
        expect(change).toHaveProperty('toVersion');
        expect(change).toHaveProperty('property');
        expect(change).toHaveProperty('changeType');
        expect(change).toHaveProperty('severity');
      }
    });

    it('should use latest version when toVersion not specified', async () => {
      const result = await (server as any).getNode(
        'nodes-base.httpRequest',
        'standard',
        'breaking',
        false,
        false,
        '4.1'
      );

      expect(result.toVersion).toBe('latest');
    });
  });

  describe('Version Mode - migrations', () => {
    it('should throw error if fromVersion is missing', async () => {
      await expect(
        (server as any).getNode('nodes-base.httpRequest', 'standard', 'migrations')
      ).rejects.toThrow('Both fromVersion and toVersion are required');
    });

    it('should throw error if toVersion is missing', async () => {
      await expect(
        (server as any).getNode(
          'nodes-base.httpRequest',
          'standard',
          'migrations',
          false,
          false,
          '4.1'
        )
      ).rejects.toThrow('Both fromVersion and toVersion are required');
    });

    it('should include nodeType in error message for missing versions', async () => {
      await expect(
        (server as any).getNode('nodes-base.httpRequest', 'standard', 'migrations')
      ).rejects.toThrow('nodeType: nodes-base.httpRequest');
    });

    it('should return migration information', async () => {
      const result = await (server as any).getNode(
        'nodes-base.httpRequest',
        'standard',
        'migrations',
        false,
        false,
        '4.1',
        '4.2'
      );

      expect(result).toHaveProperty('nodeType');
      expect(result).toHaveProperty('fromVersion');
      expect(result).toHaveProperty('toVersion');
      expect(result).toHaveProperty('autoMigratableChanges');
      expect(result).toHaveProperty('totalChanges');
      expect(result).toHaveProperty('migrations');
      expect(result).toHaveProperty('requiresManualMigration');
    });

    it('should indicate if manual migration is required', async () => {
      const result = await (server as any).getNode(
        'nodes-base.httpRequest',
        'standard',
        'migrations',
        false,
        false,
        '4.1',
        '4.2'
      );

      expect(typeof result.requiresManualMigration).toBe('boolean');

      if (result.autoMigratableChanges < result.totalChanges) {
        expect(result.requiresManualMigration).toBe(true);
      }
    });

    it('should include migration details', async () => {
      const result = await (server as any).getNode(
        'nodes-base.httpRequest',
        'standard',
        'migrations',
        false,
        false,
        '4.1',
        '4.2'
      );

      expect(Array.isArray(result.migrations)).toBe(true);

      if (result.migrations.length > 0) {
        const migration = result.migrations[0];
        expect(migration).toHaveProperty('property');
        expect(migration).toHaveProperty('changeType');
        expect(migration).toHaveProperty('migrationStrategy');
        expect(migration).toHaveProperty('severity');
      }
    });
  });

  describe('Helper Method - enrichPropertyWithTypeInfo', () => {
    it('should return property unchanged if null or undefined', () => {
      const result1 = (server as any).enrichPropertyWithTypeInfo(null);
      const result2 = (server as any).enrichPropertyWithTypeInfo(undefined);

      expect(result1).toBeNull();
      expect(result2).toBeUndefined();
    });

    it('should return property unchanged if no type field', () => {
      const property = { name: 'test', displayName: 'Test' };
      const result = (server as any).enrichPropertyWithTypeInfo(property);

      expect(result).toEqual(property);
      expect(result).not.toHaveProperty('typeInfo');
    });

    it('should return property unchanged if type structure not found', () => {
      const property = { name: 'test', type: 'unknownType' };
      const result = (server as any).enrichPropertyWithTypeInfo(property);

      expect(result).toEqual(property);
      expect(result).not.toHaveProperty('typeInfo');
    });

    it('should add typeInfo for known primitive types', () => {
      const property = { name: 'test', type: 'string' };
      const result = (server as any).enrichPropertyWithTypeInfo(property);

      expect(result).toHaveProperty('typeInfo');
      expect(result.typeInfo).toHaveProperty('category');
      expect(result.typeInfo).toHaveProperty('jsType');
      expect(result.typeInfo).toHaveProperty('description');
      expect(result.typeInfo).toHaveProperty('isComplex');
      expect(result.typeInfo).toHaveProperty('isPrimitive');
      expect(result.typeInfo).toHaveProperty('allowsExpressions');
      expect(result.typeInfo).toHaveProperty('allowsEmpty');
    });

    it('should add typeInfo for complex types', () => {
      const property = { name: 'test', type: 'collection' };
      const result = (server as any).enrichPropertyWithTypeInfo(property);

      expect(result).toHaveProperty('typeInfo');
      expect(result.typeInfo.isComplex).toBe(true);
    });

    it('should include structure hints for structured types', () => {
      const property = { name: 'test', type: 'json' };
      const result = (server as any).enrichPropertyWithTypeInfo(property);

      if (result.typeInfo) {
        // json type may have structure information
        const structure = TypeStructureService.getStructure('json');
        if (structure?.structure) {
          expect(result.typeInfo).toHaveProperty('structureHints');
          expect(result.typeInfo.structureHints).toHaveProperty('hasProperties');
          expect(result.typeInfo.structureHints).toHaveProperty('hasItems');
          expect(result.typeInfo.structureHints).toHaveProperty('isFlexible');
          expect(result.typeInfo.structureHints).toHaveProperty('requiredFields');
        }
      }
    });

    it('should include notes if available', () => {
      // Find a type with notes
      const property = { name: 'test', type: 'resourceMapper' };
      const result = (server as any).enrichPropertyWithTypeInfo(property);

      const structure = TypeStructureService.getStructure('resourceMapper');
      if (structure?.notes) {
        expect(result.typeInfo).toHaveProperty('notes');
      }
    });

    it('should preserve original property fields', () => {
      const property = {
        name: 'test',
        displayName: 'Test Property',
        type: 'string',
        required: true,
        default: 'default value'
      };
      const result = (server as any).enrichPropertyWithTypeInfo(property);

      expect(result.name).toBe(property.name);
      expect(result.displayName).toBe(property.displayName);
      expect(result.type).toBe(property.type);
      expect(result.required).toBe(property.required);
      expect(result.default).toBe(property.default);
    });
  });

  describe('Helper Method - enrichPropertiesWithTypeInfo', () => {
    it('should return properties unchanged if null or undefined', () => {
      const result1 = (server as any).enrichPropertiesWithTypeInfo(null);
      const result2 = (server as any).enrichPropertiesWithTypeInfo(undefined);

      expect(result1).toBeNull();
      expect(result2).toBeUndefined();
    });

    it('should return properties unchanged if not an array', () => {
      const notArray = { name: 'test' };
      const result = (server as any).enrichPropertiesWithTypeInfo(notArray);

      expect(result).toEqual(notArray);
    });

    it('should enrich all properties in array', () => {
      const properties = [
        { name: 'prop1', type: 'string' },
        { name: 'prop2', type: 'number' },
        { name: 'prop3', type: 'boolean' }
      ];
      const result = (server as any).enrichPropertiesWithTypeInfo(properties);

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(3);

      result.forEach((prop: any) => {
        expect(prop).toHaveProperty('typeInfo');
      });
    });

    it('should handle empty array', () => {
      const result = (server as any).enrichPropertiesWithTypeInfo([]);

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(0);
    });

    it('should handle array with mix of valid and invalid properties', () => {
      const properties = [
        { name: 'prop1', type: 'string' },
        { name: 'prop2' }, // no type
        { name: 'prop3', type: 'unknownType' }
      ];
      const result = (server as any).enrichPropertiesWithTypeInfo(properties);

      expect(result.length).toBe(3);
      expect(result[0]).toHaveProperty('typeInfo');
      expect(result[1]).not.toHaveProperty('typeInfo');
      expect(result[2]).not.toHaveProperty('typeInfo');
    });
  });

  describe('Helper Method - getVersionSummary', () => {
    it('should return version summary for node with versions', () => {
      const summary = (server as any).getVersionSummary('nodes-base.httpRequest');

      expect(summary).toHaveProperty('currentVersion');
      expect(summary).toHaveProperty('totalVersions');
      expect(summary).toHaveProperty('hasVersionHistory');
    });

    it('should cache version summary for performance', () => {
      const cache = (server as any).cache;
      const cacheGetSpy = vi.spyOn(cache, 'get');
      const cacheSetSpy = vi.spyOn(cache, 'set');

      // First call - should miss cache and set it
      const summary1 = (server as any).getVersionSummary('nodes-base.httpRequest');
      expect(cacheSetSpy).toHaveBeenCalled();

      // Second call - should hit cache
      const summary2 = (server as any).getVersionSummary('nodes-base.httpRequest');

      expect(summary1).toEqual(summary2);
    });

    it('should use cache key with node type', () => {
      const cache = (server as any).cache;
      const cacheGetSpy = vi.spyOn(cache, 'get');

      (server as any).getVersionSummary('nodes-base.httpRequest');

      expect(cacheGetSpy).toHaveBeenCalledWith('version-summary:nodes-base.httpRequest');
    });

    it('should cache for 24 hours', () => {
      const cache = (server as any).cache;
      const cacheSetSpy = vi.spyOn(cache, 'set');

      (server as any).getVersionSummary('nodes-base.httpRequest');

      expect(cacheSetSpy).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Object),
        86400000 // 24 hours in milliseconds
      );
    });

    it('should return unknown version if no version data available', () => {
      const summary = (server as any).getVersionSummary('nodes-base.webhook');

      expect(summary.currentVersion).toBeDefined();
      expect(summary.totalVersions).toBeDefined();
      expect(summary.hasVersionHistory).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    it('should throw error when repository not initialized', async () => {
      const uninitializedServer = new N8NDocumentationMCPServer();

      // Don't wait for initialization
      // Force repository to null
      (uninitializedServer as any).repository = null;

      await expect(
        (uninitializedServer as any).getNode('nodes-base.httpRequest', 'minimal', 'info')
      ).rejects.toThrow();
    });

    it('should include context in version mode errors', async () => {
      try {
        await (server as any).getNode(
          'nodes-base.httpRequest',
          'standard',
          'compare'
        );
        expect.fail('Should have thrown error');
      } catch (error: any) {
        expect(error.message).toContain('nodeType: nodes-base.httpRequest');
      }
    });

    it('should handle invalid version mode gracefully', async () => {
      await expect(
        (server as any).getNode(
          'nodes-base.httpRequest',
          'standard',
          'invalidmode'
        )
      ).rejects.toThrow();
    });
  });

  describe('Integration - Mode Routing', () => {
    it('should route to handleInfoMode when mode is info', async () => {
      const handleInfoModeSpy = vi.spyOn(server as any, 'handleInfoMode');

      await (server as any).getNode('nodes-base.httpRequest', 'standard', 'info');

      expect(handleInfoModeSpy).toHaveBeenCalled();
    });

    it('should route to handleVersionMode when mode is not info', async () => {
      const handleVersionModeSpy = vi.spyOn(server as any, 'handleVersionMode');

      await (server as any).getNode('nodes-base.httpRequest', 'standard', 'versions');

      expect(handleVersionModeSpy).toHaveBeenCalled();
    });

    it('should normalize node type before routing', async () => {
      const result = await (server as any).getNode('httpRequest', 'minimal', 'info');

      expect(result.nodeType).toBe('nodes-base.httpRequest');
    });
  });

  describe('Caching Behavior', () => {
    it('should use different cache keys for different includeExamples values', async () => {
      const cache = (server as any).cache;
      const cacheGetSpy = vi.spyOn(cache, 'get');

      await (server as any).getNode('nodes-base.httpRequest', 'standard', 'info', false, false);
      await (server as any).getNode('nodes-base.httpRequest', 'standard', 'info', false, true);

      // Should check cache with different keys
      expect(cacheGetSpy).toHaveBeenCalledWith(expect.stringContaining('basic'));
      expect(cacheGetSpy).toHaveBeenCalledWith(expect.stringContaining('withExamples'));
    });

    it('should cache version summary across multiple calls', async () => {
      const cache = (server as any).cache;
      const cacheSetSpy = vi.spyOn(cache, 'set');

      // First call
      await (server as any).getNode('nodes-base.httpRequest', 'standard', 'info');
      const setCallCount = cacheSetSpy.mock.calls.length;

      // Second call - should use cached version summary
      await (server as any).getNode('nodes-base.httpRequest', 'standard', 'info');

      // Set should not be called again for version summary
      expect(cacheSetSpy.mock.calls.length).toBe(setCallCount);
    });
  });

  describe('Edge Cases', () => {
    it('should handle node with no properties gracefully', async () => {
      const result = await (server as any).getNode('nodes-langchain.agent', 'full', 'info');

      expect(result).toBeDefined();
      expect(result.properties).toBeDefined();
    });

    it('should handle empty version history gracefully', async () => {
      const result = await (server as any).getNode('nodes-base.webhook', 'standard', 'info');

      // Webhook node has no version history in our test data
      expect(result.versionInfo).toBeDefined();
      expect(result.versionInfo.totalVersions).toBe(0);
    });

    it('should handle very long node type names', async () => {
      // This should still normalize correctly even if input is unusual
      const result = await (server as any).getNode(
        'n8n-nodes-base.httpRequest',
        'minimal',
        'info'
      );

      expect(result.nodeType).toBe('nodes-base.httpRequest');
    });
  });

  describe('Type Safety', () => {
    it('should return NodeMinimalInfo type for minimal detail', async () => {
      const result = await (server as any).getNode('nodes-base.httpRequest', 'minimal', 'info');

      // Check type structure
      expect(result).toHaveProperty('nodeType');
      expect(result).toHaveProperty('workflowNodeType');
      expect(result).toHaveProperty('displayName');
      expect(result).toHaveProperty('description');
      expect(result).toHaveProperty('category');
      expect(result).toHaveProperty('package');
      expect(result).toHaveProperty('isAITool');
      expect(result).toHaveProperty('isTrigger');
      expect(result).toHaveProperty('isWebhook');

      // Should not have standard or full info properties
      expect(result).not.toHaveProperty('versionInfo');
      expect(result).not.toHaveProperty('properties');
      expect(result).not.toHaveProperty('requiredProperties');
    });

    it('should return NodeStandardInfo type for standard detail', async () => {
      const result = await (server as any).getNode('nodes-base.httpRequest', 'standard', 'info');

      // Check type structure
      expect(result).toHaveProperty('nodeType');
      expect(result).toHaveProperty('displayName');
      expect(result).toHaveProperty('description');
      expect(result).toHaveProperty('category');
      expect(result).toHaveProperty('requiredProperties');
      expect(result).toHaveProperty('commonProperties');
      expect(result).toHaveProperty('versionInfo');
    });

    it('should return NodeFullInfo type for full detail', async () => {
      const result = await (server as any).getNode('nodes-base.httpRequest', 'full', 'info');

      // Check type structure
      expect(result).toHaveProperty('nodeType');
      expect(result).toHaveProperty('displayName');
      expect(result).toHaveProperty('description');
      expect(result).toHaveProperty('category');
      expect(result).toHaveProperty('properties');
      expect(result).toHaveProperty('versionInfo');
    });
  });
});
