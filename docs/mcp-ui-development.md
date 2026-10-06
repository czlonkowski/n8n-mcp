# Developing and testing MCP result cards

The agent builds and repairs workflows. The cards help the user follow the work and inspect outcomes. A validation error does not create a user task; normal results never need a repair-request or copy-to-chat handoff. Structured tool results remain unchanged and available to the agent.

## Local development

Building or developing the UI requires Node `^20.19.0 || >=22.12.0` (Node 22.12+ is recommended). This build prerequisite also applies to `npm run build:all`, `npm run prepare:publish`, and `bash scripts/publish-npm-quick.sh`, which build the UI assets. The published server ships prebuilt cards; its runtime requirement remains Node `>=20.0.0`.

Install root dependencies as usual, then:

```sh
npm --prefix ui-apps ci
npm run ui:dev
```

Open [the local lab](http://127.0.0.1:5173/lab.html). The server binds to `127.0.0.1:5173` and fails if the port is occupied. Stop it with Ctrl+C. Edits to production components hot reload; refresh the scenario after editing lifecycle code to start a fresh invocation.

The lab uses the SDK's `AppBridge` and source-checked `PostMessageTransport`, an opaque `sandbox="allow-scripts"` iframe, and deterministic synthetic results. It advertises no tool-calling, message-sending, navigation or sampling capabilities. Unsupported requests fail through the SDK; it does not acknowledge arbitrary requests as successful. Development CORS allows opaque iframe origins for module loading and filesystem access is confined to `ui-apps`.

Choose an outcome or failure in **Scenario**, select a narrow **Embed width**, or start **Replay agent sequence**. Replay represents separate calls, creating a fresh sandbox per step; it does not invent a production cross-call timeline. The agent-question example is explicitly a synthetic conversation message outside the card. It demonstrates that the presence of a validation error alone must not request a human decision. Host events are recorded in the expandable log. The theme follows the browser/host, including changes while mounted.

Every new card starts collapsed to one row with the n8n-mcp name, result category and a compact outcome. Click that row, or focus it and press Enter/Space, to expand or collapse the details. Errors and pending calls also start collapsed. The full outcome remains available to screen readers and in the expanded body; synthetic results retain a visible Test marker. The lab follows the height reported by the SDK so collapsing removes the expanded card's space.

Manual expansion survives the pending-to-result transition within a card. Hosts exposing ChatGPT's optional `widgetState` and `setWidgetState` APIs can also restore that same widget's expansion after remounting. The namespaced boolean lives in UI-only `privateContent`; it never sets a global preference for future cards. Late restoration cannot override a user's click. Hosts without this capability keep local presentation state for the mounted card. See [OpenAI's widget-state guidance](https://developers.openai.com/plugins/build/chatgpt-ui#manage-state).

To check a chat host manually, rebuild and reload the fixture connection, then request fresh workflow-list, validation, operation, execution and health results. Confirm each starts as one row, expands by keyboard, shrinks after collapsing, and preserves independent expansion for earlier cards. Reopen the conversation to check optional same-widget restoration. Actual host restoration and native zoom must be verified in that host; mocked bridge tests and a narrow CSS viewport do not establish those behaviors.

Fixtures cover seven operation tools, three validation tools, workflow pages, execution list/get/delete, and status/diagnostic connection checks, minimal/full result shapes, previews, partial saves, failed saves, test preparation, triggered-but-unconfirmed runs, verified pinned-test results, cancellation, late results and malformed payloads. IDs and URLs are synthetic; the lab requires no n8n credentials.

## Actual MCP protocol smoke

Both `npm run prepare:publish` and `bash scripts/publish-npm-quick.sh` rebuild and stage the UI assets (install UI dependencies first). After either command, run `node scripts/ui-npm-smoke.mjs` to create and inspect a local npm tarball, including all five cards and their tool mappings. CI checks both preparation paths. These commands do not publish a package.

Build both packages first, then run:

```sh
npm run build
npm --prefix ui-apps run build
npm run ui:smoke
```

The smoke starts the built stdio server with telemetry disabled and live API settings empty, from a temporary working directory. It copies the bundled database into that directory so initialization cannot modify the repository database. It checks tool/resource discovery, UI metadata, all five exact built HTML resources (with a 750 kB limit per resource) and an offline validation call. It then closes the server and removes the temporary directory. A native SQLite ABI mismatch means the local native module needs rebuilding for your Node runtime, or you should use the runtime matching that installation.

The resulting ignored `ui-apps/.lab-smoke.json` contains the synthetic validation request, its actual offline result, all five built resources, and a synthetic operation receipt. **Load protocol snapshot** renders the validation HTML and result through the sandboxed SDK bridge. **Load operation bundle** renders the actual operation resource with the clearly labeled synthetic receipt; it never calls a live management tool. **Load selected built resource** renders any selected fixture using its actual resource captured through MCP. Run the smoke again after rebuilding to replace stale snapshots. This verifies server delivery plus local rendering. It does not prove a third-party chat host will display the same resource.

## Checks

```sh
npm run typecheck
npm run ui:check
npm --prefix ui-apps run test:coverage
npm --prefix ui-apps exec -- playwright install chromium
npm run ui:smoke
npm --prefix ui-apps run test:browser
```

`ui:check` runs UI TypeScript, component/contract tests and all five builds. Browser tests exercise the real bridge, agent-sequence playback, malformed/cancelled/error states, host theme changes, keyboard details, 320px embeds and accessibility. Run the protocol smoke before browser tests. CI installs Chromium and runs these checks on PRs. UI tests are excluded from the root Vitest configuration because they have their own DOM and browser environments. No test retries are enabled.

The UI contract adapters require a recognizable result. `structuredContent` is preferred; text JSON remains supported. Tool errors, initialization failures, unsuccessful validation requests and malformed data cannot become a passing verdict. Recoverable SDK diagnostics show a host communication notice while awaiting the outcome; a later valid result replaces that notice. Each invocation has pending, ready, error and cancelled states. Terminal results are snapshots; a new complete tool input explicitly resets the state. Duplicate/late results after completion or cancellation are ignored. Hosts must preserve call ordering: the Apps notifications do not provide enough identity to distinguish a late result from a previous invocation after a new input. Do not reuse a card for concurrent calls.

Loaded UI tools attach their identity in response `_meta['n8n-mcp/toolName']`. Cards prefer this identity and fall back to optional host `toolInfo` for older servers. Hosts must forward response metadata when they omit `toolInfo`; if neither is present, operation receipts retain an unknown outcome and validation scope is not reported. Public content and structured result schemas are unchanged.

Receipt labels use explicit evidence: `saved` for partial updates, `preview` for autofix, the returned validation verdict and operation count for simulation, and the official pinned-test result for confirmed execution. Arbitrary public webhook response fields are never interpreted as execution success. Unrecognized operation shapes produce an unknown outcome. There are no mutation, retry or send-to-chat buttons.

## Turning cards off

Cards are advertised by default. Two switches stop that, and both leave every tool available with the same text result:

- `N8N_MCP_DISABLE_UI_APPS=true` applies to the whole process, in stdio and HTTP mode. Only the exact value `true` turns cards off.
- `InstanceContext.uiAppsEnabled: false` applies to the requests an embedder makes with that context. Unset and `true` both mean the default. The environment variable wins over `uiAppsEnabled: true`.

With cards off the server omits `_meta.ui` and `_meta['ui/resourceUri']` from tool definitions, `_meta['n8n-mcp/toolName']` from tool results, and the `ui://n8n-mcp/*` entries from `resources/list`. `resources/read` for a `ui://n8n-mcp/*` URI keeps succeeding: hosts cache the tool list, and a host holding an older list would otherwise show a card that fails to load. For the same reason a host can keep rendering cards from a cached tool list until it fetches the list again.

In HTTP mode the context switch follows the session context, so send the value on every request:

- `ENABLE_MULTI_TENANT=true` with the default `instance` session strategy: the value is taken from each request that carries the session's full tenant identity (the same `n8nApiUrl` and `instanceId`, plus `n8nApiKey`). A request that omits `uiAppsEnabled` leaves the session's value unchanged, like every other context field; send `true` to turn cards back on. A request without the full identity does not change it.
- `MULTI_TENANT_SESSION_STRATEGY=shared`: each request's context replaces the previous one, so an omitted value means the default (cards on).
- Without multi-tenant mode a session keeps the context it was created with.

A new session takes the value from its `initialize` request, including after a server restart. A request whose `uiAppsEnabled` is not a boolean is answered with HTTP 400.

## Manual acceptance

1. Replay creation → invalid validation → fix preview → saved update → passed validation → triggered run → confirmed execution. The replay must advance without a human repair handoff.
2. Expand an error and the operation log. Confirm that subject identity and context remain available, long descriptions wrap, and tool text is displayed literally.
3. Check preview, validation-only update, partial save and failed save. The title must distinguish proposed changes from persistence.
4. Check pending, cancellation, late-result and API-error scenarios. No missing result may look like a passed check or a completed repair.
5. Select **Host diagnostic followed by a valid result**: the communication notice must give way to the saved workflow. Select scenarios ending in **no host toolInfo**: operation titles and saved-validation scope must stay correct.
6. Load the protocol snapshot and the operation bundle, and verify both actual built cards.
7. Use keyboard navigation, light/dark appearance, a 320px embed, and 200% browser zoom. Confirm focus is visible, labels are readable and content does not overflow horizontally.
8. In a target MCP Apps chat host, repeat the relevant journey after reloading the local MCP server. Record the host version and results below. Do not assume local lab success proves third-party host support.

## Compatibility record

| Surface | Evidence | Status |
|---|---|---|
| Local SDK AppBridge, source components | Manual lab and browser suite | Tested locally; see verification report |
| Local SDK AppBridge, built resource from stdio MCP | Protocol smoke + browser snapshot | Tested locally; see verification report |
| Claude.ai / Claude Desktop | Historical blank/collapsed behavior; original cause not established | Current release acceptance still requires an explicit real-host check |
| ChatGPT web | Validation error and agent-corrected success rendered via an official tunnel | Validation and all 15 restored-view fixtures verified on 2026-09-13; see verification report |
| Native ChatGPT desktop and other MCP Apps chat hosts | No direct runtime evidence | Unverified |

All five views are registered on this feature branch. Template deployment uses operation-result. Execution results dispatch by the captured action (list/get/delete), while connection results distinguish status from diagnostics. Public MCP output schemas remain unchanged. Registration does not imply verified rendering in every host. UI bundles are generated with Vite and are not committed or edited by hand.


## Test restored cards in a real chat host

Build and verify the isolated fixture server first:

```sh
npm run ui:fixtures:build
node scripts/ui-fixture-server.mjs
```

Configure your local MCP host or official tunnel to run the second command, using an absolute script path and the Node runtime for this checkout. The build command refreshes the server configuration and all UI bundles before checking all 15 fixtures. After every rebuild, reload the MCP connection and refresh its tool metadata in the host before starting a new conversation.

This separate server exposes four tools with their production names but **synthetic, read-only behavior**. It has no n8n client, network requests, database or environment-file loading. Even the deletion and deployment examples only return fixtures. Each response includes a visible synthetic-data notice inside the card. Do not replace a real production MCP connection with this development server.

Use these cases in a dedicated test connection; include `scenario` plus the exact arguments shown. The tool descriptions also list all available cases.

| Tool | Scenario | Additional arguments |
|---|---|---|
| `n8n_list_workflows` | `workflow-empty`, `workflow-error`, `workflow-page` | `limit: 6` |
| `n8n_executions` | `execution-empty` | `action: "list"` |
| `n8n_executions` | `execution-page` | `action: "list", workflowId: "demo-0"` |
| `n8n_executions` | `execution-detail` | `action: "get", id: "demo-ex-0", mode: "error"` |
| `n8n_executions` | `execution-deleted` | `action: "delete", id: "demo-ex-removed"` |
| `n8n_health_check` | `health-connected`, `health-error` | `mode: "status"` |
| `n8n_health_check` | `health-unconfigured`, `health-diagnostic` | `mode: "diagnostic"` |
| `n8n_deploy_template` | `template-saved`, `template-setup`, `template-error` | `templateId: 1000` |

Start with empty/error cases, then normal lists, execution details, connection diagnostics and template setup. Expand disclosures and inspect the synthetic notice, the returned-page scope and snapshot time. Follow with a new call and confirm the previous card does not change. These fixtures establish host rendering and action routing, not live n8n management correctness. Host cancellation remains a separate manual action; the local lab covers deterministic cancellation notifications.
