/**
 * Env-gated live integration test for the routed workflow-side operations
 * added in PR 2: `n8n_test_workflow` (method: prepare/pinned/direct),
 * `n8n_workflow_versions` (source: native, plus the local `diff` mode), and
 * the `n8n_manage_datatable` column actions (addColumn/renameColumn/deleteColumn).
 * All of these need n8n's own instance-level MCP server behind them, which is
 * why this only runs against a real n8n instance rather than the fake server.
 *
 * Runs only when N8N_API_URL, N8N_API_KEY and N8N_MCP_ACCESS_TOKEN are all
 * set — the same convention used by tests/integration/official-mcp/agents-lifecycle.test.ts
 * and tests/integration/ci/database-population.test.ts (describe.skipIf, so
 * the suite is a no-op rather than a failure when the token is absent). CI
 * does not set N8N_MCP_ACCESS_TOKEN, so this only runs locally:
 *   N8N_API_URL=... N8N_API_KEY=... N8N_MCP_ACCESS_TOKEN=... \
 *     npx vitest run tests/integration/official-mcp/workflow-routes.test.ts --config vitest.config.integration.ts
 *
 * Everything this test creates is named "[TEST] routes ..." and is removed in
 * afterAll, even when an assertion above it fails. `executionMode` is never
 * set to 'production' (method: direct defaults to 'manual' and this test
 * never overrides it), and the test never touches a workflow or table it did
 * not create itself. The workflow is Manual Trigger -> Set, so both the
 * pinned and direct runs are side-effect free.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  handleCreateWorkflow,
  handleGetWorkflow,
  handleDeleteWorkflow,
  handleTestWorkflow,
  handleWorkflowVersions,
  handleGetExecution,
  handleCreateTable,
  handleGetTable,
  handleDeleteTable,
  handleAddColumn,
  handleRenameColumn,
  handleDeleteColumn,
} from '@/mcp/handlers-n8n-manager';
import { handleUpdatePartialWorkflow } from '@/mcp/handlers-workflow-diff';
import { clearOfficialMcpClientCache } from '@/mcp/official-mcp-access';
import { NodeRepository } from '@/database/node-repository';
import { getNodeRepository, closeNodeRepository } from '../n8n-api/utils/node-repository';

const enabled = !!(process.env.N8N_API_URL && process.env.N8N_API_KEY && process.env.N8N_MCP_ACCESS_TOKEN);
const LIVE_TIMEOUT_MS = 60_000;
// Unique per run: a leftover workflow/table from an interrupted earlier run
// must not collide with this run's names.
const RUN_ID = Date.now().toString(36);
const TEST_WORKFLOW_NAME = `[TEST] routes ${RUN_ID}`;

interface NativeVersion { versionId: string; createdAt?: string; updatedAt?: string }

/** Epoch ms for a native version entry, or NaN when n8n sent no usable timestamp. */
function versionTimestamp(version: NativeVersion): number {
  return Date.parse(version.createdAt ?? version.updatedAt ?? '');
}
const TEST_TABLE_NAME = `[TEST] routes table ${RUN_ID}`;

/** Execution statuses that mean the run has finished, one way or another. */
const FINAL_EXECUTION_STATUSES = new Set(['success', 'error', 'crashed', 'canceled']);

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Polls n8n_executions (get) until the execution reaches a final status. */
async function pollExecutionToFinal(executionId: string, deadlineMs: number): Promise<Record<string, unknown>> {
  const start = Date.now();
  for (;;) {
    const r = await handleGetExecution({ id: executionId });
    expect(r.success).toBe(true);
    const data = r.data as Record<string, unknown>;
    const status = data?.status;
    if (typeof status === 'string' && FINAL_EXECUTION_STATUSES.has(status)) {
      return data;
    }
    if (Date.now() - start > deadlineMs) {
      throw new Error(`Execution ${executionId} did not reach a final status within ${deadlineMs}ms (last status: ${String(status)})`);
    }
    await sleep(1000);
  }
}

