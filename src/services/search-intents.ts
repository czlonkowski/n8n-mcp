/**
 * Generic data-shaping intents for search_nodes.
 *
 * FTS5 ranks by bm25 over node names and descriptions without stemming, so a
 * query that describes an operation ("group by", "flatten array", "deduplicate")
 * often misses the core node that performs it, or ranks a short community node
 * description above it. This table maps explicit phrases to the core nodes that
 * do the job, and search_nodes moves those nodes to the top of the results.
 *
 * Matching is on the whole query after normalization: lowercase, collapsed
 * whitespace, trailing punctuation removed and question/function words dropped.
 * A query with any other content word (a service name, an object such as
 * "contacts") does not match, so "hubspot deduplicate contacts" keeps its
 * normal ranking. Add variants as explicit phrases rather than loosening the
 * matcher.
 *
 * Scope: generic data-shaping operations only. No service names, and no Code
 * node as a target.
 */

export interface SearchIntent {
  /** Stable identifier, used in tests and debug output */
  id: string;
  /** Core node types in the order they should be listed (DB form: nodes-base.xxx) */
  nodeTypes: readonly string[];
  /** Phrases that trigger the intent; matched after normalizeIntentQuery() */
  phrases: readonly string[];
}

export const SEARCH_INTENTS: readonly SearchIntent[] = [
  {
    id: 'remove-duplicates',
    nodeTypes: ['nodes-base.removeDuplicates'],
    phrases: [
      'deduplicate', 'dedupe', 'dedup', 'deduplication', 'duplicates',
      'deduplicate items', 'dedupe items', 'deduplicate rows', 'dedupe rows',
      'deduplicate list', 'dedupe list', 'deduplicate data', 'dedupe data',
      'remove duplicates', 'remove duplicate', 'remove duplicate items', 'remove duplicate rows',
      'remove duplicate entries', 'remove duplicates from list', 'delete duplicates', 'drop duplicates',
      'find duplicates', 'skip duplicates', 'ignore duplicates',
      'unique items', 'unique values', 'unique rows', 'distinct', 'distinct values', 'distinct items'
    ]
  },
  {
    id: 'summarize',
    nodeTypes: ['nodes-base.summarize'],
    phrases: [
      'group by', 'group items', 'group data', 'group rows', 'group by field',
      'group and sum', 'group and count', 'group and aggregate',
      'sum', 'sum values', 'sum items', 'sum field', 'sum by', 'sum up values',
      'count by', 'count items', 'count values', 'count per group',
      'totals', 'calculate totals', 'calculate total', 'total by',
      'average', 'average by', 'average values', 'calculate average',
      'min max', 'pivot', 'pivot table', 'summarise', 'summarize data', 'summarise data'
    ]
  },
  {
    id: 'split-out',
    nodeTypes: ['nodes-base.splitOut'],
    phrases: [
      'flatten', 'flatten array', 'flatten list', 'flatten items', 'flatten data',
      'split array', 'split list', 'split out', 'split into items', 'split into separate items',
      'split array into items', 'split list into items', 'array into items', 'list into items',
      'unnest', 'unnest array', 'unwind', 'unwind array', 'explode array', 'one item per element'
    ]
  },
  {
    id: 'aggregate',
    nodeTypes: ['nodes-base.aggregate'],
    phrases: [
      'combine into list', 'combine into array', 'combine items', 'combine items into list',
      'combine items into array', 'combine items into one', 'combine into one item',
      'collect into array', 'collect into list', 'collect items', 'collect values',
      'aggregate items', 'aggregate into list', 'merge items into one', 'merge items into one item',
      'items into list', 'items into array', 'items into one item', 'gather items'
    ]
  },
  {
    id: 'rename-fields',
    nodeTypes: ['nodes-base.set', 'nodes-base.renameKeys'],
    phrases: [
      'rename', 'rename keys', 'rename key', 'rename fields', 'rename field',
      'rename columns', 'rename column', 'rename properties', 'rename property', 'change field names'
    ]
  },
  {
    id: 'set-fields',
    nodeTypes: ['nodes-base.set'],
    phrases: [
      'add field', 'add fields', 'add property', 'add value', 'create field', 'new field',
      'set field', 'set fields', 'set value', 'set values', 'set variable', 'set property',
      'edit field', 'edit fields', 'change field', 'change fields', 'change value', 'update field', 'update fields',
      'map fields', 'map data', 'map values', 'field mapping', 'data mapping',
      'transform data', 'transform json', 'transform fields', 'reshape data', 'modify data', 'modify fields',
      'remove field', 'remove fields', 'drop fields', 'keep only fields', 'select fields'
    ]
  },
  {
    id: 'compare-datasets',
    nodeTypes: ['nodes-base.compareDatasets'],
    phrases: [
      'compare', 'compare lists', 'compare two lists', 'compare datasets', 'compare two datasets',
      'compare data', 'compare arrays', 'compare items', 'compare inputs', 'compare two inputs',
      'diff', 'diff lists', 'diff data', 'find differences', 'find changes', 'sync lists'
    ]
  },
  {
    id: 'merge',
    nodeTypes: ['nodes-base.merge'],
    phrases: [
      'join', 'join lists', 'join two lists', 'join data', 'join datasets', 'join items', 'join inputs',
      'join by key', 'join by field', 'inner join', 'left join', 'outer join',
      'merge lists', 'merge two lists', 'merge data', 'merge datasets', 'merge inputs', 'merge two inputs',
      'merge by key', 'merge by field',
      'combine data', 'combine lists', 'combine two lists', 'combine inputs', 'combine two inputs', 'combine datasets'
    ]
  },
  {
    id: 'sort',
    nodeTypes: ['nodes-base.sort'],
    phrases: [
      'sort', 'sort items', 'sort list', 'sort array', 'sort data', 'sort rows',
      'sort by', 'sort by field', 'sort by date', 'sort ascending', 'sort descending',
      'order by', 'order items', 'reorder items'
    ]
  },
  {
    id: 'filter',
    nodeTypes: ['nodes-base.filter'],
    phrases: [
      'filter', 'filter items', 'filter list', 'filter array', 'filter data', 'filter rows',
      'filter out items', 'filter by condition', 'filter by field',
      'keep matching items', 'keep only matching items', 'remove items', 'drop items',
      'exclude items', 'remove empty items'
    ]
  },
  {
    id: 'date-time',
    nodeTypes: ['nodes-base.dateTime'],
    phrases: [
      'format date', 'format dates', 'date format', 'change date format', 'format time', 'format datetime',
      'parse date', 'parse datetime', 'convert date', 'date conversion',
      'add days', 'subtract days', 'add hours', 'date math', 'calculate date', 'date difference',
      'convert timezone', 'timezone conversion'
    ]
  },
  {
    id: 'limit',
    nodeTypes: ['nodes-base.limit'],
    phrases: [
      'limit items', 'limit results', 'first n items', 'first items', 'take first', 'take first n',
      'keep first items', 'keep first n items', 'top n items', 'max items', 'last n items', 'take last'
    ]
  }
];

