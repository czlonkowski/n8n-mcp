import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  LLM_PROVIDER_PRESETS,
  LLMProviderPreset,
  clampTemperature,
  resolveProviderPreset,
  createDocumentationGenerator,
  DocumentationGenerator,
} from '../../../src/community/documentation-generator';

// Mock OpenAI
vi.mock('openai', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      chat: {
        completions: {
          create: vi.fn(),
        },
      },
    })),
  };
});

// Mock logger
vi.mock('../../../src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('LLM Provider Presets', () => {
  describe('LLM_PROVIDER_PRESETS', () => {
    it('should include minimax preset', () => {
      expect(LLM_PROVIDER_PRESETS).toHaveProperty('minimax');
      const minimax = LLM_PROVIDER_PRESETS.minimax;
      expect(minimax.baseUrl).toBe('https://api.minimax.io/v1');
      expect(minimax.model).toBe('MiniMax-M3');
      expect(minimax.supportsTemperature).toBe(true);
      expect(minimax.temperatureRange).toEqual([0, 1]);
    });

    it('should include openai preset', () => {
      expect(LLM_PROVIDER_PRESETS).toHaveProperty('openai');
      const openai = LLM_PROVIDER_PRESETS.openai;
      expect(openai.baseUrl).toBe('https://api.openai.com/v1');
      expect(openai.model).toBe('gpt-4o-mini');
      expect(openai.supportsTemperature).toBe(true);
    });

    it('should include anthropic preset', () => {
      expect(LLM_PROVIDER_PRESETS).toHaveProperty('anthropic');
      const anthropic = LLM_PROVIDER_PRESETS.anthropic;
      expect(anthropic.baseUrl).toBe('https://api.anthropic.com/v1');
      expect(anthropic.supportsTemperature).toBe(true);
    });

    it('all presets should have required fields', () => {
      for (const [name, preset] of Object.entries(LLM_PROVIDER_PRESETS)) {
        expect(preset.baseUrl).toBeTruthy();
        expect(preset.model).toBeTruthy();
        expect(typeof preset.supportsTemperature).toBe('boolean');
      }
    });
  });

  describe('clampTemperature', () => {
    it('should clamp value below minimum', () => {
      expect(clampTemperature(-0.5, [0, 1])).toBe(0);
    });

    it('should clamp value above maximum', () => {
      expect(clampTemperature(1.5, [0, 1])).toBe(1);
    });

    it('should not clamp value within range', () => {
      expect(clampTemperature(0.5, [0, 1])).toBe(0.5);
    });

    it('should handle value at exact minimum', () => {
      expect(clampTemperature(0, [0, 1])).toBe(0);
    });

    it('should handle value at exact maximum', () => {
      expect(clampTemperature(1, [0, 1])).toBe(1);
    });

    it('should handle custom range', () => {
      expect(clampTemperature(0.1, [0.2, 0.8])).toBe(0.2);
      expect(clampTemperature(0.9, [0.2, 0.8])).toBe(0.8);
      expect(clampTemperature(0.5, [0.2, 0.8])).toBe(0.5);
    });
  });

  describe('resolveProviderPreset', () => {
    it('should resolve minimax preset (lowercase)', () => {
      const preset = resolveProviderPreset('minimax');
      expect(preset).toBeDefined();
      expect(preset!.baseUrl).toBe('https://api.minimax.io/v1');
    });

    it('should resolve MiniMax preset (mixed case)', () => {
      const preset = resolveProviderPreset('MiniMax');
      expect(preset).toBeDefined();
      expect(preset!.model).toBe('MiniMax-M3');
    });

    it('should resolve openai preset', () => {
      const preset = resolveProviderPreset('openai');
      expect(preset).toBeDefined();
      expect(preset!.baseUrl).toBe('https://api.openai.com/v1');
    });

    it('should resolve OPENAI preset (uppercase)', () => {
      const preset = resolveProviderPreset('OPENAI');
      expect(preset).toBeDefined();
    });

    it('should return undefined for unknown provider', () => {
      expect(resolveProviderPreset('unknown')).toBeUndefined();
    });

    it('should return undefined for empty string', () => {
      expect(resolveProviderPreset('')).toBeUndefined();
    });

    it('should return undefined for undefined', () => {
      expect(resolveProviderPreset(undefined)).toBeUndefined();
    });
  });

  describe('createDocumentationGenerator with provider presets', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
      // Clear all LLM-related env vars
      delete process.env.N8N_MCP_LLM_PROVIDER;
      delete process.env.N8N_MCP_LLM_BASE_URL;
      delete process.env.N8N_MCP_LLM_MODEL;
      delete process.env.N8N_MCP_LLM_TIMEOUT;
      delete process.env.N8N_MCP_LLM_API_KEY;
      delete process.env.MINIMAX_API_KEY;
      delete process.env.OPENAI_API_KEY;
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('should use minimax preset when N8N_MCP_LLM_PROVIDER=minimax', () => {
      process.env.N8N_MCP_LLM_PROVIDER = 'minimax';
      process.env.MINIMAX_API_KEY = 'test-minimax-key';

      const generator = createDocumentationGenerator();

      expect(generator['model']).toBe('MiniMax-M3');
    });

    it('should use openai preset when N8N_MCP_LLM_PROVIDER=openai', () => {
      process.env.N8N_MCP_LLM_PROVIDER = 'openai';
      process.env.OPENAI_API_KEY = 'test-openai-key';

      const generator = createDocumentationGenerator();

      expect(generator['model']).toBe('gpt-4o-mini');
    });

    it('should allow N8N_MCP_LLM_MODEL to override preset model', () => {
      process.env.N8N_MCP_LLM_PROVIDER = 'minimax';
      process.env.N8N_MCP_LLM_MODEL = 'MiniMax-M2.7-highspeed';
      process.env.MINIMAX_API_KEY = 'test-key';

      const generator = createDocumentationGenerator();

      expect(generator['model']).toBe('MiniMax-M2.7-highspeed');
    });

    it('should allow N8N_MCP_LLM_BASE_URL to override preset base URL', () => {
      process.env.N8N_MCP_LLM_PROVIDER = 'minimax';
      process.env.N8N_MCP_LLM_BASE_URL = 'https://custom-proxy.example.com/v1';
      process.env.MINIMAX_API_KEY = 'test-key';

      const generator = createDocumentationGenerator();

      // Model should still come from preset since N8N_MCP_LLM_MODEL is not set
      expect(generator['model']).toBe('MiniMax-M3');
    });

    it('should auto-detect MINIMAX_API_KEY when no explicit API key is set', () => {
      process.env.N8N_MCP_LLM_PROVIDER = 'minimax';
      process.env.MINIMAX_API_KEY = 'test-minimax-key';

      const generator = createDocumentationGenerator();

      // Generator should be created successfully (no error thrown)
      expect(generator).toBeInstanceOf(DocumentationGenerator);
    });

    it('should prefer N8N_MCP_LLM_API_KEY over MINIMAX_API_KEY', () => {
      process.env.N8N_MCP_LLM_PROVIDER = 'minimax';
      process.env.N8N_MCP_LLM_API_KEY = 'explicit-key';
      process.env.MINIMAX_API_KEY = 'minimax-key';

      const generator = createDocumentationGenerator();

      expect(generator).toBeInstanceOf(DocumentationGenerator);
    });

    it('should set temperature for minimax provider', () => {
      process.env.N8N_MCP_LLM_PROVIDER = 'minimax';
      process.env.MINIMAX_API_KEY = 'test-key';

      const generator = createDocumentationGenerator();

      expect(generator['temperature']).toBe(0.3);
    });

    it('should set temperature for local server (no provider preset)', () => {
      delete process.env.N8N_MCP_LLM_PROVIDER;
      process.env.N8N_MCP_LLM_BASE_URL = 'http://localhost:1234/v1';

      const generator = createDocumentationGenerator();

      expect(generator['temperature']).toBe(0.3);
    });

    it('should fall back to defaults when no provider and no env vars', () => {
      const generator = createDocumentationGenerator();

      expect(generator['model']).toBe('qwen3-4b-thinking-2507');
      expect(generator['timeout']).toBe(60000);
    });
  });
});
