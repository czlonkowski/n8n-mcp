import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EnhancedConfigValidator } from '@/services/enhanced-config-validator';
import { ConfigValidator } from '@/services/config-validator';
import { NodeSpecificValidators } from '@/services/node-specific-validators';

vi.mock('@/services/node-specific-validators', () => ({
  NodeSpecificValidators: {
    validateSlack: vi.fn(),
    validateGoogleSheets: vi.fn(),
    validateCode: vi.fn(),
    validateOpenAI: vi.fn(),
    validateMongoDB: vi.fn(),
    validateWebhook: vi.fn(),
    validatePostgres: vi.fn(),
    validateMySQL: vi.fn(),
    validateAIAgent: vi.fn(),
    validateSet: vi.fn()
  }
}));

/**
 * Regression tests for validator false positives found by the 2026-07 audit.
 *
 * Runtime semantics below were live-verified against n8n 2.62.0:
 * - An empty multi-resource node resolves to the default resource's default
 *   operation (e.g. Gmail -> message/send), not the first schema entry.
 * - Expression values and loadOptions-backed enums resolve at runtime.
 * - The legacy Code-node language value 'python' still executes.
 * - IF/Filter v1 nodes run the legacy conditions.{string|number|boolean}
 *   shape natively; v2+ nodes silently ignore it (always-true branch).
 * - The filter combinator defaults to "and" when omitted.
 * - resourceLocator values with mode: "" and an expression value resolve fine.
 * - URLs whose protocol lives in a resolved variable fetch successfully.
 */

describe('applyNodeDefaults is visibility-aware (audit A1)', () => {
  // Gmail-like schema: one `operation` property per resource. The draft
  // operation property comes first in the array; resource comes last so the
  // fixpoint has to resolve `resource` before `operation`.
  const multiResourceProperties = [
    {
      name: 'operation', type: 'options', default: 'create',
      displayOptions: { show: { resource: ['draft'] } },
      options: [{ value: 'create' }, { value: 'delete' }, { value: 'get' }]
    },
    {
      name: 'operation', type: 'options', default: 'send',
      displayOptions: { show: { resource: ['message'] } },
      options: [{ value: 'send' }, { value: 'reply' }, { value: 'get' }]
    },
    {
      name: 'resource', type: 'options', default: 'message',
      options: [{ value: 'draft' }, { value: 'message' }]
    }
  ];

  it('does not inject another resource\'s operation default for an empty config', () => {
    const result = EnhancedConfigValidator.validateWithMode(
      'nodes-base.gmail', {}, multiResourceProperties, 'operation', 'ai-friendly'
    );

    expect(result.errors.filter(e => e.property === 'operation')).toHaveLength(0);
    expect(result.valid).toBe(true);
  });

  it('resolves resource before operation regardless of schema order', () => {
    const resourceFirst = [
      multiResourceProperties[2],
      multiResourceProperties[0],
      multiResourceProperties[1]
    ];
    const result = EnhancedConfigValidator.validateWithMode(
      'nodes-base.gmail', {}, resourceFirst, 'operation', 'ai-friendly'
    );

    expect(result.errors.filter(e => e.property === 'operation')).toHaveLength(0);
    expect(result.valid).toBe(true);
  });

  it('still flags an explicitly invalid operation (guard)', () => {
    const result = EnhancedConfigValidator.validateWithMode(
      'nodes-base.gmail',
      { resource: 'message', operation: 'create' },
      multiResourceProperties,
      'operation',
      'ai-friendly'
    );

    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.property === 'operation' && e.type === 'invalid_value')).toBe(true);
  });
});

