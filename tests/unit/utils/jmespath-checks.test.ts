import { describe, it, expect } from 'vitest';
import { blankStringLiterals, checkJmespathQuery, findJmespathCalls } from '@/utils/jmespath-checks';

describe('blankStringLiterals', () => {
  it('blanks the contents of single, double and template literals but keeps the quotes and length', () => {
    const source = `a + 'b c' + "d" + \`e\``;
    const blanked = blankStringLiterals(source);
    expect(blanked).toBe(`a + '   ' + " " + \` \``);
    expect(blanked.length).toBe(source.length);
  });

  it('keeps code inside template interpolations and blanks nested literals there', () => {
    expect(blankStringLiterals('`x ${ json.a + "y" } z`')).toBe('`  ${ json.a + " " }  `');
  });

  it('does not recurse on deeply nested template literals', () => {
    const source = '`${'.repeat(20000);
    expect(() => blankStringLiterals(source)).not.toThrow();
    expect(blankStringLiterals(source).length).toBe(source.length);
  });

  it('reads a regex that follows a division operator', () => {
    expect(findJmespathCalls('1 / /$jmespath($json, "[?age > 1]")/.test(x)')).toEqual([]);
  });

  it('reads a division after a closed string literal', () => {
    expect(findJmespathCalls('"x" / $jmespath($json, "[?age > 18]")')[0].query).toBe('[?age > 18]');
  });

  it('reads a regex after return and a division after an object literal', () => {
    expect(findJmespathCalls('(() => { return /$jmespath("a", d)/.source; })()')).toEqual([]);
    expect(findJmespathCalls('(async () => { return await /$jmespath("a", d)/; })()')).toEqual([]);
    expect(findJmespathCalls('returnx / $jmespath($json, "[?a > 1]")')[0].query).toBe('[?a > 1]');
    expect(findJmespathCalls('({valueOf: () => 1} / $jmespath($json, "[?age > 18]"))')[0].query).toBe('[?age > 18]');
  });

  it('gives up on an invalid code point instead of throwing', () => {
    expect(findJmespathCalls('$jmespath($json, "\\u{110000}")')[0].query).toBeUndefined();
    expect(findJmespathCalls('$jmespath($json, "\\u{41}")')[0].query).toBe('A');
  });

  it('blanks regex literals so a quote inside one does not open a string', () => {
    expect(blankStringLiterals(`x = /"/.source + "s"`)).toBe(`x = / /.source + " "`);
    expect(blankStringLiterals(`a / b / c`)).toBe(`a / b / c`);
    expect(blankStringLiterals(`s.replace(/[/"]/g, "Q") + json.y`)).toBe(`s.replace(/    /g, " ") + json.y`);
  });

  it('handles escaped quotes and an unterminated literal', () => {
    expect(blankStringLiterals(`'a\\'b' + c`)).toBe(`'    ' + c`);
    expect(blankStringLiterals(`'open\nnext`)).toBe(`'    \nnext`);
  });
});

describe('blankStringLiterals with comments', () => {
  it('blanks line and block comments only when asked', () => {
    expect(blankStringLiterals('a // b "c"\nd /* "e" */ f', { comments: true })).toBe('a         \nd           f');
    expect(blankStringLiterals('a // b', {})).toBe('a // b');
  });
});

describe('findJmespathCalls', () => {
  it('returns the query when it is the second argument', () => {
    expect(findJmespathCalls('$jmespath($json, "a[?b == `1`]")')).toEqual([
      { index: 0, query: 'a[?b == `1`]', queryIsFirstArgument: false },
    ]);
  });

  it('flags a string literal in the first position as reversed arguments', () => {
    expect(findJmespathCalls('x = $jmespath("a.b", $json)')[0]).toMatchObject({ query: 'a.b', queryIsFirstArgument: true });
  });

  it('leaves the query undefined when it is not a literal', () => {
    expect(findJmespathCalls('$jmespath($json, query)')[0]).toMatchObject({ queryIsFirstArgument: false });
    expect(findJmespathCalls('$jmespath($json, query)')[0].query).toBeUndefined();
  });

  it('decodes JavaScript escapes in the query and keeps an escaped quote inside the literal', () => {
    expect(findJmespathCalls('$jmespath($json, "[?name == \\u0027rock and roll\\u0027]")')[0].query).toBe("[?name == 'rock and roll']");
    expect(findJmespathCalls("$jmespath($json, '[?name == \\'Bob\\' && age > 18]')")[0].query).toBe("[?name == 'Bob' && age > 18]");
    expect(findJmespathCalls('$jmespath($json, "a" + "b")')[0].query).toBeUndefined();
  });

  it('reads a literal surrounded by comments and ignores a call on another identifier', () => {
    expect(findJmespathCalls('$jmespath($json, /* query */ "[?age > 1]" // why\n)')[0].query).toBe('[?age > 1]');
    expect(findJmespathCalls('foo$jmespath($json, "a")')).toEqual([]);
    expect(findJmespathCalls('obj.$jmespath($json, "a")')).toEqual([]);
  });

  it('allows whitespace between the callee and its paren', () => {
    expect(findJmespathCalls('$jmespath ($json, "a")')[0].query).toBe('a');
    expect(findJmespathCalls('$jmespathX($json, "a")')).toEqual([]);
  });

  it('reads a regex at the start of a template interpolation', () => {
    expect(findJmespathCalls('`${ /$jmespath("a", d)/.source }`')).toEqual([]);
  });

  it('flags a dynamic template literal in first position as reversed', () => {
    expect(findJmespathCalls('$jmespath(`users.${field}`, $json)')[0]).toMatchObject({ queryIsFirstArgument: true });
  });

  it('reads nested calls', () => {
    const calls = findJmespathCalls('$jmespath($jmespath($json, "[?age > 18]"), "[].name")');
    expect(calls.map(c => c.query)).toEqual(['[].name', '[?age > 18]']);
  });

  it('splits arguments at the top level only', () => {
    const calls = findJmespathCalls(`$jmespath($("A, B").all().map(i => i.json), "[?x == 'a,b']")`);
    expect(calls[0].query).toBe("[?x == 'a,b']");
  });

  it('stops at an unclosed call, whose open paren swallows every later one', () => {
    expect(findJmespathCalls('$jmespath($json, "a"; $jmespath($json, "b")')).toEqual([]);
    expect(findJmespathCalls('$jmespath($json, "a"); $jmespath($json, "b"').map(c => c.query)).toEqual(['a']);
  });

  it('ignores a call inside a string literal or comment, and a template query with interpolation', () => {
    expect(findJmespathCalls('"docs: $jmespath(\'q\', d)"')).toEqual([]);
    expect(findJmespathCalls(`x = /"/.source + "docs: $jmespath('a[?b > 1]', d)"`)).toEqual([]);
    expect(findJmespathCalls('x // $jmespath("a", d)\n/* $jmespath("b", d) */ $jmespath(d, "c")').map(c => c.query)).toEqual(['c']);
    expect(findJmespathCalls('$jmespath($json, `a[?b > ${min}]`)')[0].query).toBeUndefined();
  });

  it('scans linearly on many unclosed calls', () => {
    const source = '$jmespath('.repeat(20000);
    const started = Date.now();
    expect(findJmespathCalls(source)).toEqual([]);
    expect(Date.now() - started).toBeLessThan(500);
  });
});

