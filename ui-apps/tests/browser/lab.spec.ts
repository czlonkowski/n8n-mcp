import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import axe from 'axe-core';
import type { Page } from '@playwright/test';
import { TOOL_INPUT_METHOD, TOOL_RESULT_METHOD } from '@modelcontextprotocol/ext-apps/app-bridge';
const result = (page: Page) => page.frameLocator('iframe[title="MCP result card"]');
const toggle = (page: Page) => result(page).locator('button.result-toggle');
async function expandCard(page: Page) {
  await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false');
  await toggle(page).click();
  await expect(toggle(page)).toHaveAttribute('aria-expanded', 'true');
}
async function expectNoOverflow(page: Page) {
  const sizes = await result(page).locator('body').evaluate(element => ({ width: element.clientWidth, scroll: element.scrollWidth }));
  expect(sizes.scroll).toBeLessThanOrEqual(sizes.width);
}
// The lab intentionally uses an opaque-origin sandbox. Audit its document directly:
// a clean parent-page scan alone does not establish that the card was inspected.
async function auditCard(page: Page) {
  return result(page).locator('html').evaluate(async (_element, source) => {
    window.eval(source);
    return (window as typeof window & { axe: typeof axe }).axe.run(document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] },
    });
  }, axe.source);
}

test('a recoverable SDK diagnostic does not hide the subsequent tool result', async ({ page }) => {
  await page.goto('/lab.html');
  await page.getByRole('combobox', { name: 'Scenario', exact: true }).selectOption('recoverable-host-error');
  await expandCard(page);
  await expect(result(page).getByText('A host communication problem occurred. Still waiting for the tool result.')).toBeVisible();
  await expect(result(page).getByRole('status').first()).toHaveText('Workflow created');
  await expect(result(page).getByText(/host communication problem/)).toHaveCount(0);
  await expect(toggle(page)).toHaveAttribute('aria-expanded', 'true');
  await expect(result(page).getByRole('heading', { name: 'Customer onboarding', exact: true })).toBeVisible();
});
test('response identity works without optional host toolInfo across operation shapes', async ({ page }) => {
  await page.goto('/lab.html');
  for (const [scenario, title] of [
    ['created', 'Workflow created'], ['full-update', 'Workflow updated'],
    ['updated', 'Workflow updated'], ['deleted', 'Workflow deleted'],
    ['preview', '2 fixes proposed'], ['triggered', 'Workflow triggered'],
    ['template-setup', 'Template saved · setup needs review'],
  ]) {
    await page.getByRole('combobox', { name: 'Scenario', exact: true }).selectOption(`${scenario}-no-tool-info`);
    await expect(result(page).getByRole('status')).toHaveText(title);
  }
  await page.getByRole('combobox', { name: 'Scenario', exact: true }).selectOption('invalid-no-tool-info');
  await expect(result(page).getByRole('status')).toHaveText('3 validation errors found');
  await expandCard(page);
  await result(page).getByText('Result context', { exact: true }).click();
  await expect(result(page).getByText('Saved workflow', { exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'Scenario', exact: true }).selectOption('protocol-error-no-tool-info');
  await expect(result(page).getByRole('status')).toHaveText('Result unavailable');
  await expandCard(page);
  await result(page).getByText('Result context', { exact: true }).click();
  await expect(result(page).getByText('validate_workflow', { exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'Scenario', exact: true }).selectOption('api-error-no-tool-info');
  await expect(result(page).getByRole('status')).toHaveText('Validation unavailable');
  await expandCard(page);
  await result(page).getByText('Result context', { exact: true }).click();
  await expect(result(page).getByText('n8n_validate_workflow', { exact: true })).toBeVisible();
  await expect(result(page).locator('time')).toBeVisible();
});
test('agent loop advances without a human repair handoff', async ({ page }) => {
  await page.goto('/lab.html');
  await expect(result(page).getByRole('status')).toHaveText('3 validation errors found');
  await page.getByRole('button', { name: 'Replay agent sequence' }).click();
  await expect(result(page).getByRole('status')).toHaveText('Workflow created');
  await expect(result(page).getByRole('status')).toHaveText('2 fixes proposed', { timeout: 10000 });
  await expect(result(page).getByRole('status')).toHaveText('Execution succeeded', { timeout: 18000 });
  await expect(result(page).getByRole('button', { name: /copy request|repair request/i })).toHaveCount(0);
});
test('real bridge handles cancellation, failure and malformed results', async ({ page }) => {
  await page.goto('/lab.html');
  for (const [scenario, title] of [['late', 'Tool call cancelled'], ['protocol-error', 'Result unavailable'], ['malformed', 'Result unavailable'], ['api-error', 'Validation unavailable']]) {
    await page.getByRole('combobox', { name: 'Scenario', exact: true }).selectOption(scenario);
    await expect(result(page).getByRole('status')).toHaveText(title);
  }
});
test('readable narrow cards, keyboard disclosure, host theme and accessibility', async ({ page }) => {
  await page.goto('/lab.html');
  await page.getByLabel('Embed width').selectOption('320');
  await expect(result(page).getByRole('status')).toHaveText('3 validation errors found');
  await expandCard(page);
  await result(page).getByText('Validation details', { exact: false }).focus();
  await page.keyboard.press('Enter');
  await expect(result(page).getByRole('button', { name: 'Warnings · 2' })).toBeVisible();
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    const root = result(page).locator('html');
    await expect(root).toHaveCSS('color-scheme', colorScheme);
    await expectNoOverflow(page);
    const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(audit.violations).toEqual([]);
    expect((await auditCard(page)).violations).toEqual([]);
  }
});
test('loads the resource and validation result from the actual local MCP server', async ({ page }) => {
  await page.goto('/lab.html');
  await page.getByRole('button', { name: 'Load protocol snapshot' }).click();
  await expect(page.getByRole('status').first()).toContainText('Built HTML read from local MCP');
  await expandCard(page);
  await expect(result(page).getByRole('heading', { level: 1 })).toHaveText('Offline protocol smoke');
  await expect(result(page).getByRole('status')).toHaveText(/validation errors?|Validation did not pass/);
  await page.getByRole('button', { name: 'Load operation bundle' }).click();
  await expect(page.getByRole('status').first()).toContainText('synthetic result');
  await expandCard(page);
  await expect(result(page).getByRole('heading', { level: 1 })).toHaveText('Synthetic saved workflow');
  await expect(result(page).getByRole('status')).toHaveText('Workflow created');
});

test('restored views preserve action semantics in narrow light and dark cards', async ({ page }) => {
  test.setTimeout(120000);
  await page.goto('/lab.html');
  await page.getByLabel('Embed width').selectOption('320');
  for (const [scenario, title] of [
    ['workflow-empty','No matching workflows'], ['workflow-error','Request could not complete'],
    ['workflow-page','6 workflows returned'], ['execution-page','6 executions returned'],
    ['execution-detail','Failed'], ['execution-deleted','Execution deleted'],
    ['health-unconfigured','n8n API not configured'], ['health-connected','Connection verified'],
    ['template-setup','Template saved · setup needs review'],
  ]) {
    await page.getByRole('combobox', { name: 'Scenario', exact: true }).selectOption(scenario);
    await expect(result(page).getByRole('status').first()).toHaveText(title);
    for (const colorScheme of ['light','dark'] as const) {
      await page.emulateMedia({colorScheme});
      await expect(result(page).locator('html')).toHaveCSS('color-scheme',colorScheme);
      for (const expanded of [false, true]) {
        if (expanded) await expandCard(page);
        await expectNoOverflow(page);
        expect((await auditCard(page)).violations).toEqual([]);
        if (expanded) {
          await toggle(page).click();
          await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false');
        }
      }
    }
  }
});
test('extra returned rows and connection evidence are inspectable without fetching new data',async ({page})=>{
  await page.goto('/lab.html');
  await page.getByRole('combobox', { name: 'Scenario', exact: true }).selectOption('workflow-page');
  await expect(result(page).getByRole('status')).toHaveText('6 workflows returned');
  await expandCard(page);
  await result(page).getByText('Show 1 more in this page').focus(); await page.keyboard.press('Enter');
  await expect(result(page).getByRole('heading',{name:/A very long workflow name/})).toBeVisible();
  await page.getByRole('combobox', { name: 'Scenario', exact: true }).selectOption('health-connected');
  await expect(result(page).getByRole('status')).toHaveText('Connection verified');
  await expandCard(page);
  await result(page).getByText('Connection details',{exact:true}).click();
  await expect(result(page).getByText('80.00%',{exact:true})).toBeVisible();
  await expect(result(page).getByText(/Not live/)).toBeVisible();
});

const collapsedScenarios = [
  ['created', 'Workflow operation', 'Workflow created'],
  ['invalid', 'Validation', '3 validation errors found'],
  ['workflow-page', 'Workflows', '6 workflows returned'],
  ['execution-page', 'Executions', '6 executions returned'],
  ['health-connected', 'Connection', 'Connection verified'],
  ['pending', 'Validation', 'Tool call in progress'],
  ['cancelled', 'Validation', 'Tool call cancelled'],
  ['late', 'Validation', 'Tool call cancelled'],
  ['protocol-error', 'Validation', 'Result unavailable'],
  ['malformed', 'Validation', 'Result unavailable'],
  ['api-error', 'Validation', 'Validation unavailable'],
] as const;

test('all five apps and lifecycle outcomes start as one compact row at 320px', async ({ page }) => {
  await page.goto('/lab.html');
  await page.getByLabel('Embed width').selectOption('320');
  for (const [scenario, kind, title] of collapsedScenarios) {
    await page.getByRole('combobox', { name: 'Scenario', exact: true }).selectOption(scenario);
    await expect(result(page).getByRole('status')).toHaveText(title);
    await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle(page)).toHaveAccessibleName(new RegExp(`n8n-mcp.*${kind === 'Workflow operation' ? 'Workflow' : kind}`));
    await expect(toggle(page)).toHaveAccessibleDescription(title);
    await expect(result(page).locator('.result-body')).toBeHidden();
    // Hidden body actions must also disappear from the accessibility tree.
    await expect(result(page).getByRole('heading')).toHaveCount(0);
    await expect(result(page).getByRole('button')).toHaveCount(1);
    const geometry = await toggle(page).evaluate(element => {
      const row = element.getBoundingClientRect();
      const parts = ['strong', '.result-kind', '.result-status'].map(selector => {
        const rect = element.querySelector(selector)!.getBoundingClientRect();
        return { center: rect.y + rect.height / 2, width: rect.width };
      });
      return { rowHeight: row.height, centers: parts.map(part => part.center), widths: parts.map(part => part.width) };
    });
    expect(geometry.rowHeight).toBeGreaterThanOrEqual(44);
    expect(geometry.rowHeight).toBeLessThanOrEqual(48);
    expect(Math.max(...geometry.centers) - Math.min(...geometry.centers)).toBeLessThanOrEqual(1);
    expect(Math.min(...geometry.widths)).toBeGreaterThan(8);
    await expectNoOverflow(page);
    await expect.poll(async () => (await page.locator('iframe').boundingBox())!.height).toBeLessThanOrEqual(72);
  }
});

