/**
 * Model providers n8n Agents accept and the credential types each maps to.
 * Source: n8n `packages/@n8n/api-types/src/agents/model-providers.ts`
 * (AGENT_MODEL_PROVIDER_CREDENTIAL_TYPES). The agents runtime validates
 * credentials against `packages/cli/src/modules/agents/llm-provider-defaults.ts`
 * (LLM_PROVIDER_DEFAULTS), which on n8n 2.36.7 has no entry for azureOpenAiApi
 * or aws — those credentials are rejected as incompatible even though the
 * api-types table lists them. Re-check both files on each n8n update.
 *
 * Provider keys are the identifiers n8n itself uses (the `provider` enum of
 * `discover_agent_assets` and the provider prefix of an agent config's
 * `model` string, e.g. "azure-openai/gpt-5.4-mini") — verified against
 * docs/local/official-agent-tools-2026-08-27/agent-tools-schemas.json
 * (discover_agent_assets inputSchema.provider.enum) and spike-log-1-create.json
 * / spike-log-3-azure-incompatible.json.
 */
export const AGENT_MODEL_PROVIDER_CREDENTIAL_TYPES: Record<string, string[]> = {
  openai: ['openAiApi'],
  anthropic: ['anthropicApi'],
  google: ['googlePalmApi'],
  'azure-openai': ['azureOpenAiApi'],
  'aws-bedrock': ['aws'],
  xai: ['xAiApi'],
  groq: ['groqApi'],
  openrouter: ['openRouterApi'],
  deepseek: ['deepSeekApi'],
  cohere: ['cohereApi'],
  mistral: ['mistralCloudApi'],
  vercel: ['vercelAiGatewayApi'],
  nvidia: ['nvidiaApi'],
};

export const AGENT_UNSUPPORTED_CREDENTIAL_TYPES: Record<string, string> = {
  azureOpenAiApi: 'not mapped in LLM_PROVIDER_DEFAULTS (verified on n8n 2.36.7)',
  aws: 'not mapped in LLM_PROVIDER_DEFAULTS (verified on n8n 2.36.7)',
};

export const AGENT_SUPPORTED_CREDENTIAL_TYPES = Object.values(AGENT_MODEL_PROVIDER_CREDENTIAL_TYPES)
  .flat()
  .filter(t => !(t in AGENT_UNSUPPORTED_CREDENTIAL_TYPES));
