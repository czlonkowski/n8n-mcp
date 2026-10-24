/**
 * Reference for the helper methods n8n adds to values inside `{{ }}` expressions
 * (n8n-workflow's expression extensions). Served by
 * tools_documentation({topic: "expression_helpers"}).
 *
 * Every helper listed here must exist in n8n-workflow's ExpressionExtensions, and
 * every example must return the stated output; a unit test runs them against the
 * bundled n8n-workflow so the reference fails loudly when n8n changes.
 */

export type HelperType = 'Array' | 'String' | 'Object' | 'Number' | 'Date';

export interface HelperExample {
  /** Value the helper is called on. Date examples use an ISO string, parsed to a DateTime. */
  input: unknown;
  args?: unknown[];
  output: unknown;
}

export interface ExpressionHelper {
  type: HelperType;
  name: string;
  /** Call signature as written in an expression, e.g. `pluck(field, ...)`. */
  call: string;
  summary: string;
  example?: HelperExample;
}

export const EXPRESSION_HELPERS: ExpressionHelper[] = [
  // Arrays
  { type: 'Array', name: 'pluck', call: 'pluck(field, ...)', summary: 'Values of a field from each object; several fields give sub-arrays', example: { input: [{ price: 5 }, { price: 7 }], args: ['price'], output: [5, 7] } },
  { type: 'Array', name: 'sum', call: 'sum()', summary: 'Sum of numbers (throws if any element is not a number, numeric strings included)', example: { input: [1, 2, 3.5], output: 6.5 } },
  { type: 'Array', name: 'average', call: 'average()', summary: 'Mean of numbers', example: { input: [2, 4], output: 3 } },
  { type: 'Array', name: 'min', call: 'min()', summary: 'Smallest number', example: { input: [4, 2, 9], output: 2 } },
  { type: 'Array', name: 'max', call: 'max()', summary: 'Largest number', example: { input: [4, 2, 9], output: 9 } },
  { type: 'Array', name: 'unique', call: 'unique(field?, ...)', summary: 'Remove duplicates, optionally comparing only the given fields', example: { input: [{ id: 1, v: 'a' }, { id: 1, v: 'b' }], args: ['id'], output: [{ id: 1, v: 'a' }] } },
  { type: 'Array', name: 'compact', call: 'compact()', summary: "Drop null, undefined, '' and empty objects", example: { input: [1, null, '', 2], output: [1, 2] } },
  { type: 'Array', name: 'chunk', call: 'chunk(size)', summary: 'Split into arrays of the given size', example: { input: [1, 2, 3, 4, 5], args: [2], output: [[1, 2], [3, 4], [5]] } },
  { type: 'Array', name: 'first', call: 'first()', summary: 'First element', example: { input: ['a', 'b'], output: 'a' } },
  { type: 'Array', name: 'last', call: 'last()', summary: 'Last element', example: { input: ['a', 'b'], output: 'b' } },
  { type: 'Array', name: 'union', call: 'union(other)', summary: 'Elements in either array, without duplicates', example: { input: [1, 2], args: [[2, 3]], output: [1, 2, 3] } },
  { type: 'Array', name: 'intersection', call: 'intersection(other)', summary: 'Elements in both arrays', example: { input: [1, 2, 3], args: [[2, 3, 4]], output: [2, 3] } },
  { type: 'Array', name: 'difference', call: 'difference(other)', summary: 'Elements not in the other array', example: { input: [1, 2, 3], args: [[2]], output: [1, 3] } },
  { type: 'Array', name: 'smartJoin', call: 'smartJoin(keyField, valueField)', summary: 'Turn [{key, value}] rows into one object', example: { input: [{ k: 'a', v: 1 }, { k: 'b', v: 2 }], args: ['k', 'v'], output: { a: 1, b: 2 } } },
  { type: 'Array', name: 'renameKeys', call: 'renameKeys(from, to, ...)', summary: 'Rename keys in each object (pairs of names)', example: { input: [{ a: 1 }], args: ['a', 'b'], output: [{ b: 1 }] } },
  { type: 'Array', name: 'isNotEmpty', call: 'isEmpty() / isNotEmpty()', summary: 'Length check', example: { input: [], output: false } },

  // Strings
  { type: 'String', name: 'extractEmail', call: 'extractEmail()', summary: 'First email address in the text', example: { input: 'Contact: anna@example.com today', output: 'anna@example.com' } },
  { type: 'String', name: 'extractDomain', call: 'extractDomain()', summary: 'Domain of a URL or email address', example: { input: 'anna@example.com', output: 'example.com' } },
  { type: 'String', name: 'extractUrl', call: 'extractUrl()', summary: 'First URL in the text', example: { input: 'see https://example.com/x now', output: 'https://example.com/x' } },
  { type: 'String', name: 'extractUrlPath', call: 'extractUrlPath()', summary: 'Path part of a URL', example: { input: 'https://example.com/a/b?q=1', output: '/a/b' } },
  { type: 'String', name: 'isEmail', call: 'isEmail() / isUrl() / isNumeric()', summary: 'Format checks (isUrl needs a protocol)', example: { input: 'anna@example.com', output: true } },
  { type: 'String', name: 'toTitleCase', call: 'toTitleCase()', summary: 'Title Case', example: { input: 'hello world', output: 'Hello World' } },
  { type: 'String', name: 'toSentenceCase', call: 'toSentenceCase()', summary: 'Sentence case', example: { input: 'HELLO world', output: 'Hello world' } },
  { type: 'String', name: 'toSnakeCase', call: 'toSnakeCase()', summary: 'snake_case', example: { input: 'Hello World', output: 'hello_world' } },
  { type: 'String', name: 'replaceSpecialChars', call: 'replaceSpecialChars()', summary: 'Transliterate accented characters to ASCII', example: { input: 'déjà vu', output: 'deja vu' } },
  { type: 'String', name: 'removeTags', call: 'removeTags()', summary: 'Strip HTML/XML tags', example: { input: '<b>hi</b>', output: 'hi' } },
  { type: 'String', name: 'removeMarkdown', call: 'removeMarkdown()', summary: 'Strip Markdown formatting', example: { input: '**bold**', output: 'bold' } },
  { type: 'String', name: 'base64Encode', call: 'base64Encode() / base64Decode()', summary: 'Base64', example: { input: 'hi', output: 'aGk=' } },
  { type: 'String', name: 'urlEncode', call: 'urlEncode() / urlDecode()', summary: 'Percent-encoding for URL parts', example: { input: 'a b&c', output: 'a%20b%26c' } },
  { type: 'String', name: 'hash', call: 'hash(algorithm?)', summary: 'md5 (default), sha1, sha224, sha256, sha384, sha512, sha3 or base64', example: { input: 'abc', args: ['sha256'], output: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad' } },
  { type: 'String', name: 'parseJson', call: 'parseJson()', summary: 'JSON.parse; throws on invalid JSON', example: { input: '{"a":1}', output: { a: 1 } } },
  { type: 'String', name: 'toNumber', call: 'toNumber()', summary: 'Parse a number; throws when the text is not numeric', example: { input: '1234.5', output: 1234.5 } },
  { type: 'String', name: 'toBoolean', call: 'toBoolean()', summary: '"false", "no", "0" and "" give false; anything else true', example: { input: 'no', output: false } },
  { type: 'String', name: 'toDateTime', call: 'toDateTime(format?)', summary: 'Parse ISO, RFC 2822, HTTP or SQL dates, or a Luxon format such as "dd.MM.yyyy"' },
  { type: 'String', name: 'quote', call: 'quote(mark?)', summary: 'Wrap in quotes and escape', example: { input: 'hi', output: '"hi"' } },

  // Objects
  { type: 'Object', name: 'hasField', call: 'hasField(name)', summary: 'Whether a top-level key exists', example: { input: { a: 1 }, args: ['a'], output: true } },
  { type: 'Object', name: 'removeField', call: 'removeField(name)', summary: 'Copy without that key', example: { input: { a: 1, b: 2 }, args: ['a'], output: { b: 2 } } },
  { type: 'Object', name: 'keepFieldsContaining', call: 'keepFieldsContaining(text)', summary: 'Keep only string fields containing the text', example: { input: { a: 'foo', b: 'bar' }, args: ['fo'], output: { a: 'foo' } } },
  { type: 'Object', name: 'removeFieldsContaining', call: 'removeFieldsContaining(text)', summary: 'Drop string fields containing the text', example: { input: { a: 'foo', b: 'bar' }, args: ['fo'], output: { b: 'bar' } } },
  { type: 'Object', name: 'compact', call: 'compact()', summary: "Drop null, undefined, '' and empty-object fields", example: { input: { a: null, b: '', c: 1 }, output: { c: 1 } } },
  { type: 'Object', name: 'keys', call: 'keys() / values()', summary: 'Object.keys / Object.values', example: { input: { a: 1, b: 2 }, output: ['a', 'b'] } },
  { type: 'Object', name: 'urlEncode', call: 'urlEncode()', summary: 'Query string from the fields', example: { input: { q: 'a b', n: 2 }, output: 'q=a+b&n=2' } },
  { type: 'Object', name: 'toJsonString', call: 'toJsonString()', summary: 'JSON.stringify', example: { input: { a: 1 }, output: '{"a":1}' } },

  // Numbers
  { type: 'Number', name: 'round', call: 'round(decimals?)', summary: 'Round to the given number of decimals', example: { input: 3.14159, args: [2], output: 3.14 } },
  { type: 'Number', name: 'floor', call: 'floor() / ceil() / abs()', summary: 'Rounding and absolute value', example: { input: 2.7, output: 2 } },
  { type: 'Number', name: 'format', call: 'format(locale?, options?)', summary: 'Intl.NumberFormat, e.g. currency', example: { input: 1234.5, args: ['en-US', { style: 'currency', currency: 'EUR' }], output: '€1,234.50' } },
  { type: 'Number', name: 'isEven', call: 'isEven() / isOdd() / isInteger()', summary: 'Number checks', example: { input: 4, output: true } },
  { type: 'Number', name: 'toDateTime', call: 'toDateTime(unit?)', summary: "Epoch number to DateTime; unit 'ms' (default), 's', 'us' or 'excel'" },

  // Dates: DateTime ($now, $today, '...'.toDateTime()) or Date
  { type: 'Date', name: 'format', call: 'format(luxonFormat)', summary: 'Format with Luxon tokens', example: { input: '2026-10-24T10:30:00Z', args: ['yyyy-MM-dd'], output: '2026-10-24' } },
  { type: 'Date', name: 'plus', call: 'plus(n, unit) / minus(n, unit)', summary: "Add or subtract time; unit e.g. 'days', 'hours', 'months'" },
  { type: 'Date', name: 'diffTo', call: 'diffTo(other, unit?)', summary: "Difference to another date in a unit ('days' default), or several units as an object", example: { input: '2026-10-24T10:00:00Z', args: ['2026-10-20T08:00:00Z', ['days', 'hours']], output: { days: 4, hours: 2 } } },
  { type: 'Date', name: 'diffToNow', call: 'diffToNow(unit?)', summary: 'Difference to now' },
  { type: 'Date', name: 'isBetween', call: 'isBetween(start, end)', summary: 'Whether the date lies between two dates; both bounds excluded', example: { input: '2026-10-15T00:00:00Z', args: ['2026-10-01T00:00:00Z', '2026-11-01T00:00:00Z'], output: true } },
  { type: 'Date', name: 'extract', call: 'extract(unit?)', summary: "Part of the date: 'year', 'month', 'week', 'day', 'hour', 'weekday', ...", example: { input: '2026-10-24T10:30:00Z', args: ['month'], output: 10 } },
];

/** Expression globals. Not extension methods, so they are documented without examples. */
export const EXPRESSION_GLOBALS: Array<{ call: string; summary: string }> = [
  { call: '$if(condition, valueIfTrue, valueIfFalse)', summary: 'Inline condition' },
  { call: '$ifEmpty(value, fallback)', summary: "Fallback when the value is undefined, null, '', [] or {}" },
  { call: "$jmespath(object, 'query')", summary: 'JMESPath query over JSON' },
  { call: '$min(a, b, ...) / $max(a, b, ...)', summary: 'Smallest / largest of the arguments (not an array)' },
  { call: '$now / $today', summary: 'Current time / start of today as Luxon DateTime, in the workflow time zone' },
  { call: "DateTime.fromISO('...')", summary: 'Luxon is available; its methods (startOf, endOf, setZone, toISO, toRelative) work too' },
];

/** Jobs across items belong in nodes: helpers only see the current item's values. */
const ACROSS_ITEMS: Array<[string, string]> = [
  ['Remove duplicate items', 'Remove Duplicates (also across executions)'],
  ['Group items and total, count or average', 'Summarize'],
  ['Collect many items into one list', 'Aggregate'],
  ['Turn a list field into separate items', 'Split Out'],
  ['Keep items that match a condition', 'Filter'],
  ['Order items / keep the first N', 'Sort / Limit'],
  ['Join two inputs by a key', 'Merge (Combine by matching fields)'],
  ['Find added, removed and changed records', 'Compare Datasets'],
  ['Format, shift or compare dates on many fields', 'Date & Time'],
];

const TYPE_TITLES: Record<HelperType, string> = {
  Array: 'Arrays',
  String: 'Strings',
  Object: 'Objects',
  Number: 'Numbers',
  Date: 'Dates (Luxon DateTime or Date; convert a string first with .toDateTime())',
};

const TYPES: HelperType[] = ['Array', 'String', 'Object', 'Number', 'Date'];

function renderValue(value: unknown): string {
  return typeof value === 'string' ? `'${value}'` : JSON.stringify(value);
}

function renderExample(helper: ExpressionHelper): string {
  const { example } = helper;
  if (!example) return '';
  const args = (example.args ?? []).map(renderValue).join(', ');
  let receiver = renderValue(example.input);
  if (helper.type === 'Date') {
    receiver = `'${example.input}'.toDateTime()`;
  } else if (helper.type === 'Number' || helper.type === 'Object') {
    // `4.isEven()` and `{...}.hasField()` do not parse as written
    receiver = `(${receiver})`;
  }
  return `${receiver}.${helper.name}(${args}) → ${JSON.stringify(example.output)}`;
}

const INTRO = `n8n adds helper methods to values inside {{ }} expressions. Use them in a native node's field (Edit Fields, IF, Filter, HTTP Request, ...) before reaching for a Code node. Keep one helper chain per field: an expression with a function body or several statements is code, so use a Code node for that instead of an IIFE.

Helpers work on the current item's values. For jobs across items, use a node.`;

const GOTCHAS = `## Gotchas
- sum(), average(), min() and max() throw if any element is not a number, numeric strings included. Set the field type to Number in Edit Fields first.
- parseJson() and toNumber() throw on invalid input.
- isBetween() excludes both bounds.
- A helper called on null or undefined throws; guard with ?. (e.g. {{ $json.email?.extractDomain() }}) or $ifEmpty().`;

export function getExpressionHelpersGuide(depth: 'essentials' | 'full' = 'essentials'): string {
  const acrossItems = ACROSS_ITEMS.map(([job, node]) => `- ${job} → ${node}`).join('\n');

  if (depth === 'essentials') {
    const byType = TYPES.map(type => {
      const calls = EXPRESSION_HELPERS.filter(h => h.type === type).map(h => h.call).join(', ');
      return `**${TYPE_TITLES[type]}**: ${calls}`;
    }).join('\n');
    const globals = EXPRESSION_GLOBALS.map(g => g.call).join(', ');

    return `# Expression helpers

${INTRO}
${acrossItems}

${byType}
**Globals**: ${globals}

Examples:
- {{ $json.lineItems.pluck('price').sum() }}
- {{ $json.email.extractDomain() }}
- {{ $json.createdAt.toDateTime().diffToNow('days') }}
- {{ $ifEmpty($json.nickname, $json.firstName) }}

${GOTCHAS}

For signatures and worked examples: tools_documentation({topic: "expression_helpers", depth: "full"})`;
  }

  const sections = TYPES.map(type => {
    const rows = EXPRESSION_HELPERS.filter(h => h.type === type).map(h => {
      const example = renderExample(h);
      return `- \`${h.call}\`: ${h.summary}${example ? `. \`${example}\`` : ''}`;
    }).join('\n');
    return `## ${TYPE_TITLES[type]}\n${rows}`;
  }).join('\n\n');
  const globals = EXPRESSION_GLOBALS.map(g => `- \`${g.call}\`: ${g.summary}`).join('\n');

  return `# Expression helpers

${INTRO}
${acrossItems}

Examples below show the value a helper is called on; in a workflow that value comes from an expression such as {{ $json.prices }}.

${sections}

## Globals
${globals}

${GOTCHAS}

## Related
- tools_documentation({topic: "javascript_code_node_guide"}) for the cases that need a Code node: loops or recursion that nodes cannot express, state across runs, parsing no node handles, libraries, heavy all-items work`;
}
