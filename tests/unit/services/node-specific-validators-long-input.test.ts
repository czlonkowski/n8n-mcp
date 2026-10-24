import { describe, it, expect } from 'vitest';
import { NodeSpecificValidators, NodeValidationContext } from '@/services/node-specific-validators';

const FS_WARNING = 'File system and process access not available in Code nodes';
const AWAIT_WARNING = 'Using await inside a non-async function';

function validate(config: Record<string, unknown>): { context: NodeValidationContext; ms: number } {
  const context: NodeValidationContext = { config, errors: [], warnings: [], suggestions: [], autofix: {} };
  const start = performance.now();
  NodeSpecificValidators.validateCode(context);
  return { context, ms: performance.now() - start };
}

describe('NodeSpecificValidators.validateCode with long input', () => {
  describe('Python', () => {
    it('handles a for head with a long blank run', () => {
      const { ms } = validate({
        language: 'pythonNative',
        pythonCode: 'for' + ' '.repeat(5_000) + 'x\nreturn [{"json": {}}]'
      });
      expect(ms).toBeLessThan(2_000);
    });

    it('handles a comprehension for head with a long blank run', () => {
      const { ms } = validate({
        language: 'pythonNative',
        pythonCode: 'y = [x for' + ' '.repeat(5_000) + 'x]\nreturn []'
      });
      expect(ms).toBeLessThan(2_000);
    });

    it('handles a line of many lambdas inside one bracket group', () => {
      const { context, ms } = validate({
        language: 'pythonNative',
        pythonCode: '[' + 'lambda:0, '.repeat(19_998) + ']\nreturn []'
      });
      expect(ms).toBeLessThan(2_000);
      expect(context.errors).toHaveLength(0);
    });

    it('handles a long indented statement without an assignment', () => {
      const { ms } = validate({ language: 'pythonNative', pythonCode: ' '.repeat(199_980) + 'x\nreturn []' });
      expect(ms).toBeLessThan(2_000);
    });

    it('handles a long run of closing brackets in an assignment target', () => {
      const { ms } = validate({ language: 'pythonNative', pythonCode: 'x' + ')'.repeat(150_000) + 'y = 1\nreturn []' });
      expect(ms).toBeLessThan(2_000);
    });

    it('still scopes lambda and comprehension names to their own group', () => {
      const { context } = validate({
        language: 'pythonNative',
        pythonCode: 'a = (lambda _json: _json)\nb = [_json for _json in _items]\nreturn [{"json": {"v": _json}}]'
      });
      expect(context.errors.filter(e => e.message.startsWith('_json does not exist'))).toHaveLength(1);
    });

    it('handles deeply nested function headers followed by many blank lines', () => {
      const headers = Array.from({ length: 365 }, (_, depth) => ' '.repeat(depth) + `def f${depth}():`).join('\n');
      const { context, ms } = validate({
        language: 'pythonNative',
        mode: 'runOnceForAllItems',
        pythonCode: headers + '\n' + '\n'.repeat(129_281) + 'return []'
      });
      expect(ms).toBeLessThan(2_000);
      expect(context.errors).toHaveLength(0);
    });

    it('handles a long run of statement separators after a returned list', () => {
      const { context, ms } = validate({
        language: 'pythonNative',
        mode: 'runOnceForEachItem',
        pythonCode: 'return []' + ';'.repeat(100_000) + 'x'
      });
      expect(ms).toBeLessThan(2_000);
      expect(context.errors.some(e => e.message.startsWith('Returning a list'))).toBe(false);
    });

    it('still flags a returned list followed only by separators', () => {
      const { context } = validate({
        language: 'pythonNative',
        mode: 'runOnceForEachItem',
        pythonCode: 'return []' + ';'.repeat(1_000) + ' '
      });
      expect(context.errors.some(e => e.message.startsWith('Returning a list'))).toBe(true);
    });

    it('handles a class header that never closes', () => {
      const { context, ms } = validate({
        language: 'pythonNative',
        pythonCode: 'return 1\nclass K(\n' + 'b\n'.repeat(99_990)
      });
      expect(ms).toBeLessThan(2_000);
      expect(context.errors.some(e => e.message.startsWith('class definitions fail'))).toBe(true);
    });
  });

  describe('JavaScript', () => {
    it('handles repeated comment-close and brace units under the length cap', () => {
      const { ms } = validate({ language: 'javaScript', jsCode: '*/{'.repeat(66_000) + '\nreturn [{json:{}}]' });
      expect(ms).toBeLessThan(2_000);
    });

    it('handles repeated comment-close and brace units above the length cap', () => {
      const { ms } = validate({ language: 'javaScript', jsCode: '*/{'.repeat(106_666) + '\nreturn [{json:{}}]' });
      expect(ms).toBeLessThan(2_000);
    });

    it('handles many unmatched parameter lists before braces', () => {
      const { ms } = validate({ language: 'javaScript', jsCode: '){'.repeat(500_000) + '\nreturn [{json:{}}]' });
      expect(ms).toBeLessThan(2_000);
    });

    it('still detects a function body after a block comment', () => {
      for (const note of ['note', 'c'.repeat(2_100)]) {
        const { context } = validate({
          language: 'javaScript',
          jsCode: `function pick(a) /* ${note} */ {\n  return 1;\n}\nreturn [{json: {v: pick(1)}}];`
        });
        expect(context.errors.some(e => e.message === 'Cannot return primitive values directly')).toBe(false);
      }
    });

    it('handles a large node with eval( only inside strings and comments', () => {
      const { context } = validate({
        language: 'javaScript',
        jsCode: 'const s = "eval(x)"; // eval(y)\n'.repeat(10_000) + 'return [{json: {s}}];'
      });
      expect(context.warnings.some(w => w.message.startsWith('Avoid eval()'))).toBe(false);
    });

    it('handles a long line of import keywords', () => {
      const { context, ms } = validate({ language: 'javaScript', jsCode: 'import '.repeat(91_430) + '\nreturn [{json:{}}]' });
      expect(ms).toBeLessThan(2_000);
      expect(context.warnings.some(w => w.message === FS_WARNING)).toBe(false);
    });

    it('still warns on an import from a file system module', () => {
      for (const jsCode of [
        "import { readFileSync } from 'fs';\nreturn [{json: {}}];",
        'import * as path from "node:path"\nreturn [{json: {}}];'
      ]) {
        const { context } = validate({ language: 'javaScript', jsCode });
        expect(context.warnings.some(w => w.message === FS_WARNING)).toBe(true);
      }
      const { context } = validate({
        language: 'javaScript',
        jsCode: "import x from 'lodash';\nconst y = 'from \"fs\"';\nreturn [{json: {}}];"
      });
      expect(context.warnings.some(w => w.message === FS_WARNING)).toBe(false);
    });

    it('handles a function keyword followed by a long blank run', () => {
      const { ms } = validate({ language: 'javaScript', jsCode: 'function' + ' '.repeat(199_900) + '\nreturn [{json:{}}]' });
      expect(ms).toBeLessThan(2_000);
    });

    it('handles a long run of open parentheses', () => {
      const { ms } = validate({ language: 'javaScript', jsCode: '('.repeat(199_900) + '\nreturn [{json:{}}]' });
      expect(ms).toBeLessThan(2_000);
    });

    it('still warns on await inside a non-async function or arrow', () => {
      for (const jsCode of [
        'function load(id) { const r = await fetch(id); }\nreturn [{json: {}}];',
        'const f = (x) => { await x; };\nreturn [{json: {}}];'
      ]) {
        const { context } = validate({ language: 'javaScript', jsCode });
        expect(context.warnings.some(w => w.message === AWAIT_WARNING)).toBe(true);
      }
      const { context } = validate({
        language: 'javaScript',
        jsCode: 'function load(id) { return id; }\nconst r = await load(1);\nreturn [{json: {r}}];'
      });
      expect(context.warnings.some(w => w.message === AWAIT_WARNING)).toBe(false);
    });
  });
});