describe.skipIf(!enabled)('official MCP: routed workflow operations (live)', () => {
  let workflowId: string | undefined;
  let tableId: string | undefined;
  let repository: NodeRepository;

  beforeAll(async () => {
    repository = await getNodeRepository();
  }, LIVE_TIMEOUT_MS);

  afterAll(async () => {
    // Runs even when an assertion above threw - vitest still runs afterAll
    // hooks after a failed test in the same describe block.
    if (tableId) {
      try {
        await handleDeleteTable({ tableId });
      } catch {
        // ignore - the post-condition check below is the real check
      }
    }
    if (workflowId) {
      try {
        await handleDeleteWorkflow({ id: workflowId });
      } catch {
        // ignore - the post-condition check below is the real check
      }
    }

    // Confirm cleanup actually happened, regardless of whether the delete
    // calls above reported success.
    try {
      if (workflowId) {
        const stillThere = await handleGetWorkflow({ id: workflowId });
        expect(stillThere.success).toBe(false);
      }
      if (tableId) {
        const stillThere = await handleGetTable({ tableId });
        expect(stillThere.success).toBe(false);
      }
    } finally {
      // Close the cached client so its transport and pinned undici dispatcher
      // do not keep the vitest worker alive after the suite finishes, and the
      // shared nodes.db handle for the same reason.
      await clearOfficialMcpClientCache();
      await closeNodeRepository();
    }
  }, LIVE_TIMEOUT_MS);

  it('creates a [TEST] Manual Trigger -> Set workflow, not exposed to MCP', async () => {
    const created = await handleCreateWorkflow({
      name: TEST_WORKFLOW_NAME,
      nodes: [
        {
          id: 'manual-1',
          name: 'Manual Trigger',
          type: 'n8n-nodes-base.manualTrigger',
          typeVersion: 1,
          position: [250, 300],
          parameters: {},
        },
        {
          id: 'set-1',
          name: 'Set',
          type: 'n8n-nodes-base.set',
          typeVersion: 3.4,
          position: [450, 300],
          parameters: {
            assignments: {
              assignments: [
                { id: 'a-1', name: 'a', value: 1, type: 'number' },
              ],
            },
          },
        },
      ],
      connections: {
        'Manual Trigger': { main: [[{ node: 'Set', type: 'main', index: 0 }]] },
      },
      settings: { executionOrder: 'v1' },
    });
    expect(created.success).toBe(true);
    workflowId = (created.data as any).id;
    expect(typeof workflowId).toBe('string');
  }, LIVE_TIMEOUT_MS);

  it('refuses prepare until exposeToMcp is set, then exposes and returns pin-data coverage', async () => {
    const refused = await handleTestWorkflow({ workflowId, method: 'prepare' });
    expect(refused.success).toBe(false);
    expect(refused.method).toBe('prepare');
    expect(refused.code).toBe('WORKFLOW_NOT_EXPOSED');

    const exposed = await handleTestWorkflow({ workflowId, method: 'prepare', exposeToMcp: true });
    expect(exposed).toMatchObject({ success: true, method: 'prepare', backend: 'official-mcp', exposedToMcp: true });
    expect(typeof (exposed.data as any)?.coverage?.total).toBe('number');

    const workflow = await handleGetWorkflow({ id: workflowId });
    expect(workflow.success).toBe(true);
    const settings = (workflow.data as any).settings;
    expect(settings.availableInMCP).toBe(true);
    expect(settings.executionOrder).toBe('v1');
  }, LIVE_TIMEOUT_MS);

  it('runs a pinned execution', async () => {
    const r = await handleTestWorkflow({
      workflowId,
      method: 'pinned',
      pinData: { 'Manual Trigger': [{ json: { a: 1 } }] },
    });
    expect(r).toMatchObject({ success: true, method: 'pinned', backend: 'official-mcp' });
    expect(typeof r.executionId).toBe('string');
    const status = (r.data as any)?.status;
    // test_workflow's own declared status enum.
    expect(['success', 'error', 'running', 'waiting', 'canceled', 'crashed', 'new', 'unknown']).toContain(status);
  }, LIVE_TIMEOUT_MS);

  it('runs a direct execution and polls it to a final status', async () => {
    const r = await handleTestWorkflow({ workflowId, method: 'direct' });
    expect(r).toMatchObject({ success: true, method: 'direct', backend: 'official-mcp' });
    expect(typeof r.executionId).toBe('string');

    const finalExecution = await pollExecutionToFinal(r.executionId as string, 30_000);
    expect(FINAL_EXECUTION_STATUSES.has(finalExecution.status as string)).toBe(true);
  }, LIVE_TIMEOUT_MS);

  it('lists, gets, diffs and rolls back native versions', async () => {
    const list = await handleWorkflowVersions({ mode: 'list', source: 'native', workflowId }, repository);
    expect(list).toMatchObject({ success: true, mode: 'list', source: 'native', backend: 'official-mcp' });
    const versions = (list.data as any).versions as NativeVersion[];
    expect(Array.isArray(versions)).toBe(true);
    expect(versions.length).toBeGreaterThanOrEqual(1);

    const newest = versions[0];
    const oldest = versions[versions.length - 1];

    const got = await handleWorkflowVersions(
      { mode: 'get', source: 'native', workflowId, versionId: newest.versionId },
      repository
    );
    expect(got).toMatchObject({ success: true, mode: 'get', source: 'native', backend: 'official-mcp' });

    // The diff's from -> to direction, and the rollback target when there is
    // more than one version, both assume n8n returns the history newest-first.
    // get_workflow_history documents that, but the envelope does not restate
    // it, so prove it from the timestamps before relying on it. With a single
    // version there is no direction to check and no diff to take.
    if (versions.length >= 2) {
      const newestAt = versionTimestamp(newest);
      const oldestAt = versionTimestamp(oldest);
      expect(Number.isFinite(newestAt)).toBe(true);
      expect(Number.isFinite(oldestAt)).toBe(true);
      expect(newestAt).toBeGreaterThanOrEqual(oldestAt);

      const secondNewest = versions[1];
      const diff = await handleWorkflowVersions(
        {
          mode: 'diff',
          source: 'native',
          workflowId,
          versionId: secondNewest.versionId,
          toVersionId: newest.versionId,
        },
        repository
      );
      expect(diff).toMatchObject({ success: true, mode: 'diff', source: 'native', backend: 'official-mcp' });
      expect((diff.data as any).format).toBe('n8n');
    }

    // Unconditional: with one version `oldest` is `newest`, so the target
    // involves no ordering assumption, and with more the check above has
    // already proved the list is newest-first. A freshly created workflow
    // usually has exactly one native version, so gating this too would leave
    // restore_workflow_version with no live coverage at all.
    const rollback = await handleWorkflowVersions(
      { mode: 'rollback', source: 'native', workflowId, versionId: oldest.versionId },
      repository
    );
    expect(rollback).toMatchObject({
      success: true,
      mode: 'rollback',
      source: 'native',
      backend: 'official-mcp',
      validation: 'not available for native versions',
    });
  }, LIVE_TIMEOUT_MS);

  it('diffs two local snapshots created by consecutive updateName operations', async () => {
    const first = await handleUpdatePartialWorkflow(
      { id: workflowId, operations: [{ type: 'updateName', name: `${TEST_WORKFLOW_NAME} v2` }] },
      repository
    );
    expect(first.success).toBe(true);

    const second = await handleUpdatePartialWorkflow(
      { id: workflowId, operations: [{ type: 'updateName', name: `${TEST_WORKFLOW_NAME} v3` }] },
      repository
    );
    expect(second.success).toBe(true);

    const list = await handleWorkflowVersions({ mode: 'list', workflowId }, repository);
    expect(list).toMatchObject({ success: true, mode: 'list', source: 'local', backend: 'n8n-mcp' });
    const localVersions = (list.data as any).versions as Array<{ id: number }>;
    expect(localVersions.length).toBeGreaterThanOrEqual(2);

    const [newestLocal, secondNewestLocal] = localVersions;
    const diff = await handleWorkflowVersions(
      { mode: 'diff', workflowId, versionId: secondNewestLocal.id, toVersionId: newestLocal.id },
      repository
    );
    expect(diff).toMatchObject({ success: true, mode: 'diff', source: 'local', backend: 'n8n-mcp' });
    expect((diff.data as any).format).toBe('n8n-mcp');
  }, LIVE_TIMEOUT_MS);

  it('adds, renames and deletes a data-table column through the official server', async () => {
    const table = await handleCreateTable({
      name: TEST_TABLE_NAME,
      columns: [{ name: 'label', type: 'string' }],
    });
    expect(table.success).toBe(true);
    tableId = (table.data as any).id;
    expect(typeof tableId).toBe('string');

    const added = await handleAddColumn({ tableId, column: { name: 'score', type: 'number' } });
    expect(added).toMatchObject({ success: true, action: 'addColumn', backend: 'official-mcp' });
    const columnId = (added.data as any)?.column?.id;
    expect(typeof columnId).toBe('string');

    const renamed = await handleRenameColumn({ tableId, columnId, name: 'scoreRenamed' });
    expect(renamed).toMatchObject({ success: true, action: 'renameColumn', backend: 'official-mcp' });

    const deletedColumn = await handleDeleteColumn({ tableId, columnId });
    expect(deletedColumn).toMatchObject({ success: true, action: 'deleteColumn', backend: 'official-mcp' });
  }, LIVE_TIMEOUT_MS);
});
