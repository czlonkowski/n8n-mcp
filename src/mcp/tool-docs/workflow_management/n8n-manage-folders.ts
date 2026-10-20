import { ToolDocumentation } from '../types';

export const n8nManageFoldersDoc: ToolDocumentation = {
  name: 'n8n_manage_folders',
  category: 'workflow_management',
  essentials: {
    description: 'Manage workflow folders (n8n 2.19+): create, list, get, rename, move, delete. Folder placement of workflows happens in the workflow tools (parentFolderId on create, moveToFolder diff operation), not here.',
    keyParameters: ['action', 'projectId', 'folderId', 'name', 'parentFolderId'],
    example: 'n8n_manage_folders({action: "create", name: "Production"})',
    performance: 'Fast (100-500ms); list with counts can be slower on very large projects',
    tips: [
      "projectId defaults to 'personal' (the calling user's personal project) - pass a real project ID on multi-project enterprise instances",
      'list returns workflowCount, subFolderCount and the path breadcrumb per folder',
      "Put workflows in folders via n8n_create_workflow's parentFolderId or n8n_update_partial_workflow's moveToFolder operation (both n8n 2.32+)",
      "n8n's API cannot report which folder a workflow is in - plan folder contents around counts, not membership lists",
      "delete without transferToFolderId ARCHIVES the folder's workflows - pass transferToFolderId ('0' = project root) to keep them active",
      'Folders need a licensed instance: they unlock on the registered free Community tier (Settings -> Usage and plan) and up, plus folder:* API key scopes',
    ]
  },
  full: {
    description: `**Actions:**
- **create**: Create a folder, optionally nested under parentFolderId. Accepts projectId 'personal' natively (n8n 2.32+; on 2.19-2.31 pass a real project ID).
- **list**: List folders in a project with workflow/sub-folder counts and path breadcrumbs. Filter by nameFilter (contains) and parentFolderId (direct children), sort, and paginate with skip/take.
- **get**: Folder details including recursive totals (totalSubFolders, totalWorkflows).
- **rename**: Change a folder's name.
- **move**: Re-parent a folder under another folder, or pass parentFolderId: null to move it to the project root.
- **delete**: Remove a folder. With transferToFolderId, contents move there first ('0' = project root). Without it, workflows move to the project root AND ARE ARCHIVED, and sub-folders are deleted.

**The 'personal' project alias:** n8n resolves it server-side only for folder creation. For every other action this tool resolves it itself: via the projects API when the instance licenses it, falling back to reading a workflow's owning project (Community instances have exactly one project). On an empty Community instance with no workflows, pass an explicit projectId or run create first.

**Workflow placement lives in the workflow tools** (n8n 2.32+): n8n_create_workflow accepts parentFolderId, and n8n_update_partial_workflow has a moveToFolder operation ({type: "moveToFolder", parentFolderId: "abc123"} or null for the project root). n8n's API treats a workflow's folder as write-only - it can be set but never read back, and workflow listings cannot filter by folder.`,
    parameters: {
      action: { type: 'string', required: true, description: 'create | list | get | rename | move | delete' },
      projectId: { type: 'string', required: false, description: "Project containing the folder(s). Default 'personal'." },
      folderId: { type: 'string', required: false, description: 'Folder ID (required for get, rename, move, delete)' },
      name: { type: 'string', required: false, description: 'For create: folder name (required). For rename: new name (required).' },
      parentFolderId: { type: 'string|null', required: false, description: 'For create: parent folder to nest under. For move: target parent, or null for the project root (required). For list: only direct children of this folder.' },
      transferToFolderId: { type: 'string', required: false, description: "For delete: receiving folder for the contents ('0' = project root). Omitting it archives the folder's workflows." },
      nameFilter: { type: 'string', required: false, description: 'For list: name contains-match filter' },
      sortBy: { type: 'string', required: false, description: 'For list: name|createdAt|updatedAt + :asc/:desc (default updatedAt:desc)' },
      skip: { type: 'number', required: false, description: 'For list: pagination offset (default 0)' },
      take: { type: 'number', required: false, description: 'For list: page size (default 50, max 100)' },
    },
    returns: `Depends on action:
- create: {id, name, parentFolderId}
- list: {folders: [{id, name, createdAt, updatedAt, parentFolder, workflowCount, subFolderCount, path}], count, projectId} - count is the total matching the query, not the page size
- get: folder object with totalSubFolders and totalWorkflows (recursive), plus the resolved projectId
- rename: {id, name}
- move: {id, name, parentFolderId}
- delete: {id, deleted: true}`,
    examples: [
      '// Create a top-level folder in the personal project\nn8n_manage_folders({action: "create", name: "Production"})',
      '// Create a nested folder\nn8n_manage_folders({action: "create", name: "Webhooks", parentFolderId: "abc123"})',
      '// List folders with counts\nn8n_manage_folders({action: "list"})',
      '// List sub-folders of one folder\nn8n_manage_folders({action: "list", parentFolderId: "abc123"})',
      '// Folder details with recursive totals\nn8n_manage_folders({action: "get", folderId: "abc123"})',
      '// Rename\nn8n_manage_folders({action: "rename", folderId: "abc123", name: "Staging"})',
      '// Move under another folder\nn8n_manage_folders({action: "move", folderId: "abc123", parentFolderId: "def456"})',
      '// Move to the project root\nn8n_manage_folders({action: "move", folderId: "abc123", parentFolderId: null})',
      '// Delete, transferring contents to the project root (keeps workflows active)\nn8n_manage_folders({action: "delete", folderId: "abc123", transferToFolderId: "0"})',
      '// Then place a workflow in a folder at creation\nn8n_create_workflow({name: "My flow", nodes: [...], connections: {...}, parentFolderId: "abc123"})',
      '// Or move an existing workflow there\nn8n_update_partial_workflow({id: "wf1", operations: [{type: "moveToFolder", parentFolderId: "abc123"}]})',
    ],
    useCases: [
      'Organize a grown instance: create per-environment or per-team folders and move workflows into them',
      'Set up folder structure before deploying a batch of related workflows',
      'Clean up: find empty folders via workflowCount/subFolderCount and delete them',
      'Restructure nested folder trees without touching the workflows inside',
    ],
    performance: 'Each action is a single API call (except non-create actions with the default personal project, which add one resolution call the first time per session). List counts are computed server-side.',
    errorHandling: `- 403: the API key lacks folder:* scopes, or the instance license has no feat:folders - folders unlock on the registered free Community tier and up
- 404: project or folder not found; on n8n < 2.19 the folders API does not exist at all
- 400: invalid payload (e.g. moving a folder under its own descendant - n8n rejects circular nesting)
- Workflow placement (parentFolderId on workflow writes) on n8n < 2.32 fails with a 400 naming parentFolderId; the workflow tools append an upgrade hint`,
    bestPractices: [
      'Use list first to discover existing structure before creating folders - names are not unique, so duplicates are easy to create',
      "Prefer delete with transferToFolderId ('0' for the root) unless archiving the contents is intended",
      'On enterprise instances pass explicit projectId values rather than relying on the personal default',
    ],
    pitfalls: [
      "A workflow's folder cannot be read back through the API - do not build logic that needs to query folder membership",
      "delete without transferToFolderId archives the folder's workflows, which deactivates them",
      'Folder names are not unique within a project or even within a parent folder',
      'On n8n 2.19-2.31, folder CRUD works but workflows cannot be placed into folders via the API (that needs 2.32+)',
    ],
    relatedTools: ['n8n_create_workflow', 'n8n_update_partial_workflow', 'n8n_update_full_workflow', 'n8n_list_workflows'],
  },
};
