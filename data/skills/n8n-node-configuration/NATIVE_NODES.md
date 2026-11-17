# Native Nodes for Data Jobs

Configuration patterns for the native nodes that replace most Code nodes. The job-to-node
table in `using-n8n-mcp-skills` says *which* node fits a job; this file says *how* to
configure it.

Every block below is the `parameters` object as it appears in workflow JSON (node types in
LONG form, e.g. `n8n-nodes-base.summarize`). The typeVersions are the current ones at the
time of writing. Before you commit a config, confirm it with `get_node` on the user's
version — on n8n-mcp 2.97.0+ standard detail already lists each `options` collection's settings — or search for a field: `get_node({nodeType: "nodes-base.summarize", mode: "search_properties",
propertyQuery: "split"})`. Parameters left at their default can be omitted.

## Contents

- [Summarize: group and aggregate](#summarize-group-and-aggregate)
- [Aggregate: items to one array](#aggregate-items-to-one-array)
- [Split Out: array to items](#split-out-array-to-items)
- [Merge: join two lists](#merge-join-two-lists)
- [Compare Datasets: diff and sync](#compare-datasets-diff-and-sync)
- [Remove Duplicates, also across executions](#remove-duplicates-also-across-executions)
- [Sort + Limit: top-N](#sort--limit-top-n)
- [Filter, IF, Switch: conditions](#filter-if-switch-conditions)
- [Data Table get: order by and limit](#data-table-get-order-by-and-limit)
- [Date & Time](#date--time)
- [HTTP Request pagination](#http-request-pagination)
- [Webhook signature: raw body + Crypto](#webhook-signature-raw-body--crypto)
- [Files and markup: XML, HTML, Markdown, Extract From File, Convert To File](#files-and-markup)
- [Node settings: executeOnce, alwaysOutputData, notes](#node-settings-executeonce-alwaysoutputdata-notes)

---

## Summarize: group and aggregate

`n8n-nodes-base.summarize`, typeVersion 1.1. Group by one or more fields and compute
aggregates per group, like SQL `GROUP BY`.

```json
{
  "fieldsToSummarize": {
    "values": [
      { "aggregation": "sum", "field": "amount" },
      { "aggregation": "count", "field": "id" }
    ]
  },
  "fieldsToSplitBy": "customerId",
  "options": {}
}
```

Output: one item per `customerId`, with fields `customerId`, `sum_amount`, `count_id`.

- `aggregation`: `sum`, `average`, `count`, `countUnique`, `min`, `max`, `append`,
  `concatenate`. Output keys are prefixed `sum_`, `average_`, `count_`, `unique_count_`,
  `min_`, `max_`, `appended_`, `concatenated_`; dots and spaces in the field name become `_`.
- `fieldsToSplitBy` is ONE comma-separated string (`"customerId, month"`), not a list. Leave
  it empty for a single total over all items.
- `options.outputFormat`: `separateItems` (default, one item per group) or `singleItem`.
- `concatenate` takes `separateBy` / `customSeparator`; `count`, `countUnique`, `append` and
  `concatenate` take `includeEmpty`.

## Aggregate: items to one array

`n8n-nodes-base.aggregate`, typeVersion 1. Collapses many items into one item holding arrays.

Collect one field from every item:

```json
{
  "aggregate": "aggregateIndividualFields",
  "fieldsToAggregate": {
    "fieldToAggregate": [
      { "fieldToAggregate": "id", "renameField": true, "outputFieldName": "ids" }
    ]
  },
  "options": {}
}
```

Collect whole items into one list:

```json
{ "aggregate": "aggregateAllItemData", "destinationFieldName": "rows", "include": "allFields" }
```

- Without `renameField: true` the output field keeps the input name (`id` holding an array).
- All-data mode: `include` is `allFields`, `specifiedFields` (+ `fieldsToInclude`) or
  `allFieldsExcept` (+ `fieldsToExclude`).
- Options in individual-fields mode: `mergeLists` (flatten array fields), `keepMissing`
  (keep null / missing values), `includeBinaries`.
- Typical use: a bulk API body or one Slack message built from many items. For a single
  total or count, Summarize is the better fit.

## Split Out: array to items

`n8n-nodes-base.splitOut`, typeVersion 1.1. Turns an array field into one item per element.

```json
{
  "fieldToSplitOut": "line_items",
  "include": "selectedOtherFields",
  "fieldsToInclude": "order_id, customer_email",
  "options": { "destinationFieldName": "line_item" }
}
```

- The parameter is `fieldToSplitOut` (singular); it accepts comma-separated names.
- `include`: `noOtherFields` (default: parent fields are dropped), `allOtherFields`, or
  `selectedOtherFields` + `fieldsToInclude`. Use one of the last two when downstream nodes
  need the parent's fields; otherwise they reach back with `$('Source').item`.

## Merge: join two lists

`n8n-nodes-base.merge`, typeVersion 3.2. `mode`: `append` (default), `combine`,
`combineBySql`, `chooseBranch`.

Join on a field with the same name in both inputs (like a SQL join):

```json
{ "mode": "combine", "combineBy": "combineByFields", "fieldsToMatchString": "id", "joinMode": "enrichInput1", "options": {} }
```

Different field names on each side:

```json
{
  "mode": "combine",
  "combineBy": "combineByFields",
  "advanced": true,
  "mergeByFields": { "values": [ { "field1": "customerId", "field2": "id" } ] },
  "joinMode": "keepMatches",
  "options": {}
}
```

- `joinMode`: `keepMatches` (default, inner join), `keepNonMatches` (items without a
  partner), `keepEverything` (outer join), `enrichInput1` (left join), `enrichInput2` (right
  join). `keepMatches` and `keepNonMatches` add `outputDataFrom`: `both`, `input1`, `input2`.
- `options.multipleMatches`: `all` (default) or `first`. `options.fuzzyCompare` treats `"1"`
  and `1` as equal. `options.clashHandling` decides which value wins when both sides have a
  field.
- `combineBy` also takes `combineByPosition` (item 1 with item 1; `options.includeUnpaired`)
  and `combineAll` (a cross join; every pair).
- **Input count:** `numberInputs` (default 2, up to 10) exists on `append`, `combineBySql`,
  `combineByPosition` and `chooseBranch`. Combine by Fields and Combine All always take two.
  It is `numberInputs`, not `numberOfInputs`; see [NODE_FAMILY_GOTCHAS.md](NODE_FAMILY_GOTCHAS.md).

SQL mode, for joins on several keys, aggregates across inputs, or 3+ inputs:

```json
{
  "mode": "combineBySql",
  "numberInputs": 3,
  "query": "SELECT o.*, c.email FROM input1 o LEFT JOIN input2 c ON o.customer_id = c.id",
  "options": {}
}
```

- Tables are `input1` … `inputN`; the engine is AlaSQL.
- Don't build the query from item data with `{{ }}`: the value becomes SQL text. Use `?`
  placeholders and `options.queryParameters` (a comma-separated string of values).

## Compare Datasets: diff and sync

`n8n-nodes-base.compareDatasets`, typeVersion 2.3. Compares input A (first wire) with input
B (second wire) on a key and sorts every item into one of four outputs.

```json
{
  "mergeByFields": { "values": [ { "field1": "id", "field2": "id" } ] },
  "resolve": "includeBoth",
  "options": { "skipFields": "updated_at, synced_at" }
}
```

- Outputs, in this fixed order: `main[0]` In A only, `main[1]` Same, `main[2]` Different,
  `main[3]` In B only. A sync wires them to create / skip / update / delete.
- `resolve` (what the Different output carries): `includeBoth` (default from 2.1),
  `preferInput1`, `preferInput2`, `mix` (+ `preferWhenMix`, `exceptWhenMix`). Older
  versions default to `preferInput2`, so set it explicitly.
- `options.skipFields`: fields that should not count as a difference (timestamps).
  `fuzzyCompare` is a top-level parameter on v2+.

## Remove Duplicates, also across executions

`n8n-nodes-base.removeDuplicates`, typeVersion 2 (cross-execution mode needs v2).

Within the current input:

```json
{ "operation": "removeDuplicateInputItems", "compare": "selectedFields", "fieldsToCompare": "email", "options": {} }
```

`compare`: `allFields` (default), `allFieldsExcept` (+ `fieldsToExclude`), `selectedFields`
(+ `fieldsToCompare`).

Across executions (a poller that must not process the same record twice):

```json
{
  "operation": "removeItemsSeenInPreviousExecutions",
  "logic": "removeItemsWithAlreadySeenKeyValues",
  "dedupeValue": "={{ $json.id }}",
  "options": { "scope": "node", "historySize": 10000 }
}
```

| `logic` | Keeps items whose… | Value parameter |
|---|---|---|
| `removeItemsWithAlreadySeenKeyValues` | key was never seen | `dedupeValue` |
| `removeItemsUpToStoredIncrementalKey` | number is higher than the stored one | `incrementalDedupeValue` |
| `removeItemsUpToStoredDate` | date is later than the stored one | `dateDedupeValue` |

- `options.scope`: `node` (default) or `workflow` (shared by every Remove Duplicates node in
  the workflow). `historySize` (default 10000) applies to the seen-keys logic.
- To reset: `{ "operation": "clearDeduplicationHistory", "mode": "cleanDatabase" }`.
- The history survives between executions on the instance itself, so this replaces the
  `$getWorkflowStaticData` + Code pattern for "only new items".

## Sort + Limit: top-N

`n8n-nodes-base.sort` (typeVersion 1) followed by `n8n-nodes-base.limit` (typeVersion 1).

```json
{ "type": "simple", "sortFieldsUi": { "sortField": [ { "fieldName": "amount", "order": "descending" } ] }, "options": {} }
```

```json
{ "maxItems": 10, "keep": "firstItems" }
```

- Sort `type`: `simple`, `random`, or `code` (a comparator, for orders the field list can't
  express). `order`: `ascending` / `descending`; several `sortField` entries sort by each in turn.
- Limit `keep`: `firstItems` (default) or `lastItems`. `maxItems` defaults to 1.

## Filter, IF, Switch: conditions

Filter (`n8n-nodes-base.filter`, 2.3), IF (`n8n-nodes-base.if`, 2.3) and Switch rules
(`n8n-nodes-base.switch`, 3.4) share one conditions shape. Put the comparison in the
condition itself instead of computing a flag in an earlier node.

```json
{
  "conditions": {
    "options": { "caseSensitive": true, "leftValue": "", "typeValidation": "strict", "version": 3 },
    "conditions": [
      { "leftValue": "={{ $json.status }}", "rightValue": "active", "operator": { "type": "string", "operation": "equals" } },
      { "leftValue": "={{ $json.amount }}", "rightValue": 100, "operator": { "type": "number", "operation": "gt" } }
    ],
    "combinator": "and"
  },
  "options": {}
}
```

- One condition group is either all `and` or all `or`. For mixed logic, chain two nodes or
  put the combined test in one boolean expression (`operator: {type: "boolean", operation: "true"}`).
- `typeValidation: "strict"` fails on a number arriving as a string; fix the type upstream or
  set top-level `looseTypeValidation: true`.
- IF: `main[0]` true, `main[1]` false. Switch: set `options.fallbackOutput: "extra"`, or
  unmatched items are dropped silently (see [NODE_FAMILY_GOTCHAS.md](NODE_FAMILY_GOTCHAS.md)).
- Operator details (unary operators, `singleValue`) live in the validation skill's
  auto-sanitization notes; let `validate_node` fix the structure.

## Data Table get: order by and limit

`n8n-nodes-base.dataTable`, typeVersion 1.1, `resource: "row"`, `operation: "get"`. Pick the
latest or top rows in the query itself instead of fetching everything and sorting in Code.

```json
{
  "resource": "row",
  "operation": "get",
  "dataTableId": { "__rl": true, "mode": "name", "value": "orders" },
  "matchType": "allConditions",
  "filters": { "conditions": [ { "keyName": "status", "condition": "eq", "keyValue": "open" } ] },
  "returnAll": false,
  "limit": 1,
  "orderBy": true,
  "orderByColumn": "createdAt",
  "orderByDirection": "DESC"
}
```

- `returnAll` defaults to false and `limit` to 50, **per input item**. Set `returnAll: true`
  when you need every row.
- `matchType` defaults to `anyCondition` (OR). Use `allConditions` for AND.
- There is no `getAll` operation; `get` with `returnAll: true` is the "get all".

## Date & Time

`n8n-nodes-base.dateTime`, typeVersion 2. A named date step; an inline Luxon one-liner in
the consuming field is equally fine (see `n8n-expression-syntax`).

```json
{ "operation": "addToDate", "magnitude": "={{ $json.created_at }}", "timeUnit": "days", "duration": 7, "outputFieldName": "due_at", "options": { "includeInputFields": true } }
```

| `operation` | Key parameters |
|---|---|
| `getCurrentDate` | `includeTime`, `outputFieldName` |
| `addToDate` / `subtractFromDate` | `magnitude` (the date), `timeUnit`, `duration` |
| `formatDate` | `date`, `format` (`yyyy-MM-dd`, `custom` + `customFormat`, …), `options.fromFormat` |
| `getTimeBetweenDates` | `startDate`, `endDate`, `units` (list) |
| `extractDate` | `date`, `part` (`year` … `second`) |
| `roundDate` | `date`, `mode` (`roundDown` / `roundUp`), `toNearest` / `to` |

- **Set `options.includeInputFields: true`**, or the output holds only the new date field
  and the rest of the item is gone.
- v1 used different names (`action`, `value`, `toFormat`). Old templates won't validate on v2.
- Timezone: `getCurrentDate` takes `options.timezone` (a zone name) and `formatDate` takes `options.timezone` (a "use the
  workflow timezone" toggle); the other operations work in the workflow / instance timezone.

## HTTP Request pagination

`n8n-nodes-base.httpRequest`, typeVersion 4.5. Use the built-in pagination option instead of a
Set → HTTP → IF → loop. When a service node exists (its own "Return All" usually pages for you),
use that first.

Page-number or offset APIs:

```json
{
  "method": "GET",
  "url": "https://api.example.com/v1/contacts",
  "sendQuery": true,
  "queryParameters": { "parameters": [ { "name": "per_page", "value": "100" } ] },
  "options": {
    "pagination": {
      "pagination": {
        "paginationMode": "updateAParameterInEachRequest",
        "parameters": { "parameters": [ { "type": "qs", "name": "page", "value": "={{ $pageCount + 1 }}" } ] },
        "paginationCompleteWhen": "other",
        "completeExpression": "={{ !$response.body.has_more }}",
        "limitPagesFetched": true,
        "maxRequests": 100,
        "requestInterval": 250
      }
    }
  }
}
```

The API returns the next page's URL (cursor or link style):

```json
{
  "pagination": {
    "pagination": {
      "paginationMode": "responseContainsNextURL",
      "nextURL": "={{ $response.body.next }}",
      "paginationCompleteWhen": "other",
      "completeExpression": "={{ !$response.body.next }}",
      "limitPagesFetched": true,
      "maxRequests": 100
    }
  }
}
```

For a cursor sent as a parameter, use `updateAParameterInEachRequest` with
`"value": "={{ $response.body.next_cursor }}"`.

- Variables: `$pageCount` (pages fetched so far, starts at 0), `$response.body`,
  `$response.headers`, `$response.statusCode`, `$request`.
- `paginationCompleteWhen`: `responseIsEmpty` (default; the body is empty or an empty array),
  `receiveSpecificStatusCodes` (+ `statusCodesWhenComplete`, comma-separated), or `other`
  (+ `completeExpression`, which must be a full `={{ … }}` expression).
- **Always set `limitPagesFetched: true` and `maxRequests`.** Without them there is no page
  cap, and a stop condition that never fires pages forever.
- **Output shape:** a page whose body is an array becomes one item per element. A page whose
  body is an object (`{ "data": [...], "has_more": true }`) becomes one item per page; add a
  Split Out on `data`.
- Pagination settings are read from the first input item only. Paging per input item needs
  one request chain per item (a sub-workflow with `mode: each`).
- `type` in `parameters` is `qs`, `body` or `headers`. Auth comes from the node's credential,
  as for any HTTP Request.

## Webhook signature: raw body + Crypto

Verify an HMAC-signed webhook without Code. The signature must be computed over the **raw**
request body: re-serialising `$json.body` changes key order and whitespace, and the check
then fails for valid requests.

```
Webhook (options.rawBody: true)
  → Crypto (hmac over binary "data", secret from a crypto credential)
  → IF  signature header equals the computed value
       ├─ true  → process
       └─ false → Respond to Webhook 401
