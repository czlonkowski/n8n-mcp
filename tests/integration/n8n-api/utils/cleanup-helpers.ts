/**
 * Cleanup Helpers for Integration Tests
 *
 * Provides multi-level cleanup strategies for test resources:
 * - Orphaned workflows (from failed test runs)
 * - Old executions (older than 24 hours)
 * - Bulk cleanup by tag or name prefix
 */

import { getTestN8nClient } from './n8n-client';
import { getN8nCredentials } from './credentials';
import { Logger } from '../../../../src/utils/logger';

const logger = new Logger({ prefix: '[Cleanup]' });

export interface CleanupOrphanedWorkflowsOptions {
  /**
   * Minimum age (in ms) a workflow must have before it is eligible for
   * deletion, based on `updatedAt` (falling back to `createdAt`). Workflows
   * with neither timestamp are kept when the age is positive, since their age
   * cannot be established; `minAgeMs` of 0 deletes every candidate.
   *
   * Defaults to 5 minutes. This reduces (does not eliminate) the chance of
   * deleting a workflow another run recently created or updated.
   */
  minAgeMs?: number;
}

const DEFAULT_MIN_AGE_MS = 5 * 60 * 1000;

/**
 * Clean up orphaned test workflows
 *
 * Finds and deletes all workflows tagged with the test tag or
 * prefixed with the test name prefix. Run this periodically in CI
 * to clean up failed test runs.
 *
 * @param options - Optional settings, including an age guard
 * @returns Array of deleted workflow IDs
 */
export async function cleanupOrphanedWorkflows(
  options: CleanupOrphanedWorkflowsOptions = {}
): Promise<string[]> {
  const { minAgeMs = DEFAULT_MIN_AGE_MS } = options;
  const creds = getN8nCredentials();
  const client = getTestN8nClient();
  const deleted: string[] = [];

  logger.info('Searching for orphaned test workflows...');

  let allWorkflows: any[] = [];
  let cursor: string | undefined;
  let pageCount = 0;
  const MAX_PAGES = 1000; // Safety limit to prevent infinite loops

  // Fetch all workflows with pagination
  try {
    do {
      pageCount++;

      if (pageCount > MAX_PAGES) {
        logger.error(`Exceeded maximum pages (${MAX_PAGES}). Possible infinite loop or API issue.`);
        throw new Error('Pagination safety limit exceeded while fetching workflows');
      }

      logger.debug(`Fetching workflows page ${pageCount}...`);

      const response = await client.listWorkflows({
        cursor,
        limit: 100,
        excludePinnedData: true
      });

      allWorkflows.push(...response.data);
      cursor = response.nextCursor || undefined;
    } while (cursor);

    logger.info(`Found ${allWorkflows.length} total workflows across ${pageCount} page(s)`);
  } catch (error) {
    logger.error('Failed to fetch workflows:', error);
    throw error;
  }

  // Pre-activated webhook workflow that should NOT be deleted
  // This is needed for webhook trigger integration tests
  // Note: Single webhook accepts all HTTP methods (GET, POST, PUT, DELETE)
  const preservedWorkflowNames = new Set([
    '[MCP-TEST] Webhook All Methods'
  ]);

  // Find test workflows but exclude pre-activated webhook workflows
  const candidateWorkflows = allWorkflows.filter(w => {
    const isTestWorkflow = w.tags?.includes(creds.cleanup.tag) || w.name?.startsWith(creds.cleanup.namePrefix);
    const isPreserved = preservedWorkflowNames.has(w.name);

    return isTestWorkflow && !isPreserved;
  });

  // Age guard: skip anything created/updated too recently. `updatedAt` only
  // moves when a workflow is mutated, so a workflow being read (not
  // written) by another run won't look "new" here - this reduces, rather
  // than eliminates, the chance of deleting a workflow another run is
  // using. The sweep is invoked once before the suite starts (not mid-run)
  // for that reason: nothing else should be creating or touching test
  // workflows while this runs.
  //
  // `minAgeMs <= 0` bypasses the timestamp filter entirely rather than just
  // using a cutoff of "now": a workflow's updatedAt/createdAt can be ahead
  // of this runner's clock (clock skew against the n8n host), which would
  // make it look permanently "too new" under a `workflowTime < cutoffTime`
  // check even at cutoff = now. cleanup-orphans.ts (the standalone
  // maintenance script, which only runs when no test suite is live) always
  // passes { minAgeMs: 0 } and must still delete every candidate.
  let skippedTooNew = 0;
  const testWorkflows = minAgeMs <= 0
    ? candidateWorkflows
    : candidateWorkflows.filter(w => {
        const cutoffTime = Date.now() - minAgeMs;
        const timestamp = w.updatedAt || w.createdAt;
        const workflowTime = timestamp ? new Date(timestamp).getTime() : NaN;

        // No usable timestamp: the age cannot be established, so the guard keeps it.
        // The maintenance script passes minAgeMs 0 and deletes every candidate.
        if (Number.isNaN(workflowTime)) {
          return false;
        }

        const isOldEnough = workflowTime < cutoffTime;
        if (!isOldEnough) {
          skippedTooNew++;
        }
        return isOldEnough;
      });

  if (skippedTooNew > 0) {
    logger.info(`Skipped ${skippedTooNew} workflow(s) younger than ${minAgeMs}ms (likely in use by another running test)`);
  }

  logger.info(`Found ${testWorkflows.length} orphaned test workflow(s) (excluding ${preservedWorkflowNames.size} preserved webhook workflow)`);

  if (testWorkflows.length === 0) {
    return deleted;
  }

  // Delete them
  for (const workflow of testWorkflows) {
    try {
      await client.deleteWorkflow(workflow.id);
      deleted.push(workflow.id);
      logger.debug(`Deleted orphaned workflow: ${workflow.name} (${workflow.id})`);
    } catch (error) {
      logger.warn(`Failed to delete workflow ${workflow.id}:`, error);
    }
  }

  logger.info(`Successfully deleted ${deleted.length} orphaned workflow(s)`);
  return deleted;
}

