import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  LLM_PROVIDER_PRESETS,
  resolveProviderPreset,
  createDocumentationGenerator,
} from '@/community/documentation-generator';

vi.mock('@/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe('LLM provider presets', () => {
  const preset = LLM_PROVIDER_PRESETS.minimax;

  it('defaults to Flash and offers only the current models in order', () => {
    expect(preset.defaultRegion).toBe('global');
    expect(preset.defaultModel).toBe('MiniMax-M3.1-Flash');
    expect(Object.keys(preset.models)).toEqual(['MiniMax-M3.1-Flash', 'MiniMax-M3']);
    expect(preset.models['MiniMax-M3.1-Flash'].thinking).toEqual(['adaptive']);
    expect(preset.models['MiniMax-M3'].thinking).toEqual(['adaptive', 'disabled']);
    expect(preset.sendThinkingKwargs).toBe(false);
    expect(preset.apiKeyEnvVars).toContain('MINIMAX_API_KEY');
  });

  it('exposes global and CN OpenAI-compatible endpoints', () => {
    expect(preset.baseUrls).toEqual({
      global: 'https://api.minimax.io/v1',
      cn: 'https://api.minimax.cn/v1',
    });
  });

  it('returns undefined for absent or unknown providers', () => {
    expect(resolveProviderPreset({})).toBeUndefined();
    expect(resolveProviderPreset({ N8N_MCP_LLM_PROVIDER: 'does-not-exist' })).toBeUndefined();
  });

  it('resolves provider and region case-insensitively', () => {
    expect(resolveProviderPreset({
      N8N_MCP_LLM_PROVIDER: ' MiniMax ', N8N_MCP_LLM_REGION: 'CN',
    })).toMatchObject({
      provider: 'minimax', region: 'cn', baseUrl: preset.baseUrls.cn,
      defaultModel: 'MiniMax-M3.1-Flash', sendThinkingKwargs: false,
    });
  });

  it('falls back to the global region for an unknown region', () => {
    expect(resolveProviderPreset({
      N8N_MCP_LLM_PROVIDER: 'minimax', N8N_MCP_LLM_REGION: 'mars',
    })?.baseUrl).toBe(preset.baseUrls.global);
  });

  it('discovers the optional preset API key', () => {
    expect(resolveProviderPreset({ N8N_MCP_LLM_PROVIDER: 'minimax' })?.apiKey).toBeUndefined();
    expect(resolveProviderPreset({
      N8N_MCP_LLM_PROVIDER: 'minimax', MINIMAX_API_KEY: 'fixture-key',
    })?.apiKey).toBe('fixture-key');
  });
});

