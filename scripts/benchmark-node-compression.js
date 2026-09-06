#!/usr/bin/env node
/**
 * Compare the four offline MCP tools against two built checkouts and their
 * bundled catalogs. No live n8n service is used. Each sample group runs in a
 * fresh process against a temporary database copy; alternate baseline/candidate
 * order to reduce warm-up bias. The MCP response cache is cleared per call to
 * exercise repository reads. Measure cold schema-cache misses separately from
 * warm reads; SQLite pages and the JavaScript runtime are warm in both cases.
 *
 * node scripts/benchmark-node-compression.js /path/to/baseline /path/to/candidate
 * Optional: BENCH_ROUNDS=5 BENCH_ITERATIONS=100 (per tool, per round).
 */
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { mkdtempSync, copyFileSync, rmSync, statSync } = require('node:fs');
const { tmpdir, cpus } = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { createHash } = require('node:crypto');
const { gunzipSync } = require('node:zlib');

function corpus() {
  const nodeTypes = ['httpRequest', 'slack', 'googleSheets', 'postgres', 'airtable', 'code', 'webhook', 'if', 'set', 'supabase'];
  const nodes = nodeTypes.map(name => `nodes-base.${name}`);
  return {
    get_node: nodes.map(nodeType => ({ nodeType, detail: 'full', mode: 'info' })),
    search_nodes: ['slack', 'google sheets', 'http request', 'database', 'webhook', 'airtable', 'postgres', 'send message', 'supabase', 'openai']
      .map(query => ({ query, limit: 10, includeOperations: true })),
    validate_node: nodes.map(nodeType => ({ nodeType, config: {}, profile: 'runtime' })),
    validate_workflow: nodes.map((nodeType, i) => ({
      workflow: {
        name: `Compression benchmark ${i}`,
        nodes: [
          { id: 'start', name: 'Start', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: [0, 0], parameters: {} },
          { id: 'action', name: 'Action', type: nodeType.replace('nodes-base.', 'n8n-nodes-base.'), typeVersion: 1, position: [200, 0], parameters: {} },
        ],
        connections: { Start: { main: [[{ node: 'Action', type: 'main', index: 0 }]] } },
      },
      options: { profile: 'runtime' },
    })),
  };
}

