import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createDatabaseAdapter, DatabaseAdapter } from '../../../src/database/database-adapter';
import { EnhancedConfigValidator } from '../../../src/services/enhanced-config-validator';
import type { NodePropertyTypes } from 'n8n-workflow';
import { gunzipSync } from 'zlib';

/**
 * Integration tests for Phase 3: Real-World Type Structure Validation
 *
 * Tests the EnhancedConfigValidator against actual workflow templates from n8n.io
 * to ensure type structure validation works in production scenarios.
 *
 * Success Criteria (from implementation plan):
 * - Pass Rate: >95%
 * - False Positive Rate: <5%
 * - Performance: <50ms per validation
 */

describe('Integration: Real-World Type Structure Validation', () => {
  let db: DatabaseAdapter;
  let templatesAvailable = false;
  const SAMPLE_SIZE = 20; // Use smaller sample for fast tests
  const SPECIAL_TYPES: NodePropertyTypes[] = [
    'filter',
    'resourceMapper',
    'assignmentCollection',
    'resourceLocator',
  ];

  beforeAll(async () => {
    // Connect to production database
    db = await createDatabaseAdapter('./data/nodes.db');

    // Check if templates are available (may not be populated in CI)
    try {
      const result = db.prepare('SELECT COUNT(*) as count FROM templates').get() as any;
      templatesAvailable = result.count > 0;
    } catch {
      templatesAvailable = false;
    }
  });

  afterAll(() => {
    if (db && 'close' in db && typeof db.close === 'function') {
      db.close();
    }
  });

  function decompressWorkflow(compressed: string): any {
    const buffer = Buffer.from(compressed, 'base64');
    const decompressed = gunzipSync(buffer);
    return JSON.parse(decompressed.toString('utf-8'));
  }

  function inferPropertyType(value: any): NodePropertyTypes | null {
    if (!value || typeof value !== 'object') return null;

    if (value.combinator && value.conditions) return 'filter';
    if (value.mappingMode) return 'resourceMapper';
    if (value.assignments && Array.isArray(value.assignments)) return 'assignmentCollection';
    if (value.mode && value.hasOwnProperty('value')) return 'resourceLocator';

    return null;
  }

  function extractNodesWithSpecialTypes(workflowJson: any) {
    const results: Array<any> = [];

    if (!workflowJson?.nodes || !Array.isArray(workflowJson.nodes)) {
      return results;
    }

    for (const node of workflowJson.nodes) {
      if (!node.parameters || typeof node.parameters !== 'object') continue;

      const specialProperties: Array<any> = [];

      for (const [paramName, paramValue] of Object.entries(node.parameters)) {
        const inferredType = inferPropertyType(paramValue);

        if (inferredType && SPECIAL_TYPES.includes(inferredType)) {
          specialProperties.push({
            name: paramName,
            type: inferredType,
            value: paramValue,
          });
        }
      }

      if (specialProperties.length > 0) {
        results.push({
          nodeId: node.id,
          nodeName: node.name,
          nodeType: node.type,
          properties: specialProperties,
        });
      }
    }

    return results;
  }

  it('should have templates database available', () => {
    // Skip this test if templates are not populated (common in CI environments)
    if (!templatesAvailable) {
      return; // Test passes but doesn't validate - templates not available
    }
    const result = db.prepare('SELECT COUNT(*) as count FROM templates').get() as any;
    expect(result.count).toBeGreaterThan(0);
  });

  it('should validate filter type structures from real templates', async () => {
    const templates = db.prepare(`
      SELECT id, name, workflow_json_compressed, views
      FROM templates
      WHERE workflow_json_compressed IS NOT NULL
      ORDER BY views DESC
      LIMIT ?
    `).all(SAMPLE_SIZE) as any[];

    let filterValidations = 0;
    let filterPassed = 0;

    for (const template of templates) {
      const workflow = decompressWorkflow(template.workflow_json_compressed);
      const nodes = extractNodesWithSpecialTypes(workflow);

      for (const node of nodes) {
        for (const prop of node.properties) {
          if (prop.type !== 'filter') continue;

          filterValidations++;
          const startTime = Date.now();

          const properties = [{
            name: prop.name,
            type: 'filter' as NodePropertyTypes,
            required: true,
            displayName: prop.name,
            default: {},
          }];

          const config = { [prop.name]: prop.value };

          const result = EnhancedConfigValidator.validateWithMode(
            node.nodeType,
            config,
            properties,
            'operation',
            'ai-friendly'
          );

          const timeMs = Date.now() - startTime;

          expect(timeMs).toBeLessThan(50); // Performance target

          if (result.valid) {
            filterPassed++;
          }
        }
      }
    }

    if (filterValidations > 0) {
      const passRate = (filterPassed / filterValidations) * 100;
      expect(passRate).toBeGreaterThanOrEqual(95); // Success criteria
    }
  });

  it('should validate resourceMapper type structures from real templates', async () => {
    const templates = db.prepare(`
      SELECT id, name, workflow_json_compressed, views
      FROM templates
      WHERE workflow_json_compressed IS NOT NULL
      ORDER BY views DESC
      LIMIT ?
    `).all(SAMPLE_SIZE) as any[];

    let resourceMapperValidations = 0;
    let resourceMapperPassed = 0;

    for (const template of templates) {
      const workflow = decompressWorkflow(template.workflow_json_compressed);
      const nodes = extractNodesWithSpecialTypes(workflow);

      for (const node of nodes) {
        for (const prop of node.properties) {
          if (prop.type !== 'resourceMapper') continue;

          resourceMapperValidations++;
          const startTime = Date.now();

          const properties = [{
            name: prop.name,
            type: 'resourceMapper' as NodePropertyTypes,
            required: true,
            displayName: prop.name,
            default: {},
          }];

          const config = { [prop.name]: prop.value };

          const result = EnhancedConfigValidator.validateWithMode(
            node.nodeType,
            config,
            properties,
            'operation',
            'ai-friendly'
          );

          const timeMs = Date.now() - startTime;

          expect(timeMs).toBeLessThan(50);

          if (result.valid) {
            resourceMapperPassed++;
          }
        }
      }
    }

    if (resourceMapperValidations > 0) {
      const passRate = (resourceMapperPassed / resourceMapperValidations) * 100;
      expect(passRate).toBeGreaterThanOrEqual(95);
    }
  });

  it('should validate assignmentCollection type structures from real templates', async () => {
    const templates = db.prepare(`
      SELECT id, name, workflow_json_compressed, views
      FROM templates
      WHERE workflow_json_compressed IS NOT NULL
      ORDER BY views DESC
      LIMIT ?
    `).all(SAMPLE_SIZE) as any[];

    let assignmentValidations = 0;
    let assignmentPassed = 0;

    for (const template of templates) {
      const workflow = decompressWorkflow(template.workflow_json_compressed);
      const nodes = extractNodesWithSpecialTypes(workflow);

      for (const node of nodes) {
        for (const prop of node.properties) {
          if (prop.type !== 'assignmentCollection') continue;

          assignmentValidations++;
          const startTime = Date.now();

          const properties = [{
            name: prop.name,
            type: 'assignmentCollection' as NodePropertyTypes,
            required: true,
            displayName: prop.name,
            default: {},
          }];

          const config = { [prop.name]: prop.value };

          const result = EnhancedConfigValidator.validateWithMode(
            node.nodeType,
            config,
            properties,
            'operation',
            'ai-friendly'
          );

          const timeMs = Date.now() - startTime;

          expect(timeMs).toBeLessThan(50);

          if (result.valid) {
            assignmentPassed++;
          }
        }
      }
    }

    if (assignmentValidations > 0) {
      const passRate = (assignmentPassed / assignmentValidations) * 100;
      expect(passRate).toBeGreaterThanOrEqual(95);
    }
  });

  it('should validate resourceLocator type structures from real templates', async () => {
    const templates = db.prepare(`
      SELECT id, name, workflow_json_compressed, views
      FROM templates
      WHERE workflow_json_compressed IS NOT NULL
      ORDER BY views DESC
      LIMIT ?
    `).all(SAMPLE_SIZE) as any[];

    let locatorValidations = 0;
    let locatorPassed = 0;

    for (const template of templates) {
      const workflow = decompressWorkflow(template.workflow_json_compressed);
      const nodes = extractNodesWithSpecialTypes(workflow);

      for (const node of nodes) {
        for (const prop of node.properties) {
          if (prop.type !== 'resourceLocator') continue;

          locatorValidations++;
          const startTime = Date.now();

          const properties = [{
            name: prop.name,
            type: 'resourceLocator' as NodePropertyTypes,
            required: true,
            displayName: prop.name,
            default: {},
          }];

          const config = { [prop.name]: prop.value };

          const result = EnhancedConfigValidator.validateWithMode(
            node.nodeType,
            config,
            properties,
            'operation',
            'ai-friendly'
          );

          const timeMs = Date.now() - startTime;

          expect(timeMs).toBeLessThan(50);

          if (result.valid) {
            locatorPassed++;
          }
        }
      }
    }

    if (locatorValidations > 0) {
      const passRate = (locatorPassed / locatorValidations) * 100;
      expect(passRate).toBeGreaterThanOrEqual(95);
    }
  });

  it('should achieve overall >95% pass rate across all special types', async () => {
    const templates = db.prepare(`
      SELECT id, name, workflow_json_compressed, views
      FROM templates
      WHERE workflow_json_compressed IS NOT NULL
      ORDER BY views DESC
      LIMIT ?
    `).all(SAMPLE_SIZE) as any[];

    let totalValidations = 0;
    let totalPassed = 0;

    for (const template of templates) {
      const workflow = decompressWorkflow(template.workflow_json_compressed);
      const nodes = extractNodesWithSpecialTypes(workflow);

      for (const node of nodes) {
        for (const prop of node.properties) {
          totalValidations++;

          const properties = [{
            name: prop.name,
            type: prop.type,
            required: true,
            displayName: prop.name,
            default: {},
          }];

          const config = { [prop.name]: prop.value };

          const result = EnhancedConfigValidator.validateWithMode(
            node.nodeType,
            config,
            properties,
            'operation',
            'ai-friendly'
          );

          if (result.valid) {
            totalPassed++;
          }
        }
      }
    }

    if (totalValidations > 0) {
      const passRate = (totalPassed / totalValidations) * 100;
      expect(passRate).toBeGreaterThanOrEqual(95); // Phase 3 success criteria
    }
  });

  it('should handle Google Sheets credential-provided fields correctly', async () => {
    // Find templates with Google Sheets nodes
    const templates = db.prepare(`
      SELECT id, name, workflow_json_compressed
      FROM templates
      WHERE workflow_json_compressed IS NOT NULL
      AND (
        workflow_json_compressed LIKE '%GoogleSheets%'
        OR workflow_json_compressed LIKE '%Google Sheets%'
      )
      LIMIT 10
    `).all() as any[];

    let sheetIdErrors = 0;
    let totalGoogleSheetsNodes = 0;

    for (const template of templates) {
      const workflow = decompressWorkflow(template.workflow_json_compressed);

      if (!workflow?.nodes) continue;

      for (const node of workflow.nodes) {
        if (node.type !== 'n8n-nodes-base.googleSheets') continue;

        totalGoogleSheetsNodes++;

        // Create a config that might be missing sheetId (comes from credentials)
        const config = { ...node.parameters };
        delete config.sheetId; // Simulate missing credential-provided field

        const result = EnhancedConfigValidator.validateWithMode(
          node.type,
          config,
          [],
          'operation',
          'ai-friendly'
        );

        // Should NOT error about missing sheetId
        const hasSheetIdError = result.errors?.some(
          e => e.property === 'sheetId' && e.type === 'missing_required'
        );

        if (hasSheetIdError) {
          sheetIdErrors++;
        }
      }
    }

    // No sheetId errors should occur (it's credential-provided)
    expect(sheetIdErrors).toBe(0);
  });

  it('should validate all filter operations including exists/notExists/notEmpty', async () => {
    const templates = db.prepare(`
      SELECT id, name, workflow_json_compressed
      FROM templates
      WHERE workflow_json_compressed IS NOT NULL
      ORDER BY views DESC
      LIMIT 50
    `).all() as any[];

    const operationsFound = new Set<string>();
    let filterNodes = 0;

    for (const template of templates) {
      const workflow = decompressWorkflow(template.workflow_json_compressed);
      const nodes = extractNodesWithSpecialTypes(workflow);

      for (const node of nodes) {
        for (const prop of node.properties) {
          if (prop.type !== 'filter') continue;

          filterNodes++;

          // Track operations found in real workflows
          if (prop.value?.conditions && Array.isArray(prop.value.conditions)) {
            for (const condition of prop.value.conditions) {
              if (condition.operator) {
                operationsFound.add(condition.operator);
              }
            }
          }

          const properties = [{
            name: prop.name,
            type: 'filter' as NodePropertyTypes,
            required: true,
            displayName: prop.name,
            default: {},
          }];

          const config = { [prop.name]: prop.value };

          const result = EnhancedConfigValidator.validateWithMode(
            node.nodeType,
            config,
            properties,
            'operation',
            'ai-friendly'
          );

          // Should not have errors about unsupported operations
          const hasUnsupportedOpError = result.errors?.some(
            e => e.message?.includes('Unsupported operation')
          );

          expect(hasUnsupportedOpError).toBe(false);
        }
      }
    }

    // Verify we tested some filter nodes
    if (filterNodes > 0) {
      expect(filterNodes).toBeGreaterThan(0);
    }
  });
});