test('Enter and Space toggle the card and the host iframe grows and shrinks', async ({ page }) => {
  await page.goto('/lab.html');
  await expect(result(page).getByRole('status')).toHaveText('3 validation errors found');
  await expect.poll(async () => (await page.locator('iframe').boundingBox())!.height).toBeLessThanOrEqual(80);
  const collapsedHeight = (await page.locator('iframe').boundingBox())!.height;
  const bodyId = await toggle(page).getAttribute('aria-controls');
  expect(bodyId).toBeTruthy();
  await expect(result(page).locator('.result-body')).toHaveAttribute('id', bodyId!);
  await toggle(page).focus();
  await page.keyboard.press('Enter');
  await expect(toggle(page)).toHaveAttribute('aria-expanded', 'true');
  await expect(toggle(page)).toBeFocused();
  await expect(result(page).getByRole('heading', { level: 1 })).toBeVisible();
  await expect.poll(async () => (await page.locator('iframe').boundingBox())!.height).toBeGreaterThan(collapsedHeight + 100);
  await page.keyboard.press('Space');
  await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(toggle(page)).toBeFocused();
  await expect(result(page).locator('.result-body')).toBeHidden();
  await expect.poll(async () => (await page.locator('iframe').boundingBox())!.height).toBeLessThanOrEqual(collapsedHeight + 1);
});

