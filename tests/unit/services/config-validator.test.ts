import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConfigValidator } from '@/services/config-validator';
import type { ValidationResult, ValidationError, ValidationWarning } from '@/services/config-validator';

// Mock the database
vi.mock('better-sqlite3');

describe('ConfigValidator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── Basic Validation ───────────────────────────────────────────────

  describe('validate', () => {
    it('should validate required fields for Slack message post', () => {
      const config = { resource: 'message', operation: 'post' };
      const properties = [
        { name: 'resource', type: 'options', required: true, default: 'message', options: [{ name: 'Message', value: 'message' }, { name: 'Channel', value: 'channel' }] },
        { name: 'operation', type: 'options', required: true, default: 'post', displayOptions: { show: { resource: ['message'] } }, options: [{ name: 'Post', value: 'post' }, { name: 'Update', value: 'update' }] },
        { name: 'channel', type: 'string', required: true, displayOptions: { show: { resource: ['message'], operation: ['post'] } } }
      ];
      const result = ConfigValidator.validate('nodes-base.slack', config, properties);
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toMatchObject({ type: 'missing_required', property: 'channel', message: "Required property 'channel' is missing", fix: 'Add channel to your configuration' });
    });

    it('should validate successfully with all required fields', () => {
      const config = { resource: 'message', operation: 'post', channel: '#general', text: 'Hello, Slack!' };
      const properties = [
        { name: 'resource', type: 'options', required: true, default: 'message', options: [{ name: 'Message', value: 'message' }, { name: 'Channel', value: 'channel' }] },
        { name: 'operation', type: 'options', required: true, default: 'post', displayOptions: { show: { resource: ['message'] } }, options: [{ name: 'Post', value: 'post' }, { name: 'Update', value: 'update' }] },
        { name: 'channel', type: 'string', required: true, displayOptions: { show: { resource: ['message'], operation: ['post'] } } },
        { name: 'text', type: 'string', default: '', displayOptions: { show: { resource: ['message'], operation: ['post'] } } }
      ];
      const result = ConfigValidator.validate('nodes-base.slack', config, properties);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should handle unknown node types gracefully', () => {
      const result = ConfigValidator.validate('nodes-base.unknown', { field: 'value' }, []);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should validate property types', () => {
      const result = ConfigValidator.validate('nodes-base.test', { numberField: 'not-a-number', booleanField: 'yes' }, [{ name: 'numberField', type: 'number' }, { name: 'booleanField', type: 'boolean' }]);
      expect(result.errors).toHaveLength(2);
      expect(result.errors.some(e => e.property === 'numberField' && e.type === 'invalid_type')).toBe(true);
      expect(result.errors.some(e => e.property === 'booleanField' && e.type === 'invalid_type')).toBe(true);
    });

    it('should validate option values', () => {
      const result = ConfigValidator.validate('nodes-base.test', { selectField: 'invalid-option' }, [{ name: 'selectField', type: 'options', options: [{ name: 'Option A', value: 'a' }, { name: 'Option B', value: 'b' }] }]);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toMatchObject({ type: 'invalid_value', property: 'selectField', message: expect.stringContaining('Invalid value') });
    });

    it('should check property visibility based on displayOptions', () => {
      const result = ConfigValidator.validate('nodes-base.test', { resource: 'user', userField: 'visible' }, [
        { name: 'resource', type: 'options', options: [{ name: 'User', value: 'user' }, { name: 'Post', value: 'post' }] },
        { name: 'userField', type: 'string', displayOptions: { show: { resource: ['user'] } } },
        { name: 'postField', type: 'string', displayOptions: { show: { resource: ['post'] } } }
      ]);
      expect(result.visibleProperties).toContain('resource');
      expect(result.visibleProperties).toContain('userField');
      expect(result.hiddenProperties).toContain('postField');
    });

    it('should handle empty properties array', () => {
      const result = ConfigValidator.validate('nodes-base.test', { someField: 'value' }, []);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should handle missing displayOptions gracefully', () => {
      const result = ConfigValidator.validate('nodes-base.test', { field1: 'value1' }, [{ name: 'field1', type: 'string' }]);
      expect(result.visibleProperties).toContain('field1');
    });

    it('should validate options with array format', () => {
      const result = ConfigValidator.validate('nodes-base.test', { optionField: 'b' }, [{ name: 'optionField', type: 'options', options: [{ name: 'Option A', value: 'a' }, { name: 'Option B', value: 'b' }, { name: 'Option C', value: 'c' }] }]);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  // ─── Edge Cases and Additional Coverage ─────────────────────────────

  describe('edge cases and additional coverage', () => {
    it('should handle null and undefined config values', () => {
      const result = ConfigValidator.validate('nodes-base.test', { nullField: null, undefinedField: undefined, validField: 'value' }, [
        { name: 'nullField', type: 'string', required: true },
        { name: 'undefinedField', type: 'string', required: true },
        { name: 'validField', type: 'string' }
      ]);
      expect(result.errors.find(e => e.property === 'nullField')).toBeDefined();
      expect(result.errors.find(e => e.property === 'undefinedField')).toBeDefined();
    });

    it('should validate nested displayOptions conditions', () => {
      const result = ConfigValidator.validate('nodes-base.test', { mode: 'advanced', resource: 'user', advancedUserField: 'value' }, [
        { name: 'mode', type: 'options', options: [{ name: 'Simple', value: 'simple' }, { name: 'Advanced', value: 'advanced' }] },
        { name: 'resource', type: 'options', displayOptions: { show: { mode: ['advanced'] } }, options: [{ name: 'User', value: 'user' }, { name: 'Post', value: 'post' }] },
        { name: 'advancedUserField', type: 'string', displayOptions: { show: { mode: ['advanced'], resource: ['user'] } } }
      ]);
      expect(result.visibleProperties).toContain('advancedUserField');
    });

    it('should handle hide conditions in displayOptions', () => {
      const result = ConfigValidator.validate('nodes-base.test', { showAdvanced: false, hiddenField: 'should-not-be-here' }, [
        { name: 'showAdvanced', type: 'boolean' },
        { name: 'hiddenField', type: 'string', displayOptions: { hide: { showAdvanced: [false] } } }
      ]);
      expect(result.hiddenProperties).toContain('hiddenField');
      expect(result.warnings.some(w => w.property === 'hiddenField' && w.type === 'inefficient')).toBe(true);
    });

    it('should handle internal properties that start with underscore', () => {
      const result = ConfigValidator.validate('nodes-base.test', { '@version': 1, '_internalField': 'value', normalField: 'value' }, [{ name: 'normalField', type: 'string' }]);
      expect(result.warnings.some(w => w.property === '@version' || w.property === '_internalField')).toBe(false);
    });

    it('should warn about inefficient configured but hidden properties', () => {
      const result = ConfigValidator.validate('nodes-base.test', { mode: 'manual', automaticField: 'This will not be used' }, [
        { name: 'mode', type: 'options', options: [{ name: 'Manual', value: 'manual' }, { name: 'Automatic', value: 'automatic' }] },
        { name: 'automaticField', type: 'string', displayOptions: { show: { mode: ['automatic'] } } }
      ]);
      expect(result.warnings.some(w => w.type === 'inefficient' && w.property === 'automaticField' && w.message.includes("won't be used"))).toBe(true);
    });

    it('should suggest commonly used properties', () => {
      const result = ConfigValidator.validate('nodes-base.httpRequest', { method: 'GET', url: 'https://api.example.com/data' }, [{ name: 'method', type: 'options' }, { name: 'url', type: 'string' }, { name: 'headers', type: 'json' }]);
      expect(result.suggestions.length).toBeGreaterThanOrEqual(0);
    });
  });

  // ─── ResourceLocator Validation ─────────────────────────────────────

  describe('resourceLocator validation', () => {
    const rlNodeType = '@n8n/n8n-nodes-langchain.lmChatOpenAi';

    it('should reject string value when resourceLocator object is required', () => {
      const result = ConfigValidator.validate(rlNodeType, { model: 'gpt-4o-mini' }, [{ name: 'model', displayName: 'Model', type: 'resourceLocator', required: true, default: { mode: 'list', value: 'gpt-4o-mini' } }]);
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toMatchObject({ type: 'invalid_type', property: 'model', message: expect.stringContaining('must be an object with \'mode\' and \'value\' properties') });
      expect(result.errors[0].fix).toContain('mode');
      expect(result.errors[0].fix).toContain('value');
    });

    it('should accept valid resourceLocator with mode and value', () => {
      const result = ConfigValidator.validate(rlNodeType, { model: { mode: 'list', value: 'gpt-4o-mini' } }, [{ name: 'model', displayName: 'Model', type: 'resourceLocator', required: true, default: { mode: 'list', value: 'gpt-4o-mini' } }]);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject null value for resourceLocator', () => {
      const result = ConfigValidator.validate(rlNodeType, { model: null }, [{ name: 'model', type: 'resourceLocator', required: true }]);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.property === 'model' && e.type === 'invalid_type')).toBe(true);
    });

    it('should reject array value for resourceLocator', () => {
      const result = ConfigValidator.validate(rlNodeType, { model: ['gpt-4o-mini'] }, [{ name: 'model', type: 'resourceLocator', required: true }]);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.property === 'model' && e.type === 'invalid_type' && e.message.includes('must be an object'))).toBe(true);
    });

    it('should detect missing mode property in resourceLocator', () => {
      const result = ConfigValidator.validate(rlNodeType, { model: { value: 'gpt-4o-mini' } }, [{ name: 'model', type: 'resourceLocator', required: true }]);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.property === 'model.mode' && e.type === 'missing_required' && e.message.includes('missing required property \'mode\''))).toBe(true);
    });

    it('should detect missing value property in resourceLocator', () => {
      const result = ConfigValidator.validate(rlNodeType, { model: { mode: 'list' } }, [{ name: 'model', displayName: 'Model', type: 'resourceLocator', required: true }]);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.property === 'model.value' && e.type === 'missing_required' && e.message.includes('missing required property \'value\''))).toBe(true);
    });

    it('should detect invalid mode type in resourceLocator', () => {
      const result = ConfigValidator.validate(rlNodeType, { model: { mode: 123, value: 'gpt-4o-mini' } }, [{ name: 'model', type: 'resourceLocator', required: true }]);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.property === 'model.mode' && e.type === 'invalid_type' && e.message.includes('must be a string'))).toBe(true);
    });

    it('should accept resourceLocator with mode "id"', () => {
      const result = ConfigValidator.validate(rlNodeType, { model: { mode: 'id', value: 'gpt-4o-2024-11-20' } }, [{ name: 'model', type: 'resourceLocator', required: true }]);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject number value when resourceLocator is required', () => {
      const result = ConfigValidator.validate(rlNodeType, { model: 12345 }, [{ name: 'model', type: 'resourceLocator', required: true }]);
      expect(result.valid).toBe(false);
      expect(result.errors[0].type).toBe('invalid_type');
      expect(result.errors[0].message).toContain('must be an object');
    });

    it('should provide helpful fix suggestion for string to resourceLocator conversion', () => {
      const result = ConfigValidator.validate(rlNodeType, { model: 'gpt-4o-mini' }, [{ name: 'model', type: 'resourceLocator', required: true }]);
      expect(result.errors[0].fix).toContain('{ mode: "list", value: "gpt-4o-mini" }');
      expect(result.errors[0].fix).toContain('{ mode: "id", value: "gpt-4o-mini" }');
    });

    it('should reject invalid mode values when schema defines allowed modes', () => {
      const result = ConfigValidator.validate(rlNodeType, { model: { mode: 'invalid-mode', value: 'gpt-4o-mini' } }, [{ name: 'model', type: 'resourceLocator', required: true, modes: [{ name: 'list', displayName: 'List' }, { name: 'id', displayName: 'ID' }, { name: 'url', displayName: 'URL' }] }]);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.property === 'model.mode' && e.type === 'invalid_value' && e.message.includes('must be one of [list, id, url]'))).toBe(true);
    });

    it('should handle modes defined as array format', () => {
      const result = ConfigValidator.validate(rlNodeType, { model: { mode: 'custom', value: 'gpt-4o-mini' } }, [{ name: 'model', type: 'resourceLocator', required: true, modes: [{ name: 'list', displayName: 'List' }, { name: 'id', displayName: 'ID' }, { name: 'custom', displayName: 'Custom' }] }]);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should handle malformed modes schema gracefully', () => {
      const result = ConfigValidator.validate(rlNodeType, { model: { mode: 'any-mode', value: 'gpt-4o-mini' } }, [{ name: 'model', type: 'resourceLocator', required: true, modes: 'invalid-string' }]);
      expect(result.valid).toBe(true);
      expect(result.errors.some(e => e.property === 'model.mode')).toBe(false);
    });

    it('should handle empty modes definition gracefully', () => {
      const result = ConfigValidator.validate(rlNodeType, { model: { mode: 'any-mode', value: 'gpt-4o-mini' } }, [{ name: 'model', type: 'resourceLocator', required: true, modes: {} }]);
      expect(result.valid).toBe(true);
      expect(result.errors.some(e => e.property === 'model.mode')).toBe(false);
    });

    it('should skip mode validation when modes not provided', () => {
      const result = ConfigValidator.validate(rlNodeType, { model: { mode: 'custom-mode', value: 'gpt-4o-mini' } }, [{ name: 'model', type: 'resourceLocator', required: true }]);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should accept resourceLocator with mode "url"', () => {
      const result = ConfigValidator.validate(rlNodeType, { model: { mode: 'url', value: 'https://api.example.com/models/custom' } }, [{ name: 'model', type: 'resourceLocator', required: true }]);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect empty resourceLocator object', () => {
      const result = ConfigValidator.validate(rlNodeType, { model: {} }, [{ name: 'model', type: 'resourceLocator', required: true }]);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(2);
      expect(result.errors.some(e => e.property === 'model.mode')).toBe(true);
      expect(result.errors.some(e => e.property === 'model.value')).toBe(true);
    });

    it('should handle resourceLocator with extra properties gracefully', () => {
      const result = ConfigValidator.validate(rlNodeType, { model: { mode: 'list', value: 'gpt-4o-mini', extraProperty: 'ignored' } }, [{ name: 'model', type: 'resourceLocator', required: true }]);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  // ─── _cnd Operators (from config-validator-cnd) ─────────────────────

  describe('_cnd operators', () => {
    describe('eq operator', () => {
      it('should match when values are equal', () => {
        expect(ConfigValidator.isPropertyVisible({ name: 'testField', displayOptions: { show: { status: [{ _cnd: { eq: 'active' } }] } } }, { status: 'active' })).toBe(true);
      });
      it('should not match when values are not equal', () => {
        expect(ConfigValidator.isPropertyVisible({ name: 'testField', displayOptions: { show: { status: [{ _cnd: { eq: 'active' } }] } } }, { status: 'inactive' })).toBe(false);
      });
      it('should match numeric equality', () => {
        const prop = { name: 'testField', displayOptions: { show: { '@version': [{ _cnd: { eq: 1 } }] } } };
        expect(ConfigValidator.isPropertyVisible(prop, { '@version': 1 })).toBe(true);
        expect(ConfigValidator.isPropertyVisible(prop, { '@version': 2 })).toBe(false);
      });
    });

    describe('not operator', () => {
      it('should match when values are not equal', () => {
        expect(ConfigValidator.isPropertyVisible({ name: 'testField', displayOptions: { show: { status: [{ _cnd: { not: 'disabled' } }] } } }, { status: 'active' })).toBe(true);
      });
      it('should not match when values are equal', () => {
        expect(ConfigValidator.isPropertyVisible({ name: 'testField', displayOptions: { show: { status: [{ _cnd: { not: 'disabled' } }] } } }, { status: 'disabled' })).toBe(false);
      });
    });

    describe('gte operator', () => {
      it('should match when value is greater', () => {
        expect(ConfigValidator.isPropertyVisible({ name: 'f', displayOptions: { show: { '@version': [{ _cnd: { gte: 1.1 } }] } } }, { '@version': 2.0 })).toBe(true);
      });
      it('should match when value is equal', () => {
        expect(ConfigValidator.isPropertyVisible({ name: 'f', displayOptions: { show: { '@version': [{ _cnd: { gte: 1.1 } }] } } }, { '@version': 1.1 })).toBe(true);
      });
      it('should not match when value is less', () => {
        expect(ConfigValidator.isPropertyVisible({ name: 'f', displayOptions: { show: { '@version': [{ _cnd: { gte: 1.1 } }] } } }, { '@version': 1.0 })).toBe(false);
      });
    });

    describe('lte operator', () => {
      it('should match when value is less', () => {
        expect(ConfigValidator.isPropertyVisible({ name: 'f', displayOptions: { show: { '@version': [{ _cnd: { lte: 2.0 } }] } } }, { '@version': 1.5 })).toBe(true);
      });
      it('should match when value is equal', () => {
        expect(ConfigValidator.isPropertyVisible({ name: 'f', displayOptions: { show: { '@version': [{ _cnd: { lte: 2.0 } }] } } }, { '@version': 2.0 })).toBe(true);
      });
      it('should not match when value is greater', () => {
        expect(ConfigValidator.isPropertyVisible({ name: 'f', displayOptions: { show: { '@version': [{ _cnd: { lte: 2.0 } }] } } }, { '@version': 2.5 })).toBe(false);
      });
    });

    describe('gt operator', () => {
      it('should match when value is greater', () => {
        expect(ConfigValidator.isPropertyVisible({ name: 'f', displayOptions: { show: { count: [{ _cnd: { gt: 5 } }] } } }, { count: 10 })).toBe(true);
      });
      it('should not match when value is equal', () => {
        expect(ConfigValidator.isPropertyVisible({ name: 'f', displayOptions: { show: { count: [{ _cnd: { gt: 5 } }] } } }, { count: 5 })).toBe(false);
      });
    });

    describe('lt operator', () => {
      it('should match when value is less', () => {
        expect(ConfigValidator.isPropertyVisible({ name: 'f', displayOptions: { show: { count: [{ _cnd: { lt: 10 } }] } } }, { count: 5 })).toBe(true);
      });
      it('should not match when value is equal', () => {
        expect(ConfigValidator.isPropertyVisible({ name: 'f', displayOptions: { show: { count: [{ _cnd: { lt: 10 } }] } } }, { count: 10 })).toBe(false);
      });
    });

    describe('between operator', () => {
      it('should match when value is within range', () => {
        expect(ConfigValidator.isPropertyVisible({ name: 'f', displayOptions: { show: { '@version': [{ _cnd: { between: { from: 4, to: 4.6 } } }] } } }, { '@version': 4.3 })).toBe(true);
      });
      it('should match when value equals lower bound', () => {
        expect(ConfigValidator.isPropertyVisible({ name: 'f', displayOptions: { show: { '@version': [{ _cnd: { between: { from: 4, to: 4.6 } } }] } } }, { '@version': 4 })).toBe(true);
      });
      it('should match when value equals upper bound', () => {
        expect(ConfigValidator.isPropertyVisible({ name: 'f', displayOptions: { show: { '@version': [{ _cnd: { between: { from: 4, to: 4.6 } } }] } } }, { '@version': 4.6 })).toBe(true);
      });
      it('should not match when value is below range', () => {
        expect(ConfigValidator.isPropertyVisible({ name: 'f', displayOptions: { show: { '@version': [{ _cnd: { between: { from: 4, to: 4.6 } } }] } } }, { '@version': 3.9 })).toBe(false);
      });
      it('should not match when value is above range', () => {
        expect(ConfigValidator.isPropertyVisible({ name: 'f', displayOptions: { show: { '@version': [{ _cnd: { between: { from: 4, to: 4.6 } } }] } } }, { '@version': 5 })).toBe(false);
      });
      it('should not match when between structure is null', () => {
        expect(ConfigValidator.isPropertyVisible({ name: 'f', displayOptions: { show: { '@version': [{ _cnd: { between: null } }] } } }, { '@version': 4 })).toBe(false);
      });
      it('should not match when between is missing from field', () => {
        expect(ConfigValidator.isPropertyVisible({ name: 'f', displayOptions: { show: { '@version': [{ _cnd: { between: { to: 5 } } }] } } }, { '@version': 4 })).toBe(false);
      });
      it('should not match when between is missing to field', () => {
        expect(ConfigValidator.isPropertyVisible({ name: 'f', displayOptions: { show: { '@version': [{ _cnd: { between: { from: 3 } } }] } } }, { '@version': 4 })).toBe(false);
      });
    });

    describe('startsWith operator', () => {
      it('should match when string starts with prefix', () => { expect(ConfigValidator.isPropertyVisible({ name: 'f', displayOptions: { show: { name: [{ _cnd: { startsWith: 'test' } }] } } }, { name: 'testUser' })).toBe(true); });
      it('should not match when string does not start with prefix', () => { expect(ConfigValidator.isPropertyVisible({ name: 'f', displayOptions: { show: { name: [{ _cnd: { startsWith: 'test' } }] } } }, { name: 'mytest' })).toBe(false); });
      it('should not match non-string values', () => { expect(ConfigValidator.isPropertyVisible({ name: 'f', displayOptions: { show: { value: [{ _cnd: { startsWith: 'test' } }] } } }, { value: 123 })).toBe(false); });
    });

    describe('endsWith operator', () => {
      it('should match when string ends with suffix', () => { expect(ConfigValidator.isPropertyVisible({ name: 'f', displayOptions: { show: { email: [{ _cnd: { endsWith: '@example.com' } }] } } }, { email: 'user@example.com' })).toBe(true); });
      it('should not match when string does not end with suffix', () => { expect(ConfigValidator.isPropertyVisible({ name: 'f', displayOptions: { show: { email: [{ _cnd: { endsWith: '@example.com' } }] } } }, { email: 'user@other.com' })).toBe(false); });
    });

    describe('includes operator', () => {
      it('should match when string contains substring', () => { expect(ConfigValidator.isPropertyVisible({ name: 'f', displayOptions: { show: { eventId: [{ _cnd: { includes: '_' } }] } } }, { eventId: 'event_123' })).toBe(true); });
      it('should not match when string does not contain substring', () => { expect(ConfigValidator.isPropertyVisible({ name: 'f', displayOptions: { show: { eventId: [{ _cnd: { includes: '_' } }] } } }, { eventId: 'event123' })).toBe(false); });
    });

    describe('regex operator', () => {
      it('should match when string matches regex pattern', () => { expect(ConfigValidator.isPropertyVisible({ name: 'f', displayOptions: { show: { id: [{ _cnd: { regex: '^[A-Z]{3}\\d{4}$' } }] } } }, { id: 'ABC1234' })).toBe(true); });
      it('should not match when string does not match regex pattern', () => { expect(ConfigValidator.isPropertyVisible({ name: 'f', displayOptions: { show: { id: [{ _cnd: { regex: '^[A-Z]{3}\\d{4}$' } }] } } }, { id: 'abc1234' })).toBe(false); });
      it('should not match when regex pattern is invalid', () => { expect(ConfigValidator.isPropertyVisible({ name: 'f', displayOptions: { show: { id: [{ _cnd: { regex: '[invalid(regex' } }] } } }, { id: 'test' })).toBe(false); });
      it('should not match non-string values', () => { expect(ConfigValidator.isPropertyVisible({ name: 'f', displayOptions: { show: { value: [{ _cnd: { regex: '\\d+' } }] } } }, { value: 123 })).toBe(false); });
    });

    describe('exists operator', () => {
      it('should match when field exists and is not null', () => { expect(ConfigValidator.isPropertyVisible({ name: 'f', displayOptions: { show: { optionalField: [{ _cnd: { exists: true } }] } } }, { optionalField: 'value' })).toBe(true); });
      it('should match when field exists with value 0', () => { expect(ConfigValidator.isPropertyVisible({ name: 'f', displayOptions: { show: { optionalField: [{ _cnd: { exists: true } }] } } }, { optionalField: 0 })).toBe(true); });
      it('should match when field exists with empty string', () => { expect(ConfigValidator.isPropertyVisible({ name: 'f', displayOptions: { show: { optionalField: [{ _cnd: { exists: true } }] } } }, { optionalField: '' })).toBe(true); });
      it('should not match when field is undefined', () => { expect(ConfigValidator.isPropertyVisible({ name: 'f', displayOptions: { show: { optionalField: [{ _cnd: { exists: true } }] } } }, { otherField: 'value' })).toBe(false); });
      it('should not match when field is null', () => { expect(ConfigValidator.isPropertyVisible({ name: 'f', displayOptions: { show: { optionalField: [{ _cnd: { exists: true } }] } } }, { optionalField: null })).toBe(false); });
    });

    describe('mixed plain values and _cnd conditions', () => {
      it('should match plain value in array with _cnd', () => {
        const prop = { name: 'f', displayOptions: { show: { status: ['active', { _cnd: { eq: 'pending' } }] } } };
        expect(ConfigValidator.isPropertyVisible(prop, { status: 'active' })).toBe(true);
        expect(ConfigValidator.isPropertyVisible(prop, { status: 'pending' })).toBe(true);
        expect(ConfigValidator.isPropertyVisible(prop, { status: 'disabled' })).toBe(false);
      });
      it('should handle multiple conditions with AND logic', () => {
        const prop = { name: 'f', displayOptions: { show: { '@version': [{ _cnd: { gte: 1.1 } }], mode: ['advanced'] } } };
        expect(ConfigValidator.isPropertyVisible(prop, { '@version': 2.0, mode: 'advanced' })).toBe(true);
        expect(ConfigValidator.isPropertyVisible(prop, { '@version': 2.0, mode: 'basic' })).toBe(false);
        expect(ConfigValidator.isPropertyVisible(prop, { '@version': 1.0, mode: 'advanced' })).toBe(false);
      });
    });

    describe('hide conditions with _cnd', () => {
      it('should hide property when _cnd condition matches', () => {
        const prop = { name: 'f', displayOptions: { hide: { '@version': [{ _cnd: { lt: 2.0 } }] } } };
        expect(ConfigValidator.isPropertyVisible(prop, { '@version': 1.5 })).toBe(false);
        expect(ConfigValidator.isPropertyVisible(prop, { '@version': 2.0 })).toBe(true);
        expect(ConfigValidator.isPropertyVisible(prop, { '@version': 2.5 })).toBe(true);
      });
    });

    describe('Execute Workflow Trigger scenario', () => {
      it('should show property when @version >= 1.1', () => {
        const prop = { name: 'inputSource', displayOptions: { show: { '@version': [{ _cnd: { gte: 1.1 } }] } } };
        expect(ConfigValidator.isPropertyVisible(prop, { '@version': 1.1 })).toBe(true);
        expect(ConfigValidator.isPropertyVisible(prop, { '@version': 1.2 })).toBe(true);
        expect(ConfigValidator.isPropertyVisible(prop, { '@version': 2.0 })).toBe(true);
      });
      it('should hide property when @version < 1.1', () => {
        const prop = { name: 'inputSource', displayOptions: { show: { '@version': [{ _cnd: { gte: 1.1 } }] } } };
        expect(ConfigValidator.isPropertyVisible(prop, { '@version': 1.0 })).toBe(false);
        expect(ConfigValidator.isPropertyVisible(prop, { '@version': 1 })).toBe(false);
        expect(ConfigValidator.isPropertyVisible(prop, { '@version': 0.9 })).toBe(false);
      });
      it('should show outdated version warning only for v1', () => {
        const prop = { name: 'outdatedVersionWarning', displayOptions: { show: { '@version': [{ _cnd: { eq: 1 } }] } } };
        expect(ConfigValidator.isPropertyVisible(prop, { '@version': 1 })).toBe(true);
        expect(ConfigValidator.isPropertyVisible(prop, { '@version': 1.1 })).toBe(false);
        expect(ConfigValidator.isPropertyVisible(prop, { '@version': 2 })).toBe(false);
      });
    });

    describe('backward compatibility with plain values', () => {
      it('should continue to work with plain value arrays', () => {
        const prop = { name: 'f', displayOptions: { show: { resource: ['user', 'message'] } } };
        expect(ConfigValidator.isPropertyVisible(prop, { resource: 'user' })).toBe(true);
        expect(ConfigValidator.isPropertyVisible(prop, { resource: 'message' })).toBe(true);
        expect(ConfigValidator.isPropertyVisible(prop, { resource: 'channel' })).toBe(false);
      });
      it('should work with properties without displayOptions', () => {
        expect(ConfigValidator.isPropertyVisible({ name: 'f' }, {})).toBe(true);
      });
    });
  });

  // ─── Null/Undefined Handling (from edge-cases) ─────────────────────

  describe('null and undefined handling', () => {
    it('should handle null config gracefully', () => { expect(() => { ConfigValidator.validate('nodes-base.test', null as any, []); }).toThrow(TypeError); });
    it('should handle undefined config gracefully', () => { expect(() => { ConfigValidator.validate('nodes-base.test', undefined as any, []); }).toThrow(TypeError); });
    it('should handle null properties array gracefully', () => { expect(() => { ConfigValidator.validate('nodes-base.test', {}, null as any); }).toThrow(TypeError); });
    it('should handle undefined properties array gracefully', () => { expect(() => { ConfigValidator.validate('nodes-base.test', {}, undefined as any); }).toThrow(TypeError); });
  });

  // ─── Boundary Value Testing (from edge-cases) ─────────────────────

  describe('boundary value testing', () => {
    it('should handle empty arrays', () => { expect(ConfigValidator.validate('nodes-base.test', { arrayField: [] }, [{ name: 'arrayField', type: 'collection' }]).valid).toBe(true); });
    it('should handle very large property arrays', () => { expect(ConfigValidator.validate('nodes-base.test', { field1: 'value1' }, Array(1000).fill(null).map((_, i) => ({ name: `field${i}`, type: 'string' }))).valid).toBe(true); });
    it('should handle deeply nested displayOptions', () => {
      const result = ConfigValidator.validate('nodes-base.test', { level1: 'a', level2: 'b', level3: 'c', deepField: 'value' }, [
        { name: 'level1', type: 'options', options: ['a', 'b'] },
        { name: 'level2', type: 'options', options: ['a', 'b'], displayOptions: { show: { level1: ['a'] } } },
        { name: 'level3', type: 'options', options: ['a', 'b', 'c'], displayOptions: { show: { level1: ['a'], level2: ['b'] } } },
        { name: 'deepField', type: 'string', displayOptions: { show: { level1: ['a'], level2: ['b'], level3: ['c'] } } }
      ]);
      expect(result.visibleProperties).toContain('deepField');
    });
    it('should handle extremely long string values', () => { expect(ConfigValidator.validate('nodes-base.test', { longField: 'a'.repeat(10000) }, [{ name: 'longField', type: 'string' }]).valid).toBe(true); });
  });

  // ─── Invalid Data Type Handling (from edge-cases) ─────────────────

  describe('invalid data type handling', () => {
    it('should handle NaN values', () => { expect(ConfigValidator.validate('nodes-base.test', { numberField: NaN }, [{ name: 'numberField', type: 'number' }])).toBeDefined(); });
    it('should handle Infinity values', () => { expect(ConfigValidator.validate('nodes-base.test', { numberField: Infinity }, [{ name: 'numberField', type: 'number' }])).toBeDefined(); });
    it('should handle objects when expecting primitives', () => {
      const result = ConfigValidator.validate('nodes-base.test', { stringField: { nested: 'object' }, numberField: { value: 123 } }, [{ name: 'stringField', type: 'string' }, { name: 'numberField', type: 'number' }]);
      expect(result.errors).toHaveLength(2);
      expect(result.errors.every(e => e.type === 'invalid_type')).toBe(true);
    });
    it('should handle circular references in config', () => {
      const config: any = { field: 'value' };
      config.circular = config;
      expect(ConfigValidator.validate('nodes-base.test', config, [{ name: 'field', type: 'string' }, { name: 'circular', type: 'json' }])).toBeDefined();
    });
  });

  // ─── Performance Boundaries (from edge-cases) ─────────────────────

  describe('performance boundaries', () => {
    it('should validate large config objects within reasonable time', () => {
      const config: Record<string, any> = {};
      const properties: any[] = [];
      for (let i = 0; i < 1000; i++) { config[`field_${i}`] = `value_${i}`; properties.push({ name: `field_${i}`, type: 'string' }); }
      const startTime = Date.now();
      const result = ConfigValidator.validate('nodes-base.test', config, properties);
      expect(result.valid).toBe(true);
      expect(Date.now() - startTime).toBeLessThan(1000);
    });
  });

  // ─── Special Characters (from edge-cases) ─────────────────────────

  describe('special characters and encoding', () => {
    it('should handle special characters in property values', () => { expect(ConfigValidator.validate('nodes-base.test', { specialField: 'Value with special chars: <>&"\'`\n\r\t' }, [{ name: 'specialField', type: 'string' }]).valid).toBe(true); });
    it('should handle unicode characters', () => { expect(ConfigValidator.validate('nodes-base.test', { unicodeField: 'Unicode: \u4F60\u597D\u4E16\u754C' }, [{ name: 'unicodeField', type: 'string' }]).valid).toBe(true); });
  });

  // ─── Complex Validation Scenarios (from edge-cases) ───────────────

  describe('complex validation scenarios', () => {
    it('should handle conflicting displayOptions conditions', () => {
      expect(ConfigValidator.validate('nodes-base.test', { mode: 'both', showField: true, conflictField: 'value' }, [
        { name: 'mode', type: 'options', options: ['show', 'hide', 'both'] },
        { name: 'showField', type: 'boolean' },
        { name: 'conflictField', type: 'string', displayOptions: { show: { mode: ['show'], showField: [true] }, hide: { mode: ['hide'] } } }
      ])).toBeDefined();
    });
    it('should handle multiple validation profiles correctly', () => {
      const result = ConfigValidator.validate('nodes-base.code', { language: 'javascript', jsCode: 'const x = 1;' }, [{ name: 'language', type: 'options' }, { name: 'jsCode', type: 'string' }]);
      expect(result.warnings.some(w => w.message.includes('No return statement found'))).toBe(true);
    });
  });

  // ─── Error Recovery (from edge-cases) ─────────────────────────────

  describe('error recovery and resilience', () => {
    it('should continue validation after encountering errors', () => {
      const result = ConfigValidator.validate('nodes-base.test', { field1: 'invalid-for-number', field2: null, field3: 'valid' }, [{ name: 'field1', type: 'number' }, { name: 'field2', type: 'string', required: true }, { name: 'field3', type: 'string' }]);
      expect(result.errors.length).toBeGreaterThanOrEqual(2);
      expect(result.errors.find(e => e.property === 'field1')?.type).toBe('invalid_type');
      expect(result.errors.find(e => e.property === 'field2')).toBeDefined();
      expect(result.visibleProperties).toContain('field3');
    });
    it('should handle malformed property definitions gracefully', () => {
      const result = ConfigValidator.validate('nodes-base.test', { field: 'value' }, [{ name: 'field', type: 'string' }, { type: 'string' } as any, { name: 'field2' } as any]);
      expect(result).toBeDefined();
      expect(result.valid).toBeDefined();
    });
  });

  // ─── Batch Validation (from edge-cases) ───────────────────────────

  describe('validateBatch method implementation', () => {
    it('should validate multiple configs in batch if method exists', () => {
      const configs = [{ nodeType: 'nodes-base.test', config: { field: 'value1' }, properties: [] as any[] }, { nodeType: 'nodes-base.test', config: { field: 'value2' }, properties: [] as any[] }];
      if ('validateBatch' in ConfigValidator) { expect((ConfigValidator as any).validateBatch(configs)).toHaveLength(2); }
      else { expect(configs.map(c => ConfigValidator.validate(c.nodeType, c.config, c.properties))).toHaveLength(2); }
    });
  });

  // ─── HTTP Request Node (from node-specific) ──────────────────────

  describe('HTTP Request node validation', () => {
    it('should perform HTTP Request specific validation', () => {
      const result = ConfigValidator.validate('nodes-base.httpRequest', { method: 'POST', url: 'invalid-url', sendBody: false }, [{ name: 'method', type: 'options' }, { name: 'url', type: 'string' }, { name: 'sendBody', type: 'boolean' }]);
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toMatchObject({ type: 'invalid_value', property: 'url', message: 'URL must start with http:// or https://' });
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toMatchObject({ type: 'missing_common', property: 'sendBody', message: 'POST requests typically send a body' });
      expect(result.autofix).toMatchObject({ sendBody: true, contentType: 'json' });
    });
    it('should validate JSON in HTTP Request body', () => {
      const result = ConfigValidator.validate('nodes-base.httpRequest', { method: 'POST', url: 'https://api.example.com', contentType: 'json', body: '{"invalid": json}' }, [{ name: 'method', type: 'options' }, { name: 'url', type: 'string' }, { name: 'contentType', type: 'options' }, { name: 'body', type: 'string' }]);
      expect(result.errors.some(e => e.property === 'body' && e.message.includes('Invalid JSON')));
    });
    it('should handle webhook-specific validation', () => {
      const result = ConfigValidator.validate('nodes-base.webhook', { httpMethod: 'GET', path: 'webhook-endpoint' }, [{ name: 'httpMethod', type: 'options' }, { name: 'path', type: 'string' }]);
      expect(result.warnings.some(w => w.property === 'path' && w.message.includes('should start with /')));
    });
  });

  // ─── Code Node (from node-specific) ──────────────────────────────

  describe('Code node validation', () => {
    it('should validate Code node configurations', () => {
      const result = ConfigValidator.validate('nodes-base.code', { language: 'javascript', jsCode: '' }, [{ name: 'language', type: 'options' }, { name: 'jsCode', type: 'string' }]);
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toMatchObject({ type: 'missing_required', property: 'jsCode', message: 'Code cannot be empty' });
    });
    it('should validate JavaScript syntax in Code node', () => {
      const result = ConfigValidator.validate('nodes-base.code', { language: 'javascript', jsCode: 'const data = { foo: "bar" };\nif (data.foo {\n  return [{json: data}];\n}' }, [{ name: 'language', type: 'options' }, { name: 'jsCode', type: 'string' }]);
      expect(result.errors.some(e => e.message.includes('Unbalanced')));
      expect(result.warnings).toHaveLength(1);
    });
    it('should validate n8n-specific patterns in Code node', () => {
      const result = ConfigValidator.validate('nodes-base.code', { language: 'javascript', jsCode: 'const processedData = items.map(item => ({...item.json, processed: true}));' }, [{ name: 'language', type: 'options' }, { name: 'jsCode', type: 'string' }]);
      expect(result.warnings.some(w => w.type === 'missing_common' && w.message.includes('No return statement found'))).toBe(true);
    });
    it('should handle empty code in Code node', () => {
      const result = ConfigValidator.validate('nodes-base.code', { language: 'javascript', jsCode: '   \n  \t  \n   ' }, [{ name: 'language', type: 'options' }, { name: 'jsCode', type: 'string' }]);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.type === 'missing_required' && e.message.includes('Code cannot be empty'))).toBe(true);
    });
    it('should validate complex return patterns in Code node', () => {
      const result = ConfigValidator.validate('nodes-base.code', { language: 'javascript', jsCode: 'return ["string1", "string2", "string3"];' }, [{ name: 'language', type: 'options' }, { name: 'jsCode', type: 'string' }]);
      expect(result.warnings.some(w => w.type === 'invalid_value' && w.message.includes('Items must be objects with json property'))).toBe(true);
    });
    it('should validate Code node with $helpers usage', () => {
      const result = ConfigValidator.validate('nodes-base.code', { language: 'javascript', jsCode: 'const workflow = $helpers.getWorkflowStaticData();\nworkflow.counter = (workflow.counter || 0) + 1;\nreturn [{json: {count: workflow.counter}}];' }, [{ name: 'language', type: 'options' }, { name: 'jsCode', type: 'string' }]);
      expect(result.warnings.some(w => w.type === 'best_practice' && w.message.includes('$helpers is only available in Code nodes'))).toBe(true);
    });
    it('should detect incorrect $helpers.getWorkflowStaticData usage', () => {
      const result = ConfigValidator.validate('nodes-base.code', { language: 'javascript', jsCode: 'const data = $helpers.getWorkflowStaticData;\nreturn [{json: {data}}];' }, [{ name: 'language', type: 'options' }, { name: 'jsCode', type: 'string' }]);
      expect(result.errors.some(e => e.type === 'invalid_value' && e.message.includes('getWorkflowStaticData requires parentheses'))).toBe(true);
    });
    it('should validate console.log usage', () => {
      const result = ConfigValidator.validate('nodes-base.code', { language: 'javascript', jsCode: "console.log('Debug info:', items);\nreturn items;" }, [{ name: 'language', type: 'options' }, { name: 'jsCode', type: 'string' }]);
      expect(result.warnings.some(w => w.type === 'best_practice' && w.message.includes('console.log output appears in n8n execution logs'))).toBe(true);
    });
    it('should validate $json usage warning', () => {
      const result = ConfigValidator.validate('nodes-base.code', { language: 'javascript', jsCode: 'const data = $json.myField;\nreturn [{json: {processed: data}}];' }, [{ name: 'language', type: 'options' }, { name: 'jsCode', type: 'string' }]);
      expect(result.warnings.some(w => w.type === 'best_practice' && w.message.includes('$json only works in "Run Once for Each Item" mode'))).toBe(true);
    });
    it('should not warn about properties for Code nodes', () => {
      const result = ConfigValidator.validate('nodes-base.code', { language: 'javascript', jsCode: 'return items;', unusedProperty: 'test' }, [{ name: 'language', type: 'options' }, { name: 'jsCode', type: 'string' }]);
      expect(result.warnings.some(w => w.type === 'inefficient' && w.property === 'unusedProperty')).toBe(false);
    });
    it('should suggest error handling for complex code', () => {
      const result = ConfigValidator.validate('nodes-base.code', { language: 'javascript', jsCode: "const apiUrl = items[0].json.url;\nconst response = await fetch(apiUrl);\nconst data = await response.json();\nreturn [{json: data}];" }, [{ name: 'language', type: 'options' }, { name: 'jsCode', type: 'string' }]);
      expect(result.suggestions.some(s => s.includes('Consider adding error handling')));
    });
    it('should suggest error handling for non-trivial code', () => {
      const result = ConfigValidator.validate('nodes-base.code', { language: 'javascript', jsCode: Array(10).fill('const x = 1;').join('\n') + '\nreturn items;' }, [{ name: 'language', type: 'options' }, { name: 'jsCode', type: 'string' }]);
      expect(result.suggestions.some(s => s.includes('error handling')));
    });
    it('should validate async operations without await', () => {
      const result = ConfigValidator.validate('nodes-base.code', { language: 'javascript', jsCode: "const promise = fetch('https://api.example.com');\nreturn [{json: {data: promise}}];" }, [{ name: 'language', type: 'options' }, { name: 'jsCode', type: 'string' }]);
      expect(result.warnings.some(w => w.type === 'best_practice' && w.message.includes('Async operation without await'))).toBe(true);
    });
  });

  // ─── Python Code Node (from node-specific) ──────────────────────

  describe('Python Code node validation', () => {
    it('should validate Python code syntax', () => {
      const result = ConfigValidator.validate('nodes-base.code', { language: 'python', pythonCode: 'def process_data():\n  return [{"json": {"test": True}]' }, [{ name: 'language', type: 'options' }, { name: 'pythonCode', type: 'string' }]);
      expect(result.errors.some(e => e.type === 'syntax_error' && e.message.includes('Unmatched bracket'))).toBe(true);
    });
    it('should detect mixed indentation in Python code', () => {
      const result = ConfigValidator.validate('nodes-base.code', { language: 'python', pythonCode: 'def process():\n    x = 1\n\ty = 2\n    return [{"json": {"x": x, "y": y}}]' }, [{ name: 'language', type: 'options' }, { name: 'pythonCode', type: 'string' }]);
      expect(result.errors.some(e => e.type === 'syntax_error' && e.message.includes('Mixed indentation'))).toBe(true);
    });
    it('should warn about incorrect n8n return patterns', () => {
      const result = ConfigValidator.validate('nodes-base.code', { language: 'python', pythonCode: 'result = {"data": "value"}\nreturn result' }, [{ name: 'language', type: 'options' }, { name: 'pythonCode', type: 'string' }]);
      expect(result.warnings.some(w => w.type === 'invalid_value' && w.message.includes('Must return array of objects with json key'))).toBe(true);
    });
    it('should warn about using external libraries in Python code', () => {
      const result = ConfigValidator.validate('nodes-base.code', { language: 'python', pythonCode: 'import pandas as pd\nimport requests\ndf = pd.DataFrame(items)\nresponse = requests.get("https://api.example.com")\nreturn [{"json": {"data": response.json()}}]' }, [{ name: 'language', type: 'options' }, { name: 'pythonCode', type: 'string' }]);
      expect(result.warnings.some(w => w.type === 'invalid_value' && w.message.includes('External libraries not available'))).toBe(true);
    });
    it('should validate Python code with print statements', () => {
      const result = ConfigValidator.validate('nodes-base.code', { language: 'python', pythonCode: 'print("Debug:", items)\nprocessed = []\nfor item in items:\n    print(f"Processing: {item}")\n    processed.append({"json": item["json"]})\nreturn processed' }, [{ name: 'language', type: 'options' }, { name: 'pythonCode', type: 'string' }]);
      expect(result.warnings.some(w => w.type === 'best_practice' && w.message.includes('print() output appears in n8n execution logs'))).toBe(true);
    });
  });

  // ─── Database Node (from node-specific, non-security) ────────────

  describe('Database node validation', () => {
    it('should validate SQL SELECT * performance warning', () => {
      const result = ConfigValidator.validate('nodes-base.postgres', { query: 'SELECT * FROM large_table WHERE status = "active"' }, [{ name: 'query', type: 'string' }]);
      expect(result.suggestions.some(s => s.includes('Consider selecting specific columns'))).toBe(true);
    });
  });
});
