import { ToolDocumentation } from '../types';

export const n8nManageDatatableDoc: ToolDocumentation = {
  name: 'n8n_manage_datatable',
  category: 'workflow_management',
  essentials: {
    description: 'Manage n8n data tables and rows. Unified tool for table CRUD and row operations with filtering, pagination, and dry-run support.',
    keyParameters: ['action', 'tableId', 'name', 'data', 'filter'],
    example: 'n8n_manage_datatable({action: "createTable", name: "Contacts", columns: [{name: "email", type: "string"}]})',
    performance: 'Fast (100-500ms)',
    tips: [
      'Table actions: createTable, listTables, getTable, updateTable, deleteTable',
      'Row actions: getRows, insertRows, updateRows, upsertRows, deleteRows',
      'Use dryRun: true to preview update/upsert/delete before applying',
      'Filter supports: eq, neq, like, ilike, gt, gte, lt, lte conditions',
      'Use returnData: true to get affected rows back from update/upsert/delete',
      'Requires n8n enterprise or cloud with data tables feature'
    ]
  },
  full: {
    description: `**Table Actions:**
- **createTable**: Create a new data table with optional typed columns
- **listTables**: List all data tables (paginated)
- **getTable**: Get table details and column definitions by ID
- **updateTable**: Rename an existing table
- **deleteTable**: Permanently delete a table and all its rows

**Row Actions:**
- **getRows**: List rows with filtering, sorting, search, and pagination
- **insertRows**: Insert one or more rows (bulk)
- **updateRows**: Update rows matching a filter condition
- **upsertRows**: Update matching row or insert if none match
- **deleteRows**: Delete rows matching a filter condition (filter required)

**Filter System:** Used in getRows, updateRows, upsertRows, deleteRows
- Combine conditions with "and" (default) or "or"
- Conditions: eq, neq, like, ilike, gt, gte, lt, lte
- Example: {type: "and", filters: [{columnName: "status", condition: "eq", value: "active"}]}

**Dry Run:** updateRows, upsertRows, and deleteRows support dryRun: true to preview changes without applying them.`,
    parameters: {
      action: { type: 'string', required: true, description: 'Operation to perform' },
      tableId: { type: 'string', required: false, description: 'Data table ID (required for all except createTable and listTables)' },
      name: { type: 'string', required: false, description: 'For createTable/updateTable: table name' },
      columns: { type: 'array', required: false, description: 'For createTable: column definitions [{name, type?}]. Types: string, number, boolean, date, json' },
      data: { type: 'array|object', required: false, description: 'For insertRows: array of row objects. For updateRows/upsertRows: object with column values' },
      filter: { type: 'object', required: false, description: 'Filter: {type?: "and"|"or", filters: [{columnName, condition, value}]}' },
      limit: { type: 'number', required: false, description: 'For listTables/getRows: max results (1-100)' },
      cursor: { type: 'string', required: false, description: 'For listTables/getRows: pagination cursor' },
      sortBy: { type: 'string', required: false, description: 'For getRows: "columnName:asc" or "columnName:desc"' },
      search: { type: 'string', required: false, description: 'For getRows: full-text search across string columns' },
      returnType: { type: 'string', required: false, description: 'For insertRows: "count" (default), "id", or "all"' },
      returnData: { type: 'boolean', required: false, description: 'For updateRows/upsertRows/deleteRows: return affected rows (default: false)' },
      dryRun: { type: 'boolean', required: false, description: 'For updateRows/upsertRows/deleteRows: preview without applying (default: false)' },
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
- deleteRows: Delete result with optional rows`,
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
    ],
    useCases: [
      'Persist structured workflow data across executions',
      'Store and query lookup tables for workflow logic',
      'Bulk insert records from external data sources',
      'Conditionally update records matching criteria',
      'Upsert to maintain unique records by key column',
      'Clean up old or invalid rows with filtered delete',
      'Preview changes with dryRun before modifying data',
    ],
    performance: 'Table operations: 50-300ms. Row operations: 100-500ms depending on data size and filters.',
    bestPractices: [
      'Define column types upfront for schema consistency',
      'Use dryRun: true before bulk updates/deletes to verify filter correctness',
      'Use returnType: "count" (default) for insertRows to minimize response size',
      'Use filter with specific conditions to avoid unintended bulk operations',
      'Use cursor-based pagination for large result sets',
      'Use sortBy for deterministic row ordering',
    ],
    pitfalls: [
      'Requires N8N_API_URL and N8N_API_KEY configured',
      'Feature only available on n8n enterprise or cloud plans',
      'deleteTable permanently deletes all rows — cannot be undone',
      'deleteRows requires a filter — cannot delete all rows without one',
      'Column types cannot be changed after table creation via API',
      'updateTable can only rename the table (no column modifications via public API)',
      'projectId cannot be set via the public API — use the n8n UI',
    ],
    relatedTools: ['n8n_create_workflow', 'n8n_list_workflows', 'n8n_health_check'],
  },
};
