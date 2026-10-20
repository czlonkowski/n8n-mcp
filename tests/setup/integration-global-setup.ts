/**
 * Vitest globalSetup: sweep orphaned integration-test workflows exactly
 * once, before the test suite starts.
 *
 * This logic used to run at the end of every integration test file's
 * `afterAll` hook. Because vitest runs test files in parallel (threads
 * pool), that made the sweep an instance-wide deletion race: whichever
 * file finished first could delete workflows another still-running file
 * had just created (see issue #1102). Running the sweep once here, before
 * any test file starts, keeps its original purpose - clearing leftovers
 * from a previous crashed run - without ever competing with a live test.
 *
 * Only registered in vitest.config.integration.ts, not the base
 * vitest.config.ts - a plain `npm test` still runs the integration files when
 * credentials are configured, but a run selected down to unit files must not
 * start an instance-wide deletion.
 *
 * globalSetup runs once, outside any test's module context, so this file
 * must not import anything that calls `vi`, `beforeAll`, etc. at module
 * scope - those globals are not available here. `cleanup-helpers.ts`,
 * `credentials.ts`, `test-env.ts` and their dependencies (`n8n-client.ts`,
 * the production `src/services/n8n-api-client.ts`) are plain
 * TypeScript/ESM with no such side effects as of this writing, so they are
 * imported directly rather than duplicated. Re-check this if it ever
 * starts throwing "vi is not defined" style errors after a refactor of
 * those files.
 */
import { cleanupOrphanedWorkflows } from '../integration/n8n-api/utils/cleanup-helpers';
import { getN8nCredentials } from '../integration/n8n-api/utils/credentials';
import { loadTestEnvironment } from './test-env';

// vitest does not time-box a globalSetup, so bound the sweep here: an
// unreachable or slow-to-respond n8n instance can never hang the suite.
const SWEEP_TIMEOUT_MS = 15_000;

// The URL loadTestEnvironment() and .env.test fall back to when nothing real
// is configured. A sweep against it would only produce a connection error.
const MOCK_API_URL = 'http://localhost:3001/mock-api';
const MOCK_API_KEY = 'test-api-key-12345';

export async function setup(): Promise<void> {
  // CI never ran the per-file sweep either (`if (!process.env.CI)`), and
  // CI instances have their own lifecycle - skip entirely.
  if (process.env.CI) {
    return;
  }

  let creds;
  try {
    // Load the same .env / .env.test / .env.test.local chain the test
    // workers load, so this sees the same credentials they would.
    loadTestEnvironment();
    creds = getN8nCredentials();
  } catch {
    // Environment validation failed. Nothing to sweep - return quietly, the
    // test files report their own configuration problems.
    return;
  }

  // loadTestEnvironment() fills in mock defaults when no real instance is
  // configured, so credentials are always present; the mock URL or the mock
  // key is the "not (fully) configured" signal.
  if (!creds.cleanup.enabled || creds.url === MOCK_API_URL || creds.apiKey === MOCK_API_KEY) {
    return;
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`orphan workflow sweep timed out after ${SWEEP_TIMEOUT_MS}ms`)), SWEEP_TIMEOUT_MS);
      timer.unref();
    });
    // The race only bounds how long the suite waits for the sweep - if it
    // times out, the sweep keeps running (and deleting) in the background,
    // it isn't cancelled. What actually protects a workflow a test creates
    // while that background sweep is still going is the age guard inside
    // cleanupOrphanedWorkflows: anything younger than minAgeMs is skipped
    // no matter when the listing happened, so a test's own new workflow is
    // never a candidate.
    const deleted = await Promise.race([cleanupOrphanedWorkflows(), timeout]);
    if (deleted.length > 0) {
      console.log(`[integration-global-setup] Swept ${deleted.length} orphaned workflow(s) before the suite started.`);
    }
  } catch (error) {
    // An unreachable/misconfigured n8n instance, or a slow sweep, must
    // never fail the run this globalSetup is attached to.
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[integration-global-setup] Orphan workflow sweep skipped: ${message}`);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}