```

Webhook (`n8n-nodes-base.webhook`, typeVersion 2.2):

```json
{ "httpMethod": "POST", "path": "github-events", "responseMode": "responseNode", "options": { "rawBody": true } }
```

With `rawBody`, the raw bytes land in the binary property `data`; `$json.body` is still the
parsed body.

Crypto (`n8n-nodes-base.crypto`, **typeVersion 2**):

```json
{
  "type": "n8n-nodes-base.crypto",
  "typeVersion": 2,
  "parameters": {
    "action": "hmac",
    "type": "SHA256",
    "binaryData": true,
    "binaryPropertyName": "data",
    "encoding": "hex",
    "dataPropertyName": "computedSignature"
  },
  "credentials": { "crypto": { "id": "<credential id>", "name": "GitHub webhook secret" } }
}
```

IF condition (GitHub sends `X-Hub-Signature-256: sha256=<hex>`; other providers differ, so
read their docs for the header name and prefix):

```json
{ "leftValue": "={{ $('Webhook').item.json.headers['x-hub-signature-256'] }}", "rightValue": "={{ 'sha256=' + $json.computedSignature }}", "operator": { "type": "string", "operation": "equals" } }
```

- **Crypto v2 reads the HMAC secret from a `crypto` credential (`hmacSecret`).** v1 had a
  plain-text `secret` parameter that is stored in the workflow JSON; never copy a v1 config.
  One credential holds one secret, so per-provider secrets mean one credential each.
- Header names arrive lowercased in `$json.headers`.
- Schemes that sign more than the body need the signed string built first. Stripe, for
  example, signs `<timestamp>.<raw body>` and sends `t=…,v1=…`. Check for the provider's own
  trigger node (Stripe Trigger, GitHub Trigger, …) before building verification by hand.
- The IF comparison is not constant-time. For most webhooks that is acceptable; if the user
  needs a timing-safe compare, that is a Code exception (library-level crypto).
- Crypto also covers `hash` (no credential: `{"action": "hash", "type": "SHA256", "value":
  "={{ $json.email }}", "dataPropertyName": "email_hash"}`), `generate` (`{"action":
  "generate", "encodingType": "uuid", "dataPropertyName": "id"}`), and `sign` (private key
  from the credential).
- Simple shared-secret auth (a static token in a header) doesn't need Crypto at all: set the
  Webhook node's `authentication` to `headerAuth` with a Header Auth credential.

## Files and markup

| Job | Node (typeVersion) | Key parameters |
|---|---|---|
| XML ↔ JSON | XML `n8n-nodes-base.xml` (1) | `mode`: `xmlToJson` / `jsonToxml`; `dataPropertyName` (default `data`); options `explicitArray` (default false), `mergeAttrs` (default true), `ignoreAttrs` |
| Scrape / parse HTML | HTML `n8n-nodes-base.html` (1.2) | `operation: "extractHtmlContent"`, `sourceData` `json` / `binary`, `dataPropertyName`, `extractionValues.values[]` of `{key, cssSelector, returnValue: text/html/attribute/value, attribute, returnArray}` |
| Build an HTML table / page | HTML (1.2) | `operation`: `convertToHtmlTable` or `generateHtmlTemplate` (`html` with `{{ }}`) |
| Markdown ↔ HTML | Markdown `n8n-nodes-base.markdown` (1) | `mode`: `markdownToHtml` (reads `markdown`) / `htmlToMarkdown` (reads `html`, the default mode); output to `destinationKey` |
| File → items / JSON | Extract From File `n8n-nodes-base.extractFromFile` (1.1) | `operation`: `csv`, `xlsx`, `xls`, `ods`, `html`, `pdf`, `rtf`, `text`, `xml`, `fromJson`, `fromIcs`, `binaryToPropery`; input `binaryPropertyName` (default `data`) |
| Items → file | Convert To File `n8n-nodes-base.convertToFile` (1.1) | `operation`: `csv`, `xlsx`, `xls`, `ods`, `html`, `rtf`, `toJson`, `toText`, `iCal`, `toBinary`; output `binaryPropertyName`; `options.fileName` |

- Spreadsheet and CSV extraction emits one item per row; `text`, `xml`, `fromJson` and
  `binaryToPropery` write to `destinationKey`.
- The operation value is really spelled `binaryToPropery`, and ICS is `fromIcs` for extract but
  `iCal` for convert.
- XML in a downloaded file: Extract From File (`text` or `xml`) first, then the XML node on
  that field.
- RSS feeds have their own node (RSS Read); check `search_nodes` before parsing feed XML.

## Node settings: executeOnce, alwaysOutputData, notes

These sit at the top level of the node object, next to `parameters`, not inside it.

```json
{
  "name": "Fetch config",
  "type": "n8n-nodes-base.httpRequest",
  "typeVersion": 4.5,
  "position": [600, 300],
  "executeOnce": true,
  "alwaysOutputData": true,
  "notes": "Why HTTP: no native node for this internal API",
  "notesInFlow": true,
  "parameters": { "url": "https://config.internal/api/v1/settings" }
}
```

| Setting | Effect | Replaces |
|---|---|---|
| `executeOnce: true` | runs on the first input item only | a "collapse to one item" Code node, or a Limit 1 before a one-time call |
| `alwaysOutputData: true` | emits one empty item `{}` on output 0 when the node returns nothing | a Code node that fakes an item so the branch keeps running (test for it downstream with `$json.isEmpty()`) |
| `notes` + `notesInFlow: true` | text on the node; `notesInFlow` shows it under the node on the canvas | — carries the `Why Code:` / `Why HTTP:` note |
| `onError`, `retryOnFail`, `maxTries`, `waitBetweenTries` | error routing and retries | see `n8n-error-handling` |

- `alwaysOutputData` only fills output 0, and only when it is empty; it doesn't run on the
  error path.
- Set notes in the same `addNode` / `updateNode` operation that adds the Code or HTTP
  Request node: `{"type": "updateNode", "nodeName": "Parse rows", "updates": {"notes":
  "Why Code: Extract From File considered — fixed-width format", "notesInFlow": true}}`.