describe('documentation generator HTTP requests', () => {
  const summary = {
    purpose: 'Send notifications', capabilities: ['Send messages'], authentication: 'API key',
    commonUseCases: ['Notify a team'], limitations: [], relatedNodes: [],
  };
  const input = {
    nodeType: 'community.notify', displayName: 'Notify', readme: '# Notify\nSend notifications.',
  };
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    for (const name of [
      'N8N_MCP_LLM_PROVIDER', 'N8N_MCP_LLM_REGION', 'N8N_MCP_LLM_MODEL',
      'N8N_MCP_LLM_BASE_URL', 'N8N_MCP_LLM_API_KEY', 'N8N_MCP_LLM_TIMEOUT',
      'MINIMAX_API_KEY', 'OPENAI_API_KEY',
    ]) {
      vi.stubEnv(name, undefined);
    }
    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify(summary), reasoning_content: 'Private reasoning' } }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  function request() {
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    return { url, options, body: JSON.parse(options!.body as string) };
  }

  it.each(['global', 'cn'])('sends the default Flash summary request in %s', async (region) => {
    vi.stubEnv('N8N_MCP_LLM_PROVIDER', 'minimax');
    vi.stubEnv('N8N_MCP_LLM_REGION', region);
    vi.stubEnv('MINIMAX_API_KEY', 'fixture-key');
    const result = await createDocumentationGenerator().generateSummary(input);
    expect(result.error).toBeUndefined();
    expect(result.summary).toEqual(summary);
    const { url, options, body } = request();
    expect(url).toBe(`https://api.minimax.${region === 'cn' ? 'cn' : 'io'}/v1/chat/completions`);
    expect(options?.method).toBe('POST');
    expect(options?.headers).toEqual({ 'Content-Type': 'application/json', Authorization: 'Bearer fixture-key' });
    // An exact body shape also excludes disabled thinking, effort=none,
    // service_tier, reasoning_split=false and local-server-only fields.
    expect(body).toEqual({
      model: 'MiniMax-M3.1-Flash', max_completion_tokens: 2000,
      messages: [
        { role: 'system', content: expect.stringContaining('generate documentation') },
        { role: 'user', content: expect.stringContaining(input.readme) },
      ],
    });
  });

  it.each(['MiniMax-M3', 'MiniMax-M2.7', 'custom-saved-model'])(
    'preserves explicit model %s and endpoint/key overrides', async (model) => {
      vi.stubEnv('N8N_MCP_LLM_PROVIDER', 'minimax');
      vi.stubEnv('N8N_MCP_LLM_MODEL', model);
      vi.stubEnv('N8N_MCP_LLM_BASE_URL', 'https://proxy.example/v1');
      vi.stubEnv('N8N_MCP_LLM_API_KEY', 'explicit-fixture-key');
      vi.stubEnv('MINIMAX_API_KEY', 'preset-fixture-key');
      expect((await createDocumentationGenerator().generateSummary(input)).error).toBeUndefined();
      const { url, options, body } = request();
      expect(url).toBe('https://proxy.example/v1/chat/completions');
      expect(options?.headers).toHaveProperty('Authorization', 'Bearer explicit-fixture-key');
      expect(body.model).toBe(model);
      expect(body).not.toHaveProperty('chat_template_kwargs');
      expect(body).not.toHaveProperty('thinking');
      expect(body).not.toHaveProperty('reasoning_effort');
    },
  );

  it.each(['api.minimax.io', 'api.minimax.cn', 'api.minimaxi.com'])(
    'preserves manual %s URLs without sending local thinking controls', async (host) => {
      vi.stubEnv('N8N_MCP_LLM_BASE_URL', `https://${host}/v1`);
      vi.stubEnv('N8N_MCP_LLM_MODEL', 'MiniMax-M3');
      expect((await createDocumentationGenerator().testConnection()).success).toBe(true);
      const { url, body } = request();
      expect(url).toBe(`https://${host}/v1/chat/completions`);
      expect(body).toEqual({ model: 'MiniMax-M3', messages: [{ role: 'user', content: 'Hello' }], max_completion_tokens: 200 });
    },
  );

  it('uses Flash for the connection probe', async () => {
    vi.stubEnv('N8N_MCP_LLM_PROVIDER', 'minimax');
    expect(await createDocumentationGenerator().testConnection()).toEqual({
      success: true, message: 'Connected to MiniMax-M3.1-Flash',
    });
    expect(request().body).toEqual({
      model: 'MiniMax-M3.1-Flash', messages: [{ role: 'user', content: 'Hello' }], max_completion_tokens: 200,
    });
  });

  it('still extracts JSON from legacy thinking-tag responses', async () => {
    vi.stubEnv('N8N_MCP_LLM_PROVIDER', 'minimax');
    vi.stubEnv('N8N_MCP_LLM_MODEL', 'MiniMax-M2.7');
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      choices: [{ message: { content: `<think>Reasoning</think>${JSON.stringify(summary)}` } }],
    })));
    expect(await createDocumentationGenerator().generateSummary(input)).toEqual({ nodeType: input.nodeType, summary });
  });

  it('preserves local defaults', async () => {
    expect((await createDocumentationGenerator().testConnection()).success).toBe(true);
    const { url, body } = request();
    expect(url).toBe('http://localhost:1234/v1/chat/completions');
    expect(body).toEqual({
      model: 'qwen3-4b-thinking-2507', messages: [{ role: 'user', content: 'Hello' }],
      max_completion_tokens: 200, temperature: 0.3, chat_template_kwargs: { enable_thinking: false },
    });
  });

  it.each(['http://example.com/minimax.io', 'https://api.minimax.io.example.com/v1'])(
    'does not classify %s as a MiniMax host', async (url) => {
      vi.stubEnv('N8N_MCP_LLM_BASE_URL', url);
      await createDocumentationGenerator().testConnection();
      expect(request().body.chat_template_kwargs).toEqual({ enable_thinking: false });
    },
  );
});
