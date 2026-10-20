/** Check the prepared npm tarball locally; never publish or contact n8n. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const staging = path.join(root, 'npm-publish-temp');
const scratch = mkdtempSync(path.join(tmpdir(), 'n8n-mcp-npm-ui-'));
function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', timeout: 120_000 });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${command} failed: ${result.stderr}`);
  return result.stdout;
}

try {
  const [packed] = JSON.parse(run('npm', ['pack', '--json', '--ignore-scripts', '--cache', path.join(scratch, 'npm-cache'), '--pack-destination', scratch], staging));
  const manifest = JSON.parse(readFileSync(path.join(staging, 'package.json'), 'utf8'));
  assert.equal(manifest.name, 'n8n-mcp');
  assert.equal(manifest.private, undefined);
  assert(!manifest.devDependencies, 'Prepared package must retain runtime-only dependencies');
  const paths = packed.files.map(file => file.path);
  assert(!paths.some(file => /^ui-apps\/(src|node_modules)\//.test(file)), 'Development UI files leaked into npm package');
  run('tar', ['-xzf', path.join(scratch, packed.filename), '-C', scratch], root);
  const unpacked = path.join(scratch, 'package');
  // Loading the registry from the extracted package verifies real runtime paths,
  // independently of source-tree assets and npm's files-list declarations.
  console.log(run(process.execPath, [path.join(root, 'scripts/ui-package-smoke.cjs'), unpacked], scratch).trim());
  for (const file of paths.filter(file => /^ui-apps\/dist\/[^/]+\/index\.html$/.test(file))) {
    assert.deepEqual(readFileSync(path.join(unpacked, file)), readFileSync(path.join(root, file)), `Stale packaged UI: ${file}`);
  }
  console.log('Prepared npm tarball UI smoke passed. No package was published.');
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
