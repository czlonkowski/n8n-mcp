import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { describe, it, expect } from 'vitest';
import {
  diffSettingsProperties,
  parseEntitySettingsProperties,
  parseSchemaProperties,
} from '../../../scripts/check-settings-drift';
import { WORKFLOW_SETTINGS_PROPERTIES } from '../../../src/constants/workflow-settings';

/**
 * The drift check reads n8n's OpenAPI schema with a small hand-rolled parser rather than a YAML
 * dependency. The failure that matters is not a parse error - it is a parse that quietly yields
 * nothing, because "no properties found" and "no drift" would look identical, and the check
 * exists precisely to stop settings drifting unnoticed. Every malformed input must throw.
 */
describe('check-settings-drift parseSchemaProperties', () => {
  const schema = (body: string) => `openapi: 3.0.0\ncomponents:\n  schemas:\n${body}`;

  it('reads the property names of the workflowSettings schema', () => {
    const yaml = schema(
      [
        '    workflowSettings:',
        '      type: object',
        '      additionalProperties: false',
        '      properties:',
        '        executionOrder:',
        '          type: string',
        '        callerPolicy:',
        '          type: string',
        '          enum: [any, none]',
        '        customTelemetryTags:',
        '          type: array',
        '          items:',
        '            type: object',
        '            properties:',
        '              key:',
        '                type: string',
        '    otherSchema:',
        '      type: object',
      ].join('\n')
    );

    // Nested keys (items.properties.key) and the following schema must not leak in
    expect([...parseSchemaProperties(yaml)]).toEqual([
      'executionOrder',
      'callerPolicy',
      'customTelemetryTags',
    ]);
  });

  it('measures indentation rather than assuming it', () => {
    const yaml = [
      'components:',
      '    schemas:',
      '        workflowSettings:',
      '            properties:',
      '                timezone:',
      '                    type: string',
    ].join('\n');

    expect([...parseSchemaProperties(yaml)]).toEqual(['timezone']);
  });

  it('throws when n8n renames the schema', () => {
    const yaml = schema('    workflowConfig:\n      properties:\n        timezone:\n');
    expect(() => parseSchemaProperties(yaml)).toThrow(/workflowSettings/);
  });

  it('throws when the schema has no properties block', () => {
    const yaml = schema('    workflowSettings:\n      type: object\n');
    expect(() => parseSchemaProperties(yaml)).toThrow(/no properties block/);
  });

  it('throws rather than reporting an empty property set', () => {
    const yaml = schema('    workflowSettings:\n      properties:\n    otherSchema:\n      type: object\n');
    expect(() => parseSchemaProperties(yaml)).toThrow(/zero properties/);
  });

  it('throws on a response that is not the schema at all', () => {
    expect(() => parseSchemaProperties('')).toThrow();
    expect(() => parseSchemaProperties('<!doctype html><html>404</html>')).toThrow();
  });
});

/**
 * The entity parser reads IWorkflowSettings out of n8n-workflow's type declarations. It exists
 * because the schema-only diff is blind to properties n8n persists but never published to the
 * Public API schema - engineType broke every workflow update that way (issue #1043). Same
 * contract as the schema parser: malformed input must throw, never yield an empty set.
 */