test('all five built resources remain collapsed until opened', async ({ page }) => {
  await page.goto('/lab.html');
  for (const [scenario, , title] of collapsedScenarios.slice(0, 5)) {
    await page.getByRole('combobox', { name: 'Scenario', exact: true }).selectOption(scenario);
    await page.getByRole('button', { name: 'Load selected built resource' }).click();
    await expect(page.getByRole('status').first()).toContainText('Built HTML read from local MCP');
    await expect(result(page).getByRole('status')).toHaveText(title);
    await expect(result(page).locator('.result-body')).toBeHidden();
    await expandCard(page);
    await expect(result(page).locator('.result-body')).toBeVisible();
  }
});

test('collapsed and expanded cards reflow at a 200-percent-equivalent viewport', async ({ page }) => {
  test.setTimeout(60000);
  // A 320 CSS-pixel viewport represents a 640px-wide host at 200% zoom.
  // deviceScaleFactor changes raster density and would not test reflow.
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('/lab.html');
  await page.getByLabel('Embed width').selectOption('320');
  for (const [scenario, , title] of collapsedScenarios.slice(0, 5)) {
    await page.getByRole('combobox', { name: 'Scenario', exact: true }).selectOption(scenario);
    await expect(result(page).getByRole('status')).toHaveText(title);
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme });
      await expect(result(page).locator('html')).toHaveCSS('color-scheme', colorScheme);
      await expectNoOverflow(page);
      expect((await auditCard(page)).violations).toEqual([]);
      await expandCard(page);
      await expectNoOverflow(page);
      expect((await auditCard(page)).violations).toEqual([]);
      await toggle(page).click();
      await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false');
    }
  }
});

