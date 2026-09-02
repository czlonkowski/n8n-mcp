# n8n API Integration Tests

Live tests against a real n8n instance (`N8N_API_URL` + `N8N_API_KEY`).

In CI these suites run only when those secrets are configured (see `.github/workflows/test.yml`). Offline unit tests in `tests/unit/services/n8n-validation.test.ts` always cover the same cleaning rules without a live API.

## n8n API quirks (workflow updates)

The Public API is **asymmetric** between read and write:

| Behavior | GET | PUT / PATCH |
|----------|-----|-------------|
| `description` | May be returned | Rejected on some versions (Issue #431) |
| Read-only fields (`id`, `createdAt`, `updatedAt`, `versionId`, `versionCounter`, `active`, `tags`, `meta`, `staticData`, `pinData`, …) | Returned | Rejected (`additionalProperties: false` on many versions) |
| `settings` | Returned | Empty `{}` rejected; when empty or omitted the client sends `{ executionOrder: 'v1' }` |

**Common failure mode (Issue #433):**

```ts
const wf = await client.getWorkflow(id);
await client.updateWorkflow(id, { ...wf, name: 'New' }); // must clean first
```

`N8nApiClient.updateWorkflow()` always runs `cleanWorkflowForUpdate()` (allowlist of writable top-level fields + settings filter) before sending the body. Coverage:

- **Unit:** `tests/unit/services/n8n-validation.test.ts` → `cleanWorkflowForUpdate` (always in CI)
- **Live:** `tests/integration/n8n-api/workflows/update-workflow.test.ts` → GET→UPDATE / spread / minimal / edge cases (Issue #433)

## Running locally

```bash
# Unit only (no n8n required)
npm run test:unit -- tests/unit/services/n8n-validation.test.ts

# Live n8n API suites
export N8N_API_URL=https://your-n8n.example
export N8N_API_KEY=...
npm run test:integration:n8n
```