describe('check-settings-drift parseEntitySettingsProperties', () => {
  it('reads the property names of the IWorkflowSettings interface', () => {
    const dts = [
      'export interface ISomethingElse {',
      '    unrelated?: string;',
      '}',
      'export interface IWorkflowSettings {',
      "    timezone?: 'DEFAULT' | string;",
      "    engineType?: 'v1' | 'v2';",
      '    customTelemetryTags?: ICustomTelemetryTag[];',
      '}',
      'export interface WorkflowFEMeta {',
      '    onboardingId?: string;',
      '}',
    ].join('\n');

    expect([...parseEntitySettingsProperties(dts)]).toEqual([
      'timezone',
      'engineType',
      'customTelemetryTags',
    ]);
  });

  it('registers a nested object property without leaking its members', () => {
    const dts = [
      'export interface IWorkflowSettings {',
      '    executionTimeout?: number;',
      '    someNested?: {',
      '        inner?: string;',
      '    };',
      '}',
    ].join('\n');

    expect([...parseEntitySettingsProperties(dts)]).toEqual(['executionTimeout', 'someNested']);
  });

  it('throws when n8n renames the interface', () => {
    const dts = 'export interface IWorkflowConfig {\n    timezone?: string;\n}';
    expect(() => parseEntitySettingsProperties(dts)).toThrow(/IWorkflowSettings/);
  });

  it('throws rather than reporting an empty property set', () => {
    const dts = 'export interface IWorkflowSettings {\n}';
    expect(() => parseEntitySettingsProperties(dts)).toThrow(/zero properties/);
  });

  it('throws when the interface extends a base type instead of missing inherited properties', () => {
    const dts = [
      'export interface IWorkflowSettings extends IBaseSettings {',
      '    timezone?: string;',
      '}',
    ].join('\n');
    expect(() => parseEntitySettingsProperties(dts)).toThrow(/extends/);
  });

  it('merges split declarations instead of reading only the first block', () => {
    const dts = [
      'export interface IWorkflowSettings {',
      '    timezone?: string;',
      '}',
      'export interface IWorkflowSettings {',
      '    engineType?: string;',
      '}',
    ].join('\n');
    expect([...parseEntitySettingsProperties(dts)]).toEqual(['timezone', 'engineType']);
  });

  it('does not mistake a comment mentioning the interface for its declaration', () => {
    const dts = [
      '// The shape of interface IWorkflowSettings mirrors the schema',
      'export interface IWorkflowSettings {',
      '    timezone?: string;',
      '}',
    ].join('\n');
    expect([...parseEntitySettingsProperties(dts)]).toEqual(['timezone']);
  });

  it('ignores a declaration-shaped line inside a block comment', () => {
    const dts = [
      '/*',
      'export interface IWorkflowSettings {',
      '    ghost?: string;',
      '}',
      '*/',
      'export interface IWorkflowSettings {',
      '    timezone?: string;',
      '}',
    ].join('\n');
    expect([...parseEntitySettingsProperties(dts)]).toEqual(['timezone']);
  });

  it('is not derailed by an unbalanced brace inside a block comment', () => {
    const dts = [
      'export interface IWorkflowSettings {',
      '    /* weird note: { */',
      '    timezone?: string;',
      '}',
    ].join('\n');
    expect([...parseEntitySettingsProperties(dts)]).toEqual(['timezone']);
  });

  it('reads a property that shares the opening-brace line instead of skipping it', () => {
    const dts = 'export interface IWorkflowSettings { engineType?: string;\n    timezone?: string;\n}';
    expect([...parseEntitySettingsProperties(dts)]).toEqual(['engineType', 'timezone']);
  });

  it('is not derailed by braces inside line comments or string literal types', () => {
    const dts = [
      'export interface IWorkflowSettings {',
      '    first?: string; // }',
      "    second?: '{';",
      '    third?: string;',
      '}',
    ].join('\n');
    expect([...parseEntitySettingsProperties(dts)]).toEqual(['first', 'second', 'third']);
  });

  it('throws on a truncated file instead of returning the partial property set', () => {
    const dts = 'export interface IWorkflowSettings {\n    timezone?: string;';
    expect(() => parseEntitySettingsProperties(dts)).toThrow(/parse cleanly/);
  });

  it('does not accept a same-named interface nested in a namespace as the target', () => {
    const dts = [
      'export namespace Other {',
      '    export interface IWorkflowSettings {',
      '        ghost?: string;',
      '    }',
      '}',
      'export interface IWorkflowSettings {',
      '    timezone?: string;',
      '}',
    ].join('\n');
    expect([...parseEntitySettingsProperties(dts)]).toEqual(['timezone']);
  });

  it('throws on a member it cannot enumerate rather than skipping it', () => {
    const dts = [
      'export interface IWorkflowSettings {',
      '    timezone?: string;',
      '    [key: string]: unknown;',
      '}',
    ].join('\n');
    expect(() => parseEntitySettingsProperties(dts)).toThrow(/cannot enumerate/);
  });

  it('parses the installed n8n-workflow declarations, which must cover our derived properties', () => {
    // Runs against the real package so a reformat of its .d.ts fails here instead of making
    // the drift check throw (or worse, quietly agree) during the next n8n update.
    const dts = readFileSync(
      join(dirname(require.resolve('n8n-workflow')), 'interfaces.d.ts'),
      'utf8'
    );

    const entityProperties = parseEntitySettingsProperties(dts);
    expect(entityProperties.has('executionOrder')).toBe(true);
    expect(entityProperties.has('engineType')).toBe(true);

    // Every property we strip as derived should still exist on the entity - one that vanished
    // from n8n entirely is a stale entry this table no longer needs.
    for (const [name, meta] of Object.entries(WORKFLOW_SETTINGS_PROPERTIES)) {
      if (meta.derived) {
        expect(entityProperties.has(name), `${name} is marked derived but not on the entity`).toBe(true);
      }
    }

    // The reverse: every entity property must be in our table. "On the entity but unknown to us"
    // is the engineType signature (#1043) - a property GET echoes into our read-modify-write that
    // no strip or filter knows about. The full drift check only runs inside `npm run update:n8n`;
    // this offline approximation makes the same class fail in CI on any n8n-workflow bump.
    for (const name of entityProperties) {
      expect(
        name in WORKFLOW_SETTINGS_PROPERTIES,
        `entity settings property ${name} is missing from WORKFLOW_SETTINGS_PROPERTIES`
      ).toBe(true);
    }
  });
});

