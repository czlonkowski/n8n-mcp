import { describe, it, expect, vi } from 'vitest';
import {
  LLM_PROVIDER_PRESETS,
  resolveProviderPreset,
} from '@/community/documentation-generator';

// Mock logger to suppress output during tests
vi.mock('@/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('LLM provider presets', () => {
  describe('minimax preset definition', () => {
    const preset = LLM_PROVIDER_PRESETS.minimax;

    it('is registered', () => {
      expect(preset).toBeDefined();
    });

    it('defaults to the global region and the MiniMax-M3 model', () => {
      expect(preset.defaultRegion).toBe('global');
      expect(preset.defaultModel).toBe('MiniMax-M3');
    });

    it('exposes both global and cn OpenAI-compatible endpoints', () => {
      expect(preset.baseUrls.global).toBe('https://api.minimax.io/v1');
      expect(preset.baseUrls.cn).toBe('https://api.minimaxi.com/v1');
    });

    it('describes both first-class models with their thinking modes', () => {
      expect(Object.keys(preset.models).sort()).toEqual(['MiniMax-M2.7', 'MiniMax-M3']);
      expect(preset.models['MiniMax-M3'].thinking).toEqual(['adaptive', 'disabled']);
      expect(preset.models['MiniMax-M2.7'].thinking).toEqual(['always_on']);
    });

    it('does not send the vLLM-only chat_template_kwargs field (cloud API)', () => {
      expect(preset.sendThinkingKwargs).toBe(false);
    });

    it('discovers the API key from MINIMAX_API_KEY', () => {
      expect(preset.apiKeyEnvVars).toContain('MINIMAX_API_KEY');
    });
  });

  describe('resolveProviderPreset', () => {
    it('returns undefined when no provider is selected', () => {
      expect(resolveProviderPreset({})).toBeUndefined();
    });

    it('returns undefined for an unknown provider', () => {
      expect(resolveProviderPreset({ N8N_MCP_LLM_PROVIDER: 'does-not-exist' })).toBeUndefined();
    });

    it('resolves the minimax preset case-insensitively to the global endpoint', () => {
      const resolved = resolveProviderPreset({ N8N_MCP_LLM_PROVIDER: 'MiniMax' });
      expect(resolved?.provider).toBe('minimax');
      expect(resolved?.region).toBe('global');
      expect(resolved?.baseUrl).toBe('https://api.minimax.io/v1');
      expect(resolved?.defaultModel).toBe('MiniMax-M3');
      expect(resolved?.sendThinkingKwargs).toBe(false);
    });

    it('selects the cn endpoint when the region is cn', () => {
      const resolved = resolveProviderPreset({
        N8N_MCP_LLM_PROVIDER: 'minimax',
        N8N_MCP_LLM_REGION: 'CN',
      });
      expect(resolved?.region).toBe('cn');
      expect(resolved?.baseUrl).toBe('https://api.minimaxi.com/v1');
    });

    it('falls back to the default region for an unknown region value', () => {
      const resolved = resolveProviderPreset({
        N8N_MCP_LLM_PROVIDER: 'minimax',
        N8N_MCP_LLM_REGION: 'mars',
      });
      expect(resolved?.region).toBe('global');
      expect(resolved?.baseUrl).toBe('https://api.minimax.io/v1');
    });

    it('picks up the API key from the preset fallback env var', () => {
      const resolved = resolveProviderPreset({
        N8N_MCP_LLM_PROVIDER: 'minimax',
        MINIMAX_API_KEY: 'test-key',
      });
      expect(resolved?.apiKey).toBe('test-key');
    });

    it('leaves the API key undefined when no preset env var is set', () => {
      const resolved = resolveProviderPreset({ N8N_MCP_LLM_PROVIDER: 'minimax' });
      expect(resolved?.apiKey).toBeUndefined();
    });
  });
});
