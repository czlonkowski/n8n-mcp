import { describe, it, expect } from 'vitest';
import { parseSchemaProperties } from '../../../scripts/check-settings-drift';

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
