import { describe, it, expect } from 'vitest';
import { EnhancedConfigValidator } from '@/services/enhanced-config-validator';
import { NodeSpecificValidators } from '@/services/node-specific-validators';
import { MCPEngine } from '@/mcp-tools-engine';

/**
 * These run the real validation chain (base ConfigValidator +
 * NodeSpecificValidators), which is what validate_node executes. The sibling
 * enhanced-config-validator.test.ts mocks NodeSpecificValidators, so the two
 * layers can only be checked for agreement here.
 */
describe('EnhancedConfigValidator - native Python Code node', () => {
  const codeProperties = [
    { name: 'language', type: 'options', options: [{ value: 'javaScript' }, { value: 'pythonNative' }] },
    { name: 'mode', type: 'options', options: [{ value: 'runOnceForAllItems' }, { value: 'runOnceForEachItem' }] },
    { name: 'pythonCode', type: 'string' },
    { name: 'jsCode', type: 'string' }
  ];

  const validate = (config: Record<string, any>) =>
    EnhancedConfigValidator.validateWithMode(
      'nodes-base.code',
      config,
      codeProperties as any,
      'operation',
      'runtime'
    );

  it('should not report empty code for pythonNative (issue #1112)', () => {
    const result = validate({
      language: 'pythonNative',
      mode: 'runOnceForEachItem',
      pythonCode: 'row = _item["json"]\nreturn {"json": row}'
    });

    expect(result.errors.some(e => e.message === 'Code cannot be empty')).toBe(false);
    expect(result.errors.some(e => e.property === 'jsCode')).toBe(false);
    expect(result.valid).toBe(true);
  });

  it('should run Python-specific checks for pythonNative', () => {
    const result = validate({
      language: 'pythonNative',
      mode: 'runOnceForAllItems',
      pythonCode: 'rows = _input.all()\nreturn [{"json": {"count": len(rows)}}]'
    });

    expect(result.errors).toContainEqual(expect.objectContaining({
      property: 'pythonCode',
      message: '_input does not exist in native Python - it was removed with the Pyodide runtime'
    }));
  });

  it('should not report the same finding twice across both validation layers', () => {
    const result = validate({
      language: 'pythonNative',
      mode: 'runOnceForAllItems',
      pythonCode: [
        'import json',
        'rows = _input.all()',
        'total = sum(item.json["amount"] for item in rows)',
        'return [{"json": {"total": total}}]'
      ].join('\n')
    });

    const messages = [...result.errors, ...result.warnings].map(m => m.message);
    const duplicates = messages.filter((m, i) => messages.indexOf(m) !== i);

    expect(duplicates).toEqual([]);
    // The old duplicated pairs: base-layer import warning and eval/exec warning
    expect(messages.filter(m => m.includes('External libraries not available'))).toHaveLength(0);
    expect(messages.filter(m => m.includes('Return value must be a list'))).toHaveLength(0);
    expect(messages.filter(m => m.includes('Must return array of objects'))).toHaveLength(0);
  });

  it('should surface every native-Python rule at the node-specific layer', () => {
    const context = {
      config: {
        language: 'pythonNative',
        mode: 'runOnceForAllItems',
        pythonCode: [
          'import json',
          'rows = _input.all()',
          'total = sum(item.json["amount"] for item in rows)',
          'class Box:',
          '    pass',
          '',
          'return [{"json": {"total": total, "t": str(type(total))}}]'
        ].join('\n')
      },
      errors: [] as any[],
      warnings: [] as any[],
      suggestions: [] as string[],
      autofix: {}
    };

    NodeSpecificValidators.validateCode(context as any);

    const messages = [...context.errors, ...context.warnings].map((m: any) => m.message);
    const countOf = (needle: string) => messages.filter(m => m.includes(needle)).length;

    expect(countOf('_input does not exist')).toBe(1);
    expect(countOf('is blocked unless this instance allowlists')).toBe(1);
    expect(countOf('.json attribute access')).toBe(1);
    expect(countOf('__build_class__')).toBe(1);
    expect(countOf('type() is denied')).toBe(1);
    expect(countOf('eval/exec')).toBe(0);
  });

  it('should surface every rule through validateWithMode, not just one (issue #1113 snippet)', () => {
    const result = validate({
      language: 'pythonNative',
      mode: 'runOnceForAllItems',
      pythonCode: [
        'import json',
        'all_items = _input.all()',
        'total = sum(item.json.amount for item in all_items)',
        'class Box:',
        '    pass',
        'return [{"json": {"total": total, "at": str(_now), "t": str(type(total)), "q": _jmespath(all_items[0]["json"], "name")}}]'
      ].join('\n')
    });

    const messages = result.errors.map(e => e.message);
    expect(messages.length).toBeGreaterThanOrEqual(5);
    expect(messages).toContain('_input does not exist in native Python - it was removed with the Pyodide runtime');
    expect(messages).toContain('_now does not exist in native Python - it was removed with the Pyodide runtime');
    expect(messages).toContain('_jmespath does not exist in native Python - it was removed with the Pyodide runtime');
    expect(messages).toContain('Items are dicts: .json attribute access raises AttributeError');
    expect(messages).toContain('class definitions fail in the sandbox: __build_class__ not found');
    expect(messages).toContain('type() is denied in the Python sandbox and raises NameError');
  });

  it('should keep the blocked-import warning under the runtime profile', () => {
    const result = EnhancedConfigValidator.validateWithMode(
      'nodes-base.code',
      { language: 'pythonNative', mode: 'runOnceForAllItems', pythonCode: 'import json\nreturn [{"json": {"n": len(_items)}}]' },
      codeProperties as any,
      'operation',
      'runtime'
    );

    expect(result.warnings).toContainEqual(expect.objectContaining({
      type: 'security',
      message: 'import json is blocked unless this instance allowlists the module (n8n Cloud allows none)'
    }));
  });

  it('should skip mode-dependent rules when mode is an expression', () => {
    const result = validate({
      language: 'pythonNative',
      mode: '={{ $json.codeMode }}',
      pythonCode: 'return [{"json": _item["json"]}]'
    });

    const messages = result.errors.map(e => e.message);
    expect(messages.filter(m => m.includes('does not exist in "Run Once'))).toHaveLength(0);
    expect(messages.filter(m => m.includes('Run Once for Each Item" mode fails'))).toHaveLength(0);
  });

  it('should accept a single dict return in all-items mode', () => {
    const result = validate({
      language: 'pythonNative',
      mode: 'runOnceForAllItems',
      pythonCode: 'return {"count": len(_items)}'
    });

    expect(result.errors).toHaveLength(0);
    expect(result.valid).toBe(true);
  });

  it('should still validate the legacy python language value', () => {
    const result = validate({
      language: 'python',
      mode: 'runOnceForAllItems',
      pythonCode: 'return [{"json": {"count": len(_items)}}]'
    });

    expect(result.errors.some(e => e.message === 'Code cannot be empty')).toBe(false);
  });
});

