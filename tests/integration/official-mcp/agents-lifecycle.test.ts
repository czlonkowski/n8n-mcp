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
import { clearOfficialMcpClientCache } from '@/mcp/official-mcp-access';

const enabled = !!(process.env.N8N_API_URL && process.env.N8N_API_KEY && process.env.N8N_MCP_ACCESS_TOKEN);
const LIVE_TIMEOUT_MS = 60_000;
// Unique per run: a leftover agent from an interrupted earlier run must not
// make this run's post-delete check fail, and two runs against the same
// instance must not collide.
const TEST_AGENT_NAME = `[TEST] n8n-mcp lifecycle ${Date.now().toString(36)}`;

describe.skipIf(!enabled)('official MCP: agent lifecycle (live)', () => {
  let agentId: string | undefined;
  let configHash: string | undefined;

  afterAll(async () => {
    // Runs even when an assertion above threw - vitest still runs afterAll
    // hooks after a failed test in the same describe block.
    if (agentId) {
      try {
        // Cleanup is verified by the post-delete search below, not by this
        // call's own `success` field - a delete that reports success but
        // doesn't actually remove the agent would otherwise pass silently.
        await handleManageAgents({ action: 'delete', args: { agentId } });
      } catch {
        // ignore - the post-condition search below is the real check
      }
    }
    // Confirm the instance is left clean: no agent with THIS run's unique
    // name remains, regardless of whether the delete call above reported
    // success. A failure here means real cleanup did not happen.
    try {
      const searched = await handleManageAgents({ action: 'search', args: { query: '[TEST]' } });
      expect(searched.success).toBe(true);
      const remaining = ((searched.data as any).data ?? []) as Array<{ name: string }>;
      expect(remaining.some(a => a.name === TEST_AGENT_NAME)).toBe(false);
    } finally {
      // Close the cached client so its transport and pinned undici dispatcher
      // do not keep the vitest worker alive after the suite finishes.
      await clearOfficialMcpClientCache();
    }
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
    expect(typeof agentId).toBe('string');
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

    // list_agent_versions is n8n's *publish history*, not a draft-revision log
    // (its own description: "List the publish history of an Agent, newest
    // first" - agent-tools-schemas.json). Live payload shape, confirmed by a
    // direct probe against the test instance and matching
    // spike-log-2-mutate-validate-delete.json's own "list_agent_versions"
    // step: { ok: true, data: [], count: 0 } - a top-level `data` array plus
    // `count`. Since this test creates the agent and mutates it but, per the
    // "never publish" constraint, never calls `publish`, that publish history
    // is legitimately empty for the whole lifecycle - a never-published draft
    // has no versions to list. Asserting non-empty (or correlating an id from
    // `create`, which returns a *draft* versionId, not a published-version
    // id) would be asserting behaviour the API does not have. Instead this
    // asserts the mapping's actual shape and internal consistency, which
    // would fail on a broken mapping (e.g. `data: undefined` while
    // `success:true`, or `count` desynced from the array) without assuming a
    // publish that this test must not perform.
    const versions = await handleManageAgents({ action: 'versions', args: { agentId } });
    expect(versions.success).toBe(true);
    const versionList = (versions.data as any)?.data;
    expect(Array.isArray(versionList)).toBe(true);
    expect((versions.data as any).count).toBe(versionList.length);
    expect(versionList.length).toBe(0); // never published in this test - see comment above
  }, LIVE_TIMEOUT_MS);
});
