import { ToolDocumentation } from '../types';

export const n8nManageDatatableDoc: ToolDocumentation = {
  name: 'n8n_manage_datatable',
  category: 'workflow_management',
  essentials: {
    description: 'Manage n8n data tables, rows and columns. Unified tool for table CRUD, row operations with filtering, pagination and dry-run support, plus column changes on an existing table.',
    keyParameters: ['action', 'tableId', 'name', 'columns', 'data', 'filter', 'column', 'columnId'],
    example: 'n8n_manage_datatable({action: "createTable", name: "Contacts", columns: [{name: "email", type: "string"}]})',
    performance: 'Fast (100-500ms)',
    tips: [
      'Table actions: createTable, listTables, getTable, updateTable (rename only), deleteTable',
      'Row actions: getRows, insertRows, updateRows, upsertRows, deleteRows',
      'Column actions: addColumn, deleteColumn, renameColumn - these need N8N_MCP_ACCESS_TOKEN (n8n 2.34+)',
      'Use dryRun: true to preview update/upsert/delete before applying',
      'Filter supports: eq, neq, like, ilike, gt, gte, lt, lte conditions',
      'Use returnData: true to get affected rows back from update/upsert/delete',
      'Requires N8N_API_URL and N8N_API_KEY configured; the column actions additionally need N8N_MCP_ACCESS_TOKEN'
    ]
  },
  full: {
    description: `**Table Actions:**
- **createTable**: Create a new data table with one or more typed columns (columns are required)
- **listTables**: List all data tables (paginated)
- **getTable**: Get table details and column definitions by ID
- **updateTable**: Rename an existing table (name only — see the column actions below to change columns)
- **deleteTable**: Permanently delete a table and all its rows

**Row Actions:**
- **getRows**: List rows with filtering, sorting, search, and pagination
- **insertRows**: Insert one or more rows (bulk)
- **updateRows**: Update rows matching a filter condition
- **upsertRows**: Update matching row or insert if none match
- **deleteRows**: Delete rows matching a filter condition (filter required)

**Column Actions** (routed to n8n's own MCP server - need N8N_MCP_ACCESS_TOKEN and n8n 2.34+):
- **addColumn**: Add a typed column to an existing table
- **deleteColumn**: Remove a column and its values (columnId from getTable)
- **renameColumn**: Rename an existing column

Column names must start with a letter, contain only letters, digits and underscores, and be at most 63 characters; the type is one of string, number, boolean, date. Renaming a TABLE is not a column action - use updateTable, which goes through the public API.

**projectId for column actions:** the official server addresses a table by project. When the instance has exactly one accessible project, it is used automatically; when several are accessible the call returns PROJECT_REQUIRED and lists the candidates, and when none can be resolved it returns PROJECT_REQUIRED asking for an explicit projectId. Pass projectId to skip resolution entirely (list them with n8n_list_catalog({kind: "projects"})).

**Filter System:** Used in getRows, updateRows, upsertRows, deleteRows
- Combine conditions with "and" (default) or "or"
- Conditions: eq, neq, like, ilike, gt, gte, lt, lte
- Example: {type: "and", filters: [{columnName: "status", condition: "eq", value: "active"}]}

**Dry Run:** updateRows, upsertRows, and deleteRows support dryRun: true to preview changes without applying them.`,
    parameters: {
      action: { type: 'string', required: true, description: 'Operation to perform' },
      tableId: { type: 'string', required: false, description: 'Data table ID (required for all except createTable and listTables)' },
      name: { type: 'string', required: false, description: 'For createTable/updateTable: table name' },
      columns: { type: 'array', required: false, description: 'For createTable (required, at least one): column definitions [{name, type?}]. Types: string, number, boolean, date' },
      data: { type: 'array|object', required: false, description: 'For insertRows: array of row objects. For updateRows/upsertRows: object with column values' },
      filter: { type: 'object', required: false, description: 'Filter: {type?: "and"|"or", filters: [{columnName, condition, value}]}' },
      limit: { type: 'number', required: false, description: 'For listTables/getRows: max results (1-100)' },
      cursor: { type: 'string', required: false, description: 'For listTables/getRows: pagination cursor' },
      sortBy: { type: 'string', required: false, description: 'For getRows: "columnName:asc" or "columnName:desc"' },
      search: { type: 'string', required: false, description: 'For getRows: full-text search across string columns' },
      returnType: { type: 'string', required: false, description: 'For insertRows: "count" (default), "id", or "all"' },
      returnData: { type: 'boolean', required: false, description: 'For updateRows/upsertRows/deleteRows: return affected rows (default: false)' },
      dryRun: { type: 'boolean', required: false, description: 'For updateRows/upsertRows/deleteRows: preview without applying (default: false)' },
      projectId: { type: 'string', required: false, description: 'For createTable: project to create the table in. For the column actions: project owning the table - auto-resolved when exactly one project is accessible' },
      column: { type: 'object', required: false, description: 'For addColumn: {name, type} - name must match ^[a-zA-Z][a-zA-Z0-9_]*$ and be at most 63 characters; type is string, number, boolean or date' },
      columnId: { type: 'string', required: false, description: 'For deleteColumn/renameColumn: ID of the column (read it from getTable)' },
      timeoutMs: { type: 'integer', required: false, description: 'For the column actions: client timeout in ms (5000-600000, default 30000)' },
    },
    returns: `Depends on action:
- createTable: {id, name}
- listTables: {tables, count, nextCursor?}
- getTable: Full table object with columns
- updateTable: Updated table object
- deleteTable: Success message
- getRows: {rows, count, nextCursor?}
- insertRows: Depends on returnType (count/ids/rows)
- updateRows: Update result with optional rows
- upsertRows: Upsert result with action type
- deleteRows: Delete result with optional rows
- addColumn/deleteColumn/renameColumn: {success, action, backend: "official-mcp", data} - data is n8n's own answer ({success, message, column?})`,
    examples: [
      '// Create a table\nn8n_manage_datatable({action: "createTable", name: "Contacts", columns: [{name: "email", type: "string"}, {name: "score", type: "number"}]})',
      '// List all tables\nn8n_manage_datatable({action: "listTables"})',
      '// Get table details\nn8n_manage_datatable({action: "getTable", tableId: "dt-123"})',
      '// Rename a table\nn8n_manage_datatable({action: "updateTable", tableId: "dt-123", name: "New Name"})',
      '// Delete a table\nn8n_manage_datatable({action: "deleteTable", tableId: "dt-123"})',
      '// Get rows with filter\nn8n_manage_datatable({action: "getRows", tableId: "dt-123", filter: {filters: [{columnName: "status", condition: "eq", value: "active"}]}, limit: 50})',
      '// Search rows\nn8n_manage_datatable({action: "getRows", tableId: "dt-123", search: "john", sortBy: "name:asc"})',
      '// Insert rows\nn8n_manage_datatable({action: "insertRows", tableId: "dt-123", data: [{email: "a@b.com", score: 10}], returnType: "all"})',
      '// Update rows (dry run)\nn8n_manage_datatable({action: "updateRows", tableId: "dt-123", filter: {filters: [{columnName: "score", condition: "lt", value: 5}]}, data: {status: "inactive"}, dryRun: true})',
      '// Upsert a row\nn8n_manage_datatable({action: "upsertRows", tableId: "dt-123", filter: {filters: [{columnName: "email", condition: "eq", value: "a@b.com"}]}, data: {score: 15}, returnData: true})',
      '// Delete rows\nn8n_manage_datatable({action: "deleteRows", tableId: "dt-123", filter: {filters: [{columnName: "status", condition: "eq", value: "deleted"}]}})',
      '// Add a column to an existing table\nn8n_manage_datatable({action: "addColumn", tableId: "dt-123", column: {name: "score", type: "number"}})',
      '// Rename a column (columnId from getTable)\nn8n_manage_datatable({action: "renameColumn", tableId: "dt-123", columnId: "col-7", name: "total_score"})',
      '// Delete a column on a multi-project instance\nn8n_manage_datatable({action: "deleteColumn", tableId: "dt-123", columnId: "col-7", projectId: "proj-1"})',
    ],
    useCases: [
      'Persist structured workflow data across executions',
      'Store and query lookup tables for workflow logic',
      'Bulk insert records from external data sources',
      'Conditionally update records matching criteria',
      'Upsert to maintain unique records by key column',
      'Clean up old or invalid rows with filtered delete',
      'Preview changes with dryRun before modifying data',
      'Adjust a table schema after creation (add, rename or drop a column)',
    ],
    performance: 'Table operations: 50-300ms. Row operations: 100-500ms depending on data size and filters.',
    bestPractices: [
      'Define column types upfront for schema consistency',
      'Use dryRun: true before bulk updates/deletes to verify filter correctness',
      'Use returnType: "count" (default) for insertRows to minimize response size',
      'Use filter with specific conditions to avoid unintended bulk operations',
      'Use cursor-based pagination for large result sets',
      'Use sortBy for deterministic row ordering',
      'Read columnId from getTable before deleteColumn or renameColumn',
      'Pass projectId for the column actions on instances with several projects',
    ],
    pitfalls: [
      'deleteTable permanently deletes all rows — cannot be undone',
      'deleteRows requires a filter — cannot delete all rows without one',
      'A column type cannot be changed after the column is created — drop and re-add the column instead',
      'updateTable only renames the table; use addColumn/deleteColumn/renameColumn to change columns',
      'The column actions are unavailable without N8N_MCP_ACCESS_TOKEN (NOT_CONFIGURED) or on n8n below 2.34 (OFFICIAL_MCP_TOOL_UNAVAILABLE)',
      'deleteColumn drops the column values along with the column',
    ],
    relatedTools: ['n8n_create_workflow', 'n8n_list_workflows', 'n8n_list_catalog', 'n8n_health_check'],
  },
};