/**
 * Clean up old executions
 *
 * Deletes executions older than the specified age.
 *
 * @param maxAgeMs - Maximum age in milliseconds (default: 24 hours)
 * @returns Array of deleted execution IDs
 */
export async function cleanupOldExecutions(
  maxAgeMs: number = 24 * 60 * 60 * 1000
): Promise<string[]> {
  const client = getTestN8nClient();
  const deleted: string[] = [];

  logger.info(`Searching for executions older than ${maxAgeMs}ms...`);

  let allExecutions: any[] = [];
  let cursor: string | undefined;
  let pageCount = 0;
  const MAX_PAGES = 1000; // Safety limit to prevent infinite loops

  // Fetch all executions
  try {
    do {
      pageCount++;

      if (pageCount > MAX_PAGES) {
        logger.error(`Exceeded maximum pages (${MAX_PAGES}). Possible infinite loop or API issue.`);
        throw new Error('Pagination safety limit exceeded while fetching executions');
      }

      logger.debug(`Fetching executions page ${pageCount}...`);

      const response = await client.listExecutions({
        cursor,
        limit: 100,
        includeData: false
      });

      allExecutions.push(...response.data);
      cursor = response.nextCursor || undefined;
    } while (cursor);

    logger.info(`Found ${allExecutions.length} total executions across ${pageCount} page(s)`);
  } catch (error) {
    logger.error('Failed to fetch executions:', error);
    throw error;
  }

  const cutoffTime = Date.now() - maxAgeMs;
  const oldExecutions = allExecutions.filter(e => {
    const executionTime = new Date(e.startedAt).getTime();
    return executionTime < cutoffTime;
  });

  logger.info(`Found ${oldExecutions.length} old execution(s)`);

  if (oldExecutions.length === 0) {
    return deleted;
  }

  for (const execution of oldExecutions) {
    try {
      await client.deleteExecution(execution.id);
      deleted.push(execution.id);
      logger.debug(`Deleted old execution: ${execution.id}`);
    } catch (error) {
      logger.warn(`Failed to delete execution ${execution.id}:`, error);
    }
  }

  logger.info(`Successfully deleted ${deleted.length} old execution(s)`);
  return deleted;
}