async function worker(checkout, backend) {
  const dir = mkdtempSync(path.join(tmpdir(), 'node-compression-bench-'));
  const dbPath = path.join(dir, 'nodes.db');
  copyFileSync(path.join(checkout, 'data/nodes.db'), dbPath);
  process.env.NODE_DB_PATH = dbPath;
  process.env.N8N_MCP_TELEMETRY_DISABLED = 'true';
  process.env.LOG_LEVEL = 'error';
  delete process.env.N8N_API_URL;
  delete process.env.N8N_API_KEY;
  delete process.env.MCP_MODE;
  // Exercise the actual production fallback factory, including in the baseline
  // where the sql.js factory was not exported. This worker has its own process.
  if (backend === 'sql.js') {
    const nativePath = require.resolve('better-sqlite3', { paths: [checkout] });
    require(nativePath);
    require.cache[nativePath].exports = function unavailableNativeAdapter() {
      throw new Error('Native adapter disabled for sql.js benchmark');
    };
  }
  const { N8NDocumentationMCPServer } = require(path.join(checkout, 'dist/mcp/server.js'));
  const server = new N8NDocumentationMCPServer();
  try {
    await server.initialized;
    assert.equal(server.db.constructor.name, backend === 'sql.js' ? 'SQLJSAdapter' : 'BetterSQLiteAdapter');
    const results = {};
    for (const [tool, cases] of Object.entries(corpus())) {
      const call = async args => {
        server.cache.clear();
        return server.executeTool(tool, structuredClone(args));
      };
      const outputs = [];
      for (const args of cases) outputs.push(await call(args));
      for (let i = 0; i < 30; i++) await call(cases[i % cases.length]);
      const measure = async cold => {
        const samples = [];
        for (let i = 0; i < Number(process.env.BENCH_ITERATIONS || 100); i++) {
          // Deliberately reach into the new reader only in this benchmark.
          // Baseline schemas are plain JSON and have no inflation cache.
          if (cold) server.repository.schemaReader?.cache.clear();
          const start = performance.now();
          await call(cases[i % cases.length]);
          samples.push(performance.now() - start);
        }
        samples.sort((a, b) => a - b);
        return {
          medianMs: samples[Math.floor(samples.length / 2)],
          p95Ms: samples[Math.floor(samples.length * 0.95)],
        };
      };
      const coldSchemaCache = await measure(true);
      for (const args of cases) await call(args);
      results[tool] = {
        coldSchemaCache,
        warmSchemaCache: await measure(false),
        outputHash: createHash('sha256').update(JSON.stringify(outputs)).digest('hex'),
      };
    }
    process.stdout.write(`${JSON.stringify(results)}\n`);
  } finally {
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

function verifyCatalog(baseline, candidate) {
  const Database = require(require.resolve('better-sqlite3', { paths: [candidate] }));
  const before = new Database(path.join(baseline, 'data/nodes.db'), { readonly: true });
  const after = new Database(path.join(candidate, 'data/nodes.db'), { readonly: true });
  try {
    process.stderr.write('Verifying catalog rows\n');
    const rows = before.prepare('SELECT COUNT(*) AS count FROM nodes').get().count;
    assert.equal(after.prepare('SELECT COUNT(*) AS count FROM nodes').get().count, rows);
    const lookup = after.prepare('SELECT * FROM nodes WHERE node_type = ?');
    const decode = row => ({ ...row, properties_schema: row.properties_schema === null ? null : JSON.parse(
      row.properties_schema.startsWith('H4sI')
        ? gunzipSync(Buffer.from(row.properties_schema, 'base64')).toString('utf8')
        : row.properties_schema
    ) });
    for (const row of before.prepare('SELECT * FROM nodes ORDER BY node_type').iterate()) {
      assert.deepEqual(decode(lookup.get(row.node_type)), decode(row),
        `Every field of ${row.node_type} must remain semantically identical`);
    }
    process.stderr.write('Verifying SQLite integrity and FTS vocabulary\n');
    for (const db of [before, after]) {
      process.stderr.write('SQLite integrity check\n');
      assert.deepEqual(db.prepare('PRAGMA integrity_check').all(), [{ integrity_check: 'ok' }]);
      db.exec("CREATE VIRTUAL TABLE temp.node_vocab USING fts5vocab(main, nodes_fts, row)");
    }
    process.stderr.write('Comparing FTS vocabulary\n');
    const expectedTerms = before.prepare('SELECT * FROM node_vocab ORDER BY term').iterate();
    const actualTerms = after.prepare('SELECT * FROM node_vocab ORDER BY term').iterate();
    try {
      for (const expected of expectedTerms) {
        const actual = actualTerms.next();
        assert.equal(actual.done, false, `Missing FTS term: ${expected.term}`);
        assert.deepEqual(actual.value, expected, `FTS vocabulary changed at term: ${expected.term}`);
      }
      assert.equal(actualTerms.next().done, true, 'Unexpected extra FTS terms');
    } finally {
      expectedTerms.return();
      actualTerms.return();
    }
    return {
      rowsVerified: rows,
      beforeMiB: statSync(path.join(baseline, 'data/nodes.db')).size / 1024 / 1024,
      afterMiB: statSync(path.join(candidate, 'data/nodes.db')).size / 1024 / 1024,
      integrity: 'ok', ftsVocabulary: 'identical',
    };
  } finally {
    before.close();
    after.close();
  }
}

function main(baseline, candidate) {
  if (!baseline || !candidate) throw new Error('Usage: benchmark-node-compression.js BASELINE_CHECKOUT CANDIDATE_CHECKOUT');
  baseline = path.resolve(baseline);
  candidate = path.resolve(candidate);
  const report = { node: process.version, platform: `${process.platform}/${process.arch}`, cpu: cpus()[0].model,
    catalog: verifyCatalog(baseline, candidate), rounds: [] };
  process.stderr.write('Catalog verification complete\n');
  for (const backend of ['better-sqlite3', 'sql.js']) {
    for (let round = 0; round < Number(process.env.BENCH_ROUNDS || 5); round++) {
      const result = { backend, round };
      const arms = round % 2 ? [['candidate', candidate], ['baseline', baseline]] : [['baseline', baseline], ['candidate', candidate]];
      for (const [name, checkout] of arms) {
        const child = spawnSync(process.execPath, [__filename, '--worker', checkout, backend], {
          cwd: checkout, encoding: 'utf8', env: process.env, maxBuffer: 10 * 1024 * 1024, timeout: 120_000,
        });
        if (child.status !== 0) throw new Error(`${name}/${backend} failed: ${child.stderr}\n${child.stdout}`);
        result[name] = JSON.parse(child.stdout.trim().split('\n').at(-1));
      }
      for (const tool of Object.keys(corpus())) {
        assert.equal(result.baseline[tool].outputHash, result.candidate[tool].outputHash,
          `${tool} responses changed on ${backend}`);
      }
      report.rounds.push(result);
      process.stderr.write(`${backend} round ${round + 1} complete\n`);
    }
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

if (process.argv[2] === '--worker') {
  worker(process.argv[3], process.argv[4]).catch(error => { console.error(error); process.exitCode = 1; });
} else {
  main(process.argv[2], process.argv[3]);
}