describe('checkJmespathQuery', () => {
  const messages = (query: string) => checkJmespathQuery(query).map(f => `${f.severity}: ${f.message}`);

  it('accepts a valid filter', () => {
    expect(checkJmespathQuery("customers[?revenue > `100000` && country == 'PL'].name")).toEqual([]);
    expect(checkJmespathQuery("[?json.country=='PL'].json.name")).toEqual([]);
  });

  it('errors on a bare number, boolean or null in a comparison', () => {
    expect(messages('customers[?revenue > 100000].name')).toEqual([
      'error: JMESPath literal 100000 must be wrapped in backticks',
    ]);
    expect(messages('[?score >= 1.5]')[0]).toContain('literal 1.5');
    expect(messages('[?delta > -18]')[0]).toContain('literal -18');
    expect(messages('[?n == 1e3]')[0]).toContain('literal 1e3');
  });

  it('warns on a bare true, false or null, which JMESPath reads as a field name', () => {
    expect(messages('[?active == true]')).toEqual(['warning: JMESPath reads true as a field name, not the literal; wrap it in backticks']);
    expect(messages('[?x != null]')[0]).toContain('reads null as a field name');
    expect(messages('[?score > true]')[0]).toContain('reads true as a field name');
    expect(checkJmespathQuery('[?active == `true`]')).toEqual([]);
  });

  it('reports each distinct mistake once, keeping fixes that differ by operator', () => {
    expect(checkJmespathQuery('[?a == 1 && b == 1 && c == 2]').map(f => f.message)).toHaveLength(2);
    expect(checkJmespathQuery('[?a == 1 && b != 1]').map(f => f.fix)).toEqual(['Write == `1`', 'Write != `1`']);
  });

  it('errors on and / or and on a single =', () => {
    expect(messages('[?a == `1` and b == `2`]')).toEqual(['error: JMESPath has no "and" operator']);
    expect(messages('[?a == `1` or b == `2`]')[0]).toContain('no "or" operator');
    expect(messages('[?a = `1`]')).toEqual(['error: JMESPath comparisons use ==, not a single =']);
  });

  it('does not read operators or quotes inside raw strings, JSON literals or quoted identifiers', () => {
    expect(checkJmespathQuery("[?tags == 'a=b and c']")).toEqual([]);
    expect(checkJmespathQuery(`[?name == 'x=="y"']`)).toEqual([]);
    expect(checkJmespathQuery('[?a == `"${foo = 1}"`]')).toEqual([]);
    expect(checkJmespathQuery("[?a == 'hello\nworld = 1']")).toEqual([]);
    expect(checkJmespathQuery('"a = b".c')).toEqual([]);
  });

  it('accepts a field named and or or', () => {
    expect(checkJmespathQuery('foo | and | bar')).toEqual([]);
    expect(checkJmespathQuery('[? and ]')).toEqual([]);
    expect(checkJmespathQuery('[?a == `1` and b == `2`]').map(f => f.severity)).toEqual(['error']);
  });

  it('warns on a double-quoted right-hand side', () => {
    expect(messages('customers[?country=="PL"].name')).toEqual([
      'warning: JMESPath treats "PL" as an identifier, so this compares against the field named PL rather than the string; that usually matches nothing',
    ]);
  });

  it('suggests a JSON literal when the text holds a quote or backslash', () => {
    expect(checkJmespathQuery(`[?name == "O'Reilly"]`)[0].fix).toBe('Use a string literal: == `"O\'Reilly"`');
    expect(checkJmespathQuery('[?name == "a\\b"]')[0].fix).toBe('Use a string literal: == `"a\\\\b"`');
    expect(checkJmespathQuery('[?name == "a`b\'"]')[0].fix).toBe('Use a string literal: == `"a\\`b\'"`');
    expect(checkJmespathQuery('[?country == "PL"]')[0].fix).toBe("Use a string literal: == 'PL'");
  });

  it('ignores a query longer than the scan limit', () => {
    expect(checkJmespathQuery('[?a > 1]' + ' '.repeat(2100))).toEqual([]);
  });
});
