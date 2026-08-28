/**
 * Env-gated live integration test for `n8n_manage_agents` against a real
 * n8n instance with the agents module enabled.
 *
 * Runs only when N8N_API_URL, N8N_API_KEY and N8N_MCP_ACCESS_TOKEN are all
 * set — the same convention used by tests/integration/mcp/stdio-shutdown.test.ts
 * and tests/integration/ci/database-population.test.ts (describe.skipIf, so
 * the suite is a no-op rather than a failure when the token is absent). CI
 * does not set N8N_MCP_ACCESS_TOKEN, so this only runs locally:
 *   N8N_API_URL=... N8N_API_KEY=... N8N_MCP_ACCESS_TOKEN=... \
 *     npx vitest run tests/integration/official-mcp --config vitest.config.integration.ts
 *
 * Everything this test creates is named "[TEST] ..." and is removed in
 * afterAll, even when an assertion above it fails. Never calls `publish` or
 * `call` — this only exercises the draft-agent lifecycle (create, mutate,
 * validate, list versions, delete).
 */
import { describe, it, expect, afterAll } from 'vitest';
import { handleManageAgents } from '@/mcp/handlers-agents';
import { handleListCatalog } from '@/mcp/handlers-official-tools';

const enabled = !!(process.env.N8N_API_URL && process.env.N8N_API_KEY && process.env.N8N_MCP_ACCESS_TOKEN);
const LIVE_TIMEOUT_MS = 60_000;
const TEST_AGENT_NAME = '[TEST] n8n-mcp lifecycle';

describe.skipIf(!enabled)('official MCP: agent lifecycle (live)', () => {
  let agentId: string | undefined;
  let configHash: string | undefined;

  afterAll(async () => {
    // Runs even when an assertion above threw - vitest still runs afterAll
    // hooks after a failed test in the same describe block.
    if (agentId) {
      try {
        await handleManageAgents({ action: 'delete', args: { agentId } });
      } catch {
        // ignore - the post-condition search below is the real check
      }
    }
    // Confirm the instance is left clean: no "[TEST] n8n-mcp lifecycle"
    // agent remains, regardless of whether the delete call above reported
    // success. A failure here means real cleanup did not happen.
    const searched = await handleManageAgents({ action: 'search', args: { query: '[TEST]' } });
    expect(searched.success).toBe(true);
    const remaining = ((searched.data as any).data ?? []) as Array<{ name: string }>;
    expect(remaining.some(a => a.name === TEST_AGENT_NAME)).toBe(false);
  }, LIVE_TIMEOUT_MS);

  it('reads the builder reference', async () => {
    const r = await handleManageAgents({ action: 'reference' });
    expect(r.success).toBe(true);
    expect(typeof (r.data as any).guide).toBe('string');
  }, LIVE_TIMEOUT_MS);

  it('creates, mutates, validates and lists versions of a [TEST] agent', async () => {
    const projects = await handleListCatalog({ kind: 'projects' });
    expect(projects.success).toBe(true);
    const items = (projects.data as any).items as Array<{ id: string; personal?: boolean }>;
    const projectId = (items.find(p => p.personal) ?? items[0]).id;

    const created = await handleManageAgents({
      action: 'create',
      args: {
        projectId,
        name: TEST_AGENT_NAME,
        config: { model: 'openai/gpt-4o-mini', instructions: 'Reply with OK.' },
      },
    });
    expect(created.success).toBe(true);
    agentId = (created.data as any).agent.id;
    configHash = (created.data as any).configHash;

    // skill.upsert shape confirmed against docs/local/official-agent-tools-2026-08-27/
    // spike-log-2-mutate-validate-delete.json: { type: 'skill.upsert', skill: { name, description, instructions } }.
    // The response's `resource.id` (e.g. "skill_bVC2PZ7gpb4MGVZv") is the id the
    // schema's skill.delete operation requires as `skillId` — NOT the skill's `name`.
    const mutated = await handleManageAgents({
      action: 'mutate',
      args: {
        agentId,
        baseConfigHash: configHash,
        operation: {
          type: 'skill.upsert',
          skill: { name: 'echo', description: 'Echo skill', instructions: 'Echo the input.' },
        },
      },
    });
    expect(mutated.success).toBe(true);
    configHash = (mutated.data as any).configHash;
    const skillId = (mutated.data as any).resource?.id;
    expect(typeof skillId).toBe('string');

    // Deliberately reuse a stale hash ('stale') to exercise the STALE_CONFIG
    // path. skill.delete's real shape is { type: 'skill.delete', skillId },
    // per agent-tools-schemas.json (the brief's original sketch used `name`,
    // which the schema does not accept) - but the mutation must be rejected
    // for staleness before the operation shape is even checked, so this
    // still proves the guard without needing a second live skill to delete.
    const stale = await handleManageAgents({
      action: 'mutate',
      args: {
        agentId,
        baseConfigHash: 'stale',
        operation: { type: 'skill.delete', skillId },
      },
    });
    expect(stale).toMatchObject({ success: false, code: 'STALE_CONFIG' });

    const validated = await handleManageAgents({ action: 'validate', args: { agentId } });
    expect(validated.success).toBe(true); // valid may be false (no credential) - that is data, not an error

    const versions = await handleManageAgents({ action: 'versions', args: { agentId } });
    expect(versions.success).toBe(true);
  }, LIVE_TIMEOUT_MS);
});