/**
 * Required-field reporting also runs the real chain: the base validator and a
 * node-specific validator both notice a missing property, and the user should
 * be told once.
 */
describe('EnhancedConfigValidator - required-field reporting', () => {
  const validate = (nodeType: string, config: Record<string, any>, properties: any[]) =>
    EnhancedConfigValidator.validateWithMode(nodeType, config, properties as any, 'operation', 'strict');

  it('should report a missing Postgres table once', () => {
    const result = validate(
      'nodes-base.postgres',
      { operation: 'insert', table: '' },
      [
        { name: 'operation', type: 'options' },
        { name: 'table', type: 'string', required: true, displayName: 'Table' }
      ]
    );

    const tableErrors = result.errors.filter(e => e.property === 'table');
    expect(tableErrors).toHaveLength(1);
    const requiredSteps = (result.nextSteps || []).filter(s => s.startsWith('Add required fields'));
    expect(requiredSteps).toEqual(['Add required fields: table']);
  });

  it.each([
    ['nodes-base.mysql', { operation: 'insert', table: '' }, [
      { name: 'operation', type: 'options' },
      { name: 'table', type: 'string', required: true, displayName: 'Table' }
    ], 'table'],
    ['nodes-base.mongodb', { operation: 'find', collection: '' }, [
      { name: 'operation', type: 'options' },
      { name: 'collection', type: 'string', required: true, displayName: 'Collection' }
    ], 'collection'],
    ['nodes-base.slack', { resource: 'message', operation: 'send', channel: '' }, [
      { name: 'resource', type: 'options' },
      { name: 'operation', type: 'options' },
      { name: 'channel', type: 'string', required: true, displayName: 'Channel' }
    ], 'channel'],
    ['nodes-base.webhook', { httpMethod: 'POST', path: '' }, [
      { name: 'httpMethod', type: 'options' },
      { name: 'path', type: 'string', required: true, displayName: 'Path' }
    ], 'path']
  ])('should report one required-field error for %s', (nodeType, config, properties, property) => {
    const result = validate(nodeType as string, config as Record<string, any>, properties as any[]);

    expect(result.errors.filter(e => e.property === property && e.type === 'missing_required')).toHaveLength(1);
  });
});

/**
 * The embedding API (MCPEngine) must see the same Python checks as validate_node
 * and workflow validation - it used to call the base ConfigValidator directly.
 */
describe('MCPEngine.validateNodeOperation - Python Code node', () => {
  const codeNode = {
    nodeType: 'nodes-base.code',
    properties: [
      { name: 'language', type: 'options', options: [{ value: 'javaScript' }, { value: 'pythonNative' }] },
      { name: 'mode', type: 'options', options: [{ value: 'runOnceForAllItems' }, { value: 'runOnceForEachItem' }] },
      { name: 'pythonCode', type: 'string' },
      { name: 'jsCode', type: 'string' }
    ]
  };

  const engine = new MCPEngine({
    getNodeByType: async () => codeNode
  } as any);

  it('should run the native-Python rules', async () => {
    const result: any = await engine.validateNodeOperation({
      nodeType: 'nodes-base.code',
      config: {
        language: 'pythonNative',
        mode: 'runOnceForAllItems',
        pythonCode: 'rows = _input.all()\nreturn [{"json": {"n": len(rows)}}]'
      }
    });

    expect(result.errors).toContainEqual(expect.objectContaining({
      property: 'pythonCode',
      message: '_input does not exist in native Python - it was removed with the Pyodide runtime'
    }));
  });

  it('should warn about a blocked import', async () => {
    const result: any = await engine.validateNodeOperation({
      nodeType: 'nodes-base.code',
      config: {
        language: 'pythonNative',
        mode: 'runOnceForAllItems',
        pythonCode: 'import json\nreturn [{"json": {"n": len(_items)}}]'
      }
    });

    expect(result.warnings.some((w: any) => w.message.includes('import json is blocked'))).toBe(true);
  });

  it('should not report empty code for pythonNative', async () => {
    const result: any = await engine.validateNodeOperation({
      nodeType: 'nodes-base.code',
      config: { language: 'pythonNative', mode: 'runOnceForEachItem', pythonCode: 'return {"json": _item["json"]}' }
    });

    expect(result.valid).toBe(true);
  });
});