test('accessibility audit detects an unnamed button inside the opaque sandbox', async ({ page }) => {
  await page.goto('/lab.html');
  await expect(result(page).getByRole('status')).toHaveText('3 validation errors found');
  await expect(page.locator('iframe')).toHaveAttribute('sandbox', 'allow-scripts');
  await result(page).locator('body').evaluate(element => {
    const button = document.createElement('button');
    button.id = 'axe-negative-control';
    button.style.cssText = 'width:44px;height:44px';
    element.append(button);
  });
  const audit = await auditCard(page);
  expect(audit.violations.some(violation => violation.id === 'button-name'
    && violation.nodes.some(node => node.target.includes('#axe-negative-control')))).toBe(true);
  await result(page).locator('#axe-negative-control').evaluate(element => element.remove());
  expect((await auditCard(page)).violations).toEqual([]);
});

test('standalone guidance in all five apps also starts collapsed and opens by keyboard', async ({ page }) => {
  for (const app of ['operation-result', 'validation-summary', 'workflow-list', 'execution-history', 'health-dashboard']) {
    await page.goto(`/src/apps/${app}/index.html`);
    const disclosure = page.locator('button.result-toggle');
    await expect(page.getByRole('status')).toHaveText('Open in an MCP Apps host');
    await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByText(/This view receives results/)).toBeHidden();
    await disclosure.focus();
    await page.keyboard.press('Enter');
    await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByText(/This view receives results/)).toBeVisible();
  }
});


test('compact outcomes keep saved errors and setup review distinct from clean success', async ({ page }) => {
  await page.goto('/lab.html');
  await page.getByLabel('Embed width').selectOption('320');
  for (const [scenario, title, compact] of [
    ['updated', 'Workflow updated', 'Updated'],
    ['partial', 'Some changes applied', 'Partially applied'],
    ['template-setup', 'Template saved · setup needs review', 'Saved · setup needed'],
  ]) {
    await page.getByRole('combobox', { name: 'Scenario', exact: true }).selectOption(scenario);
    await expect(result(page).getByRole('status')).toHaveText(title);
    await expect(toggle(page).locator('.result-status')).toHaveText(compact);
    const statusWidth = await toggle(page).locator('.result-status').evaluate(element => ({ width: element.clientWidth, scroll: element.scrollWidth }));
    expect(statusWidth.scroll).toBeLessThanOrEqual(statusWidth.width);
    await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle(page)).toHaveAccessibleName(new RegExp(compact));
    await expect(toggle(page)).toHaveAccessibleDescription(title);
    await expectNoOverflow(page);
  }

  await page.getByRole('combobox', { name: 'Scenario', exact: true }).selectOption('updated');
  await expect(result(page).getByRole('status')).toHaveText('Workflow updated');
  // Start another synthetic call through the same postMessage protocol as the lab.
  // A new input is required: a ready result is immutable until the next call.
  await page.locator('iframe').evaluate((element, methods) => {
    const target = (element as HTMLIFrameElement).contentWindow!;
    target.postMessage({ jsonrpc: '2.0', method: methods.input, params: { arguments: { id: 'synthetic-workflow' } } }, '*');
  }, { input: TOOL_INPUT_METHOD });
  await expect(result(page).getByRole('status')).toHaveText('Tool call in progress');
  await page.locator('iframe').evaluate((element, method) => {
    (element as HTMLIFrameElement).contentWindow!.postMessage({
      jsonrpc: '2.0', method, params: {
        content: [{ type: 'text', text: JSON.stringify({ success: false, saved: true, error: 'Synthetic post-save failure' }) }],
        _meta: { 'n8n-mcp/toolName': 'n8n_update_partial_workflow' },
      },
    }, '*');
  }, TOOL_RESULT_METHOD);
  await expect(result(page).getByRole('status')).toHaveText('Changes saved with reported errors');
  await expect(toggle(page).locator('.result-status')).toHaveText('Saved with errors');
  const statusWidth = await toggle(page).locator('.result-status').evaluate(element => ({ width: element.clientWidth, scroll: element.scrollWidth }));
  expect(statusWidth.scroll).toBeLessThanOrEqual(statusWidth.width);
  await expect(toggle(page)).toHaveAccessibleName(/Saved with errors/);
  await expect(toggle(page)).toHaveAccessibleDescription('Changes saved with reported errors');
  await expect(toggle(page).getByRole('status')).toHaveCount(0);
  await expectNoOverflow(page);
});
