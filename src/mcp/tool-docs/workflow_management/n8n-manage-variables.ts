import { ToolDocumentation } from '../types';

export const n8nManageVariablesDoc: ToolDocumentation = {
  name: 'n8n_manage_variables',
  category: 'workflow_management',
  essentials: {
    description: 'Manage n8n instance variables ({{ $vars.KEY }} in expressions): list, get, create, update, delete. Needs an n8n license that includes Variables.',
    keyParameters: ['action', 'id', 'key', 'value', 'projectId'],
    example: 'n8n_manage_variables({action: "create", key: "API_BASE_URL", value: "https://api.example.com"})',
    performance: 'Fast (100-500ms); get, create and partial updates also read the variable list',
    tips: [
      'Workflows read variables as {{ $vars.KEY }} - they are read-only at runtime',
      "Keys are unique per scope: global (the default) or one project. Pass projectId to scope a variable to a project, 'global' to target globals only. A project variable is visible only to workflows in that project",
      'Values are strings of up to 1000 characters, readable by every instance user (global variables) or every project member (project variables) - store secrets in credentials instead',
      'Variables need a license with the Variables feature (not the free Community edition) and an API key with variable:* scopes; otherwise every action returns 403. Operators hide the tool with DISABLE_ENTERPRISE_TOOLS=true',
      'update needs only the fields that change; the tool fills in the rest from the current variable',
    ]
  },
  full: {
    description: `**Actions:**
- **list**: Page through the variables the API key can see (up to 250 per page, default 100). Filter by projectId ('global' = global variables only) and state ('empty' = variables with an empty value). Continue with cursor.
- **get**: One variable by id or by key (with both, the variable must match both). The same key can exist once globally and once per project; when a key matches several, the call fails and lists them - pass projectId or the id.
- **create**: New variable. Global unless projectId names a project. Returns the new variable with its id.
- **update**: Change key, value or scope. projectId null or 'global' moves the variable to the global scope; omitting projectId keeps its scope. An empty value counts as omitted; pass clearValue: true to empty it.
- **delete**: Remove a variable. Expressions that read it resolve to undefined afterwards.

**How the n8n API shapes this tool:** n8n has no route that reads one variable, and its create and update routes return no body. get reads the list and filters it; create reads the list once more to return the new id; update reads the list when key or value is omitted, because n8n's update replaces the whole variable and requires both.`,
    parameters: {
      action: { type: 'string', required: true, description: 'list | get | create | update | delete' },
      id: { type: 'string', required: false, description: 'Variable ID (required for update and delete; for get, alternative to key)' },
      key: { type: 'string', required: false, description: 'For create (required) and update: letters, digits and underscores, not starting with a digit, max 50 characters. For get: look up by key.' },
      value: { type: 'string', required: false, description: 'For create (required) and update: string value, max 1000 characters. On update an empty string counts as omitted.' },
      clearValue: { type: 'boolean', required: false, description: 'For update: set the value to an empty string (value: "" cannot, see pitfalls)' },
      projectId: { type: 'string|null', required: false, description: "Scope. create: project ID, or omit/'global' for a global variable. update: target project, or null/'global' to make it global; omit to keep it. list/get: filter to one project, or 'global' for globals only." },
      state: { type: 'string', required: false, description: "For list: 'empty' returns only variables with an empty value" },
      limit: { type: 'number', required: false, description: 'For list: page size, 1-250 (default 100)' },
      cursor: { type: 'string', required: false, description: "For list: the previous response's nextCursor" },
    },
    returns: `Depends on action:
- list: {variables: [{id, key, value, type, project}], returned, nextCursor?} - project is null for global variables, {id, name} otherwise
- get: {id, key, value, type, project}. A key search without projectId that stops at the 10,000-variable cap fails with INCOMPLETE_SEARCH
- create: {id, key, value, type, project} (or {key, value, project} with a note if the id could not be read back)
- update: {id, key, value, project?}
- delete: {id, deleted: true}`,
    examples: [
      '// List all variables\nn8n_manage_variables({action: "list"})',
      '// Only global variables\nn8n_manage_variables({action: "list", projectId: "global"})',
      '// Variables with an empty value\nn8n_manage_variables({action: "list", state: "empty"})',
      '// Read one by key\nn8n_manage_variables({action: "get", key: "API_BASE_URL"})',
      '// Create a global variable\nn8n_manage_variables({action: "create", key: "API_BASE_URL", value: "https://api.example.com"})',
      '// Create a project-scoped variable\nn8n_manage_variables({action: "create", key: "SLACK_CHANNEL", value: "#alerts", projectId: "VmwOO9HeTEj20kxM"})',
      '// Change only the value\nn8n_manage_variables({action: "update", id: "abc123", value: "https://staging.example.com"})',
      '// Empty the value\nn8n_manage_variables({action: "update", id: "abc123", clearValue: true})',
      '// Make a project variable global\nn8n_manage_variables({action: "update", id: "abc123", projectId: null})',
      '// Delete\nn8n_manage_variables({action: "delete", id: "abc123"})',
      '// Use it in a node parameter\n// url: "={{ $vars.API_BASE_URL }}/users"',
    ],
    useCases: [
      'Keep environment-specific settings (base URLs, channel names, thresholds) out of workflow JSON so the same workflow runs on staging and production',
      'Check which variables a workflow expects before deploying it to another instance',
      'Find variables with empty values after an environment promotion',
    ],
    performance: 'list is one API call. get, create and update without both key and value add a full list read (n8n holds variables in memory, so this stays fast up to thousands of variables).',
    errorHandling: `- 403: the instance license has no Variables feature (the free Community edition does not), the API key lacks variable:* scopes, or the key has no access to the variable's project
- 404 or NOT_FOUND: unknown variable id; on n8n versions without the variables API the route itself is missing. n8n answers delete of an unknown id with 403, so the tool looks the id up and reports NOT_FOUND when no visible variable has it
- 400 "already exists": the key is taken in that scope - update the existing variable instead
- "Variables limit reached": the license caps the number of variables
- Invalid key or a value over 1000 characters fails locally before any API call; the error names the field and the rule ("Invalid input - key: ...")`,
    bestPractices: [
      'Use UPPER_SNAKE_CASE keys - they read clearly in {{ $vars.KEY }} expressions',
      'List before creating: keys must be unique per scope',
      'Keep secrets in credentials: variable values are readable by everyone in their scope and appear in workflow expressions',
    ],
    pitfalls: [
      'Variables are read-only inside workflows - a Code or Set node cannot change them; only this API (or the UI) can',
      'An empty value on update is ignored, because some MCP clients send empty strings for every unset field. To make a value empty, pass clearValue: true',
      'Renaming a key breaks every expression that uses the old {{ $vars.OLD_KEY }}',
      'n8n has no conditional update. An update that omits key or value fills it from a read just before the write, so a concurrent change to the other field can be overwritten; pass both key and value when several clients edit the same variable',
    ],
    relatedTools: ['n8n_list_catalog', 'n8n_update_partial_workflow', 'n8n_manage_credentials'],
  },
};