describe('options enum check guards (audit A1)', () => {
  it('skips enum validation for expression values', () => {
    const result = ConfigValidator.validate(
      'nodes-base.test',
      { include: '={{ $json.include }}' },
      [{ name: 'include', type: 'options', options: [{ value: 'all' }, { value: 'selected' }] }]
    );
    expect(result.errors.filter(e => e.property === 'include')).toHaveLength(0);
  });

  it('skips enum validation when the static options list is empty (loadOptions-backed)', () => {
    const result = ConfigValidator.validate(
      'nodes-base.asana',
      { workspace: '1212551193156936' },
      [{ name: 'workspace', type: 'options', options: [] }]
    );
    expect(result.errors.filter(e => e.property === 'workspace')).toHaveLength(0);
  });

  it('skips enum validation when the property declares loadOptionsMethod', () => {
    const result = ConfigValidator.validate(
      'nodes-base.mailchimp',
      { list: 'a1b2c3d4' },
      [{
        name: 'list', type: 'options',
        options: [{ value: 'stale-static-entry' }],
        typeOptions: { loadOptionsMethod: 'getLists' }
      }]
    );
    expect(result.errors.filter(e => e.property === 'list')).toHaveLength(0);
  });

  it('accepts the legacy Code-node language value "python"', () => {
    const result = ConfigValidator.validate(
      'nodes-base.code',
      { language: 'python', pythonCode: 'return items' },
      [
        { name: 'language', type: 'options', options: [{ value: 'javaScript' }, { value: 'pythonNative' }] },
        { name: 'pythonCode', type: 'string' }
      ]
    );
    expect(result.errors.filter(e => e.property === 'language')).toHaveLength(0);
  });

  it('still rejects a literal invalid value on a static options list (guard)', () => {
    const result = ConfigValidator.validate(
      'nodes-base.test',
      { mode: 'multiplex-typo' },
      [{ name: 'mode', type: 'options', options: [{ value: 'append' }, { value: 'combine' }] }]
    );
    expect(result.errors.some(e => e.property === 'mode' && e.type === 'invalid_value')).toBe(true);
  });
});