/**
 * Clean up all test resources
 *
 * Combines cleanupOrphanedWorkflows and cleanupOldExecutions.
 * Use this as a comprehensive cleanup in CI.
 *
 * @param options - Forwarded to cleanupOrphanedWorkflows (e.g. minAgeMs)
 * @returns Object with counts of deleted resources
 */
export async function cleanupAllTestResources(
  options: CleanupOrphanedWorkflowsOptions = {}
): Promise<{
  workflows: number;
  executions: number;
}> {
  logger.info('Starting comprehensive test resource cleanup...');

  const [workflowIds, executionIds] = await Promise.all([
    cleanupOrphanedWorkflows(options),
    cleanupOldExecutions()
  ]);

  logger.info(
    `Cleanup complete: ${workflowIds.length} workflows, ${executionIds.length} executions`
  );

  return {
    workflows: workflowIds.length,
    executions: executionIds.length
  };
}

/**
 * Delete workflows by tag
 *
 * Deletes all workflows with the specified tag.
 *
 * @param tag - Tag to match
 * @returns Array of deleted workflow IDs
 */
export async function cleanupWorkflowsByTag(tag: string): Promise<string[]> {
  const client = getTestN8nClient();
  const deleted: string[] = [];

  logger.info(`Searching for workflows with tag: ${tag}`);

  try {
    const response = await client.listWorkflows({
      tags: tag || undefined,
      limit: 100,
      excludePinnedData: true
    });

    const workflows = response.data;
    logger.info(`Found ${workflows.length} workflow(s) with tag: ${tag}`);

    for (const workflow of workflows) {
      if (!workflow.id) continue;

      try {
        await client.deleteWorkflow(workflow.id);
        deleted.push(workflow.id);
        logger.debug(`Deleted workflow: ${workflow.name} (${workflow.id})`);
      } catch (error) {
        logger.warn(`Failed to delete workflow ${workflow.id}:`, error);
      }
    }

    logger.info(`Successfully deleted ${deleted.length} workflow(s)`);
    return deleted;
  } catch (error) {
    logger.error(`Failed to cleanup workflows by tag: ${tag}`, error);
    throw error;
  }
}

/**
 * Delete executions for a specific workflow
 *
 * @param workflowId - Workflow ID
 * @returns Array of deleted execution IDs
 */
export async function cleanupExecutionsByWorkflow(
  workflowId: string
): Promise<string[]> {
  const client = getTestN8nClient();
  const deleted: string[] = [];

  logger.info(`Searching for executions of workflow: ${workflowId}`);

  let cursor: string | undefined;
  let totalCount = 0;
  let pageCount = 0;
  const MAX_PAGES = 1000; // Safety limit to prevent infinite loops

  try {
    do {
      pageCount++;

      if (pageCount > MAX_PAGES) {
        logger.error(`Exceeded maximum pages (${MAX_PAGES}). Possible infinite loop or API issue.`);
        throw new Error(`Pagination safety limit exceeded while fetching executions for workflow ${workflowId}`);
      }

      const response = await client.listExecutions({
        workflowId,
        cursor,
        limit: 100,
        includeData: false
      });

      const executions = response.data;
      totalCount += executions.length;

      for (const execution of executions) {
        try {
          await client.deleteExecution(execution.id);
          deleted.push(execution.id);
          logger.debug(`Deleted execution: ${execution.id}`);
        } catch (error) {
          logger.warn(`Failed to delete execution ${execution.id}:`, error);
        }
      }

      cursor = response.nextCursor || undefined;
    } while (cursor);

    logger.info(
      `Successfully deleted ${deleted.length}/${totalCount} execution(s) for workflow ${workflowId}`
    );
    return deleted;
  } catch (error) {
    logger.error(`Failed to cleanup executions for workflow: ${workflowId}`, error);
    throw error;
  }
}
