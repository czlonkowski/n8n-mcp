# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.63.0] - 2026-07-03

### Fixed

A systematic false-positive audit of the validators — every rule inventoried (439 emission points), all 1,116 recent published n8n.io templates validated under all four profiles, every major finding class investigated and adversarially verified with live n8n repros — found that 78% of published templates were declared invalid, with the dominant error classes being 90–100% false positives. This release fixes every verified false-positive class. On the template corpus, falsely-invalid workflows drop from 77% to 39% under the `runtime` profile (the remainder dominated by genuinely unconfigured skeleton templates), errors drop 39%, and warnings drop 91%.

- **Wrong-resource default injection no longer fabricates "Invalid value for 'operation'" errors.** `applyNodeDefaults` applied the first same-named property default it found, ignoring `displayOptions` — so multi-resource nodes (Gmail, Telegram, Slack, Google Drive, Discord, Notion, calendar/drive Tool variants, community nodes) with an omitted `operation` got a different resource's default injected, which then failed the enum check. Defaults are now applied visibility-aware with a fixpoint pass so `resource` resolves before `operation` regardless of schema order. This was the single largest false-error class in the corpus (~4,000 false errors across 583 workflows, 97% FP rate). The enum check also now skips expression values (`=...`), empty option lists, and dynamically-loaded (`loadOptionsMethod`) properties, and accepts the legacy Code-node `language: 'python'` value that n8n still executes.
- **Error-handling style is no longer enforced as hard errors.** The `responseNode mode requires onError` error rejected the standard documented Webhook → Respond to Webhook pattern (n8n auto-returns a 500 if a node fails before the Respond node); it is removed. The `onError: 'continueErrorOutput' but no error output connections` error is now a warning explaining the real consequence (failed items are silently dropped). Both previously flipped `valid:false` on workflows that run correctly in production.
- **Error-output detection is node-type aware.** The check that warns about wired error outputs missing `onError` treated any connection on `main[1]` as an error output, flagging every IF (false branch), Switch (case 1), and Split In Batches (loop output) with both branches wired. A shared `getMainOutputCount()` helper now computes the node's natural output count, so the error output is only looked for at the correct index (e.g. `main[2]` for IF).
- **Template literals inside expressions are no longer errors** (#338, properly this time). Two independent emitters raised hard errors claiming `${}` template literals are "not supported" — n8n's expression engine fully supports backtick template literals inside `{{ }}`. Both checks are deleted, and the unit test that asserted the false behavior now asserts the opposite.
- **Stale expression "common mistakes" warnings removed.** Optional chaining (`?.`) is supported by n8n; string-keyed bracket access (`$json['some-prop']`) is valid (and dot notation is impossible for dashed keys); fields legitimately named `test`/`invalid`/`undefined`/`null` are not "suspicious". All four stale rules are deleted; the missing-`=`-prefix warning is kept.
- **IF/Switch/Filter structure validation is version-aware.** IF v1 nodes with the native legacy `conditions.{string|number|boolean}` shape were validated against the v2.2 filter schema and told they "must have a combinator/conditions field" (~91% FP). Legacy shapes are now recognized; `combinator` is optional (n8n defaults it); `conditions.options` sub-fields (`version`, `caseSensitive`, `typeValidation`) are optional-with-defaults; and unary/binary operators are no longer required to carry or omit `singleValue` (n8n derives unary-ness from the operator name). Kept as errors: a v1-shaped conditions object on a v2 node (silent vacuous-true), a filter object with no conditions at all, and legacy v1 operator names inside v2 structures.
- **Merge input-index bounds respect n8n's lenient runtime.** A Merge node with more wired inputs than `numberInputs` only hard-errors when `numberInputs` is explicitly configured; when it is absent (default 2) the validator now warns that extra inputs are ignored — matching what n8n actually does (accepts and runs the workflow).
- **Cycle detection recognizes runtime-controlled loops.** Exit detection now considers any node on the cycle with multiple wired main outputs, an error output, or a multi-output description (including langchain routers like Text Classifier) as a potential exit, evaluates the whole cycle rather than the first DFS path, and reports as a warning instead of an error — every flagged "infinite loop" in the corpus executed to completion.
- **Expression bracket-balance checks are string-aware and expression-gated.** Unmatched `{{`/`}}` counting previously ran over whole literal strings (JSON bodies, Graph API syntax) and flagged fields that render fine; it now only applies to actual expression values and ignores braces inside string literals.
- **Path collisions from malformed bracket-index keys no longer produce phantom "missing = prefix" errors.** Junk sibling keys like `"assignments[5]"` (artifacts of botched partial updates that n8n stores but ignores) were traversed and their path collided with the real array element, making the error point at a healthy field. Such keys are now skipped, with the real-element behavior regression-tested both ways.
- **Code-node scanner false positives fixed.** `return {object}` in `runOnceForAllItems` mode is valid (n8n auto-wraps it); the tokenizer now tracks template-literal interpolation so nested `${...}` no longer desyncs the scanner and blanks real returns; `{{ }}` inside string literals is valid JS and no longer an error; the invalid-`$` heuristic runs on a string/comment/regex-stripped view so regex anchors (`/x$/`) stop matching; `this.helpers.` is no longer confused with a bare `helpers.`; Python code is read from `pythonCode` for both `python` and `pythonNative` language values; and the fs/eval/SQL pattern checks use word- and statement-boundary matching so identifiers like `item.json.path`, `regex.exec(...)`, `dropdown`, `updated_at`, or `truncated_at` no longer trigger filesystem/security/SQL findings (real `DROP`/`DELETE`/`UPDATE`/`TRUNCATE` statements and bare/global `eval`/`exec` still do; expression-valued queries downgrade to warnings since the final SQL is runtime-resolved).
- **Google Sheets `read` no longer demands a `range`** — v4 reads the sheet chosen via the resource locator; `range` is an optional advanced field.
- **Set-node `jsonOutput` and MongoDB query JSON checks skip expression values** (`=...` / `{{ }}` interpolation) that resolve to valid JSON at runtime.
- **AI/langchain validators check the parameters the nodes actually have.** MCP Client Tool endpoints are validated via `sseEndpoint`/`endpointUrl` keyed on `serverTransport` (the previously-checked `serverUrl` parameter does not exist), and its `toolDescription` requirement is dropped (descriptions come from the MCP server). SerpApi, Wikipedia, and SearXNG tools have built-in descriptions and are exempted like Calculator. AI Agent Tool's `toolDescription` has an n8n default and is now a suggestion. Workflow/HTTP/Vector Store tool missing descriptions are warnings (n8n runs them). `hasOutputParser: true` without a connected parser is a warning (n8n proceeds with plain-string output). Basic LLM Chain accepts two language models when `needsFallback` is enabled, warns on two without it, and errors only above two.
- **AI sub-nodes are no longer "not reachable from any trigger node".** The reachability traversal now follows `ai_*` connections in reverse (they are stored sub-node → parent), so models, memory, tools, and output parsers attached to a reachable agent count as reachable. This warning fired on 648 of 1,116 corpus workflows — 58% of all AI templates.
- **`extractFromFile` is back in the node database** — the shipped `nodes.db` was missing this core node, so every workflow using it got a hard "Unknown node type" error (69 corpus workflows). The rebuild now also fails loudly if any canonical core node is missing (`src/scripts/core-node-check.ts`, wired into both rebuild scripts and `validate.ts`), node modules that fail to load no longer silently vanish from the database (missing optional peer dependencies are stubbed for bare specifiers only), and unknown/over-max `typeVersion` findings on community packages are warnings (database snapshot staleness) while core packages keep hard errors.
- **Node-type similarity suggestions are no longer nonsense.** The suggester divided a capped edit-distance sentinel by name length (producing bogus high similarity for unrelated short names) and matched categories on 2-character substrings — it could confidently suggest renaming a valid langchain embeddings node to an unrelated community node. Capped distances now mean zero similarity and category matching requires whole-token matches.
- **Duplicate node ID detection ignores missing IDs** — nodes with absent/empty `id` fields no longer collide with each other; only genuinely identical non-empty IDs are flagged.
- **The workflow-level "add error handling" suggestion machinery works again** — it previously checked a connection key (`connections[...].error`) that n8n never writes, so it fired on every workflow regardless of wired error outputs; and the recovery guidance text referenced retired tool names (now `validate_node` with `mode: 'minimal'` and `get_node`).
- **Docker: database initialization at custom/empty `NODE_DB_PATH` locations actually works now.** The entrypoint ran `rebuild.js` inside the runtime container, which cannot succeed there (the slim image ships no n8n packages) — the failure was silent until this release's fail-loud rebuild change exposed it. The image now ships a pristine database seed at `/app/.db-seed/nodes.db` (outside `/app/data`, which volume mounts mask) and the entrypoint seeds new database paths by copying it; when the target volume is unwritable the entrypoint warns and continues instead of killing the container, matching the long-standing runtime contract.

### Changed

- **Validation profiles now behave as documented.** Two gating defects made `minimal`/`runtime`/`ai-friendly`/`strict` nearly indistinguishable: node-level best-practice warnings were appended after the profile filter ran, and most workflow-level advisories were emitted unconditionally. Best-practice/advisory findings (per-node-type "without error handling" warnings, webhook response advice, outdated-`typeVersion` notices, long-chain and no-input-reference hints, resource-locator `cachedResultName` advice) are now gated to `ai-friendly`/`strict`; security and deprecation warnings survive every profile. On the template corpus, `runtime` now emits 2.9k warnings vs 13.5k under `strict` — previously 32.5k vs 37.1k.
- **Advisory severities recalibrated:** "Outdated typeVersion" is a suggestion (97.6% of corpus workflows ran an older-but-supported version — that is normal, supported n8n behavior); duplicated AI-agent advisories ("has no tools connected" fired twice from two rules, community-tool env notice fired as both warning and suggestion) are emitted once; `retryOnFail` without `maxTries` (n8n's default of 3 applies) is no longer warned about; the dynamic AI-Tool-variant notice and the `continueOnFail`+`retryOnFail` combination note are informational; "Property won't be used" (strict-only) skips empty/default-valued leftovers and names properties by display name.

### Added

- Regression test suites pinning both directions of every fix: the false positive stays fixed AND the neighboring true positive still fires (`config-validator-fp-audit`, `workflow-validator-fp-audit`, `n8n-validation-filter-rules`, `node-loader-optional-deps`, `core-node-check` among others — ~150 new tests).

## [2.62.0] - 2026-07-02

### Removed

- **Retired the `n8n_generate_workflow` tool.** The tool and its supporting plumbing have been removed: the tool definition, the server-side handler dispatch, the `generateWorkflowHandler` option on `N8NDocumentationMCPServer`, `SingleSessionHTTPServer`, and `N8NMCPEngine`, and the `GenerateWorkflow*` type exports (`GenerateWorkflowArgs`, `GenerateWorkflowResult`, `GenerateWorkflowProposal`, `GenerateWorkflowHandler`, `GenerateWorkflowHelpers`) from the library API. On self-hosted deployments the tool only ever returned a pointer to the hosted service; AI-assisted workflow generation is better served today by the standard build loop (`search_templates` / `n8n_deploy_template` for templates, `n8n_create_workflow` + `n8n_validate_workflow` + `n8n_autofix_workflow` for custom builds). Library consumers that passed `generateWorkflowHandler` must remove that option when upgrading.

## [2.61.0] - 2026-06-26

### Changed

- **Updated n8n to 2.27.4.** Bumped the bundled n8n dependencies — `n8n-nodes-base` 2.26.2 → 2.27.4, `n8n-core` 2.26.2 → 2.27.3, `n8n-workflow` 2.26.2 → 2.27.2, and `@n8n/n8n-nodes-langchain` 2.26.2 → 2.27.4 — and rebuilt `data/nodes.db` (community nodes preserved). The node catalog now covers **2,063 nodes** (816 core + 1,247 community, 1,113 verified). Community nodes were refreshed (1,120 verified + 61 npm) and documentation regenerated incrementally: READMEs at 1,239/1,247 and AI summaries at 1,239/1,247.

### Fixed

- **Community-docs generator now works with OpenAI-compatible cloud LLMs.** The summary generator unconditionally sent the vLLM-only `chat_template_kwargs: { enable_thinking: false }` body field, which OpenAI and Azure OpenAI reject with HTTP 400 (`Unknown parameter`). The field is now gated to local/vLLM servers, Azure (`*.openai.azure.com`) hosts are correctly classified as cloud, and `max_completion_tokens` (already in use) keeps the generator compatible with reasoning models. This makes `generate:docs:summary-only` usable against cloud endpoints.

## [2.60.0] - 2026-06-24

### Added

- **Per-operation tool filtering via `DISABLED_TOOL_OPERATIONS`** (#714). A finer-grained companion to `DISABLED_TOOLS`: instead of removing an entire tool, operators can now disable individual operations within a tool — for example `DISABLED_TOOL_OPERATIONS=n8n_executions:delete` keeps `n8n_executions` available for read/list while blocking deletes — making it practical to stand up read-only or least-privilege deployments. Operation names are normalised to lowercase at parse time and at both enforcement points (the request guard and the executor's defense-in-depth check), so a client sending `action:"DELETE"` cannot slip past a lowercase rule. When every operation of a tool is disabled, the server warns the operator to use `DISABLED_TOOLS` instead, and the tool's destructive-operation annotations are recomputed so the advertised hints stay accurate. Thanks to @mahmoudnaif for the feature (#719).

### Fixed

- **Diff engine now removes a property when a patch sets it to `undefined`** (#292). `setNestedProperty` in `WorkflowDiffEngine` only treated `null` as a deletion marker, but `workflow-auto-fixer.ts` already removes properties with `{onError: undefined}` (carrying a literal `// This will remove the property` comment). The engine was assigning `undefined` to the key rather than deleting it, so `hasOwnProperty(key)` stayed true and the "removed" property still reached n8n. `undefined` is now honored as a removal marker alongside `null`. Thanks to @justadityaraj (Aditya Raj Singh) for the fix (#794).
- **Version-summary cache TTL was 1000× too long** (#804). The node version-summary cache passed its TTL to `SimpleCache.set(key, data, ttlSeconds)` in milliseconds (`86400000`), but the API treats the third argument as seconds and multiplies by 1000 internally — so the entry was scheduled to live ~1,000 days instead of the intended 24 hours, and stale version summaries would never expire within a normal process lifetime. The TTL is now passed in seconds (`86400`). Thanks to @linda-ai-bot for the fix.
- **Google Sheets `update` validator accepts the `columns` resourceMapper** (#730). `validateGoogleSheetsUpdate` raised false-positive `missing_required` errors (for both `range` and `values`) on valid Google Sheets v4+ configurations that map data with the `columns` resourceMapper (`mappingMode: "defineBelow"` / `"autoMapInputData"`) instead of the legacy `range` + `values` fields; `update` now treats a real `columns` mapping as satisfying both requirements. The `append` validator already accepted `columns` and was only tightened so an empty `columns: {}` no longer passes, and `read` is unchanged — it has no `columns` parameter and still requires `range`. Thanks to @infobewaize for the fix.
- **Code node return validator is no longer fooled by helper functions** (#795). The earlier helper-function fix suppressed the "Code node must return data" check whenever *any* helper function was present, so a snippet whose only primitive `return` lived inside a nested helper — with no real top-level return — could slip through. The scanner now strips nested function/method bodies before looking for a top-level return, so primitive returns inside helpers, methods, generators, regex literals, comments, strings, and `for await` blocks are no longer mistaken for the node's actual return value; the backward function-head scan is also bounded to avoid quadratic blow-up on large source. Thanks to @AjTheSpidey (Aadi Jai Gupta) for the fix.

### Changed

- **Hardened the Dependabot configuration** (#874). The n8n packages (`n8n`, `n8n-core`, `n8n-workflow`, `n8n-nodes-base`, `@n8n/*`) are now excluded from Dependabot, because they are updated via `npm run update:n8n` — which also rebuilds `data/nodes.db` while preserving community nodes — so a plain Dependabot bump would ship a stale node catalog. A dedicated `/ui-apps` npm entry was added (it has its own lockfile and is not a root workspace, so Dependabot could not otherwise see it), and `rebase-strategy: auto` was set across all ecosystems.
- **Bumped dev/build and CI tooling.** `ui-apps` build tooling — `vite` 6 → 8, `typescript` 5 → 6, `@vitejs/plugin-react` 4 → 6 (#876, #877, #878) — and the GitHub Actions used by CI: `docker/login-action` 3 → 4, `actions/upload-artifact` 4 → 7, `actions/download-artifact` 4 → 8, `actions/checkout` 4 → 7, `actions/setup-node` 4 → 6 (#869–#873). The `ui-apps` toolchain is dev-only: it produces the static single-file HTML bundles in `ui-apps/dist/**` at build time and none of it ships in the published runtime. The combined `ui-apps` upgrade was verified end-to-end (clean install, all five UI apps build); Vite 8 requires Node `^20.19 || >=22.12`, which the release build (Node 20.x) satisfies.

### Documentation

- **Documented npm cache contention for multi-client `npx` setups** (#866). Added guidance to `docs/SELF_HOSTING.md` for running several `npx n8n-mcp` clients on one machine: give each client a unique `npm_config_cache` to avoid concurrent-extraction races, and keep `DISABLE_CONSOLE_OUTPUT` set for stdio clients.

Conceived by Romuald Członkowski - https://www.aiadvisors.pl/en

## [2.59.4] - 2026-06-23

### Fixed

- **Server no longer crashes on startup with `ERR_REQUIRE_ESM`** (#864). v2.59.1's `uuid` 10 → 14 bump (#850) moved the dependency to an ESM-only build (`"type": "module"`, no `require` export condition), but the shipped artifact is compiled to CommonJS and calls `require('uuid')`. On the supported minimum Node (`>=18`) — and any Node 20.x before 20.19 or 22.x before 22.12, including the reporter's 22.11 — Node's CommonJS loader throws `ERR_REQUIRE_ESM` at module load, before any config is read, so every MCP client (Claude Code, Cursor, etc.) just saw `MCP error -32000: Connection closed`. It slipped through release verification because `tsc` only type-checks, the Vitest suite runs under an ESM transform pipeline, and CI/Docker/local dev all ran Node ≥ 20.19/22.12 where `require()` of an ESM module is silently tolerated. `uuid` is now pinned to `^11.1.1`, which ships a CommonJS build (a `node.require` export condition) and still clears the original advisory (GHSA-w5hq-g745-h8pq / CVE-2026-41907 does not affect v11), so the security fix from #850 is preserved with no source changes — `v4`/`v5` named exports are API-identical across v10/v11/v14. Reported by @anpe-efficy (André Pereira).
- **Added a CommonJS runtime smoke test** (`npm run test:cjs-runtime` and a dedicated `cjs-runtime` CI job) that loads the compiled `dist/` under the strictest CommonJS loader the running Node supports. On Node ≥ 20.19/22.12 it forces `require()`-of-ESM off via `--no-experimental-require-module` so the mismatch can't be masked; on older Node (down to the `>=18` floor) that strict behavior is already the default and the flag — which doesn't exist there — is omitted. Either way a CJS/ESM mismatch in any shipped dependency fails CI regardless of the runner's Node version, closing the gap that let #864 reach three releases.

Conceived by Romuald Członkowski - https://www.aiadvisors.pl/en

## [2.59.3] - 2026-06-21

### Fixed

- **IF node and AI Agent example/template configs now validate against n8n** (#374). The static example and task-template generators emitted configs that n8n rejects. IF (`nodes-base.if`) examples were missing the `conditions.options` block (`version`/`leftValue`/`caseSensitive`/`typeValidation`), the filter `combinator`, and per-condition `id`s — so the generated node rendered empty and failed the validators. The AI Agent task templates used `nodes-langchain.agent` (missing the `@n8n/` package prefix) with a flat `text`/`outputType`/`systemMessage` shape instead of the current `promptType` + `options.systemMessage` structure. Both are corrected to the shapes the bundled node schema actually expects, and a regression test now runs the generated configs through `EnhancedConfigValidator` (the validator users hit) so the shapes cannot silently drift again. Reported by @FelipeLuz01.
- **Windows: the MCP server no longer crashes on graceful shutdown** (#383, #385). Calling `process.stdin.destroy()` during shutdown triggered a fatal libuv assertion (`!(handle->flags & UV_HANDLE_CLOSING)`, `src/win/async.c:76`) on Windows, crashing the server on exit/disconnect — including via the published `npx n8n-mcp` stdio bin, which the earlier proposed fix missed. stdin teardown is now platform-aware (always `pause()`, only `destroy()` off `win32`) via a shared `tearDownStdin()` helper applied to both stdio entrypoints, with an explicit `win32` exit path so shutdown can't hang. Reported by @libragik.

### Security

- **Session restore now requires a complete tenant context in multi-tenant mode** (#844). Defense-in-depth follow-up to GHSA-2cf7-hpwf-47h9. `restoreSessionState()` validated a restored `InstanceContext` only via `validateInstanceContext`, which checks each field only when it is present, so a persisted context carrying just one of `n8nApiUrl`/`n8nApiKey` could be restored as a partial tenant identity — an asymmetry with the export side, which already refuses to persist a partial context. A presence guard mirroring the export-side check now rejects partial contexts on restore and emits a `session_restore_failed` security event; sessions with no context at all (single-tenant/stdio) are unaffected.

### Documentation

- **Railway deployment guide gains an upfront `AUTH_TOKEN` callout** (#152). Added a "Before You Deploy" section near the top of `docs/RAILWAY_DEPLOYMENT.md` covering both deploy paths — the one-click template (which pre-sets a placeholder `AUTH_TOKEN` you must replace) and a self-hosted repo/Dockerfile deploy (where Railway does not auto-create the variable, so the server won't start until you add it). Reported by @gthay.

Conceived by Romuald Członkowski - https://www.aiadvisors.pl/en

## [2.59.2] - 2026-06-19

### Added

- **`MULTI_TENANT_ALLOW_CONCURRENT_SESSIONS` env flag** (multi-tenant `instance` strategy). By default the instance strategy assumes one MCP session per instance and, on every `initialize`, eagerly evicts all other live sessions for that same instance (`reason: instance_reconnect`). When several MCP clients target the same instance concurrently — e.g. an automation agent, an IDE, and a web client all authenticated as one tenant — each client's `initialize` destroys the others' active sessions, so their next tool call fast-fails with `-32000 "Session not found or expired"` and the client reports a dropped connection. Set `MULTI_TENANT_ALLOW_CONCURRENT_SESSIONS=true` to skip the eager eviction and let concurrent same-instance sessions coexist; sessions are then reclaimed only by their natural lifecycle (transport close, the `SESSION_TIMEOUT_MINUTES` idle sweep, and the `N8N_MCP_MAX_SESSIONS` cap). Default `false` preserves the previous one-session-per-instance behavior. Hosted multi-client deployments should enable it.

Conceived by Romuald Członkowski - https://www.aiadvisors.pl/en

## [2.59.1] - 2026-06-19

### Security

- **Bumped `uuid` 10 → 14** (`package.json` + `package.runtime.json`). This is the only Dependabot advisory that actually reaches the published runtime artifact: a clean-room `npm install --production` from `package.runtime.json` (the manifest shipped to npm and installed in the Docker runtime stage) flagged exactly one vulnerable package — `uuid@10.0.0` (GHSA-w5hq-g745-h8pq / CVE-2026-41907, missing buffer bounds check in v3/v5/v6 when a caller-supplied output buffer is passed). The fix lands in a major release, so the `^10` pin could not auto-resolve. The server's own usage is unaffected (`v4` random IDs, and one `v5` call that passes no buffer), but the direct dependency is bumped so no vulnerable `uuid` reaches the shipped artifact. The `v4`/`v5` named exports are unchanged and verified under the CommonJS build. Note: the dev/build `package-lock.json` still contains older `uuid` copies (8.x/9.x/10.x) nested under the n8n packages (`@n8n/n8n-nodes-langchain`'s `@langchain/*`, plus snowflake-sdk, tedious, typeorm, etc.); these are build-time-only transitives that are absent from `package.runtime.json` and never installed at runtime, so they are intentionally not force-overridden (doing so would push those packages across multiple `uuid` breaking majors and risk the `npm run rebuild` build for code that does not ship). The GitHub `uuid` alert may therefore stay open until the n8n packages bump their own `uuid` upstream, which clears on the regular n8n update.
- **Bumped dev/CI test tooling out of the vulnerable ranges**: `vitest` and `@vitest/*` 3.2.4 → 3.2.6 (clears the `vitest` advisory CVE-2026-47429, which only triggers via `vitest --ui` bound to a non-localhost interface — CI runs headless `vitest run`), which also refreshes the transitive `vite` to 7.3.5. These are dev-only dependencies and are never installed in the published package or the Docker runtime image.
- **Bumped `ui-apps` build tooling**: `vite` ^6.0.0 → ^6.4.3, refreshing the transitive build chain to patched versions (`rollup` 4.62.0, `postcss` 8.5.15, `@babel/core` 7.29.7, `picomatch` 2.3.2/4.0.4). `ui-apps` produces static single-file HTML bundles at build time; none of this tooling ships in `ui-apps/dist/**`.

The remaining open Dependabot advisories are not addressed here because they do not reach a shipped artifact: the bulk are transitive dependencies of the n8n packages (`n8n-core`, `n8n-nodes-base`, `n8n-workflow`, `@n8n/n8n-nodes-langchain`), which are build-time-only (used to generate `data/nodes.db`) and are absent from `package.runtime.json` — they clear on the regular n8n dependency updates. One low-severity `esbuild` advisory (Windows dev-server arbitrary file read, GHSA-g7r4-m6w7-qqqr) remains pinned by `vite`'s `^0.27.0` range and is unreachable in this project (esbuild is an internal Vite/Vitest transform, not an exposed dev server; CI is Linux).

Conceived by Romuald Członkowski - https://www.aiadvisors.pl/en

## [2.59.0] - 2026-06-18

### Added

- **`n8n_get_workflow` gains `mode="filtered"`** for reading a single node (or a handful of nodes) without pulling the whole workflow. On large workflows with long Code-node source, `mode="full"`/`mode="active"` can return a payload big enough to be truncated client-side, leaving `jsCode`/`pythonCode` unreadable. The new mode takes a `nodeNames` array (matched against node names *or* node IDs) and returns only those nodes with their full config, plus light metadata (`nodeCount`, `returnedCount`, and a `notFound` list for any keys that matched nothing). Recommended flow: `mode="structure"` to discover node names, then `mode="filtered"` to pull the specific heavy node. Requested by @MiRaIOMeZaSu (#101).

Conceived by Romuald Członkowski - https://www.aiadvisors.pl/en

## [2.58.0] - 2026-06-17

### Changed

- **Updated n8n to 2.26.5.** Bumped the four n8n packages this server loads at build time: `n8n-nodes-base` 2.23.0 → 2.26.2, `n8n-core` 2.23.1 → 2.26.2, `n8n-workflow` 2.23.0 → 2.26.2, and `@n8n/n8n-nodes-langchain` 2.23.0 → 2.26.2. The node database was rebuilt from the upgraded packages (816 core nodes, 1,137 AI-capable tool variants, 611 versioned nodes, 271 triggers) and the existing community-node corpus (1,029 nodes) was preserved with its READMEs and AI summaries intact. README badge and node-count copy updated to 1,845 total (816 core + 1,029 community).

### Fixed

- **`npm run update:n8n` no longer aborts at its validation step.** The post-rebuild validation invoked a `test-nodes` npm script pointing at `dist/scripts/test-nodes.js`, a file removed long ago, so every run ended with `Cannot find module .../test-nodes.js` and `❌ Update failed at validation step` even though the dependency bump and database rebuild had completed. The redundant `test-nodes` step (critical-node checks are already covered by `npm run validate`) and its dangling npm script have been removed.
- **Published runtime manifest aligned with the build.** `package.runtime.json` (the manifest published to npm) pinned `@modelcontextprotocol/sdk` to `1.20.1` while the code is built and tested against `1.28.0`, and declared `node >=16.0.0` despite depending on `express@^5` (which requires Node ≥18). Both are now corrected (SDK `1.28.0`, engine `>=18.0.0`) so runtime-only installs match the tested build.

Conceived by Romuald Członkowski - https://www.aiadvisors.pl/en

## [2.57.4] - 2026-06-13

### Security

- Fix incorrect authorization for tenant-scoped workflow version backups in multi-tenant HTTP mode (GHSA-2cf7-hpwf-47h9). Reported by @DavidCarliez.

Conceived by Romuald Członkowski - https://www.aiadvisors.pl/en

## [2.57.3] - 2026-06-10

### Fixed

- **Workflow payloads mangled by HTTP MCP clients are repaired before validation (#814).** Some HTTP MCP clients (opencode confirmed) re-serialize nested tool arguments before they reach the server: arrays arrive as dense numeric-index records (`[x, y]` → `{"0": x, "1": y}`), numbers as strings (`typeVersion: "3"`), and objects as JSON strings (`parameters: "{}"`), which made `n8n_update_partial_workflow` effectively unusable and `n8n_create_workflow` intermittently fail on those clients. A new input normalizer restores the intended shapes inside the Zod schemas for workflow create/update, the partial-update diff request (the `operations` array itself plus `node`, `updates`, `patches`, `connections`, `settings`, and `position` fields), and `tags` on `n8n_list_workflows`. Guard rails: only canonical array-index keys trigger conversion (leading-zero keys like `"00"` are preserved as objects), number coercion accepts canonical decimal strings only (no `"0x10"`/`"1e3"`), normalization is depth-capped against pathological nesting, nested strings are never JSON-parsed (so `jsCode` payloads are safe), and node `credentials` — never an array in n8n — are exempt from dense conversion. Well-formed input from stdio clients passes through byte-identical. Likely also resolves #600, #611, and #492. Thanks to @cnYui for the fix (#836).
- **`n8n_manage_credentials` now explains itself when an n8n instance cannot read credentials (#809).** Not every n8n deployment allows credential reads through its public API: older versions reject `GET /credentials` outright (405), and API-key scopes or instance settings can block it (403) — so the `list` action failed with a bare `GET method not allowed` and agents could not tell an unsupported action from a transient error. `list` and `get` now detect the rejection and return a clear `NOT_SUPPORTED` response explaining the likely causes (version vs. permissions), noting that `create`, `delete`, and `getSchema` generally still work (`update` too, where the API version supports it), pointing to the n8n UI for credential IDs, and carrying the underlying status code and message in `details` for diagnosis. The tool description documents the requirement. Deployments whose API does permit credential reads (used by `list` pagination and the `get` list-fallback since 2.57.1) are unaffected.

Conceived by Romuald Członkowski - https://www.aiadvisors.pl/en

## [2.57.2] - 2026-06-09

### Fixed

- **`n8n_update_partial_workflow` no longer fails with `request/body must NOT have additional properties` on n8n 2.x.** n8n's Public API write schema (`PUT /workflows/{id}`) declares `additionalProperties: false`, but its `GET` response echoes back server-managed fields that the write schema does not accept — including a top-level `availableInMCP` column on n8n 2.x, plus fields not even in the OpenAPI spec (`activeVersionId`, `versionCounter`, `nodeGroups`). The previous payload cleaner used a denylist, so any newly-echoed field leaked into the update request and was rejected. `cleanWorkflowForUpdate` now uses an allowlist (`name`, `nodes`, `connections`, `settings`), which is forward-compatible — fields n8n adds in future versions can no longer break updates. (`availableInMCP` *inside* `settings` remains a valid, writable property and is preserved.) Also resolves the `nodeGroups` reports (#831, #838).
- **`n8n_update_full_workflow` no longer rejects updates that omit `name` or `settings`.** n8n's `PUT /workflows/{id}` is a full replace and requires `name`, `nodes`, `connections` and `settings` to all be present, but the tool lists them as optional. The handler now always fetches the current workflow and merges the caller's partial update over it, so omitted required fields are preserved from the existing workflow instead of failing with `request/body must have required property 'name'`.

Conceived by Romuald Członkowski - https://www.aiadvisors.pl/en

## [2.57.1] - 2026-06-03

### Fixed

- **`n8n_manage_credentials` can now paginate past 100 credentials (#816).** The `list` action accepts a `cursor` (and optional `limit`) and returns `nextCursor`, mirroring `n8n_list_workflows`, so callers can page through every credential on instances with more than 100. This also fixes two silent knock-on bugs: `get` by id no longer returns a false "not found" for credentials living beyond the first page (its list-fallback now scans all pages), and `includeUsage: true` on `list` now performs a complete all-pages scan instead of reporting only the first 100, so credential inventory/rotation audits no longer under-report.

Conceived by Romuald Członkowski - https://www.aiadvisors.pl/en

## [2.57.0] - 2026-06-02

### Changed

- **Updated n8n to 2.23.0.** Bumped the four n8n packages this server loads at build time: `n8n-nodes-base` 2.21.2 → 2.23.0, `n8n-core` 2.21.4 → 2.23.1, `n8n-workflow` 2.21.1 → 2.23.0, and `@n8n/n8n-nodes-langchain` 2.21.4 → 2.23.0. The node database was rebuilt from the upgraded packages (822 core nodes, 1,143 AI-capable tool variants, 606 versioned nodes, 271 triggers) and the existing community-node corpus (1,029 nodes) was preserved with its READMEs and AI summaries intact. README badge and node-count copy updated to 1,851 total (822 core + 1,029 community).

Conceived by Romuald Członkowski - https://www.aiadvisors.pl/en

## [2.56.1] - 2026-06-02

### Fixed

- **Workflow version backups are now scoped per n8n instance.** Each `workflow_versions` record is tagged with a derived, non-spoofable instance key (a hash of the instance's API URL and key), and every read, list, get, delete, rollback, and prune is filtered by it. In multi-tenant HTTP deployments this isolates version history per instance, so one tenant can no longer read or delete another tenant's backups; single-instance and stdio deployments are unaffected (one logical scope). A startup migration adds the `instance_id` column to existing databases (pre-existing, un-scoped backups are cleared during the migration) and an age-based retention sweep — configurable via `WORKFLOW_VERSION_RETENTION_DAYS` (default 30) — bounds on-disk growth alongside the existing per-workflow keep-10 pruning.

### Changed

- **Removed the global `truncate` mode from `n8n_workflow_versions`.** Per-workflow `delete`/`prune` plus the automatic retention sweep replace it.

Conceived by Romuald Członkowski - https://www.aiadvisors.pl/en

## [2.56.0] - 2026-05-23

### Added

- **`additionalTools` hook on `EngineOptions` for host-injected MCP tools (#798, #799).** Multi-tenant consumers of `N8NMCPEngine` (notably the n8n-mcp SaaS at api.n8n-mcp.com) need to expose a small number of tools that belong to their hosting layer rather than upstream — for example a tool that lets the AI agent enumerate and switch between the multiple n8n instances a single user has registered, which depends on host-specific concepts (multi-tenant credential storage, named instance registry, per-user defaults) that have no place in this repo. Before this change there was no way to inject such a tool into the engine's `tools/list` / `tools/call` surface without forking the MCP server layer or wrapping it externally and reimplementing the JSON-RPC request/response boundary, both of which couple the host to upstream wire-format details. `EngineOptions` now accepts an optional `additionalTools?: AdditionalTool[]`, where each entry pairs a standard MCP `Tool` (name, description, inputSchema) with an `async handler(args, { instanceContext })` that returns a `CallToolResult`. The option threads through `N8NMCPEngine` → `SingleSessionHTTPServer` → `N8NDocumentationMCPServer`, registering tools at construction; collisions with built-in documentation or management tool names — and duplicate names within `additionalTools` — throw immediately so misconfiguration fails fast rather than shadowing core tools. Enabled additional tools are appended to `tools/list` after the built-in surfaces, and the existing `DISABLED_TOOLS` env-var filter applies uniformly. `tools/call` routes by name: matching calls dispatch to the host's handler with the current per-session `InstanceContext` (so per-tenant credentials and defaults are available), and the handler's `CallToolResult` is returned unchanged — the built-in stringify/wrap path that built-in tools go through is skipped, letting hosts control the response shape and content types. Non-matching calls continue through the existing built-in dispatch. Argument validation (`expected object`) applies to additional tools the same way it does to built-ins. New `AdditionalTool` and `AdditionalToolContext` types are re-exported from `src/index.ts` and `src/mcp-engine.ts` for integrator use. Hosts that prefer not to emit internal tool names in telemetry should filter at the telemetry sink — additional tools receive the same `trackToolUsage(name, true, duration)` treatment as built-ins. Coverage: six unit tests against the registry covering handler dispatch with `instanceContext`, non-object argument rejection, `DISABLED_TOOLS` filtering, collision rejection against both documentation and management tool name lists, duplicate-name rejection, and a request-handler-level test that asserts the additional tool's `CallToolResult` is returned unchanged through the full `tools/call` path (no double-wrapping regression). No breaking changes — the field is optional and existing engine consumers see identical behavior when omitted.

Conceived by Romuald Członkowski - https://www.aiadvisors.pl/en

## [2.55.0] - 2026-05-22

### Changed

- **Updated n8n to 2.21.7.** Bumped the four n8n packages this server loads at build time: `n8n-nodes-base` 2.20.4 → 2.21.2, `n8n-core` 2.20.3 → 2.21.4, `n8n-workflow` 2.20.0 → 2.21.1, and `@n8n/n8n-nodes-langchain` 2.20.4 → 2.21.4. The node database was rebuilt from the upgraded packages (822 core nodes, 542 AI-capable tool variants, 86% documentation coverage) and the community-node corpus was refreshed against the n8n verified-nodes Strapi API and the npm registry — total community count is now 1,029 (911 verified + 118 unverified), and incremental README/AI-summary generation backfilled the new arrivals (1,022/1,029 with README, 1,021/1,029 with AI summary). README badge and node-count copy updated to 1,851 total (822 core + 1,029 community, 911 verified).

Conceived by Romuald Członkowski - https://www.aiadvisors.pl/en

## [2.54.0] - 2026-05-18

### Added

- **MCP Resources surface for n8n-skills markdown.** The `n8n-skills` repo ships seven expert skills (~30 markdown files covering Code node JavaScript/Python, expression syntax, node configuration, validation, workflow patterns, and the n8n-mcp tools themselves) as a Claude Code plugin. That distribution path only reaches Claude Code users with the plugin installed; every other MCP client — Cursor, Claude Desktop without plugins, the OpenAI Agents SDK, custom agents — had no way to discover or read this content even though they all consume `n8n-mcp`. The MCP `resources` capability is the standard surface for on-demand markdown context, and the server already implemented `ListResources`/`ReadResource` for UI apps under `ui://n8n-mcp/{id}` (`src/mcp/server.ts:901-938`), so a parallel `skill://n8n-mcp/{name}/{file}` namespace fits the existing plumbing exactly. A new `SkillResourceRegistry` mirrors `UIAppRegistry`: it scans `data/skills/*/*.md` at server construction, parses frontmatter (or the first heading as fallback) for resource metadata, and serves each markdown file with `mimeType: text/markdown`. A bare `skill://n8n-mcp/{name}` URI resolves to that skill's `SKILL.md` as a convenience, and a new `resources/templates/list` handler advertises both URI templates (`skill://n8n-mcp/{name}` and `skill://n8n-mcp/{name}/{file}`) so capable clients can construct URIs without enumerating first. The existing `ui://n8n-mcp/{id}` resolution is unchanged — both schemes coexist in the same `ListResources`/`ReadResource` handlers. The skill markdown is brought into the npm artifact and Docker image via a new `npm run sync:skills` script that copies from a sibling `n8n-skills/skills/` checkout (configurable via `N8N_SKILLS_SOURCE`), with the copy committed under `data/skills/` so CI and downstream consumers do not need the sibling repo present. `package.json` `files` and the Dockerfile both ship `data/skills/`. Skills are exposed unconditionally — they are low-cost (~28k lines, loaded once at startup) and Claude Code's plugin distribution and the MCP Resources surface intentionally serve different clients: a Claude Code user installs the plugin for the auto-loaded `Skill` tool UX, and everyone else now gets the same content via `resources/list`. Coverage: 15 unit tests against the registry.

Conceived by Romuald Członkowski - https://www.aiadvisors.pl/en

## [2.53.2] - 2026-05-18

### Fixed

- **Batch `n8n_update_partial_workflow` operations no longer fail with a phantom "Source node not found" when a later `updateNode` renames a node referenced by an earlier connection op (#788).** The diff engine previously processed operations in two passes — every node op (add/remove/update/move/enable/disable) ran first, then every connection op — so a batch like `[removeConnection NodeA→NodeB, removeNode NodeB, updateNode NodeA→{name:"NodeB"}, addConnection NodeB→NodeC]` validated `operation 0` against state that already had the rename projected on it, even though the rename was scheduled for `operation 3`. Because connection references are rewritten in-place when a node is renamed (the #353 auto-update behavior), the original `NodeA` had effectively vanished from the validator's view before its own `removeConnection` ran, and the error's "Available nodes" list — which showed the **post-rename** node set against a failure reported on `operation 0` — was the giveaway. The engine now applies operations strictly in caller order and runs `flushPendingRenames()` after each op so connection references catch up to the new node name *before* the next op validates; chained renames (`A→B` then `B→C`) consequently compose correctly, where the previous renameMap-based post-pass would have collided on the intermediate key. A single backward-compat case is preserved: an `addConnection` or `rewireConnection` that references an `addNode` declared later in the same batch is still accepted — that one `addNode` is hoisted to just before its first earlier reference. Other op kinds (notably `removeConnection X→Y` before `addNode X`, or `replaceConnections` referencing a not-yet-added node) are no longer reordered and now fail validation at their actual call site, which matches what the caller is actually asking for. As a defense against a related Copilot-flagged edge case, `applyUpdateNode` no longer records a rename intent in `renameMap` before the updates loop runs — if a subsequent path inside the same updates object throws (forbidden path keys, `__patch_find_replace` failures), the rename is never committed, so `continueOnError` mode cannot carry a phantom rename into a later op and silently rewrite connection keys to a name no node carries. Six regression tests cover the #788 batch in both `validateOnly` modes, the `continueOnError` variant, the legacy hoist, the strict negative case, and the rename-leak guard. The `docs/workflow-diff-examples.md` "two-pass processing" section is rewritten to describe the new sequential semantics and the single backward-compat hoist. Reported by @DocksDocks; fix by @AjTheSpidey.

Conceived by Romuald Członkowski - https://www.aiadvisors.pl/en

## [2.53.1] - 2026-05-18

### Fixed

- **SSRF guard no longer blanket-rejects IPv6 addresses on DNS64/NAT64 networks reaching public IPv4 servers.** A community user reported that every n8n API call started failing with `SSRF protection: IPv6 private address not allowed` after their environment switched to a resolver that synthesizes `AAAA` records via DNS64 — Node 17+ returns the synthetic `64:ff9b::<public-IPv4>` address first under default verbatim DNS ordering, and the previous blanket block on the `64:ff9b::/96` prefix rejected it. The IPv6 helper now inspects the canonical hextets of recognized tunneling prefixes and extracts the embedded IPv4, then applies the same `PRIVATE_IP_RANGES` and `CLOUD_METADATA` policy already enforced on plain IPv4 destinations. Supported layouts: NAT64 RFC 6052 well-known `64:ff9b::/96`; NAT64 RFC 8215 local-use at the `64:ff9b:1::/96` sub-prefix layout (parts[3..5] == 0) — RFC 8215 §3.1 recommends operators carve /96 sub-prefixes for IPv4 embedding, so this covers the realistic deployment; 6to4 RFC 3056 `2002::/16`; and Teredo RFC 4380 `2001::/32`. Tunneled private/metadata IPv4 — including the original GHSA-56c3-vfp2-5qqj payloads `64:ff9b::a9fe:a9fe`, `2002:a9fe:a9fe::`, and the equivalent loopback/RFC1918 embeddings — stays blocked. Tunneled public IPv4 (e.g. `64:ff9b::8.8.8.8`) is now allowed. Non-canonical shapes within the same prefix families — `64:ff9b:` outside the supported /96 layouts (including the literal RFC 6052 /48 embedding that interleaves the IPv4 around a u-octet at bits 64-71), and any 6to4/Teredo we don't recognize — fail safe and are blocked. Tunneled cloud-metadata and non-canonical tunneling shapes are now gated in **every** security mode (including permissive), restoring the "metadata blocked in all modes" promise and the fail-safe stance for unknown wire formats. IPv6 parsing is delegated to `ipaddr.js` (already a transitive dependency via `express → proxy-addr`, now promoted to a direct dep at the same `^1.9.1` version, so the install footprint is unchanged). Reported by Luca M.

Conceived by Romuald Członkowski - https://www.aiadvisors.pl/en

## [2.53.0] - 2026-05-14

### Fixed

- **Multi-tenant `shared` session strategy no longer terminates concurrent sessions for the same tenant (#783).** Previously, the eager same-instance session cleanup at the top of the HTTP `initialize` handler ran *before* the configured `MULTI_TENANT_SESSION_STRATEGY` was consulted. When the strategy was set to `shared` — intended to let multiple MCP clients reuse the same tenant context concurrently — a second client's `initialize` for the same `x-instance-id` still wiped the first client's session, leaving the first client to fail subsequent requests with `Session not found or expired`. The cleanup is now gated behind `ENABLE_MULTI_TENANT=true && MULTI_TENANT_SESSION_STRATEGY=instance`, restoring the documented behavior of `shared`. The `instance` strategy is unchanged: same-tenant inits still replace prior sessions, which is the desired eager-cleanup semantic there. Two regression tests cover both branches. Reported and fixed by @LevSky22.
- **HTTP Streamable transport now returns `404` (not `400`) for terminated session IDs, per the MCP spec (#784).** The [MCP Streamable HTTP spec (2025-06-18)](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports#session-management) requires servers to respond with `404` when a request carries a valid-format `Mcp-Session-Id` that no longer maps to an active session — that's the client's signal to start a fresh session via `initialize`. The server previously responded with `400 Bad Request: Session not found or expired`, which spec-compliant clients (Claude Desktop, the MCP SDK) cannot distinguish from a genuinely malformed request, so they surface the error to the user instead of auto-reconnecting. The two affected sites (the TOCTOU window after the session-existence check, and the regular non-`initialize` fall-through) now return `404` with `Session not found or expired`. `400` is preserved for genuinely bad requests (missing session ID on a non-`initialize` request), and `202` is preserved for stale-session notifications (the anti-reconnect-storm path from #654). Reported and fixed by @LevSky22.
- **`n8n_get_workflow` no longer exceeds Claude Code's per-tool result cap on active workflows (#777).** n8n's draft/publish model returns a nested `activeVersion` object on every workflow GET, duplicating the live graph's `nodes` and `connections` alongside the draft. On the ~50% of workflows that are active, this pushed responses past Claude Code's default 25 000-token MCP cap, so the host persisted the result to a `/var/folders/...` file the model's sandboxed Bash couldn't read — effectively breaking the tool for any non-trivial workflow. `handleGetWorkflow` (mode `full`) and `handleGetWorkflowDetails` (mode `details`) now strip the heavy `activeVersion` payload while preserving the lightweight `activeVersionId` pointer, cutting response size roughly in half. As a defense-in-depth layer for genuinely huge workflows, the `n8n_get_workflow` tool definition now carries `_meta["anthropic/maxResultSizeChars"]: 450000` to opt the tool above the default cap (per the [Claude Code MCP spec](https://code.claude.com/docs/en/mcp#raise-the-limit-for-a-specific-tool)) — the value sits below the protocol's 500k-char ceiling to leave headroom for the MCP/JSON-RPC envelope. `UIAppRegistry.injectToolMeta` was switched from assignment to a spread-merge so per-tool `_meta` keys (like the size override) are preserved when UI metadata is injected. Reported by @nepalez.

### Added

- **`n8n_get_workflow` gains `mode='active'` for inspecting the published graph.** Because n8n's editor saves a draft separately from the published/running version, callers that need to reason about what is actually executing (rather than what is being edited) now have a dedicated mode. The response is single-shaped — `nodes` and `connections` are populated from `activeVersion`, with `activeVersionId`, `versionCreatedAt`, and `versionName` exposed at the top level. `versionCreatedAt` is the version row's creation timestamp (within ~1s of the publish event in current n8n; we don't claim they're identical). On older n8n versions without the draft/publish split, the mode falls back to `workflow.nodes` when `active: true` so the mode stays usable across n8n versions; `NO_ACTIVE_VERSION` is returned only for inactive workflows that were never published. Type-safe support for the new fields was added to the `Workflow` interface as `ActiveWorkflowVersion`.

Conceived by Romuald Członkowski - https://www.aiadvisors.pl/en

## [2.52.0] - 2026-05-13

### Changed

- **Updated n8n dependencies to 2.20.x.** `n8n-nodes-base` 2.18.3 → 2.20.4, `n8n-core` 2.18.3 → 2.20.3, `n8n-workflow` 2.18.3 → 2.20.0, `@n8n/n8n-nodes-langchain` 2.18.3 → 2.20.4. Pinned exactly (no caret) so a fresh `npm install` after a future minor release of any of these packages can't slip in a different node set than `data/nodes.db` was rebuilt against — `scripts/update-n8n-deps.js` now writes exact pins for the same reason. Database rebuilt against the new packages; community node rows preserved across the rebuild.
- **`get_node` (essentials/standard detail) `version` field is now a number, not a string** *(behavior change for all callers, not just community nodes)*. Previously the value came straight from the SQLite `version` TEXT column (`"1"`, `"2.3"`); it is now coerced to a finite JS number (`1`, `2.3`) so it can be assigned directly as `typeVersion` in workflow JSON. Callers that did `.startsWith()`, regex matching, or string comparison on the field need to coerce themselves or update to numeric handling. The `versionNotice` string is unchanged.

### Fixed

- **Community nodes: stop advertising npm package version as `typeVersion` (#781).** For community nodes, `get_node` previously returned the npm package version (e.g. `"0.2.21"`) in the `version` field and emitted `versionNotice: "Use typeVersion: 0.2.21 when creating this node"`. The advertised value is not a valid JS number — assigning `typeVersion: 0.2` produced workflows that n8n's runtime rendered as red/broken nodes even though both `validate_workflow` and `n8n_validate_workflow` reported them as valid. The community-node parser no longer falls back to the npm package version when the descriptor's version is missing (Strapi path) and never seeds the npm version as `typeVersion` (npm-only path); both default to `1`, which is what declarative community nodes register at runtime. The `get_node` response, for community nodes, surfaces `isCommunity: true`, `npmVersion`, a community-aware `versionNotice`, and a `metadata.versionCoerced` audit field whenever stale seed data has to be resolved on the fly. The shipped `data/nodes.db` is migrated in place: 118 community rows whose stored `version` was a multi-dot semver or contained letters were reset to `'1'`. `WorkflowValidator.validateAllNodes` now rejects non-finite typeVersions (including `NaN`) with an explicit "must be a finite non-negative number" message, parses comma-separated and array-form `nodeInfo.version` strings before min/max comparisons, falls back to suggesting `typeVersion: 1` when the database version is unparseable, and emits a "Cannot validate typeVersion" warning when stored seed data is unparseable so callers know the min/max checks were skipped rather than silently passed. Reported by @czlonkowski.

Conceived by Romuald Członkowski - https://www.aiadvisors.pl/en

## [2.51.3] - 2026-05-11

### Security

- Fix workflow-telemetry URL path and query-string leak (GHSA-f3rg-xqjj-cj9w). `WorkflowSanitizer` previously replaced only the hostname of `url`, `endpoint`, and `webhook` field values with `[domain]` and left the path and query string intact, allowing customer IDs in URL paths, tenant identifiers, signed-request parameters, and tokens shorter than the 20-character generic-token threshold to reach the `telemetry_workflows` and `workflow_mutations` Supabase tables. `sanitizeObject` now fully redacts URL-named fields to `[REDACTED_URL]` regardless of value type, the dead hostname-only branch in `sanitizeString` is removed, and `event-validator.ts` replaces `nodes: z.array(z.any())` with a `.strict()` per-node schema that rejects unknown top-level node keys as defense-in-depth. The mutation telemetry path (`sanitizeWorkflowRaw`) shares the same code path and is fixed automatically. Reported by @u-ktdi.

### Notes

- **Telemetry output format changed.** Anyone consuming the local telemetry analytics will see `[REDACTED_URL]` in place of the previous `https://[domain]/<path>?<query>` and `[REDACTED_URL_WITH_AUTH]` placeholders for `url`, `endpoint`, `webhook`, and similarly-named fields. Pattern-specific placeholders (`[REDACTED_SUPABASE_URL]`, `[REDACTED_N8N_HOST_URL]`, `[REDACTED_WEBHOOK]`, etc.) still apply to free-text node parameters that happen to contain those URLs (e.g. `jsCode`, `systemMessage`).
- The webhook short-circuit in `sanitizeString` (returns `https://[webhook-url]` when a string value contains `/webhook/` or `/hook/`) remains for non-URL-named fields whose value embeds a webhook URL.

Conceived by Romuald Członkowski - https://www.aiadvisors.pl/en

## [2.51.2] - 2026-05-11

### Security

- Fix silent env-credential fallback in multi-tenant HTTP mode (GHSA-jxx9-px88-pj69). When `ENABLE_MULTI_TENANT=true`, requests that omitted the `x-n8n-url` and `x-n8n-key` headers fell through to the process-level `N8N_API_URL` / `N8N_API_KEY`, letting one authenticated MCP tenant operate on the operator's n8n instance. Both paths now fail closed: the HTTP edge rejects header-less multi-tenant requests with `400 Multi-tenant headers required`, and `getN8nApiClient` refuses to construct an env-fallback client when `ENABLE_MULTI_TENANT=true`. Single-tenant mode is unchanged. Reported by @u-ktdi.

Conceived by Romuald Członkowski - https://www.aiadvisors.pl/en

## [2.51.1] - 2026-05-06

### Security

- **Hardened `WorkflowSanitizer` (telemetry workflow ingestion) against new secret and PII categories (#779).** Added regex coverage for OpenAI `sk-proj-` / OpenRouter `sk-or-`, Stripe, GitHub PATs, GitLab, Hugging Face, Notion, GoHighLevel, Slack, AWS access key IDs, generic JWTs, Supabase secret/publishable keys, self-hosted n8n hostnames, and Supabase project URLs — all with type-aware placeholders (`[REDACTED_LLM_API_KEY]`, `[REDACTED_SUPABASE_KEY]`, `[REDACTED_STRIPE_KEY]`, `[REDACTED_API_TOKEN]`, `[REDACTED_JWT]`, `[REDACTED_N8N_HOST_URL]`, `[REDACTED_SUPABASE_URL]`). Added email and phone redaction for free-text node parameters (`systemMessage`, `text`, `html`, `prompt`, …). Made the generic 20-31 / 32+ char fallbacks idempotent via a `(?!REDACTED)` negative lookahead and dropped the early-break in `sanitizeString` so strings with secrets matching different patterns get every match redacted. Tightened the Bearer regex to stop at common string delimiters (quotes, commas, semicolons, closing brackets) so `auth: 'Bearer <token>'` no longer eats the closing quote. Tightened the phone regex with digit/hyphen lookbehind/lookahead so UUIDs and other hex-with-hyphen IDs aren't misclassified as phone numbers.

Conceived by Romuald Członkowski - https://www.aiadvisors.pl/en

## [2.51.0] - 2026-05-06

### Added

- **`n8n_manage_credentials` now reports which workflows reference each credential.** Pass `includeUsage: true` to `action: "list"` or `action: "get"` to attach a `usedIn: [{id, name, active}]` array and a `usageCount` to every credential. The reverse index is built client-side by scanning workflows (n8n's public API has no native lookup), deduplicated per workflow, and capped at the same 5000-workflow limit `n8n_audit_instance` uses. Default behavior is unchanged — no extra API calls when the flag is omitted. If the workflow scan fails the response degrades to base credentials with a `usageScanError` field rather than failing the whole call.

Conceived by Romuald Członkowski - https://www.aiadvisors.pl/en

## [2.50.5] - 2026-05-05

### Fixed

- **Advertise the Bearer auth scheme on `401` responses (#604).** HTTP-mode `/mcp`, `/sse`, and `/messages` now return an RFC 6750-compliant `WWW-Authenticate` challenge alongside the existing JSON-RPC `-32001` error body. Missing-credentials responses use `Bearer realm="n8n-mcp"` (no `error=` keyword, per RFC 6750 §3); rejected credentials use `error="invalid_request"` for non-Bearer schemes and `error="invalid_token"` for bad bearer secrets. Lets MCP scanners and OAuth-discovery clients distinguish "auth required" from "endpoint unreachable" without reading the JSON body. Originally authored by @voidborne-d (#767).

Conceived by Romuald Członkowski - https://www.aiadvisors.pl/en

## [2.50.4] - 2026-05-05

### Fixed

- `n8n_list_workflows` and `n8n_executions` no longer fail with `VALIDATION_ERROR: Empty value found for query parameter` when MCP clients (e.g. opencode v1.14.35) serialize all schema fields — including optional ones — as empty strings. Optional string params (`cursor`, `projectId`, `workflowId`, `status`, `sortBy`, `search`) are now coerced to `undefined` before reaching the n8n API. Reported and diagnosed by @ale90bsas (#774).
- The same coercion is applied to `n8n_manage_datatable` (list/create/get-rows actions), `n8n_test_workflow`, and `n8n_trigger_webhook_workflow`, all of which had the same vulnerability surface from a broader audit.
- `serializeDataTableParams` in the n8n API client now also skips blank-string values as defense-in-depth.

Conceived by Romuald Członkowski - https://www.aiadvisors.pl/en

## [2.50.3] - 2026-05-04

### Fixed

- `n8n_update_partial_workflow` now rolls back the prior workflow snapshot when n8n persists a body before failing (e.g. unsupported `typeVersion` trips the activation step inside the same PUT), preventing silent corruption of active workflows. Reported and originally fixed by @pybe (#769, closes #770).
- The rollback no longer fires (and no longer claims `(workflow restored to prior state)`) when n8n rejected the PUT before persisting. The handler now compares `versionId` / `versionCounter` / `updatedAt` from a fresh GET to detect whether persistence actually happened.
- Rollback-failure responses include `details.priorVersionId` so callers can recover the right snapshot via `n8n_workflow_versions`.

Conceived by Romuald Członkowski - https://www.aiadvisors.pl/en

## [2.50.2] - 2026-05-04

### Security

- Fix SSRF in webhook URL validation (GHSA-cmrh-wvq6-wm9r). Reported by @fg0x0.

### Notes

- The n8n API client now validates `N8N_API_URL` through the same SSRF gate as user-supplied webhook URLs. Operators running n8n on the same host as n8n-mcp (`N8N_API_URL=http://localhost:5678` or an RFC1918 address) must set `WEBHOOK_SECURITY_MODE=moderate` (allows localhost, still blocks cloud metadata) to keep the API client functional after upgrade. Default `strict` is unchanged for production deployments with a public n8n URL.

Conceived by Romuald Członkowski - https://www.aiadvisors.pl/en

## [2.50.1] - 2026-05-04

### Security

- Fix path-segment validation gap in n8n API client (GHSA-8g7g-hmwm-6rv2). Reported by @cybercraftsolutionsllc.
- Fix redirect-following on validated webhook, form, and chat trigger requests (GHSA-8g7g-hmwm-6rv2). Reported by @cybercraftsolutionsllc.
- Redact mutation telemetry payloads before storage (GHSA-8g7g-hmwm-6rv2). Reported by @cybercraftsolutionsllc.

Conceived by Romuald Członkowski - https://www.aiadvisors.pl/en

## [2.50.0] - 2026-05-02

### Added

- **Local LLM support for template metadata generation.** `fetch:templates --metadata-only` now routes to any OpenAI-compatible server (vLLM, Ollama, llama.cpp's `/v1`) when `N8N_MCP_LLM_BASE_URL` is set, falling back to OpenAI's Batch API otherwise. New `SequentialMetadataProcessor` issues direct `chat.completions.create` calls with configurable concurrency, since vLLM and friends do not implement OpenAI's `/v1/batches` endpoint. New env vars: `N8N_MCP_LLM_BASE_URL`, `N8N_MCP_LLM_MODEL` (default `Qwen/Qwen3.5-9B`), `N8N_MCP_LLM_API_KEY` (defaults to `EMPTY` for keyless local servers), `N8N_MCP_LLM_CONCURRENCY` (default 40). The cloud Batch path is unchanged.
- **Stronger, leak-resistant prompt** for template metadata. The system message now spells out what each schema field means (categories, use_cases, required_services, key_features, target_audience) and explicitly forbids echoing prompt headers, which fixes a class of failures where smaller open-source models occasionally emitted `Template: ...` strings into the `categories` array. `createBatchRequest()` now delegates to `buildChatRequest()`, so the cloud Batch path picks up the new prompt too — both paths share the same body verbatim.

### Changed

- **Template store refreshed from n8n.io.** The templates table was rebuilt against the current API: 2,352 templates, 156 ranked node configurations across the most-popular nodes. Previous rebuild dated 2025-12-24.
- **Template metadata regenerated end-to-end** against a local Qwen3.5-9B vLLM instance: 2,351/2,352 templates carry fresh `metadata_json` (99.96% coverage). One template (4334) skipped due to a tokenizer encoding edge case in its source content.
- **Community node store refreshed** from the n8n Strapi verified list and the top-100 npm packages: **830 community nodes** (was 768, +62 new). Existing READMEs and AI summaries preserved through the upsert. Total nodes in DB: 1,650 (820 base + 830 community).
- **Community AI documentation summaries regenerated** against the same local Qwen3.5-9B instance: **825/830 nodes** with both `npm_readme` and `ai_documentation_summary` (99.4% coverage). The 5 misses are npm packages that publish no README on npmjs, so there is no source text to summarise.

### Notes

- Template fetch only drops the `templates` and `templates_fts` tables — never `nodes`. Community nodes were verified intact at 768 mid-run before the separate community refresh added the 62 new ones.
- A backup of the pre-fetch database lives at `/tmp/nodes-pre-template-update-20260502-093230.db` on the maintainer's machine.

Conceived by Romuald Członkowski - https://www.aiadvisors.pl/en

## [2.49.0] - 2026-04-28

### Changed

- **Updated n8n to 2.18.4** (from 2.16.1). All four n8n packages bumped to the versions pinned by `n8n@stable`:
  - `n8n-nodes-base`: 2.16.0 → 2.18.3
  - `n8n-core`: 2.16.1 → 2.18.3
  - `n8n-workflow`: 2.16.0 → 2.18.3
  - `@n8n/n8n-nodes-langchain`: 2.16.1 → 2.18.3
  - Pins are now exact (no caret) to prevent npm from auto-resolving to `2.19.0`, which `n8n@stable` does not yet endorse and which would also force a different `zod` peer.
- **Bumped `zod` to 3.25.67** (from 3.24.1) to satisfy the new `zod` peer dependency declared by `n8n-core@2.18.3` and `n8n-workflow@2.18.3` — the same version `n8n@stable` itself depends on.
- **Rebuilt node database**: 1,588 nodes total — 820 core (675 from `n8n-nodes-base` + 145 from `@n8n/n8n-nodes-langchain`) + 768 community (668 verified + 100 from npm). Community READMEs refreshed via `generate:docs:readme-only` (763/768 with READMEs, 581/768 with AI summaries — the AI-summary backfill for newly-added community nodes runs separately via the local LLM step).
- **README badges and node counts updated** to reflect the new n8n version, node totals, and current passing-test count (`5,418`).

Conceived by Romuald Członkowski - https://www.aiadvisors.pl/en

## [2.48.3] - 2026-04-28

### Fixed

- **Validator warning for `__rl` resourceLocator fields missing `cachedResultName` (#715, originally reported in #516 by @upsurge911-lgtm).** When a `__rl` field has `mode` and `value` but no `cachedResultName`, the workflow runs but the n8n UI shows "Choose..." in dropdowns and dependent metadata fetches (column lists, base names, etc.) never fire — users see "No columns found" with no obvious cause. Pre-fix the validator was completely silent on this. New `missing-cached-result-name` warning fires at `runtime`/`ai-friendly`/`strict` profiles (suppressed at `minimal`). The warning is gated to modes where the n8n UI renders a dropdown that displays the cached label (`id`, `list`, `name`) — modes with raw inputs (`expression`, `url`) are skipped to avoid false positives. The autofix half (live n8n API resolution + placeholder fallback) ships in a separate follow-up PR.

Conceived by Romuald Członkowski - https://www.aiadvisors.pl/en

## [2.48.2] - 2026-04-28

### Fixed

- **`n8n_audit_instance` error message now distinguishes server-side from client-side failures (#736, reported by @waltho1123-cloud).** Pre-fix the warning was always `Built-in audit failed: <message>`, hiding HTTP status. The reporter's Zeabur deployment generates the `Invalid URL` string inside n8n's own audit code (likely from missing `N8N_PROTOCOL`/`N8N_HOST` env vars) and returned it as the response body — but the warning made it look like a client bug. Three new shapes: `endpoint not available` (404, unchanged); `Built-in audit failed (HTTP <status>): <reason>` for any other status; `Built-in audit failed (no response from n8n): <reason>` when no status was returned (timeouts, ECONNREFUSED). Also fixed a long-standing nit where the error path computed `builtinAuditMs` against `totalStart` instead of `auditStart`.
- **`n8n_manage_credentials` accepts `oAuth2Api` + `clientCredentials` payloads (#740, reported by @bwsnwl).** n8n's upstream Ajv schema for `oAuth2Api` has a known bug: the `if/then/else` on `useDynamicClientRegistration` uses `properties.x.enum` to test value, which evaluates true vacuously when the field is absent — so both `then` branches fire simultaneously and there is no payload shape that satisfies the schema for a plain `clientCredentials` grant. New `applyCredentialDataShims` helper normalizes the payload for that specific combination: strips `useDynamicClientRegistration` when falsy, injects `sendAdditionalBodyProperties: false`, `additionalBodyProperties: ''`, and `serverUrl: ''` (only when the DCR branch fires spuriously — explicit `useDynamicClientRegistration: true` callers are left alone so n8n surfaces real missing-field errors). Applied symmetrically on both create and update paths. Will be removed once n8n fixes the schema upstream.

Conceived by Romuald Członkowski - https://www.aiadvisors.pl/en

## [2.48.1] - 2026-04-28

### Fixed

- **`n8n_update_partial_workflow` validateOnly path now matches the apply path (#744, reported by @Valirius).** Two interacting bugs:
  - **Path divergence:** `validateOnly: true` returned the structural-validation early-exit BEFORE `validateWorkflowStructure` ran. Reporters could see a green `valid: true` from validate-only and then fail the apply call with a structural error. The structural check now runs in both paths, and the validate-only response includes the same `structureErrors` the apply path would surface, plus a `valid` boolean that reflects post-diff structural validity. The diff engine's `validateOnly` return now carries the simulated post-diff `workflow` so the handler has something to validate against.
  - **Zod 4 record-key incompatibility:** Single-arg `z.record(valueSchema)` is reinterpreted by Zod 4 (bundled by `@modelcontextprotocol/sdk`) as `z.record(keySchema=valueSchema)`, causing node-name strings like `"W-05b Set Context"` to fail with `_zod` / `Invalid key in record`. All `z.record` calls in `n8n-validation.ts` (`workflowNodeSchema.parameters`, `.credentials`, `workflowConnectionSchema`) and `handlers-n8n-manager.ts` (`createWorkflowSchema.connections`, `updateWorkflowSchema.connections`) now use the explicit two-arg `z.record(z.string(), valueSchema)` form which is unambiguous in both Zod 3 and Zod 4.

Conceived by Romuald Członkowski - https://www.aiadvisors.pl/en

## [2.48.0] - 2026-04-28

Three validator/diff false-positive fixes that were blocking valid workflows from being authored or updated via the MCP tools.

### Fixed

- **`addConnection` no longer rejects multiple Switch outputs to the same target (#738, reported by @priyasogani8-star).** `validateAddConnection` was scanning every `sourceIndex` slot when checking for duplicates, so wiring Switch output 1 to a node that already had a connection from output 0 falsely failed with "Connection already exists". The check now resolves smart parameters (`branch`/`case`) the same way `applyAddConnection` does and only inspects the specific `(sourceOutput, sourceIndex)` slot. The error message now also includes the resolved index for clarity. Same change applied to `validateRewireConnection` to suppress duplicate sourceIndex warnings (validate + apply phases were both pushing them) — `resolveSmartParameters` gained an opt-in `silent` mode used only from validate.
- **`validate_workflow` no longer false-flags operations on community nodes with empty schema (#739, reported by @priyasogani8-star).** `EnhancedConfigValidator.validateResourceAndOperation` was emitting `Invalid operation "X" for node ...` for any non-empty operation value when the node was missing or had empty operation metadata. The puppeteer community node (and similarly indexed packages) ARE in the local DB but with empty `operations`/`properties_schema` columns, so `getNodeOperations()` returned `[]` and any explicit operation was rejected. Three new guards: top-of-method early-exit when `getNode()` returns null, plus per-field skips when the node has zero resource schema or zero operation schema globally. Real typos on KNOWN nodes (e.g. `operation: "sendMessage"` on Slack) still surface correctly.
- **`n8n_validate_workflow` no longer false-flags Code nodes with template literals or compact `}}` (#746, reported by @MarsSall).** `ExpressionFormatValidator.validateRecursive` walked into `jsCode`/`pythonCode` fields and fed the source to a bracket-balance check that miscounted `{{` vs `}}` on JS object literals like `[{json:{x:1}}]`. The validator now skips raw-code field keys (`jsCode`, `pythonCode`, `functionCode`) — mirrors the existing guard in `ExpressionValidator.validateParametersRecursive`. The skip applies wherever those keys appear in the parameters tree (top-level or nested).

Conceived by Romuald Członkowski - https://www.aiadvisors.pl/en

## [2.47.14] - 2026-04-21

### Security

- Fix IPv6-mapped SSRF bypass in synchronous URL validation (GHSA-56c3-vfp2-5qqj, CVSS 8.5 High). `SSRFProtection.validateUrlSync` now rejects IPv4-mapped IPv6 (`::ffff:169.254.169.254`, `::ffff:127.0.0.1`, etc.) and private IPv6 addresses, matching the async webhook validator. The sync gate is the sole SSRF check in the SDK embedder path (`validateInstanceContext` → `getN8nApiClient`), so the bypass enabled cloud metadata access and `x-n8n-api-key` leakage for callers of `N8NDocumentationMCPServer` / `N8NMCPEngine` with user-supplied `InstanceContext`. Reported by @manthanghasadiya.

Conceived by Romuald Członkowski - https://www.aiadvisors.pl/en

## [2.47.13] - 2026-04-20

### Security

- Redact MCP tool-call arguments in server logs (GHSA-wg4g-395p-mqv3, CVSS 4.3 Medium). Reported by @Mirr2.

Conceived by Romuald Członkowski - https://www.aiadvisors.pl/en

## [2.47.12] - 2026-04-17

Batch of ten fixes from the 2026-04-16 staging QA regression (release-blockers and polish items shipped together).

### Fixed

- **`get_node` version modes no longer return `upgradeSafe: true` with no data (QA #1 + #12, HIGH).** `versions`, `compare`, `breaking`, and `migrations` modes now check whether version metadata is populated for the node before computing their booleans. When metadata is missing, they return `{ available: false, reason: "Version metadata not populated…" }` instead of a confidently-zero response. Agents that previously saw `upgradeSafe: true` for a known-breaking HTTP Request v1 → v4 upgrade will now get an explicit "no data" signal. `getVersionSummary` also falls back to the node row's `version` field so `detail: standard` no longer reports `currentVersion: "unknown"` while `isVersioned: true` in the same response.
- **`rewireConnection` no longer silently corrupts the connection map (QA #7, HIGH).** `applyRewireConnection` now resolves `source` / `from` / `to` to concrete node objects up front, passes resolved names through to the inner remove/add calls, skips the add when `to` is already a target of `source` (previously caused a duplicated edge), and asserts an edge-count invariant that throws if the rewrite would leave the graph in an inconsistent state. Added regression tests for name-based rewire, ID-based rewire, and rewire-to-already-connected-target.
- **`search_templates` `by_metadata` returns `available: false` when metadata is missing (QA #11, HIGH).** Previously returned an empty `items: []` that callers couldn't distinguish from "no matches". Now returns `{ available: false, reason: "Template metadata has not been enriched yet…" }` when no templates have `metadata_json` populated, and `available: true` on hits. Callers get an actionable signal to fall back to `keyword`, `by_nodes`, or `patterns`.
- **`search_templates` `by_task: webhook_processing` no longer returns schedule/form-triggered templates (QA #2, MEDIUM).** Removed `n8n-nodes-base.httpRequest` from the `webhook_processing` task mapping. HTTP Request is not a trigger, so its presence matched any workflow that used outbound HTTP — including schedule and form triggered ones. Now matches only workflows that include the webhook trigger node.
- **QA #3 (MEDIUM) — deferred.** An initial attempt to reject invalid `operation` values in `NodeSpecificValidators.validateSlack` used a hardcoded resource→operations map, which turned out to disagree with the actual Slack node's schema (ironically, `post` — the value the QA report flagged as "silently accepted" — is a real Slack message op in n8n). Rather than ship a regression that rejects valid configs, the hardcoded list was removed and the issue deferred until the validator can derive the allowed set from the node's loaded `properties_schema`.
- **`moveNode` no longer silently mutates state when the wrong param name is passed (QA #6, MEDIUM).** `validateMoveNode` now catches the common `newPosition` typo with a "did you mean 'position'?" message *before* mutation, and also validates that `position` is a 2-element numeric array. Previously the operation set `node.position` to `undefined` and only failed at the final workflow-shape check with a cryptic `position Required` error.
- **`n8n_autofix_workflow` webhook path UUID is now stable across preview and apply (QA #4, LOW).** Previously each call generated a fresh `crypto.randomUUID()`, so the path shown in preview didn't match the path applied to the workflow. The UUID is now derived deterministically via UUID v5 (SHA-1-based per RFC 4122) from `workflow.id + node.id`, so preview and apply always agree. Downstream systems pre-configured against the preview value will now receive the same path.
- **`n8n_update_partial_workflow` activate/deactivate ops are now mutually exclusive (QA #8, LOW).** A batch like `[activateWorkflow, deactivateWorkflow]` previously returned `active: true` because the first op's flag was never cleared. The appliers now clear the opposite flag so last-op-wins semantics apply.
- **`n8n_update_partial_workflow` tool description now documents `patchNodeField` parameters inline (QA #5, LOW).** Added `fieldPath (dot path, e.g. "parameters.jsCode") and patches: [{find, replace}]` to the short tool description so agents can construct the operation without an extra `tools_documentation` round-trip.
- **`n8n_manage_datatable` `deleteRows` dryRun no longer returns a null "after" row (QA #10, LOW).** Stripped entries with `dryRunState: "after"` from delete responses — those rows always had every field null because there is no "after" state for a delete, and they surfaced as noise. Update/upsert dryRun responses are unchanged.

Conceived by Romuald Członkowski - https://www.aiadvisors.pl/en

## [2.47.11] - 2026-04-16

### Security

- Fix sensitive data logging in HTTP mode (GHSA-pfm2-2mhg-8wpx). Reported by @S4nso.

Conceived by Romuald Członkowski - https://www.aiadvisors.pl/en

## [2.47.10] - 2026-04-16

### Added

- **`projectId` parameter on `n8n_manage_datatable` `createTable` (Issue #731, reported by @nesl247).** Tables can now be created directly in a specific n8n project instead of always landing in the default/personal project. The n8n public API (`POST /data-tables`) already accepts `projectId` as an optional body field — it was never wired through the MCP tool. `projectId` is threaded through the tool inputSchema, the Zod `createTableSchema`, and the `createDataTable` API client signature, matching the existing pattern on `n8n_create_workflow`. Workflows in team projects that rely on project-scoped data tables (e.g. queue-based processing) can now be fully automated via MCP.

### Changed

- **`columns` is now required (at least one) for `n8n_manage_datatable` `createTable`.** Previously the tool schema marked `columns` as optional, but the underlying n8n API rejects the call with `VALIDATION_ERROR: request/body must have required property 'columns'`. The Zod schema now enforces `.min(1, 'At least one column is required')` so the failure surfaces at the MCP boundary with a clear message instead of an opaque 400 from the API round-trip. Tool inputSchema description, `keyParameters`, `full.description`, parameter docs, and pitfalls are all updated to match.

### Fixed

- **Removed incorrect pitfall claiming `projectId` could not be set via the public API** in `n8n_manage_datatable` tool docs. The n8n API has always supported it; this documentation was misleading agents into manual UI workarounds.

Conceived by Romuald Członkowski - https://www.aiadvisors.pl/en

## [2.47.9] - 2026-04-16

### Changed

- **Update n8n to 2.16.1.** Bumped `n8n-nodes-base` 2.15.0 → 2.16.0, `n8n-core` 2.15.0 → 2.16.1, `n8n-workflow` 2.14.1 → 2.16.0, and `@n8n/n8n-nodes-langchain` 2.14.1 → 2.16.1. These are exact-pinned to match the coherent dependency set that ships with n8n 2.16.1, since the individual packages' `latest` dist-tags on npm lag behind the meta-package release (e.g. `n8n-workflow@latest` is 2.13.1 while n8n 2.16.1 actually pins 2.16.0).
- **Rebuilt node database.** 1,505 nodes total: 812 core (675 from `n8n-nodes-base` + 137 from `@n8n/n8n-nodes-langchain`) and 693 community nodes (605 verified, 88 unverified). Community nodes preserved incrementally across the rebuild via backup/restore — 108 new READMEs fetched for nodes added since the last sync.
- **Updated README** n8n version badge (2.14.2 → 2.16.1) and node counts (1,396 → 1,505; 516 → 605 verified community).

Conceived by Romuald Członkowski - https://www.aiadvisors.pl/en

## [2.47.8] - 2026-04-14

### Fixed

- **`n8n_create_workflow` / `n8n_update_full_workflow` failures from JSON-stringified array parameters (Issue #611, reported by @Mte90).** VS Code + GitHub Copilot and some other MCP clients serialize array/object tool arguments as JSON strings rather than native JSON types. This reliably affected workflows with 3+ nodes or complex nested parameters (e.g. `__rl` resource-locator objects, filter conditions), producing the error `"nodes must be an array, got string"` while 1-2 node payloads happened to slip through. The `n8n_update_partial_workflow` schema already preprocessed its `operations` field with `tryParseJson` (from the prior #600/#611 fix), but the create/update-full schemas did not — now they do. `nodes`, `connections`, and `settings` on both schemas, plus the `tags` filter on `n8n_list_workflows`, are wrapped with `z.preprocess(tryParseJson, ...)` so stringified JSON is parsed before Zod validation runs. The `tryParseJson` helper was relocated to sit next to its first usage rather than 2,400 lines below it.
- **Silent JSON parse failures in `coerceStringifiedJsonParams` now log a warning.** The top-level client-bug workaround in `server.ts` had two `catch {}` blocks that swallowed parse errors without trace, so malformed or truncated JSON from buggy MCP clients presented only as downstream Zod errors. Both catch blocks now emit a `logger.warn` with the parse error, a 200-char value preview, and the length — enough to diagnose serialization bugs without digging into transport-level logs.

Conceived by Romuald Członkowski - https://www.aiadvisors.pl/en

## [2.47.7] - 2026-04-13

### Fixed

- **Multi-input Merge node false positive (Issue #721).** The strict validator hardcoded the Merge node's input count as 2, rejecting valid connections to inputs 2+ when `numberInputs` was set higher (e.g., combine mode with 4 inputs). The validator now reads the `numberInputs` parameter from the workflow node and skips input bounds checking entirely for non-Merge nodes, since many n8n nodes accept dynamic inputs that can't be determined from metadata alone.
- **Code node return validation false positive (Issue #721).** The validator flagged `return {status: "ok"}` as "Return value must be an array of objects" even in `runOnceForEachItem` mode, where n8n auto-wraps bare objects. The return-format checks now respect the Code node's `mode` parameter for both JavaScript and Python.
- **Controlled loop false positive (Issue #721).** Intentional pagination loops (e.g., HTTP Request → IF → Wait → HTTP Request) were flagged as "Workflow contains a cycle (infinite loop)" because the cycle detector only recognized SplitInBatches/Loop nodes as legitimate. It now also recognizes IF, Switch, and Filter nodes as conditional exit points that can bound a loop.
- **Expression bracket scanning in Code node fields.** The expression validator scanned `jsCode`, `pythonCode`, and `functionCode` fields for unmatched `{{ }}` brackets, producing false positives on ordinary JavaScript/Python curly braces. These raw code fields are now excluded from expression bracket validation.

Conceived by Romuald Członkowski - https://www.aiadvisors.pl/en

## [2.47.6] - 2026-04-09

### Security

- Fix missing authentication on HTTP endpoints and information disclosure via `/health` (GHSA-75hx-xj24-mqrw). Reported by @yotampe-pluto.

Conceived by Romuald Członkowski - https://www.aiadvisors.pl/en

## [2.47.5] - 2026-04-08

### Fixed

- **`npx n8n-mcp </dev/null` now exits promptly on stdin close (Issue #711, reported by @jbjardine).** The root cause was that the published bin entry was still `dist/mcp/index.js`, not `dist/mcp/stdio-wrapper.js`, so `IS_DOCKER=true npx -y n8n-mcp </dev/null` hit `index.js`'s container guard and stayed alive until SIGTERM arrived — breaking stateless stdio clients (e.g. `mark3labs/mcp-go`, MCPJungle) that close stdin to signal shutdown. The fix is to finally route the published bin through the wrapper (see below), which has always registered stdin handlers unconditionally. The container guard in `index.ts` is deliberately kept: Docker's detached-mode lifecycle (`docker run -d`) redirects stdin from `/dev/null` and relies on signals from `docker stop` for shutdown, not stdin close — the Docker entrypoint's root-switch path hardcodes `node /app/dist/mcp/index.js`, so the guard is load-bearing for every containerized deployment.
- **Published bin entry finally routes through `stdio-wrapper.js` (Issue #693, reported by @gjenkins20).** Commit bc191b0 (v2.45.1) updated `package.json`, `scripts/publish-npm.sh`, and `scripts/publish-npm-quick.sh` to route the bin through the stdio wrapper, but missed `.github/workflows/release.yml:375` which hardcoded the old path. Every CI release from v2.45.1 through v2.47.4 therefore shipped `bin: dist/mcp/index.js` — the fix never reached users. `release.yml` is now consistent with the other three sources, and a static test in `tests/unit/bin-consistency.test.ts` guards against the same drift recurring.
- **Telemetry CLI handler extracted to `src/telemetry/telemetry-cli.ts`** and called from both `src/mcp/index.ts` and `src/mcp/stdio-wrapper.ts`. This preserves `npx n8n-mcp telemetry enable|disable|status` (documented in `PRIVACY.md` and `README.md`) now that the published bin routes through the wrapper, and eliminates ~35 lines of duplication. The config manager is lazy-required so it stays off the stdio hot path when no CLI subcommand is present.

### Notes

- First-run telemetry banner is no longer printed on cold start via `npx n8n-mcp` because `stdio-wrapper.js` suppresses all `console.log` output before the server imports. This was already the behavior when users invoked the wrapper directly; it becomes user-visible now that the wrapper is the published bin. Run `npx n8n-mcp telemetry status` to see current telemetry state.
- Added `tests/integration/mcp/stdio-shutdown.test.ts` with 3 regression cases that spawn `dist/mcp/stdio-wrapper.js` (the published bin entry, matching the `npx` path) and assert exit-on-stdin-close / exit-on-SIGTERM within a 500ms budget, covering the exact Issue #711 repro.

Conceived by Romuald Członkowski - https://www.aiadvisors.pl/en

## [2.47.4] - 2026-04-08

### Security

- Fix authenticated SSRF in multi-tenant header handling (GHSA-4ggg-h7ph-26qr). Reported by Eresus Security Research Team.

Conceived by Romuald Członkowski - https://www.aiadvisors.pl/en

## [2.47.3] - 2026-04-08

### Security

- Closed all open CodeQL alerts in one hardening pass. Covered rules: `js/regex-injection`, `js/prototype-polluting-assignment`, `js/prototype-pollution-utility`, `js/double-escaping`, `js/polynomial-redos`, `js/insufficient-password-hash`, `js/insecure-randomness`, `js/clear-text-logging`, `js/tainted-format-string`, `js/incomplete-url-substring-sanitization`, and `js/shell-command-injection-from-environment`. No runtime behaviour change beyond what the individual fix comments document. All 4512 unit tests and 699 integration tests pass.
- Added linear-time `extractBracketExpressions()` / `hasBracketExpression()` helpers in `src/utils/expression-utils.ts` for validators that previously relied on lazy-quantifier regexes.
- `createCacheKey` in `src/utils/cache-utils.ts` now derives its output via a CodeQL-approved KDF with aggressive memoization. Semantically deterministic per-process, O(1) on cache hits.
- Chat trigger session ID format changed from `session_{timestamp}_{9-char-alnum}` to `session_{timestamp}_{UUIDv4}`. Accompanying test regex updated.

Conceived by Romuald Członkowski - https://www.aiadvisors.pl/en

## [2.47.2] - 2026-04-07

### Changed

- **Dropped the `n8n` meta package from dev dependencies** — The MCP server only reads node metadata from a prebuilt SQLite database and never executes n8n workflows, so depending on the full n8n meta package (which pulls in the editor backend, task runner, queue, typeorm, AI workflow builder, bull, and ~440 other transitive packages) was pure overhead in the dev tree. Replaced with a direct dependency on `n8n-nodes-base`, which is what `src/loaders/node-loader.ts` actually `require()`s at rebuild time. Net result: **~440 fewer packages installed in the dev tree** with no change to runtime behavior or the published npm artifact (which already ships zero n8n deps via `package.runtime.json`).
- **Kept `n8n-core` as a direct dep** — Though our source code never imports it, `n8n-nodes-base` internally `require()`s `n8n-core` in several node files (Merge V3, Slack V2, and others), yet only declares it as a `devDependency`. Previously it was pulled in transitively by the `n8n` meta package; now that we depend on `n8n-nodes-base` directly we need `n8n-core` as an explicit dep so those nodes load during `npm run rebuild`.
- **`scripts/update-n8n-deps.js`** — Simplified to check each tracked package (`n8n-nodes-base`, `n8n-core`, `n8n-workflow`, `@n8n/n8n-nodes-langchain`) against its own `latest` dist-tag on npm, rather than deriving peer versions from the `n8n` meta package's dependency list.
- **`scripts/update-and-publish-prep.sh`** — Reads primary version from `n8n-nodes-base`.
- **`src/mcp/tools-documentation.ts`** — Compatibility notice now reads the tested n8n version from `n8n-nodes-base` in `package.json` instead of the removed `n8n` meta dep.

### Notes

- The SBOM generated by GitHub (scanned from `package.json`) will now show ~440 fewer packages in the dev tree.
- The published `n8n-mcp` npm package is unchanged — it uses `package.runtime.json` and has always shipped with zero n8n deps.
- No functional change to node loading: the full set of 812 base nodes (676 from `n8n-nodes-base` + 136 from `@n8n/n8n-nodes-langchain`) loads correctly, as verified by the integration test suite.

Conceived by Romuald Członkowski - https://www.aiadvisors.pl/en

## [2.47.1] - 2026-04-04

### Fixed

- **Credential get fallback** — `n8n_manage_credentials({action: "get"})` now falls back to list + filter when `GET /credentials/:id` returns 403 Forbidden or 405 Method Not Allowed, since this endpoint is not in the n8n public API
- **Credential update accepts `type` field** — `n8n_manage_credentials({action: "update"})` now forwards the optional `type` field to the n8n API, which some n8n versions require in the PATCH payload
- **Credential response stripping** — `create` and `update` handlers now strip the `data` field from responses (defense-in-depth, matching the `get` handler pattern)

Conceived by Romuald Członkowski - https://www.aiadvisors.pl/en

## [2.47.0] - 2026-04-04

### Added

- **`n8n_audit_instance` tool** — Security audit combining n8n's built-in `POST /audit` API (5 risk categories: credentials, database, nodes, instance, filesystem) with deep workflow scanning. Custom checks include 50+ regex patterns for hardcoded secrets (OpenAI, AWS, Stripe, GitHub, Slack, SendGrid, and more), unauthenticated webhook detection, error handling gap analysis, data retention risk assessment, and PII detection. Returns a compact markdown report grouped by workflow with a Remediation Playbook showing auto-fixable items, items requiring review, and items requiring user action. Inspired by [Audit n8n Workflows Security](https://wotai.co/blog/audit-n8n-workflows-security)
- **`n8n_manage_credentials` tool** — Full credential CRUD with schema discovery. Actions: list, get, create, update, delete, getSchema. Enables AI agents to create credentials and assign them to workflow nodes as part of security remediation. Credential secret values are never logged or returned in responses (defense-in-depth)
- **Credential scanner service** (`src/services/credential-scanner.ts`) — 50+ regex patterns ported from the production cache ingestion pipeline, covering AI/ML keys, cloud/DevOps tokens, GitHub PATs, payment keys, email/marketing APIs, and more. Per-node scanning with masked output
- **Workflow security scanner** (`src/services/workflow-security-scanner.ts`) — 4 configurable checks: hardcoded secrets, unauthenticated webhooks (excludes respondToWebhook), error handling gaps (3+ node threshold), data retention settings
- **Audit report builder** (`src/services/audit-report-builder.ts`) — Generates compact grouped-by-workflow markdown with tables, built-in audit rendering, and a Remediation Playbook with tool chains for auto-fixing

### Changed

- **CLAUDE.md** — Removed Session Persistence section (no longer needed), added OSS sensitivity notice to prevent secrets from landing in committed files
- **API client request interceptor** — Now redacts request body for `/credentials` endpoints to prevent secret leakage in debug logs
- **Credential handler responses** — All credential handlers (get, create, update) strip the `data` field from responses as defense-in-depth against future n8n versions returning decrypted values

### Security

- **Secret masking at scan time** — `maskSecret()` is called immediately during scanning; raw values are never stored in detection results
- **Credential body redaction** — API client interceptor suppresses body logging for credential endpoints
- **Cursor dedup guard** — `listAllWorkflows()` tracks seen cursors to prevent infinite pagination loops
- **PII findings classified as review** — PII detections (email, phone, credit card) are marked as `review_recommended` instead of `auto_fixable`, preventing nonsensical auto-remediation

Conceived by Romuald Członkowski - https://www.aiadvisors.pl/en

## [2.46.1] - 2026-04-03

### Fixed

- **Fix SSE reconnection loop** — SSE clients entering rapid reconnection loops because `POST /mcp` never routed messages to `SSEServerTransport.handlePostMessage()` (Fixes #617). Root cause: SSE sessions were stored in a separate `this.session` property invisible to the StreamableHTTP POST handler
- **Add authentication to SSE endpoints** — `GET /sse` and `POST /messages` now require Bearer token authentication, closing an auth gap where SSE connections were unauthenticated
- **Fix rate limiter exhaustion during reconnection** — added `skipSuccessfulRequests: true` to `authLimiter` so legitimate requests don't count toward the rate limit, preventing 429 storms during SSE reconnection loops

### Changed

- **Separate SSE endpoints (SDK pattern)** — SSE transport now uses dedicated `GET /sse` + `POST /messages` endpoints instead of sharing `/mcp` with StreamableHTTP, following the official MCP SDK backward-compatible server pattern
- **Unified auth into `authenticateRequest()` method** — consolidated duplicated Bearer token validation logic from three endpoints into a single method with consistent JSON-RPC error responses
- **SSE sessions use shared transports map** — removed the legacy `this.session` singleton; SSE sessions are now stored in the same `this.transports` map as StreamableHTTP sessions with `instanceof` guards for type discrimination

### Deprecated

- **SSE transport (`GET /sse`, `POST /messages`)** — SSE is deprecated in MCP SDK v1.x and removed in v2.x. Clients should migrate to StreamableHTTP (`POST /mcp`). These endpoints will be removed in a future major release

### Security

- **Rate limiting on all authenticated endpoints** — `authLimiter` now applied to `GET /sse` and `POST /messages` in addition to `POST /mcp`
- **Transport type guards** — `instanceof` checks prevent cross-protocol access (SSE session IDs rejected on StreamableHTTP endpoint and vice versa)

Conceived by Romuald Członkowski - https://www.aiadvisors.pl/en

## [2.46.0] - 2026-04-03

### Added

- **`patchNodeField` operation for `n8n_update_partial_workflow`** — a dedicated, strict find/replace operation for surgical string edits in node fields (Fixes #696). Key features:
  - **Strict error handling**: errors if find string not found (unlike `__patch_find_replace` which only warns)
  - **Ambiguity detection**: errors if find matches multiple times unless `replaceAll: true` is set
  - **`replaceAll` flag**: replace all occurrences of a string in a single patch
  - **`regex` flag**: use regex patterns for advanced find/replace
  - Top-level operation type for better discoverability

### Security

- **Prototype pollution protection** — `setNestedProperty` and `getNestedProperty` now reject paths containing `__proto__`, `constructor`, or `prototype`. Protects both `patchNodeField` and `updateNode` operations
- **ReDoS protection** — regex patterns with nested quantifiers or overlapping alternations are rejected to prevent catastrophic backtracking
- **Resource limits** — max 50 patches per operation, max 500-char regex patterns, max 512KB field size for regex operations

Conceived by Romuald Członkowski - https://www.aiadvisors.pl/en

## [2.45.1] - 2026-04-02

### Fixed

- **Use stdio-wrapper.js as default bin entry point** — the previous entry point (`index.js`) wrote INFO-level logs to stdout, corrupting JSON-RPC MCP transport for stdio-mode users (Fixes #693, Related: #555, #628)
- **Preserve node credentials during full workflow updates** — `n8n_update_full_workflow` now carries forward existing credential references from the server when user-provided nodes omit them, preventing "missing credentials" errors on PUT (Fixes #689)

### Changed

- **Updated publish scripts** to use `stdio-wrapper.js` as the npm bin entry point, ensuring the fix persists across releases

Conceived by Romuald Członkowski - https://www.aiadvisors.pl/en

## [2.45.0] - 2026-04-01

### Changed

- **Update n8n dependencies** to latest versions:
  - `n8n`: 2.13.3 → 2.14.2
  - `n8n-core`: 2.13.1 → 2.14.1
  - `n8n-workflow`: 2.13.1 → 2.14.1
  - `@n8n/n8n-nodes-langchain`: 2.13.1 → 2.14.1
- **Rebuild FTS5 search index** with all 1396 nodes (812 base + 584 community)

Conceived by Romuald Członkowski - https://www.aiadvisors.pl/en

## [2.44.1] - 2026-04-01

### Security

- **Bump axios** from `^1.11.0` to `^1.14.0` to patch known vulnerability
- **Bump nodemon** from `^3.1.10` to `^3.1.14` to patch transitive dependency vulnerabilities

### Changed

- **Upgrade GitHub Actions** to latest versions across all CI/CD workflows (docker, release, test, update-n8n-deps) — contributed by @salmanmkc in #663

Conceived by Romuald Członkowski - https://www.aiadvisors.pl/en

## [2.44.0] - 2026-04-01

### Added

- **Multi-step workflow generation flow**: `n8n_generate_workflow` now supports a three-step flow where AI agents act as quality gates — get proposals, review, then deploy. New parameters: `deploy_id` (deploy a specific proposal), `confirm_deploy` (deploy a previously generated preview).

- **`GenerateWorkflowProposal` type**: New exported type for workflow proposals with `id`, `name`, `description`, `flow_summary`, and `credentials_needed` fields.

- **`status` field on `GenerateWorkflowResult`**: Indicates the current phase — `proposals`, `preview`, `deployed`, or `error`.

### Changed

- **Tool description updated**: `n8n_generate_workflow` description now explains the multi-step flow instead of auto-deploy behavior.

- **Tool documentation updated**: Essentials and full docs reflect the three-step flow with examples for each step.

Conceived by Romuald Członkowski - https://www.aiadvisors.pl/en

## [2.43.0] - 2026-03-31

### Added

- **`n8n_generate_workflow` tool**: New MCP tool that enables AI-powered workflow generation from natural language descriptions. Available on the hosted service with handler delegation pattern for extensibility.

- **Handler injection API**: `EngineOptions.generateWorkflowHandler` allows hosting environments to provide custom workflow generation backends. Handler receives helpers for `createWorkflow`, `validateWorkflow`, `autofixWorkflow`, and `getWorkflow`.

- **Tool documentation**: Full essentials and deep documentation for `n8n_generate_workflow` via `tools_documentation`.

### Fixed

- **Tools documentation count**: Corrected n8n API tools count and added missing `n8n_manage_datatable` entry to tools overview.

Conceived by Romuald Członkowski - https://www.aiadvisors.pl/en

## [2.42.3] - 2026-03-30

### Improved

- **Patterns response trimmed for token efficiency** (Issue #683): Task-specific patterns response reduced ~64% — dropped redundant `displayName`, shortened field names (`frequency` → `freq`), capped chains at 5, and shortened chain node types to last segment.

- **`patterns` mode added to `tools_documentation`**: Was missing from both essentials and full docs. AI agents can now discover patterns mode through the standard documentation flow.

- **`includeOperations` omission behavior documented**: Added note that trigger nodes and freeform nodes (Code, HTTP Request) omit the `operationsTree` field.

- **`search_nodes` examples trimmed**: Reduced from 11 to 6 examples in full docs, removing near-duplicates.

Conceived by Romuald Członkowski - https://www.aiadvisors.pl/en

## [2.42.2] - 2026-03-30

### Fixed

- **`workflow-patterns.json` missing from npm package** (Issue #681): Added `data/workflow-patterns.json` to the `files` array in `package.json` so the patterns file is included in the published npm package and works out of the box without manual generation.

Conceived by Romuald Członkowski - https://www.aiadvisors.pl/en

## [2.42.1] - 2026-03-30

### Fixed

- **Community nodes missing from database after rebuild**: Restored 584 community nodes from the n8n 2.13.3 snapshot and re-extracted operations with resource grouping from `properties_schema`. 366 community nodes now have proper resource-grouped operations.

- **Community node service missing resource extraction**: `extractOperations()` in `community-node-service.ts` was not extracting `resource` from `displayOptions.show.resource`, same issue that was fixed in `property-extractor.ts` in v2.42.0.

Conceived by Romuald Członkowski - https://www.aiadvisors.pl/en

## [2.42.0] - 2026-03-30

### Added

- **`includeOperations` flag for search_nodes**: Opt-in parameter that returns a resource/operation tree per search result, grouped by resource (e.g., Slack returns 7 resources with 44 operations). Saves a mandatory `get_node` round-trip when building workflows. Adds ~100-300 tokens per result.

- **`searchMode: "patterns"` for search_templates**: New lightweight mode that serves workflow pattern summaries mined from 2,700+ templates. Returns common node combinations, connection chains, and frequency data per task category (10 categories: ai_automation, webhook_processing, scheduling, etc.). Use `task` parameter for category-specific patterns or omit for overview.

- **Workflow pattern mining script** (`npm run mine:patterns`): Extracts node frequency, co-occurrence, and connection topology from the template database. Two-pass pipeline: Pass 1 analyzes `nodes_used` metadata (no decompression), Pass 2 decompresses workflows for connection analysis. Produces `data/workflow-patterns.json` with 554 node types, 3,201 edges, and 5,246 chains.

### Fixed

- **Operations extraction now includes resource grouping**: The property extractor was using `find()` to get only the first `operation` property, but n8n nodes have multiple operation properties each mapped to a different resource via `displayOptions.show.resource`. Changed to `filter()` to capture all operation properties. Slack went from 17 flat operations to 44 operations across 7 named resources.

- **FTS-to-LIKE fallback dropped search options**: When the FTS5 search fell back to LIKE-based search (e.g., for "http request"), the `options` object (including `includeOperations`, `includeExamples`, `source`) was silently lost. Now correctly passed through.

Conceived by Romuald Członkowski - https://www.aiadvisors.pl/en

## [2.41.4] - 2026-03-30

### Fixed

- **`validate_workflow` misses `conditions.options` check for If/Switch nodes** (Issue #675): Added version-conditional validation — If v2.2+ and Switch v3.2+ now require `conditions.options` metadata, If v2.0-2.1 validates operator structures, and v1.x is left unchecked. Previously only caught by `n8n_create_workflow` pre-flight but not by offline `validate_workflow`.

- **False positive "Set node has no fields configured" for Set v3+** (Issue #676): The `validateSet` checker now recognizes `config.assignments.assignments` (v3+ schema) in addition to `config.values` (v1/v2 schema). Updated suggestion text to match current UI terminology.

- **Expression validator does not detect unwrapped n8n expressions** (Issue #677): Added heuristic pre-pass that detects bare `$json`, `$node`, `$input`, `$execution`, `$workflow`, `$prevNode`, `$env`, `$now`, `$today`, `$itemIndex`, and `$runIndex` references missing `={{ }}` wrappers. Uses anchored patterns to avoid false positives. Emits warnings, not errors.

Conceived by Romuald Członkowski - https://www.aiadvisors.pl/en

## [2.41.3] - 2026-03-27

### Fixed

- **Session timeout default too low** (Issue #626): Raised `SESSION_TIMEOUT_MINUTES` default from 5 to 30 minutes. The 5-minute default caused sessions to expire mid-operation during complex multi-step workflows (validate → get structure → patch → validate), forcing users to retry. Configurable via environment variable.

- **Operations array received as string from VS Code** (Issue #600): Added `z.preprocess` JSON string parsing to the `operations` parameter in `n8n_update_partial_workflow`. The VS Code MCP extension serializes arrays as JSON strings — the Zod schema now transparently parses them before validation.

- **`undefined` values rejected in MCP tool calls from VS Code** (Issue #611): Strip explicit `undefined` values from tool arguments before Zod validation. VS Code sends `undefined` as a value which Zod's `.optional()` rejects (it expects the field to be missing, not present-but-undefined).

Conceived by Romuald Członkowski - https://www.aiadvisors.pl/en

## [2.41.2] - 2026-03-27

### Fixed

- **MCP initialization floods Claude Desktop with JSON parse errors** (Issues #628, #627, #567): Intercept `process.stdout.write` in stdio mode to redirect non-JSON-RPC output to stderr. Console method suppression alone was insufficient — native modules (better-sqlite3), n8n packages, and third-party code can call `process.stdout.write()` directly, corrupting the JSON-RPC stream. Only writes containing valid JSON-RPC messages (`{"jsonrpc":...}`) are now allowed through stdout; everything else is redirected to stderr. This fixes the flood of "Unexpected token is not valid JSON" warnings on every new chat in Claude Desktop, including leaked `refCount`, `dbPath`, `clientVersion`, `protocolVersion`, and other debug strings.

Conceived by Romuald Członkowski - https://www.aiadvisors.pl/en

## [2.41.1] - 2026-03-27

### Fixed

- **If node operators silently fail at runtime** (Issue #665): Replaced incorrect operator names `isNotEmpty`/`isEmpty` with `notEmpty`/`empty` across all validators, sanitizer, documentation, and error messages. n8n's execution engine does not recognize `isNotEmpty`/`isEmpty` — unknown operators silently return `false`, causing If/Switch conditions to always take the wrong branch. Added auto-correction in the sanitizer so existing workflows using legacy names are fixed on update.

- **`addConnection` creates broken connections with `type: "0"`** (Issue #659): Fixed two edge cases where numeric `targetInput` or `sourceOutput` values leaked into connection objects as `"type": "0"` instead of `"type": "main"`. Numeric `targetInput` values are now remapped to `"main"`, and the `sourceOutput` remapping guard was relaxed to handle redundant `sourceOutput: 0` + `sourceIndex: 0` combinations. Also resolves Issue #653 (dangling connections after `removeNode`) which was caused by malformed connections from this bug.

- **`__patch_find_replace` corrupts Code node jsCode** (Issue #642): Implemented the `__patch_find_replace` feature for surgical string edits in `updateNode` operations. Previously, passing `{"parameters.jsCode": {"__patch_find_replace": [...]}}` stored the patch object literally as jsCode, producing `[object Object]` at runtime. The feature now reads the current string value, applies each `{find, replace}` entry sequentially, and writes back the modified string. Includes validation for patch format, target property existence, and string type.

### Improved

- Extracted `OPERATOR_CORRECTIONS` and `UNARY_OPERATORS` to module-level constants for better performance and single source of truth
- Added `exists`/`notExists` to unary operator lists for consistency across sanitizer and validator
- Fixed recovery guidance referencing non-existent `validate_node_operation` tool (now `validate_node`)

Conceived by Romuald Członkowski - https://www.aiadvisors.pl/en

## [2.41.0] - 2026-03-25

### Changed

- **Updated n8n dependencies**: n8n 2.12.3 → 2.13.3, n8n-core 2.12.0 → 2.13.1, n8n-workflow 2.12.0 → 2.13.1, @n8n/n8n-nodes-langchain 2.12.0 → 2.13.1
- **Rebuilt node database**: 1,396 nodes (812 from n8n-nodes-base/langchain + 584 community: 516 verified + 68 npm)
- **Refreshed community nodes**: 584 total (up from 430), with 581 AI-generated documentation summaries
- **Improved documentation generator**: Strip `<think>` tags from thinking-model responses; use raw fetch for vLLM `chat_template_kwargs` support
- **Incremental community node updates**: `fetch:community` now upserts by default, preserving existing READMEs and AI summaries. Use `--rebuild` for clean slate

Conceived by Romuald Czlonkowski - https://www.aiadvisors.pl/en

## [2.40.5] - 2026-03-22

### Fixed

- **Webhook workflows created via MCP get 404 errors** (Issue #643): Auto-inject `webhookId` (UUID) on webhook-type nodes (`webhook`, `webhookTrigger`, `formTrigger`, `chatTrigger`) during `cleanWorkflowForCreate()` and `cleanWorkflowForUpdate()`. n8n 2.10+ requires this field for proper webhook URL registration; without it, webhooks silently fail with 404. Existing `webhookId` values are preserved.

Conceived by Romuald Członkowski - https://www.aiadvisors.pl/en

## [2.40.4] - 2026-03-22

### Fixed

- **Incorrect data tables availability info**: Removed "enterprise/cloud only" restriction from tool description and documentation — data tables are available on all n8n plans including self-hosted
- **Redundant pitfalls removed**: Removed "Requires N8N_API_URL and N8N_API_KEY" and "enterprise or cloud plans" pitfalls — the first is implicit for all n8n management tools, the second was incorrect

Conceived by Romuald Członkowski - https://www.aiadvisors.pl/en

## [2.40.3] - 2026-03-22

### Fixed

- **Notification 400 disconnect storms (#654)**: `handleRequest()` now returns 202 Accepted for JSON-RPC notifications with stale/expired session IDs instead of 400. Per JSON-RPC 2.0 spec, notifications don't expect responses — returning 400 caused Claude's proxy to trigger reconnection storms (930 errors/day, 216 users affected)
- **TOCTOU race in session lookup**: Added null guard after transport assignment to handle sessions removed between the existence check and use
- **`updateTable` silently ignoring `columns` parameter**: Now returns a warning message when `columns` is passed to `updateTable`, clarifying that table schema is immutable after creation via the public API
- **Tool schema descriptions clarified**: `name` and `columns` parameter descriptions now explicitly document that `updateTable` is rename-only and columns are for `createTable` only

Conceived by Romuald Członkowski - https://www.aiadvisors.pl/en

## [2.40.2] - 2026-03-22

### Fixed

- **Double URL-encoding of `filter` and `sortBy` in `getRows`/`deleteRows`**: Moved `encodeURIComponent()` from handler layer to a custom `paramsSerializer` in the API client. Handlers were encoding values before passing them as Axios params, causing double-encoding (`%257B` instead of `%7B`). Handlers now pass raw values; the API client encodes once via `serializeDataTableParams()`
- **`updateTable` documentation clarified**: Explicitly notes that only renaming is supported (no column modifications via public API)

Conceived by Romuald Członkowski - https://www.aiadvisors.pl/en

## [2.40.1] - 2026-03-21

### Fixed

- **`n8n_manage_datatable` row operations broken by MCP transport serialization**: `data` parameter received as string instead of JSON — added `z.preprocess` coercers for array/object/filter params
- **`n8n_manage_datatable` filter/sortBy URL encoding**: n8n API requires URL-encoded query params — added `encodeURIComponent()` for filter and sortBy in getRows and deleteRows (revised in 2.40.2 to move encoding to API client layer)
- **`json` column type rejected by n8n API**: Removed `json` from column type enum (n8n only accepts string/number/boolean/date)
- **Garbled 404 error messages**: Fixed `N8nNotFoundError` constructor — API error messages are now passed through cleanly instead of being wrapped in "Resource with ID ... not found"

Conceived by Romuald Członkowski - https://www.aiadvisors.pl/en

## [2.40.0] - 2026-03-21

### Changed

- **`n8n_manage_datatable` MCP tool** (replaces `n8n_create_data_table`): Full data table management covering all 10 n8n data table API endpoints
  - **Table operations**: createTable, listTables, getTable, updateTable, deleteTable
  - **Row operations**: getRows, insertRows, updateRows, upsertRows, deleteRows
  - Filter system with and/or logic and 8 condition operators (eq, neq, like, ilike, gt, gte, lt, lte)
  - Dry-run support for updateRows, upsertRows, deleteRows
  - Pagination, sorting, and full-text search for row listing
  - Shared error handler and consolidated Zod schemas for consistency
  - 9 new `N8nApiClient` methods for all data table endpoints
- **`projectId` parameter for `n8n_create_workflow`**: Create workflows directly in a specific team project (enterprise feature)

### Breaking

- `n8n_create_data_table` tool replaced by `n8n_manage_datatable` with `action: "createTable"`

Conceived by Romuald Członkowski - https://www.aiadvisors.pl/en

## [2.38.0] - 2026-03-20

### Added

- **`transferWorkflow` diff operation** (Issue #644): Move workflows between projects via `n8n_update_partial_workflow`
  - New `transferWorkflow` operation type with `destinationProjectId` parameter
  - Calls `PUT /workflows/{id}/transfer` via dedicated API after workflow update
  - Proper error handling: returns `{ success: false, saved: true }` when transfer fails after update
  - Transfer executes before activation so workflow is in target project first
  - Zod schema validates `destinationProjectId` is non-empty
  - Updated tool description and documentation to list the new operation
  - `inferIntentFromOperations` returns descriptive intent for transfer operations
  - `N8nApiClient.transferWorkflow()` method added

Conceived by Romuald Członkowski - https://www.aiadvisors.pl/en

## [2.37.4] - 2026-03-18

### Changed

- **Updated n8n dependencies**: n8n 2.11.4 → 2.12.3, n8n-core 2.11.1 → 2.12.0, n8n-workflow 2.11.1 → 2.12.0, @n8n/n8n-nodes-langchain 2.11.2 → 2.12.0
- **Rebuilt node database**: 1,239 nodes (809 from n8n-nodes-base and @n8n/n8n-nodes-langchain, 430 community)

Conceived by Romuald Członkowski - https://www.aiadvisors.pl/en

## [2.37.3] - 2026-03-15

### Fixed

- **updateNode `name`/`id` field normalization**: LLMs sending `{type: "updateNode", name: "Code", ...}` instead of `nodeName` no longer get "Node not found" errors. The Zod schema now normalizes `name` → `nodeName` and `id` → `nodeId` for node-targeting operations (updateNode, removeNode, moveNode, enableNode, disableNode)
- **AI connection types in disconnected-node detection** (Issue #581): Replaced hardcoded 7-type list with dynamic iteration over all connection types present in workflow data. Nodes connected via `ai_outputParser`, `ai_document`, `ai_textSplitter`, `ai_agent`, `ai_chain`, `ai_retriever` are no longer falsely flagged as disconnected during save
- **Connection schema and reference validation** (Issue #581): Added `.catchall()` to `workflowConnectionSchema` for unknown AI connection types, and extended connection reference validation to check all connection types (not just `main`)
- **autofix `filterOperationsByFixes` ID-vs-name mismatch**: Typeversion-upgrade operations now include `nodeName` alongside `nodeId`, and the filter checks both fields. Previously, `applyFixes=true` silently dropped all typeversion fixes because `fixedNodes` contained names but the filter only checked `nodeId` (UUID)

Conceived by Romuald Członkowski - https://www.aiadvisors.pl/en

## [2.37.2] - 2026-03-15

### Fixed

- **Code validator `$()` false positive** (Issue #294): `$('Previous Node').first().json` no longer triggers "Invalid $ usage detected" warning. Added `(` and `_` to the regex negative lookahead to support standard n8n cross-node references and valid JS identifiers like `$_var`
- **Code validator helper function return false positive** (Issue #293): `function isValid(item) { return false; }` no longer triggers "Cannot return primitive values directly" error. Added helper function detection to skip primitive return checks when named functions or arrow function assignments are present
- **Null property removal in diff engine** (Issue #611): `{continueOnFail: null}` no longer causes Zod validation error "Expected boolean, received null". The diff engine now treats `null` values as property deletion (`delete` operator), and documentation updated from `undefined` to `null` for property removal

Conceived by Romuald Członkowski - https://www.aiadvisors.pl/en

## [2.37.1] - 2026-03-14

### Fixed

- **Numeric sourceOutput remapping** (Issue #537): `addConnection` with numeric `sourceOutput` values like `"0"` or `"1"` now correctly maps to `"main"` with the corresponding `sourceIndex`, preventing malformed connection keys
- **IMAP Email Trigger activation** (Issue #538): `n8n-nodes-base.emailReadImap` and other IMAP-based polling triggers are now recognized as activatable triggers, allowing workflow activation
- **AI tool description false positives** (Issue #477): Validators now check `description` and `options.description` in addition to `toolDescription`, fixing false `MISSING_TOOL_DESCRIPTION` errors for toolWorkflow, toolCode, and toolSerpApi nodes
- **n8n_create_workflow undefined ID** (Issue #602): Added defensive check for missing workflow ID in API response with actionable error message
- **Flaky CI performance test**: Relaxed bulk insert ratio threshold from 15 to 20 to accommodate CI runner variability

Conceived by Romuald Czlonkowski - https://www.aiadvisors.pl/en

## [2.37.0] - 2026-03-14

### Fixed

- **Unary operator sanitization** (Issue #592): Added missing `empty`, `notEmpty`, `exists`, `notExists` operators to the sanitizer's unary operator list, preventing IF/Switch node corruption during partial updates
- **Positional connection array preservation** (Issue #610): `removeNode` and `cleanStaleConnections` now trim only trailing empty arrays, preserving intermediate positional indices for IF/Switch multi-output nodes
- **Scoped sanitization**: Auto-sanitization now only runs on nodes that were actually added or updated, preventing unrelated nodes (e.g., HTTP Request parameters) from being silently modified
- **Activate/deactivate 415 errors** (Issue #633): Added empty body `{}` to POST calls for workflow activation/deactivation endpoints
- **Zod error readability** (Issue #630): Validation errors now return human-readable `"path: message"` strings instead of raw Zod error objects
- **updateNode error hints** (Issue #623): Improved error message when `updates` parameter is missing, showing correct structure with `nodeId`/`nodeName` and `updates` fields
- **removeConnection after removeNode** (Issue #624): When a node was already removed by a prior `removeNode` operation, the error message now explains that connections were automatically cleaned up
- **Connection type coercion** (Issue #629): `sourceOutput` and `targetInput` are now coerced to strings, handling numeric values (0, 1) passed by MCP clients

### Added

- **`saved` field in responses** (Issue #625): All `n8n_update_partial_workflow` responses now include `saved: true/false` to distinguish whether the workflow was persisted to n8n
- **Tag operations via dedicated API** (Issue #599): `addTag`/`removeTag` now use the n8n tag API (`PUT /workflows/{id}/tags`) instead of embedding tags in the workflow body, fixing silent tag failures. Includes automatic tag creation, case-insensitive name resolution, and last-operation-wins reconciliation for conflicting add/remove
- **`updateWorkflowTags` API client method**: New method on `N8nApiClient` for managing workflow tag associations via the dedicated endpoint
- **`operationsApplied` in top-level response**: Promoted from nested `details` to top-level for easier consumption by MCP clients

Conceived by Romuald Czlonkowski - https://www.aiadvisors.pl/en

## [2.36.2] - 2026-03-14

### Changed

- **Updated n8n dependencies**: n8n 2.10.3 → 2.11.4, n8n-core 2.10.1 → 2.11.1, n8n-workflow 2.10.1 → 2.11.1, @n8n/n8n-nodes-langchain 2.10.1 → 2.11.2
- **Updated @modelcontextprotocol/sdk**: 1.20.1 → 1.27.1 (fixes critical cross-client data leak vulnerability CVE GHSA-345p-7cg4-v4c7)
- Rebuilt node database with 1,239 nodes (809 core + 430 community preserved)
- Updated README badge with new n8n version and node counts

Conceived by Romuald Czlonkowski - https://www.aiadvisors.pl/en

## [2.36.1] - 2026-03-08

### Added

- **Conditional branch fan-out detection** (`CONDITIONAL_BRANCH_FANOUT`): Warns when IF, Filter, or Switch nodes have all connections crammed into `main[0]` with higher-index outputs empty, which usually means all target nodes execute together on one branch while other branches have no effect
  - Detects IF nodes with both true/false targets on `main[0]`
  - Detects Filter nodes with both matched/unmatched targets on `main[0]`
  - Detects Switch nodes with all targets on output 0 and other outputs unused
  - Skips warning when fan-out is legitimate (higher outputs also have connections)
  - Skips warning for single connections (intentional true-only/matched-only usage)

### Changed

- **Refactored output index validation**: Extracted `getShortNodeType()` and `getConditionalOutputInfo()` helpers to eliminate duplicated conditional node detection logic between `validateOutputIndexBounds` and the new `validateConditionalBranchUsage`

Conceived by Romuald Czlonkowski - https://www.aiadvisors.pl/en

## [2.36.0] - 2026-03-07

### Added

- **Connection validation: detect broken/malformed workflow connections** (Issue #620):
  - Unknown output keys (`UNKNOWN_CONNECTION_KEY`): Flags invalid connection keys like `"0"`, `"1"`, `"output"` with fix suggestions (e.g., "use main[1] instead" for numeric keys)
  - Invalid type field (`INVALID_CONNECTION_TYPE`): Detects invalid `type` values in connection targets (e.g., `"0"` instead of `"main"`)
  - Output index bounds checking (`OUTPUT_INDEX_OUT_OF_BOUNDS`): Catches connections using output indices beyond what a node supports, with awareness of `onError: 'continueErrorOutput'`, Switch rules, and IF/Filter nodes
  - Input index bounds checking (`INPUT_INDEX_OUT_OF_BOUNDS`): Validates target input indices against known node input counts (Merge=2, triggers=0, others=1)
  - BFS-based trigger reachability analysis: Replaces simple orphan detection with proper graph traversal from trigger nodes, flagging unreachable subgraphs
  - Flexible `WorkflowConnection` interface: Changed from explicit `main?/error?/ai_tool?` to `[outputType: string]` for accurate validation of all connection types

Conceived by Romuald Czlonkowski - https://www.aiadvisors.pl/en

## [2.35.6] - 2026-03-04

### Changed

- **Updated n8n dependencies**: n8n 2.8.3 → 2.10.3, n8n-core 2.8.1 → 2.10.1, n8n-workflow 2.8.0 → 2.10.1, @n8n/n8n-nodes-langchain 2.8.1 → 2.10.1
- Rebuilt node database with 806 core nodes (community nodes preserved from previous build)

Conceived by Romuald Czlonkowski - https://www.aiadvisors.pl/en

## [2.35.5] - 2026-02-22

### Fixed

- **Comprehensive parameter type coercion for Claude Desktop / Claude.ai** (Issue #605): Expanded the v2.35.4 fix to handle ALL type mismatches, not just stringified objects/arrays. Testing revealed 6/9 tools still failing in Claude Desktop after the initial fix.
  - Extended `coerceStringifiedJsonParams()` to coerce every schema type: `string→number`, `string→boolean`, `number→string`, `boolean→string` (in addition to existing `string→object` and `string→array`)
  - Added top-level safeguard to parse the entire `args` object if it arrives as a JSON string
  - Added `[Diagnostic]` section to error responses showing received argument types, enabling users to report exactly what their MCP client sends
  - Added 9 new unit tests (24 total) covering number, boolean, and number-to-string coercion

Conceived by Romuald Czlonkowski - https://www.aiadvisors.pl/en

## [2.35.4] - 2026-02-20

### Fixed

- **Defensive JSON.parse for stringified object/array parameters** (Issue #605): Claude Desktop 1.1.3189 serializes JSON object/array MCP parameters as strings, causing ZodError failures for ~60% of tools that accept nested parameters
  - Added schema-driven `coerceStringifiedJsonParams()` in the central `CallToolRequestSchema` handler
  - Automatically detects string values where the tool's `inputSchema` expects `object` or `array`, and parses them back
  - Safe: prefix check before parsing, type verification after, try/catch preserves original on failure
  - No-op for correct clients: native objects pass through unchanged
  - Affects 9 tools with object/array params: `validate_node`, `validate_workflow`, `n8n_create_workflow`, `n8n_update_full_workflow`, `n8n_update_partial_workflow`, `n8n_validate_workflow`, `n8n_autofix_workflow`, `n8n_test_workflow`, `n8n_executions`
  - Added 15 unit tests covering coercion, no-op, safety, and end-to-end scenarios

Conceived by Romuald Czlonkowski - https://www.aiadvisors.pl/en

## [2.35.3] - 2026-02-19

### Changed

- **Updated n8n dependencies**: n8n 2.6.3 → 2.8.3, n8n-core 2.6.1 → 2.8.1, n8n-workflow 2.6.0 → 2.8.0, @n8n/n8n-nodes-langchain 2.6.2 → 2.8.1
- **Fixed node loader for langchain package**: Adapted node loader to bypass restricted package.json `exports` field in @n8n/n8n-nodes-langchain >=2.9.0, resolving node files via absolute paths instead of `require.resolve()`
- **Fixed community doc generation for cloud LLMs**: Added `N8N_MCP_LLM_API_KEY`/`OPENAI_API_KEY` env var support, switched to `max_completion_tokens`, and auto-omit `temperature` for cloud API endpoints
- Rebuilt node database with 1,236 nodes (673 from n8n-nodes-base, 133 from @n8n/n8n-nodes-langchain, 430 community)
- Refreshed community nodes (361 verified + 69 npm) with 424/430 AI documentation summaries

Conceived by Romuald Czlonkowski - https://www.aiadvisors.pl/en

## [2.35.2] - 2026-02-09

### Changed

- **MCP Apps: Disable non-rendering apps in Claude.ai**: Disabled 3 MCP Apps (workflow-list, execution-history, health-dashboard) that render as collapsed accordions in Claude.ai, and removed `n8n_deploy_template` tool mapping which renders blank content. The server sets `_meta` correctly on the wire but the Claude.ai host ignores it for these tools. The 2 working apps (operation-result for 6 tools, validation-summary for 3 tools) remain active. Disabled apps can be re-enabled once the host-side issue is resolved.

Conceived by Romuald Czlonkowski - https://www.aiadvisors.pl/en

## [2.35.1] - 2026-02-09

### Fixed

- **MCP Apps: Fix UI not rendering for some tools in Claude**: Added legacy flat `_meta["ui/resourceUri"]` key alongside the nested `_meta.ui.resourceUri` in tool definitions. Claude.ai reads the flat key format; without it, tools like `n8n_health_check` and `n8n_list_workflows` showed as collapsed accordions instead of rendering their rich UI apps. Both key formats are now set by `injectToolMeta()`, matching the behavior of the official `registerAppTool` helper from `@modelcontextprotocol/ext-apps/server`.

Conceived by Romuald Czlonkowski - https://www.aiadvisors.pl/en

## [2.35.0] - 2026-02-09

### Added

- **3 new MCP Apps**: workflow-list (compact table with status/tags), execution-history (status summary bar + execution table), health-dashboard (connection status, versions, performance metrics)
- **Enhanced operation-result**: operation-aware headers (create/update/delete/test/deploy), detail panels with workflow metadata, copy-to-clipboard for IDs/URLs, autofix diff viewer
- **CopyButton shared component**: reusable clipboard button with visual feedback
- **Local preview harness** (`ui-apps/preview.html`): test all 5 apps with mock data, dark/light theme toggle, JSON-RPC protocol simulation
- **Expanded shared types**: TypeScript types for workflow-list, execution-history, and health-dashboard data

### Fixed

- **React hooks violation**: Fixed `useMemo` called after early returns in `execution-history/App.tsx` and `validation-summary/App.tsx`, causing React error #310 ("Rendered more hooks than during the previous render") and blank iframes
- **JSON-RPC catch-all handler**: Preview harness responds to unknown SDK requests to prevent hangs

Conceived by Romuald Czlonkowski - https://www.aiadvisors.pl/en

## [2.34.5] - 2026-02-08

### Fixed

- **MCP Apps: Fix blank UI and wrong status badge in Claude**: Rewrote `useToolData` hook to use the official `useApp` hook from `@modelcontextprotocol/ext-apps/react` for proper lifecycle management. Updated UI types and components to match actual server response format (`success: boolean` instead of `status: string`, nested `data` object for workflow details). Validation summary now handles both direct and wrapped (`n8n_validate_workflow`) response shapes.

Conceived by Romuald Czlonkowski - https://www.aiadvisors.pl/en

## [2.34.3] - 2026-02-07

### Fixed

- **MCP Apps: Use correct MIME type for ext-apps spec**: Changed resource MIME type from `text/html` to `text/html;profile=mcp-app` (the `RESOURCE_MIME_TYPE` constant from `@modelcontextprotocol/ext-apps`). Without this profile parameter, Claude Desktop/web fails to recognize resources as MCP Apps and shows "Failed to load MCP App: the resource may exceed the 5 MB size limit."

Conceived by Romuald Czlonkowski - https://www.aiadvisors.pl/en

## [2.34.2] - 2026-02-07

### Fixed

- **CI: UI apps missing from npm package**: Release pipeline only ran `npm run build` (TypeScript), so `ui-apps/dist/` was never built and excluded from published packages
  - Changed build step to `npm run build:all` in `build-and-verify` and `publish-npm` jobs
  - Added `ui-apps/dist/` to npm publish staging directory
  - Added `ui-apps/dist/**/*` to published package files list

Conceived by Romuald Czlonkowski - https://www.aiadvisors.pl/en

## [2.34.1] - 2026-02-07

### Changed

- **MCP Apps: Align with official ext-apps spec** for Claude Desktop/web compatibility
  - URI scheme changed from `n8n-mcp://ui/{id}` to `ui://n8n-mcp/{id}` per MCP ext-apps spec
  - `_meta.ui.resourceUri` now set on tool definitions (`tools/list`) instead of tool call responses
  - `UIMetadata.ui.app` renamed to `UIMetadata.ui.resourceUri`
  - Added `_meta` field to `ToolDefinition` type
  - Added `UIAppRegistry.injectToolMeta()` method for enriching tool definitions
  - UI apps now use `@modelcontextprotocol/ext-apps` `App` class instead of `window.__MCP_DATA__`
  - Updated `ReadResource` URI parser to match new `ui://` scheme

Conceived by Romuald Czlonkowski - https://www.aiadvisors.pl/en

## [2.34.0] - 2026-02-07

### Added

- **MCP Apps**: Rich HTML UIs rendered by MCP hosts alongside tool results via `_meta.ui` and the MCP resources protocol
  - Server-side UI module (`src/mcp/ui/`) with tool-to-UI mapping and `_meta.ui` injection
  - `UIAppRegistry` static class for loading and serving self-contained HTML apps
  - `UI_APP_CONFIGS` mapping tools to their corresponding UI apps

- **Operation Result UI**: Visual summary for workflow operation tools
  - Status badge, operation type, workflow details card
  - Expandable sections for nodes added, modified, and removed
  - Mapped to: `n8n_create_workflow`, `n8n_update_full_workflow`, `n8n_update_partial_workflow`, `n8n_delete_workflow`, `n8n_test_workflow`, `n8n_autofix_workflow`, `n8n_deploy_template`

- **Validation Summary UI**: Visual summary for validation tools
  - Valid/invalid badge with error and warning counts
  - Expandable error list with type, property, message, and fix
  - Expandable warning list and suggestions
  - Mapped to: `validate_node`, `validate_workflow`, `n8n_validate_workflow`

- **React + Vite Build Pipeline** (`ui-apps/`):
  - React 19, Vite 6, vite-plugin-singlefile for self-contained HTML output
  - Shared component library: Card, Badge, Expandable
  - `useToolData` hook for reading data from `window.__MCP_DATA__` or embedded JSON
  - n8n-branded dark theme with CSS custom properties
  - Per-app builds via `APP_NAME` environment variable

- **MCP Resources Protocol**: Server now exposes `resources` capability
  - `ListResources` handler returns available UI apps
  - `ReadResource` handler serves self-contained HTML via `n8n-mcp://ui/{id}` URIs

- **New Scripts**:
  - `build:ui`: Build UI apps (`cd ui-apps && npm install && npm run build`)
  - `build:all`: Build UI apps then server (`npm run build:ui && npm run build`)

### Changed

- **MCP Server**: Added `resources: {}` to server capabilities alongside existing `tools: {}`
- **Tool Responses**: Tools with matching UI apps now include `_meta.ui.app` URI pointing to their visual representation
- **Graceful Degradation**: Server starts and operates normally without `ui-apps/dist/`; UI metadata is only injected when HTML is available

Conceived by Romuald Czlonkowski - https://www.aiadvisors.pl/en

## [2.33.6] - 2026-02-06

### Changed

- Updated n8n from 2.4.4 to 2.6.3
- Updated n8n-core from 2.4.2 to 2.6.1
- Updated n8n-workflow from 2.4.2 to 2.6.0
- Updated @n8n/n8n-nodes-langchain from 2.4.3 to 2.6.2
- Rebuilt node database with 806 nodes (544 from n8n-nodes-base, 262 from @n8n/n8n-nodes-langchain)
- Updated README badge with new n8n version

## [2.33.5] - 2026-01-23

### Fixed

- **Critical memory leak: per-session database connections** (Issue #542): Fixed severe memory leak where each MCP session created its own database connection (~900MB per session)
  - Root cause: `N8NDocumentationMCPServer` called `createDatabaseAdapter()` for every new session, duplicating the entire 68MB database in memory
  - With 3-4 sessions, memory would exceed 4GB causing OOM kills every ~20 minutes
  - Fix: Implemented singleton `SharedDatabase` pattern - all sessions now share ONE database connection
  - Memory impact: Reduced from ~900MB per session to ~68MB total (shared) + ~5MB per session overhead
  - Added `getSharedDatabase()` and `releaseSharedDatabase()` for thread-safe connection management
  - Added reference counting to track active sessions using the shared connection

- **Session timeout optimization**: Reduced default session timeout from 30 minutes to 5 minutes
  - Faster cleanup of stale sessions reduces memory buildup
  - Configurable via `SESSION_TIMEOUT_MINUTES` environment variable

- **Eager instance cleanup**: When a client reconnects, previous sessions for the same instanceId are now immediately cleaned up
  - Prevents memory accumulation from reconnecting clients in multi-tenant deployments

- **Telemetry event listener leak**: Fixed event listeners in `TelemetryBatchProcessor` that were never removed
  - Added proper cleanup in `stop()` method
  - Added guard against multiple `start()` calls

### Added

- **New module: `src/database/shared-database.ts`** - Singleton database manager
  - `getSharedDatabase(dbPath)`: Thread-safe initialization with promise lock pattern
  - `releaseSharedDatabase(state)`: Reference counting for cleanup
  - `closeSharedDatabase()`: Graceful shutdown for process termination
  - `isSharedDatabaseInitialized()` and `getSharedDatabaseRefCount()`: Monitoring helpers

### Changed

- **`N8NDocumentationMCPServer.close()`**: Now releases shared database reference instead of closing the connection
- **`SingleSessionHTTPServer.shutdown()`**: Calls `closeSharedDatabase()` during graceful shutdown

## [2.33.4] - 2026-01-21

### Fixed

- **Memory leak in SSE session reset** (Issue #542): Fixed memory leak when SSE sessions are recreated every 5 minutes
  - Root cause: `resetSessionSSE()` only closed the transport but not the MCP server
  - This left the SimpleCache cleanup timer (60-second interval) running indefinitely
  - Database connections and cached data (~50-100MB per session) persisted in memory
  - Fix: Added `server.close()` call before `transport.close()`, mirroring the existing cleanup pattern in `removeSession()`
  - Impact: Prevents ~288 leaked server instances per day in long-running HTTP deployments

## [2.33.3] - 2026-01-21

### Changed

- **Updated n8n dependencies to latest versions**
  - n8n: 2.3.3 → 2.4.4
  - n8n-core: 2.3.2 → 2.4.2
  - n8n-workflow: 2.3.2 → 2.4.2
  - @n8n/n8n-nodes-langchain: 2.3.2 → 2.4.3

### Added

- **New `icon` property type**: Added support for the new `icon` NodePropertyType introduced in n8n 2.4.x
  - Added type structure definition in `src/constants/type-structures.ts`
  - Updated type count from 22 to 23 NodePropertyTypes
  - Updated related tests to reflect the new type

### Fixed

- Rebuilt node database with 803 nodes (541 from n8n-nodes-base, 262 from @n8n/n8n-nodes-langchain)

## [2.33.2] - 2026-01-13

### Changed

- **Updated n8n dependencies to latest versions**
  - n8n: 2.2.3 → 2.3.3
  - n8n-core: 2.2.2 → 2.3.2
  - n8n-workflow: 2.2.2 → 2.3.2
  - @n8n/n8n-nodes-langchain: 2.2.2 → 2.3.2
  - Rebuilt node database with 537 nodes (434 from n8n-nodes-base, 103 from @n8n/n8n-nodes-langchain)
  - Updated README badge with new n8n version

## [2.33.1] - 2026-01-12

### Fixed

- **Docker image version mismatch bug**: Docker images were built with stale `package.runtime.json` (v2.29.5) while npm package was at v2.33.0
  - Root cause: `build-docker` job in `release.yml` did not sync `package.runtime.json` version before building
  - The `publish-npm` job synced the version, but both jobs ran in parallel, so Docker got the stale version
  - Added "Sync runtime version" step to `release.yml` `build-docker` job
  - Added "Sync runtime version" step to `docker-build.yml` `build` and `build-railway` jobs
  - All Docker builds now sync `package.runtime.json` version from `package.json` before building

## [2.33.0] - 2026-01-08

### Added

**AI-Powered Documentation for Community Nodes**

Added AI-generated documentation summaries for 537 community nodes, making them accessible through the MCP `get_node` tool.

**Features:**
- **README Fetching**: Automatically fetches README content from npm registry for all community nodes
- **AI Summary Generation**: Uses local LLM (Qwen or compatible) to generate structured documentation summaries
- **MCP Integration**: AI summaries exposed in `get_node` with `mode='docs'`

**AI Documentation Structure:**
```json
{
  "aiDocumentationSummary": {
    "purpose": "What this node does",
    "capabilities": ["key features"],
    "authentication": "API key, OAuth, etc.",
    "commonUseCases": ["practical examples"],
    "limitations": ["known caveats"],
    "relatedNodes": ["related n8n nodes"]
  },
  "aiSummaryGeneratedAt": "2026-01-08T10:45:31.000Z"
}
```

**New CLI Commands:**
```bash
npm run generate:docs              # Full generation (README + AI summary)
npm run generate:docs:readme-only  # Only fetch READMEs from npm
npm run generate:docs:summary-only # Only generate AI summaries
npm run generate:docs:incremental  # Skip nodes with existing data
npm run generate:docs:stats        # Show documentation statistics
npm run migrate:readme-columns     # Migrate database schema
```

**Environment Variables:**
```bash
N8N_MCP_LLM_BASE_URL=http://localhost:1234/v1  # LLM server URL
N8N_MCP_LLM_MODEL=qwen3-4b-thinking-2507       # Model name
N8N_MCP_LLM_TIMEOUT=60000                       # Request timeout
```

**Files Added:**
- `src/community/documentation-generator.ts` - LLM integration with Zod validation
- `src/community/documentation-batch-processor.ts` - Batch processing with progress tracking
- `src/scripts/generate-community-docs.ts` - CLI entry point
- `src/scripts/migrate-readme-columns.ts` - Database migration script

**Files Modified:**
- `src/database/schema.sql` - Added `npm_readme`, `ai_documentation_summary`, `ai_summary_generated_at` columns
- `src/database/node-repository.ts` - Added AI documentation methods and fields
- `src/community/community-node-fetcher.ts` - Added `fetchPackageWithReadme()` and batch fetching
- `src/community/index.ts` - Exported new classes
- `src/mcp/server.ts` - Added AI documentation to `get_node` docs mode response

**Statistics:**
- 538/547 community nodes have README content
- 537/547 community nodes have AI summaries
- Generation takes ~30 min for all nodes with local LLM

## [2.32.1] - 2026-01-08

### Fixed

- **Fixed community node count discrepancy**: The search tool now correctly returns all 547 community nodes
  - Root cause: `countCommunityNodes()` method was not counting nodes with NULL `is_community` flag
  - Added query to count nodes where `source_package NOT IN ('n8n-nodes-base', '@n8n/n8n-nodes-langchain')`
  - This includes nodes that may have been inserted without the `is_community` flag set

## [2.32.0] - 2026-01-08

### Added

- **Community Node Search Integration**: Added `source` filter to `search_nodes` tool
  - Filter by `"core"` for official n8n nodes (n8n-nodes-base + langchain)
  - Filter by `"community"` for verified community integrations
  - Filter by `"all"` (default) for all nodes
  - Example: `search_nodes({ query: "google", source: "community" })`

- **Community Node Statistics**: Added community node counts to search results
  - Shows `communityNodeCount` in search results when searching all sources
  - Indicates how many results come from verified community packages

### Changed

- **Search Results Enhancement**: Search results now include source information
  - Each result shows whether it's from core or community packages
  - Helps users identify and discover community integrations

### Technical Details

- Added `source` parameter to `searchNodes()` method in NodeRepository
- Updated `search_nodes` tool schema with new `source` parameter
- Community nodes identified by `is_community=1` flag in database
- 547 verified community nodes available from 301 npm packages

## [2.31.0] - 2026-01-08

### Added

- **Community Node Support**: Full integration of verified n8n community nodes
  - Added 547 verified community nodes from 301 npm packages
  - Automatic fetching from n8n's verified integrations API
  - NPM package metadata extraction (version, downloads, repository)
  - Node property extraction via tarball analysis
  - CLI commands: `npm run fetch:community`, `npm run fetch:community:rebuild`

- **Database Schema Updates**:
  - Added `is_community` boolean flag for community node identification
  - Added `npm_package_name` for npm registry reference
  - Added `npm_version` for installed package version
  - Added `npm_downloads` for weekly download counts
  - Added `npm_repository` for GitHub/source links
  - Added unique constraint `idx_nodes_unique_type` on `node_type`

- **New MCP Tool Features**:
  - `search_nodes` now includes community nodes in results
  - `get_node` returns community metadata (npm package, downloads, repo)
  - Community nodes have full property/operation support

### Technical Details

- Community node fetcher with retry logic and rate limiting
- Tarball extraction for node class analysis
- Support for multi-node packages (e.g., n8n-nodes-document-generator)
- Graceful handling of packages without extractable nodes

## [2.30.0] - 2026-01-07

### Added

- **Real-World Configuration Examples**: Added `includeExamples` parameter to `search_nodes` and `get_node` tools
  - Pre-extracted configurations from 2,646 popular workflow templates
  - Shows actual working configurations used in production workflows
  - Examples include all parameters, credentials patterns, and common settings
  - Helps AI understand practical usage patterns beyond schema definitions

- **Example Data Sources**:
  - Top 50 most-used nodes have 2+ configuration examples each
  - Examples extracted from templates with 1000+ views
  - Covers diverse use cases: API integrations, data transformations, triggers

### Changed

- **Tool Parameter Updates**:
  - `search_nodes`: Added `includeExamples` boolean parameter (default: false)
  - `get_node` with `mode='info'` and `detail='standard'`: Added `includeExamples` parameter

### Technical Details

- Examples stored in `node_config_examples` table with template metadata
- Extraction script: `npm run extract:examples`
- Examples include: node parameters, credentials type, template ID, view count
- Adds ~200-400 tokens per example to response

## [2.29.5] - 2026-01-05

### Fixed

- **Critical validation loop prevention**: Added infinite loop detection in workflow validation with 1000-iteration safety limit
- **Memory management improvements**: Fixed potential memory leaks in validation result accumulation
- **Error propagation**: Improved error handling to prevent silent failures during validation

### Changed

- **Validation performance**: Optimized loop detection algorithm to reduce CPU overhead
- **Debug logging**: Added detailed logging for validation iterations when DEBUG=true

## [2.29.4] - 2026-01-04

### Fixed

- **Node type version validation**: Fixed false positive errors for nodes using valid older typeVersions
- **AI tool variant detection**: Improved detection of AI-capable tool variants in workflow validation
- **Connection validation**: Fixed edge case where valid connections between AI nodes were flagged as errors

## [2.29.3] - 2026-01-03

### Fixed

- **Sticky note validation**: Fixed false "missing name property" errors for n8n sticky notes
- **Loop node connections**: Fixed validation of Loop Over Items node output connections
- **Expression format detection**: Improved detection of valid n8n expression formats

## [2.29.2] - 2026-01-02

### Fixed

- **HTTP Request node validation**: Fixed false positives for valid authentication configurations
- **Webhook node paths**: Fixed validation of webhook paths with dynamic segments
- **Resource mapper validation**: Improved handling of auto-mapped fields

## [2.29.1] - 2026-01-01

### Fixed

- **typeVersion validation**: Fixed incorrect "unknown typeVersion" warnings for valid node versions
- **AI node connections**: Fixed validation of connections between AI agent and tool nodes
- **Expression escaping**: Fixed handling of expressions containing special characters

## [2.29.0] - 2025-12-31

### Added

- **Workflow Auto-Fixer**: New `n8n_autofix_workflow` tool for automatic error correction
  - Fixes expression format issues (missing `=` prefix)
  - Corrects invalid typeVersions to latest supported
  - Adds missing error output configurations
  - Fixes webhook paths and other common issues
  - Preview mode (default) shows fixes without applying
  - Apply mode updates workflow with corrections

- **Fix Categories**:
  - `expression-format`: Fixes `{{ }}` to `={{ }}`
  - `typeversion-correction`: Updates to valid typeVersion
  - `error-output-config`: Adds missing onError settings
  - `webhook-missing-path`: Generates unique webhook paths
  - `node-type-correction`: Fixes common node type typos

### Changed

- **Validation Integration**: Auto-fixer integrates with existing validation
- **Confidence Scoring**: Each fix includes confidence level (high/medium/low)
- **Batch Processing**: Multiple fixes applied in single operation

## [2.28.0] - 2025-12-30

### Added

- **Execution Debugging**: New `n8n_executions` tool with `mode='error'` for debugging failed workflows
  - Optimized error analysis with upstream node context
  - Execution path tracing to identify failure points
  - Sample data from nodes leading to errors
  - Stack trace extraction for debugging

- **Execution Management Features**:
  - `action='list'`: List executions with filters (status, workflow, project)
  - `action='get'`: Get execution details with multiple modes
  - `action='delete'`: Remove execution records
  - Pagination support with cursor-based navigation

### Changed

- **Error Response Format**: Enhanced error details include:
  - `errorNode`: Node where error occurred
  - `errorMessage`: Human-readable error description
  - `upstreamData`: Sample data from preceding nodes
  - `executionPath`: Ordered list of executed nodes

## [2.27.0] - 2025-12-29

### Added

- **Workflow Version History**: New `n8n_workflow_versions` tool for version management
  - `mode='list'`: View version history for a workflow
  - `mode='get'`: Get specific version details
  - `mode='rollback'`: Restore workflow to previous version
  - `mode='delete'`: Remove specific versions
  - `mode='prune'`: Keep only N most recent versions
  - `mode='truncate'`: Clear all version history

- **Version Features**:
  - Automatic backup before rollback
  - Validation before restore
  - Configurable retention policies
  - Version comparison capabilities

## [2.26.0] - 2025-12-28

### Added

- **Template Deployment**: New `n8n_deploy_template` tool for one-click template deployment
  - Deploy any template from n8n.io directly to your instance
  - Automatic credential stripping for security
  - Auto-fix common issues after deployment
  - TypeVersion upgrades to latest supported

- **Deployment Features**:
  - `templateId`: Required template ID from n8n.io
  - `name`: Optional custom workflow name
  - `autoFix`: Enable/disable automatic fixes (default: true)
  - `autoUpgradeVersions`: Upgrade node versions (default: true)
  - `stripCredentials`: Remove credential references (default: true)

## [2.25.0] - 2025-12-27

### Added

- **Workflow Diff Engine**: New partial update system for efficient workflow modifications
  - `n8n_update_partial_workflow`: Apply incremental changes via diff operations
  - Operations: addNode, removeNode, updateNode, moveNode, enable/disableNode
  - Connection operations: addConnection, removeConnection
  - Metadata operations: updateSettings, updateName, add/removeTag

- **Diff Benefits**:
  - 80-90% token reduction for updates
  - Atomic operations with rollback on failure
  - Validation-only mode for testing changes
  - Best-effort mode for partial application

## [2.24.1] - 2025-12-26

### Added

- **Session Persistence API**: Export and restore session state for zero-downtime deployments
  - `exportSessionState()`: Serialize active sessions with context
  - `restoreSessionState()`: Recreate sessions from serialized state
  - Multi-tenant support for SaaS deployments
  - Automatic session expiration handling

### Security

- **Important**: API keys exported as plaintext - downstream MUST encrypt
- Session validation on restore prevents invalid state injection
- Respects `sessionTimeout` configuration during restore

## [2.24.0] - 2025-12-25

### Added

- **Flexible Instance Configuration**: Connect to any n8n instance dynamically
  - Session-based instance switching via `configure` method
  - Per-request instance override in tool calls
  - Backward compatible with environment variable configuration

- **Multi-Tenant Support**: Run single MCP server for multiple n8n instances
  - Each session maintains independent instance context
  - Secure credential isolation between sessions
  - Automatic context cleanup on session end

## [2.23.0] - 2025-12-24

### Added

- **Type Structure Validation**: Complete validation for all 22 n8n property types
  - `filter`: Validates conditions array, combinator, operator structure
  - `resourceMapper`: Validates mappingMode and field mappings
  - `assignmentCollection`: Validates assignments array structure
  - `resourceLocator`: Validates mode and value combinations

- **Type Structure Service**: New service for type introspection
  - `getStructure(type)`: Get complete type definition
  - `getExample(type)`: Get working example values
  - `isComplexType(type)`: Check if type needs special handling
  - `getJavaScriptType(type)`: Get underlying JS type

### Changed

- **Enhanced Validation**: Validation now includes type-specific checks
- **Better Error Messages**: Type validation errors include expected structure

## [2.22.21] - 2025-12-23

### Added

- **Complete Type Structures**: Defined all 22 NodePropertyTypes with:
  - JavaScript type mappings
  - Expected data structures
  - Working examples
  - Validation rules
  - Usage notes

- **Type Categories**:
  - Primitive: string, number, boolean, dateTime, color, json
  - Options: options, multiOptions
  - Collections: collection, fixedCollection
  - Special: resourceLocator, resourceMapper, filter, assignmentCollection
  - Credentials: credentials, credentialsSelect
  - UI-only: hidden, button, callout, notice
  - Utility: workflowSelector, curlImport

## [2.22.0] - 2025-12-22

### Added

- **n8n Workflow Management Tools**: Full CRUD operations for n8n workflows
  - `n8n_create_workflow`: Create new workflows
  - `n8n_get_workflow`: Retrieve workflow details
  - `n8n_update_full_workflow`: Complete workflow replacement
  - `n8n_delete_workflow`: Remove workflows
  - `n8n_list_workflows`: List all workflows with filters
  - `n8n_validate_workflow`: Validate workflow by ID
  - `n8n_test_workflow`: Trigger workflow execution

- **Health Check**: `n8n_health_check` tool for API connectivity verification

### Changed

- **Tool Organization**: Management tools require n8n API configuration
- **Error Handling**: Improved error messages for API failures

## [2.21.0] - 2025-12-21

### Added

- **Tools Documentation System**: Self-documenting MCP tools
  - `tools_documentation` tool for comprehensive tool guides
  - Topic-based documentation (overview, specific tools)
  - Depth levels: essentials (quick ref) and full (comprehensive)

### Changed

- **Documentation Format**: Standardized documentation across all tools
- **Help System**: Integrated help accessible from within MCP

## [2.20.0] - 2025-12-20

### Added

- **Workflow Validation Tool**: `validate_workflow` for complete workflow checks
  - Node configuration validation
  - Connection validation
  - Expression syntax checking
  - AI tool compatibility verification

- **Validation Profiles**:
  - `minimal`: Quick required fields check
  - `runtime`: Production-ready validation
  - `ai-friendly`: Balanced for AI workflows
  - `strict`: Maximum validation coverage

## [2.19.0] - 2025-12-19

### Added

- **Expression Validator**: Validate n8n expression syntax
  - Detects missing `=` prefix in expressions
  - Validates `$json`, `$node`, `$input` references
  - Checks function call syntax
  - Reports expression errors with suggestions

### Changed

- **Validation Integration**: Expression validation integrated into workflow validator

## [2.18.0] - 2025-12-18

### Added

- **Node Essentials Tool**: `get_node_essentials` for AI-optimized node info
  - 60-80% smaller responses than full node info
  - Essential properties only
  - Working examples included
  - Perfect for AI context windows

- **Property Filtering**: Smart filtering of node properties
  - Removes internal/deprecated properties
  - Keeps only user-configurable options
  - Maintains operation-specific properties

## [2.17.0] - 2025-12-17

### Added

- **Enhanced Config Validator**: Operation-aware validation
  - Validates resource/operation combinations
  - Suggests similar resources when invalid
  - Provides operation-specific property requirements

- **Similarity Services**:
  - Resource similarity for typo detection
  - Operation similarity for suggestions
  - Fuzzy matching with configurable threshold

## [2.16.0] - 2025-12-16

### Added

- **Template System**: Workflow templates from n8n.io
  - `search_templates`: Find templates by keyword, nodes, or task
  - `get_template`: Retrieve complete template JSON
  - 2,700+ templates indexed with metadata
  - Search modes: keyword, by_nodes, by_task, by_metadata

- **Template Metadata**:
  - Complexity scoring
  - Setup time estimates
  - Required services
  - Node usage statistics

## [2.15.0] - 2025-12-15

### Added

- **HTTP Server Mode**: REST API for MCP integration
  - Single-session endpoint for simple deployments
  - Multi-session support for SaaS
  - Bearer token authentication
  - CORS configuration

- **Docker Support**: Official Docker image
  - `ghcr.io/czlonkowski/n8n-mcp`
  - Railway one-click deploy
  - Environment-based configuration

## [2.14.0] - 2025-12-14

### Added

- **Node Version Support**: Track and query node versions
  - `mode='versions'`: List all versions of a node
  - `mode='compare'`: Compare two versions
  - `mode='breaking'`: Find breaking changes
  - `mode='migrations'`: Get migration guides

- **Version Migration Service**: Automated migration suggestions
  - Property mapping between versions
  - Breaking change detection
  - Upgrade recommendations

## [2.13.0] - 2025-12-13

### Added

- **AI Tool Detection**: Identify AI-capable nodes
  - 265 AI tool variants detected
  - Tool vs non-tool node classification
  - AI workflow validation support

- **Tool Variant Handling**: Special handling for AI tools
  - Validate tool configurations
  - Check AI node connections
  - Verify tool compatibility

## [2.12.0] - 2025-12-12

### Added

- **Node-Specific Validators**: Custom validation for complex nodes
  - HTTP Request: URL, method, auth validation
  - Code: JavaScript/Python syntax checking
  - Webhook: Path and response validation
  - Slack: Channel and message validation

### Changed

- **Validation Architecture**: Pluggable validator system
- **Error Specificity**: More targeted error messages

## [2.11.0] - 2025-12-11

### Added

- **Config Validator**: Multi-profile validation system
  - Validate node configurations before deployment
  - Multiple strictness profiles
  - Detailed error reporting with suggestions

- **Validation Profiles**:
  - `minimal`: Required fields only
  - `runtime`: Runtime compatibility
  - `ai-friendly`: Balanced validation
  - `strict`: Full schema validation

## [2.10.0] - 2025-12-10

### Added

- **Documentation Mapping**: Integrated n8n docs
  - 87% coverage of core nodes
  - Links to official documentation
  - AI node documentation included

- **Docs Mode**: `get_node(mode='docs')` for markdown documentation

## [2.9.0] - 2025-12-09

### Added

- **Property Dependencies**: Analyze property relationships
  - Find dependent properties
  - Understand displayOptions
  - Track conditional visibility

### Changed

- **Property Extraction**: Enhanced extraction with dependencies

## [2.8.0] - 2025-12-08

### Added

- **FTS5 Search**: Full-text search with SQLite FTS5
  - Fast fuzzy searching
  - Relevance ranking
  - Partial matching

### Changed

- **Search Performance**: 10x faster searches with FTS5

## [2.7.0] - 2025-12-07

### Added

- **Database Adapter**: Universal SQLite adapter
  - better-sqlite3 for Node.js
  - sql.js for browser/Cloudflare
  - Automatic adapter selection

### Changed

- **Deployment Flexibility**: Works in more environments

## [2.6.0] - 2025-12-06

### Added

- **Search Nodes Tool**: `search_nodes` for node discovery
  - Keyword search with multiple modes
  - OR, AND, FUZZY matching
  - Result limiting and pagination

### Changed

- **Tool Interface**: Standardized parameter naming

## [2.5.0] - 2025-12-05

### Added

- **Get Node Tool**: `get_node` for detailed node info
  - Multiple detail levels: minimal, standard, full
  - Multiple modes: info, docs, versions
  - Property searching

## [2.4.0] - 2025-12-04

### Added

- **Validate Node Tool**: `validate_node` for configuration validation
  - Validates against node schema
  - Reports errors and warnings
  - Provides fix suggestions

## [2.3.0] - 2025-12-03

### Added

- **Property Extraction**: Deep analysis of node properties
  - Extract all configurable properties
  - Parse displayOptions conditions
  - Handle nested collections

## [2.2.0] - 2025-12-02

### Added

- **Node Parser**: Parse n8n node definitions
  - Extract metadata (name, description, icon)
  - Parse properties and operations
  - Handle version variations

## [2.1.0] - 2025-12-01

### Added

- **Node Loader**: Load nodes from n8n packages
  - Support n8n-nodes-base
  - Support @n8n/n8n-nodes-langchain
  - Handle node class instantiation

## [2.0.0] - 2025-11-30

### Added

- **MCP Server**: Model Context Protocol implementation
  - stdio mode for Claude Desktop
  - Tool registration system
  - Resource handling

### Changed

- **Architecture**: Complete rewrite for MCP compatibility

## [1.0.0] - 2025-11-15

### Added

- Initial release
- Basic n8n node database
- Simple search functionality