/** Question and function words dropped before matching */
const STOP_WORDS = new Set([
  'how', 'to', 'do', 'i', 'can', 'need', 'want', 'the', 'a', 'an', 'my', 'in', 'n8n', 'node', 'nodes'
]);

const TRAILING_PUNCTUATION = new Set(['?', '!', '.', ',', ';', ':']);

/** Remove trailing punctuation with a scan; a regex anchored at $ is quadratic on long runs. */
function trimTrailingPunctuation(text: string): string {
  let end = text.length;
  while (end > 0 && TRAILING_PUNCTUATION.has(text[end - 1])) end--;
  return text.slice(0, end);
}

/**
 * Lowercase, trim, drop trailing punctuation, collapse whitespace and remove
 * question/function words. Content words are kept as they are.
 */
export function normalizeIntentQuery(query: string): string {
  return trimTrailingPunctuation(query.toLowerCase().trim())
    .split(/\s+/)
    .filter(word => word.length > 0 && !STOP_WORDS.has(word))
    .join(' ');
}

const INTENT_BY_PHRASE: ReadonlyMap<string, SearchIntent> = (() => {
  const map = new Map<string, SearchIntent>();
  for (const intent of SEARCH_INTENTS) {
    for (const phrase of intent.phrases) {
      map.set(normalizeIntentQuery(phrase), intent);
    }
  }
  return map;
})();

/**
 * Return the intent whose phrase equals the normalized query, or undefined.
 * Costs one normalization and one map lookup.
 */
export function matchSearchIntent(query: string): SearchIntent | undefined {
  const normalized = normalizeIntentQuery(query);
  return normalized ? INTENT_BY_PHRASE.get(normalized) : undefined;
}