describe('filter structure checks are version/shape-aware (audit A3)', () => {
  const filterProps = [{ name: 'conditions', type: 'filter', required: true }];
  const v1Conditions = {
    string: [{ value1: '={{ $json.name }}', value2: 'hello', operation: 'equal' }]
  };

  it('accepts the legacy v1 conditions shape on a v1 node', () => {
    const result = EnhancedConfigValidator.validateWithMode(
      'nodes-base.if',
      { '@version': 1, conditions: v1Conditions },
      filterProps,
      'operation',
      'ai-friendly'
    );
    expect(result.errors).toHaveLength(0);
    expect(result.valid).toBe(true);
  });

  it('accepts the legacy v1 conditions shape when the version is unknown', () => {
    const result = EnhancedConfigValidator.validateWithMode(
      'nodes-base.if',
      { conditions: v1Conditions },
      filterProps,
      'operation',
      'ai-friendly'
    );
    expect(result.errors).toHaveLength(0);
  });

  it('errors when a v2+ node carries v1-shaped conditions (silent always-true)', () => {
    const result = EnhancedConfigValidator.validateWithMode(
      'nodes-base.if',
      { '@version': 2.2, conditions: v1Conditions },
      filterProps,
      'operation',
      'ai-friendly'
    );
    expect(result.valid).toBe(false);
    const error = result.errors.find(e => e.property === 'conditions');
    expect(error).toBeDefined();
    expect(error!.message).toContain('v1-style');
    expect(error!.message).toContain('true branch');
  });

  it('does not require combinator when conditions is a valid array', () => {
    const result = EnhancedConfigValidator.validateWithMode(
      'nodes-base.if',
      {
        '@version': 2.2,
        conditions: {
          conditions: [{
            id: 'c1',
            leftValue: '={{ $json.x }}',
            rightValue: 'a',
            operator: { type: 'string', operation: 'equals' }
          }]
        }
      },
      filterProps,
      'operation',
      'ai-friendly'
    );
    expect(result.errors.filter(e => e.property.includes('combinator'))).toHaveLength(0);
    expect(result.valid).toBe(true);
  });

  it('still rejects an invalid combinator value (guard)', () => {
    const result = EnhancedConfigValidator.validateWithMode(
      'nodes-base.if',
      {
        '@version': 2.2,
        conditions: { combinator: 'nand', conditions: [] }
      },
      filterProps,
      'operation',
      'ai-friendly'
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.message.includes('Invalid combinator'))).toBe(true);
  });

  it('still rejects non-array conditions in the v2 shape (guard)', () => {
    const result = EnhancedConfigValidator.validateWithMode(
      'nodes-base.if',
      { '@version': 2.2, conditions: { combinator: 'and', conditions: 'not-an-array' } },
      filterProps,
      'operation',
      'ai-friendly'
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.message.includes('must be an array'))).toBe(true);
  });

  it('still rejects legacy v1 operation names inside a v2 structure (guard)', () => {
    const result = EnhancedConfigValidator.validateWithMode(
      'nodes-base.filter',
      {
        '@version': 2.2,
        conditions: {
          combinator: 'and',
          conditions: [{
            id: 'c1',
            leftValue: '={{ $json.x }}',
            rightValue: 'a',
            operator: { type: 'string', operation: 'equal' }
          }]
        }
      },
      filterProps,
      'operation',
      'ai-friendly'
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.message.includes("not valid for type"))).toBe(true);
  });

  it('errors on an empty filter object with no conditions field (vacuous always-true)', () => {
    const result = EnhancedConfigValidator.validateWithMode(
      'nodes-base.filter',
      { '@version': 2.2, conditions: {} },
      filterProps,
      'operation',
      'ai-friendly'
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.message.includes('Filter must have a conditions field'))).toBe(true);
  });

  it('accepts a filter whose conditions is an empty array', () => {
    const result = EnhancedConfigValidator.validateWithMode(
      'nodes-base.filter',
      { '@version': 2.2, conditions: { conditions: [] } },
      filterProps,
      'operation',
      'ai-friendly'
    );
    expect(result.errors.some(e => e.message.includes('Filter must have a conditions field'))).toBe(false);
  });

  it('does not add the missing-conditions error to a different malformed shape (handled elsewhere)', () => {
    // The legacy conditions.values collection is reported by its own structure
    // check; the missing-conditions guard must not double-flag it.
    const result = EnhancedConfigValidator.validateWithMode(
      'nodes-base.if',
      { '@version': 2.2, conditions: { values: [{ value1: '={{ $json.age }}', operation: 'largerEqual', value2: 18 }] } },
      filterProps,
      'operation',
      'ai-friendly'
    );
    expect(result.errors.some(e => e.message.includes('Filter must have a conditions field'))).toBe(false);
  });
});

describe('node-specific warnings respect validation profiles (audit RC-1)', () => {
  const codeProps = [
    { name: 'language', type: 'options', options: [{ value: 'javaScript' }, { value: 'pythonNative' }] },
    { name: 'jsCode', type: 'string' }
  ];
  const codeConfig = { language: 'javaScript', jsCode: 'return items;' };

  beforeEach(() => {
    vi.mocked(NodeSpecificValidators.validateCode).mockImplementation((ctx: any) => {
      ctx.warnings.push({
        type: 'best_practice',
        property: 'errorHandling',
        message: 'Code nodes can throw errors - consider error handling'
      });
    });
  });

  it('minimal profile drops node-specific best_practice warnings', () => {
    const result = EnhancedConfigValidator.validateWithMode(
      'nodes-base.code', codeConfig, codeProps, 'operation', 'minimal'
    );
    expect(result.warnings.filter(w => w.type === 'best_practice')).toHaveLength(0);
  });

  it('runtime profile drops node-specific best_practice warnings', () => {
    const result = EnhancedConfigValidator.validateWithMode(
      'nodes-base.code', codeConfig, codeProps, 'operation', 'runtime'
    );
    expect(result.warnings.filter(w => w.type === 'best_practice')).toHaveLength(0);
  });

  it('ai-friendly profile keeps node-specific best_practice warnings', () => {
    const result = EnhancedConfigValidator.validateWithMode(
      'nodes-base.code', codeConfig, codeProps, 'operation', 'ai-friendly'
    );
    expect(result.warnings.some(w => w.type === 'best_practice' && w.property === 'errorHandling')).toBe(true);
  });

  it('strict profile keeps node-specific best_practice warnings', () => {
    const result = EnhancedConfigValidator.validateWithMode(
      'nodes-base.code', codeConfig, codeProps, 'operation', 'strict'
    );
    expect(result.warnings.some(w => w.type === 'best_practice' && w.property === 'errorHandling')).toBe(true);
  });

  it('security warnings survive minimal profile (guard)', () => {
    vi.mocked(NodeSpecificValidators.validateCode).mockImplementation((ctx: any) => {
      ctx.warnings.push({ type: 'security', message: 'Code contains eval' });
    });
    const result = EnhancedConfigValidator.validateWithMode(
      'nodes-base.code', codeConfig, codeProps, 'operation', 'minimal'
    );
    expect(result.warnings.some(w => w.type === 'security')).toBe(true);
  });
});

