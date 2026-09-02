import { ToolDocumentation } from '../types';

/**
 * The artifact wrappers are registered by the response-bounding layer
 * (src/services/mcp-response-bounding.ts) rather than by src/mcp/tools.ts, so they were
 * absent from this catalogue while being fully callable — tools_documentation({topic:
 * 'query_response_artifact'}) answered "not found" for a tool that works. Keep this
 * entry in step with the inputSchema in that service.
 */

export const queryResponseArtifactDoc: ToolDocumentation = {
  name: 'query_response_artifact',
  category: 'system',
  essentials: {
    description:
      'Query structured JSON inside a large tool-result artifact without loading it into context. Start with describe=true to learn the real shape.',
    keyParameters: ['artifactId', 'responsePath', 'describe'],
    example:
      'query_response_artifact({artifactId: "a1b2c3", responsePath: "", describe: true})',
    performance: 'Fast - reads a stored artifact from disk, no n8n API call',
    tips: [
      'Use only the camelCase argument names artifactId, responsePath, fields, filters, pageSize, cursor, describe, objectMode, and textSearch. Snake_case variants are invalid.',
      'Call with describe=true first. The inline preview you just read is a reshaped summary, so a pointer copied out of it may not exist in the artifact.',
      'responseMeta.artifact.primaryPaths lists pointers that do resolve — prefer those over guessing.',
      'Omit responsePath to use the artifact\'s advertised responseRoot (the n8n artifact root is ""). Pass responsePath: "" explicitly for the whole document.',
      'Exact pointers win. If one is missing and responseRoot is non-empty, it is tried once beneath that root and the canonical path is returned in responsePath and responseMeta.inferredResponsePath.',
      'RFC 6901 treats "/" as a property whose name is empty; it is not the document root.',
      'On a selected object, fields or filters infer exactly one array child and report its full pointer as responseMeta.inferredResponsePath; ambiguous shapes still need a more specific responsePath.',
      'pageSize is limited to 1-100. Request another semantic page only when the current page did not answer the question.',
      'For another page, pass responseMeta.nextCursor as cursor and keep all other query-view arguments unchanged.',
      'Caller-correctable failures return structured error codes without generic n8n parameter diagnostics.',
      'An unknown artifactId means the handle expired or the server restarted — re-run the tool that produced it.'
    ]
  },
  full: {
    description: `Queries structured JSON held in a large MCP result artifact, so a response too big for context can still be read precisely.

When a tool result exceeds the inline budget, the response-bounding layer stores the full payload as an artifact and returns a bounded preview plus a handle in responseMeta.artifact. This tool navigates that stored payload.

The important failure mode is pointer drift. When filters or fields shaped the inline preview, that preview is a summary with its own keys — not a window onto the artifact's structure. Pointers copied from it can fail with "JSON pointer does not exist". Two mechanisms exist to avoid guessing:

- describe=true returns the shape at responsePath (types, key names, array lengths) instead of values, with a usable pointer on each entry.
- responseMeta.artifact.primaryPaths lists pointers already known to resolve.

Arrays page by element and objects page by entry.`,
    parameters: {
      artifactId: {
        type: 'string',
        required: true,
        description: 'Opaque artifact id returned in responseMeta.artifact.id'
      },
      responsePath: {
        type: 'string',
        required: false,
        default: '',
        description: 'RFC 6901 pointer selecting the value to query. Omit it to use responseMeta.artifact.responseRoot; for n8n that default is the whole document (empty string). Exact pointers win; a missing pointer is tried once beneath a non-empty responseRoot and reports its canonical path. A literal "/" selects an empty-key property, not the root.'
      },
      describe: {
        type: 'boolean',
        required: false,
        default: false,
        description: 'Return the shape at responsePath (types, key names, array lengths) instead of values. Use this first when the structure is unknown.'
      },
      fields: {
        type: 'array',
        required: false,
        description: 'Root property names (id) or RFC 6901 pointers (/status/name) projected from each selected item, max 50. Nested paths must begin with /; status/name is treated as one literal root key. Fields that do not resolve are omitted rather than returned as null; check responseMeta.fieldsResolved.'
      },
      filters: {
        type: 'array',
        required: false,
        description: 'Provider-independent predicates applied to a selected array, max 10. Each entry takes path (pointer relative to the item), op (eq, ne, in, contains, icontains, lt, lte, gt, gte, exists; default eq) and value.'
      },
      objectMode: {
        type: 'string',
        required: false,
        description: 'Set to entries for keyed objects, exposing {key,value} rows that can be filtered and projected.'
      },
      textSearch: {
        type: 'object',
        required: false,
        description: 'Bounded literal search across strings beneath responsePath: {query, caseSensitive?}. Returns at most 20 matches with 240 characters of context.'
      },
      pageSize: {
        type: 'integer',
        required: false,
        default: 20,
        description: 'Elements or entries per page, 1-100. Use cursor for additional pages instead of requesting more than 100.'
      },
      cursor: {
        type: 'string',
        required: false,
        description: 'Opaque responseMeta.nextCursor from the previous query page. Keep every other query-view argument unchanged.'
      }
    },
    returns:
      'The selected value (or its shape when describe=true) plus responseMeta carrying nextCursor, counts, fieldsResolved, any inferredResponsePath, and an artifact block with id, expiry and primaryPaths.',
    examples: [
      'query_response_artifact({artifactId: "a1b2c3", describe: true}) - describe the advertised default response root',
      'query_response_artifact({artifactId: "a1b2c3", responsePath: "/data", describe: true}) - array length and item shape before paging',
      'query_response_artifact({artifactId: "a1b2c3", responsePath: "/data", fields: ["id", "/status/name"], pageSize: 50}) - project two fields per element',
      'query_response_artifact({artifactId: "a1b2c3", responsePath: "/data", fields: ["id"], pageSize: 100, cursor: "<responseMeta.nextCursor>"}) - fetch the next page without exceeding the page-size limit',
      'query_response_artifact({artifactId: "a1b2c3", responsePath: "/data", filters: [{path: "/status/name", op: "eq", value: "error"}]}) - select failing entries only',
      'query_response_artifact({artifactId: "a1b2c3", responsePath: "/data", textSearch: {query: "timeout"}}) - find a literal inside large strings without returning the full payload'
    ],
    useCases: [
      'Inspect a large execution payload without paging the whole thing into context',
      'Pull a handful of fields out of a long list result',
      'Filter a large array down to the entries that matter',
      'Search large string values while keeping the full payload out of model context',
      'Recover from INVALID_RESPONSE_PATH by using its available-child hints or describing a valid parent'
    ],
    performance: 'Fast - local artifact read; cost scales with the selected page, not the artifact size',
    errorHandling:
      'Caller-correctable failures are schema-valid isError results: INVALID_RESPONSE_PATH for an unresolved pointer, INVALID_RESPONSE_CONTROLS for incompatible or malformed query controls, INVALID_RESPONSE_CURSOR for a stale or mismatched cursor, and INVALID_ARTIFACT_HANDLE for an unusable handle. INVALID_RESPONSE_PATH includes the attempted canonical path, reported parent, and available children. Internal storage, corruption, and hard-limit failures remain server errors.',
    bestPractices: [
      'Omit responsePath for the first query; use describe=true when the default root\'s shape is unfamiliar',
      'Prefer primaryPaths over pointers copied from an inline preview',
      'Request another page only when more matching results are needed',
      'Keep responsePath, fields, filters, pageSize, describe, objectMode, and textSearch unchanged when reusing a cursor',
      'Narrow with filters and fields rather than paging everything'
    ],
    pitfalls: [
      'A pointer that worked against the inline preview may not exist in the artifact when filters or fields reshaped that preview',
      'Artifact handles do not survive an MCP server restart even inside the 24 hour window',
      'Treating one page as the full result: check responseMeta before summarising',
      'Using snake_case arguments or pageSize above 100; both fail schema validation',
      'Artifacts and v3 cursors are scoped to the caller that created them; older contract cursors are rejected'
    ],
    relatedTools: ['n8n_executions', 'n8n_get_workflow']
  }
};
