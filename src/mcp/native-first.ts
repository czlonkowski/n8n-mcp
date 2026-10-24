/**
 * Node-selection guidance shared by the MCP initialize `instructions` and the
 * tools_documentation overview, so both say the same thing.
 */

/** Pick the first step that does the job. */
export const NODE_SELECTION_STEPS: readonly string[] = [
  "The service's own node (Slack, Google Sheets, Postgres, ...). Use HTTP Request only when no node covers the operation.",
  'A native node for the job: Edit Fields (Set), Filter, IF, Switch, Merge, Aggregate, Summarize, Remove Duplicates, Sort, Limit, Split Out, Date & Time, Compare Datasets.',
  'A short expression in that node\'s field; see tools_documentation({topic: "expression_helpers"}).',
  'A Code node, only for: loops or recursion that per-item execution and Loop Over Items cannot express, state across runs, parsing no node handles, external libraries, heavy all-items work on queue-mode workers, or one short Code node that replaces four or more glue nodes.',
];

export const CODE_IN_EXPRESSIONS_RULE =
  'An expression with a function body or several statements counts as code: use a Code node for it, not a long expression.';

const NUMBERED_STEPS = NODE_SELECTION_STEPS.map((step, index) => `${index + 1}. ${step}`);

export const SERVER_INSTRUCTIONS = [
  'n8n-mcp provides n8n node documentation, validation and workflow management tools. tools_documentation() gives the overview.',
  'Choose nodes native first, taking the first option that does the job:',
  ...NUMBERED_STEPS,
  CODE_IN_EXPRESSIONS_RULE,
  'Call get_node with detail "standard" before configuring a node: its options list many settings that make a Code node unnecessary.',
].join('\n');

/** Markdown section for the tools_documentation overview. */
export function renderNodeSelectionSection(): string {
  return `## Choosing Nodes (native first)
Take the first option that does the job:
${NUMBERED_STEPS.join('\n')}

${CODE_IN_EXPRESSIONS_RULE}
When a Code node is the right choice, read tools_documentation({topic: "javascript_code_node_guide"}) or tools_documentation({topic: "python_code_node_guide"}) first.`;
}