describe('URL protocol warning only for literal www. prefixes (audit B6)', () => {
  const urlProps = [{ name: 'url', type: 'string', required: true }];

  it('does not warn when the protocol lives in a resolved variable', () => {
    const result = EnhancedConfigValidator.validateWithMode(
      'nodes-base.httpRequest',
      { url: '={{ $json.BASE_URL }}/get', method: 'GET' },
      urlProps,
      'operation',
      'ai-friendly'
    );
    expect(result.warnings.filter(w => w.property === 'url' && w.message.includes('protocol'))).toHaveLength(0);
  });

  it('still warns when the expression URL literally starts with www. (guard)', () => {
    const result = EnhancedConfigValidator.validateWithMode(
      'nodes-base.httpRequest',
      { url: '=www.{{ $json.domain }}.com', method: 'GET' },
      urlProps,
      'operation',
      'ai-friendly'
    );
    expect(result.warnings.some(w => w.property === 'url' && w.message.includes('missing http:// or https://'))).toBe(true);
  });
});

describe('resourceLocator empty-string mode (audit C-tail)', () => {
  it('base validator: mode "" with an expression value is not "missing mode"', () => {
    const result = ConfigValidator.validate(
      'nodes-base.googleDrive',
      { fileId: { __rl: true, mode: '', value: '={{ $json.id || $json.data[0].id }}' } },
      [{ name: 'fileId', type: 'resourceLocator', modes: [{ name: 'list' }, { name: 'id' }, { name: 'url' }] }]
    );
    expect(result.errors).toHaveLength(0);
  });

  it('enhanced structure check: mode "" with an expression value validates clean', () => {
    const result = EnhancedConfigValidator.validateWithMode(
      'nodes-base.googleDrive',
      { fileId: { __rl: true, mode: '', value: '={{ $json.id }}' } },
      [{ name: 'fileId', type: 'resourceLocator' }],
      'operation',
      'ai-friendly'
    );
    expect(result.errors).toHaveLength(0);
  });

  it('mode "" with a genuinely absent value reports the missing value, not the mode', () => {
    const result = ConfigValidator.validate(
      'nodes-base.googleDrive',
      { fileId: { __rl: true, mode: '' } },
      [{ name: 'fileId', type: 'resourceLocator' }]
    );
    expect(result.errors.some(e => e.property === 'fileId.value')).toBe(true);
    expect(result.errors.some(e => e.property === 'fileId.mode')).toBe(false);
  });

  it('still reports a truly missing mode (guard)', () => {
    const result = ConfigValidator.validate(
      'nodes-base.googleDrive',
      { fileId: { __rl: true, value: 'abc123' } },
      [{ name: 'fileId', type: 'resourceLocator' }]
    );
    expect(result.errors.some(e => e.property === 'fileId.mode' && e.type === 'missing_required')).toBe(true);
  });

  it('still rejects an invalid non-empty mode (guard)', () => {
    const result = ConfigValidator.validate(
      'nodes-base.googleDrive',
      { fileId: { __rl: true, mode: 'bogus', value: 'abc123' } },
      [{ name: 'fileId', type: 'resourceLocator', modes: [{ name: 'list' }, { name: 'id' }] }]
    );
    expect(result.errors.some(e => e.property === 'fileId.mode' && e.type === 'invalid_value')).toBe(true);
  });
});