/**
 * The gate itself: which bucket each property lands in decides whether the check fails, so the
 * classification is tested directly against the real table rather than only via parsers.
 */
describe('check-settings-drift diffSettingsProperties', () => {
  const v236 = { major: 2, minor: 36, patch: 4 };
  // The published schema of n8n 2.36 as the table models it: everything except derived-only keys
  const schemaOf236 = new Set(
    Object.entries(WORKFLOW_SETTINGS_PROPERTIES)
      .filter(([, meta]) => !meta.entityOnly)
      .map(([name]) => name)
  );
  const entityOf236 = new Set([...schemaOf236, 'engineType']);

  it('reports no drift for a consistent pinned set', () => {
    const drift = diffSettingsProperties(schemaOf236, entityOf236, v236);

    expect(drift.missing).toEqual([]);
    expect(drift.removed).toEqual([]);
    expect(drift.unhandledEntityOnly).toEqual([]);
    expect(drift.publishedEntityOnly).toEqual([]);
    expect(drift.entityOnly).toEqual(['engineType']);
  });

  it('flags an entity property the schema rejects and the table does not strip', () => {
    const entity = new Set([...entityOf236, 'someNewInternalSetting']);
    const drift = diffSettingsProperties(schemaOf236, entity, v236);

    expect(drift.unhandledEntityOnly).toEqual(['someNewInternalSetting']);
  });

  it('still flags an entity-only property marked derived without entityOnly (detector must stay armed)', () => {
    // binaryMode is derived but not entityOnly. If the schema stopped naming it while the
    // entity kept it, derived alone must not count as handled - without entityOnly the
    // published-upstream detector would never fire for it.
    const schema = new Set(schemaOf236);
    schema.delete('binaryMode');
    const drift = diffSettingsProperties(schema, entityOf236, v236);

    expect(drift.unhandledEntityOnly).toEqual(['binaryMode']);
    // And it is not simultaneously soft-reported as expected or stale
    expect(drift.entityOnly).toEqual(['engineType']);
    expect(drift.removed).toEqual([]);
  });

  it('flags a stripped entity-only property once n8n publishes it to the schema', () => {
    const schema = new Set([...schemaOf236, 'engineType']);
    const drift = diffSettingsProperties(schema, entityOf236, v236);

    expect(drift.publishedEntityOnly).toEqual(['engineType']);
    expect(drift.unhandledEntityOnly).toEqual([]);
    expect(drift.entityOnly).toEqual([]);
  });

  it('flags a new schema property missing from the table', () => {
    const schema = new Set([...schemaOf236, 'brandNewSetting']);
    const drift = diffSettingsProperties(schema, entityOf236, v236);

    expect(drift.missing).toEqual(['brandNewSetting']);
  });

  it('splits table properties the schema lacks into removed vs ahead by the target version', () => {
    const schema = new Set(schemaOf236);
    schema.delete('timezone'); // since 0.0.0 - claiming this version has it makes its absence drift
    schema.delete('redactionPolicy'); // since 2.26.0 - ahead of a 2.20 target, expected
    const entity = new Set([...schema, 'engineType']);
    const drift = diffSettingsProperties(schema, entity, { major: 2, minor: 20, patch: 0 });

    expect(drift.removed).toEqual(['timezone']);
    expect(drift.ahead).toEqual(['redactionPolicy']);
  });

  it('treats a derived property gone from the entity as well as stale, not entity-only', () => {
    const entity = new Set(schemaOf236); // no engineType anywhere any more
    const drift = diffSettingsProperties(schemaOf236, entity, v236);

    expect(drift.entityOnly).toEqual([]);
    expect(drift.removed).toContain('engineType');
  });

  it('assumes derived properties are entity-only when no entity set is available', () => {
    const drift = diffSettingsProperties(schemaOf236, null, v236);

    expect(drift.entityOnly).toEqual(['engineType']);
    expect(drift.unhandledEntityOnly).toEqual([]);
    expect(drift.removed).toEqual([]);
  });

  it('classifies a derived property from a later n8n as ahead, not entity-only, without an entity set', () => {
    // For a 2.20 target, engineType (since 2.36) cannot be on the entity yet - calling it
    // "entity-only, expected" would be misleading; it is simply ahead of the pin.
    const drift = diffSettingsProperties(schemaOf236, null, { major: 2, minor: 20, patch: 0 });

    expect(drift.ahead).toContain('engineType');
    expect(drift.entityOnly).toEqual([]);
  });
});