describe('same-name property definitions and injected defaults (audit: openAi prompt collision)', () => {
  // openAi-like schema: `prompt` exists once per resource with different types.
  const openAiLikeProps = [
    { name: 'resource', type: 'options', default: 'chat', options: [{ value: 'chat' }, { value: 'image' }] },
    { name: 'prompt', type: 'string', default: '', displayOptions: { show: { resource: ['image'] } } },
    { name: 'prompt', type: 'fixedCollection', default: {}, displayOptions: { show: { resource: ['chat'] } } }
  ];

  it('type-checks against the visible definition, not the first same-named one', () => {
    const result = ConfigValidator.validate(
      'nodes-base.openAi',
      { resource: 'chat', prompt: { messages: [{ content: 'hi' }] } },
      openAiLikeProps
    );
    expect(result.errors.filter(e => e.property === 'prompt')).toHaveLength(0);
  });

  it('does not type-check a value equal to a same-named definition default', () => {
    const result = ConfigValidator.validate(
      'nodes-base.openAi',
      { resource: 'image', prompt: {} },
      openAiLikeProps
    );
    expect(result.errors.filter(e => e.property === 'prompt')).toHaveLength(0);
  });

  it('still flags a genuinely mistyped value on the visible definition (guard)', () => {
    const result = ConfigValidator.validate(
      'nodes-base.openAi',
      { resource: 'image', prompt: 123 },
      openAiLikeProps
    );
    expect(result.errors.some(e => e.property === 'prompt' && e.type === 'invalid_type')).toBe(true);
  });
});

describe('property-visibility warning skips inert values (audit B10)', () => {
  it('does not warn about an invisible property with a null value', () => {
    const result = ConfigValidator.validate(
      'nodes-base.test',
      { sendBody: false, specifyBody: null },
      [{ name: 'sendBody', type: 'boolean' }]
    );
    expect(result.warnings.filter(w => w.property === 'specifyBody')).toHaveLength(0);
  });

  it('does not warn about an invisible property with an empty-string value', () => {
    const result = ConfigValidator.validate(
      'nodes-base.test',
      { sendBody: false, leftover: '' },
      [{ name: 'sendBody', type: 'boolean' }]
    );
    expect(result.warnings.filter(w => w.property === 'leftover')).toHaveLength(0);
  });

  it('does not warn about an invisible property still at its schema default', () => {
    const result = ConfigValidator.validate(
      'nodes-base.test',
      { mode: 'a', extra: 'x' },
      [
        { name: 'mode', type: 'options', options: [{ value: 'a' }, { value: 'b' }] },
        { name: 'extra', type: 'string', default: 'x', displayOptions: { show: { mode: ['b'] } } }
      ]
    );
    expect(result.warnings.filter(w => w.property === 'extra')).toHaveLength(0);
  });

  it('still warns about an invisible property carrying a real value, using its displayName (guard)', () => {
    const result = ConfigValidator.validate(
      'nodes-base.test',
      { authentication: 'none', genericAuthType: 'httpBasicAuth' },
      [
        { name: 'authentication', type: 'options', options: [{ value: 'none' }, { value: 'genericCredentialType' }] },
        {
          name: 'genericAuthType', displayName: 'Generic Auth Type', type: 'string',
          displayOptions: { show: { authentication: ['genericCredentialType'] } }
        }
      ]
    );
    const warning = result.warnings.find(w => w.property === 'genericAuthType');
    expect(warning).toBeDefined();
    expect(warning!.message).toContain("won't be used");
    expect(warning!.message).toContain('Generic Auth Type');
  });
});
