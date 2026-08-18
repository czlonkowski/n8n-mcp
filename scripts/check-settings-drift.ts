#!/usr/bin/env npx tsx
/**
 * Compare src/constants/workflow-settings.ts against the workflowSettings schema n8n ships in
 * its published package, and fail if they disagree.
 *
 * n8n adds settings properties in most minor releases. Our list trailed by five properties for
 * two months before anyone noticed, and one of them (redactionPolicy) controls whether
 * execution data is redacted. `npm run update:n8n` runs this so an n8n bump that changes the
 * schema stops rather than shipping a stale list.
 *
 * Usage:
 *   npx tsx scripts/check-settings-drift.ts            # version from package.json
 *   npx tsx scripts/check-settings-drift.ts 2.34.4     # explicit n8n version
 */

import {
  WORKFLOW_SETTINGS_PROPERTIES,
  type SettingsVersion,
} from '../src/constants/workflow-settings';

const SCHEMA_PATH = 'dist/public-api/v1/openapi.yml';
const SCHEMA_NAME = 'workflowSettings';

function resolveVersion(): string {
  const fromArgs = process.argv[2];
  if (fromArgs) return fromArgs.replace(/^v/, '');

  // The n8n CLI package and n8n-nodes-base share a release train, so the pinned node package
  // names the n8n release whose schema we must match.
  const pkg = require('../package.json');
  const pinned = pkg.dependencies?.['n8n-nodes-base'];
  if (!pinned) {
    throw new Error('n8n-nodes-base is not a dependency - pass an n8n version explicitly');
  }
  return pinned.replace(/^[^0-9]*/, '');
}

async function fetchSchemaFile(version: string): Promise<string> {
  const url = `https://unpkg.com/n8n@${version}/${SCHEMA_PATH}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Could not fetch ${url} (HTTP ${response.status}). ` +
        'If n8n moved or renamed its bundled OpenAPI spec, update SCHEMA_PATH in this script.'
    );
  }
  return response.text();
}

function parseVersion(version: string): SettingsVersion {
  const [major, minor, patch] = version.split('.').map(part => parseInt(part, 10) || 0);
  return { major, minor, patch };
}

function compareVersions(a: SettingsVersion, b: SettingsVersion): number {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

const indentOf = (line: string): number => line.length - line.trimStart().length;

/**
 * Pull the property names out of `components.schemas.workflowSettings.properties`.
 *
 * Indentation is measured rather than assumed, so a reformatted spec still parses; anything
 * this cannot find throws, which is the point - a silently empty result would read as "no
 * drift".
 */
export function parseSchemaProperties(yaml: string): Set<string> {
  const lines = yaml.split('\n');

  const schemaIndex = lines.findIndex(line => new RegExp(`^\\s+${SCHEMA_NAME}:\\s*$`).test(line));
  if (schemaIndex === -1) {
    throw new Error(
      `No "${SCHEMA_NAME}:" schema in ${SCHEMA_PATH}. n8n may have renamed it - check the spec.`
    );
  }
  const schemaIndent = indentOf(lines[schemaIndex]);

  let propertiesIndex = -1;
  for (let i = schemaIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '') continue;
    if (indentOf(line) <= schemaIndent) break; // left the schema without finding properties
    // Any depth below the schema, so the step size is not assumed. The schema's own
    // `properties:` is the first one inside it; a nested one always comes later.
    if (line.trim() === 'properties:') {
      propertiesIndex = i;
      break;
    }
  }
  if (propertiesIndex === -1) {
    throw new Error(`"${SCHEMA_NAME}" has no properties block in ${SCHEMA_PATH}`);
  }

  const propertiesIndent = indentOf(lines[propertiesIndex]);
  const names = new Set<string>();
  let keyIndent: number | null = null;

  for (let i = propertiesIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '') continue;
    const indent = indentOf(line);
    if (indent <= propertiesIndent) break;

    if (keyIndent === null) keyIndent = indent;
    if (indent !== keyIndent) continue; // nested schema of the property above

    const match = line.trim().match(/^([A-Za-z][A-Za-z0-9_]*):/);
    if (match) names.add(match[1]);
  }

  if (names.size === 0) {
    throw new Error(`Parsed zero properties from "${SCHEMA_NAME}" - the spec format changed`);
  }
  return names;
}

async function main(): Promise<void> {
  const version = resolveVersion();
  console.log(`🔍 Checking workflow settings against n8n ${version}\n`);

  const schemaProperties = parseSchemaProperties(await fetchSchemaFile(version));
  const ours = new Set(Object.keys(WORKFLOW_SETTINGS_PROPERTIES));

  const missing = [...schemaProperties].filter(name => !ours.has(name));

  // A property we know but this version lacks is only drift when we claim it already existed:
  // one introduced in a later release is simply ahead of the pin, which is expected while the
  // pinned version trails n8n's newest.
  const target = parseVersion(version);
  const removed: string[] = [];
  const ahead: string[] = [];
  for (const name of ours) {
    if (schemaProperties.has(name)) continue;
    const introduced = WORKFLOW_SETTINGS_PROPERTIES[name].since;
    (compareVersions(introduced, target) <= 0 ? removed : ahead).push(name);
  }

  console.log(`   n8n schema: ${schemaProperties.size} properties`);
  console.log(`   ours:       ${ours.size} properties\n`);

  if (ahead.length > 0) {
    console.log(`ℹ️  ${ahead.length} known from a later n8n than the pin (expected): ${ahead.join(', ')}\n`);
  }

  if (missing.length === 0 && removed.length === 0) {
    console.log('✅ No drift - src/constants/workflow-settings.ts matches n8n.');
    return;
  }

  if (missing.length > 0) {
    console.error(`❌ ${missing.length} property/properties in n8n but not in ours:`);
    for (const name of missing) console.error(`   + ${name}`);
    console.error(
      `\n   Add them to src/constants/workflow-settings.ts with since: v(${version
        .split('.')
        .slice(0, 2)
        .join(', ')}, 0) - or the earlier release that introduced them - and mark any property`
    );
    console.error('   n8n documents as ignored on write with derived: true.');
  }

  if (removed.length > 0) {
    console.error(`\n❌ ${removed.length} property/properties in ours but not in n8n:`);
    for (const name of removed) console.error(`   - ${name}`);
    console.error('\n   n8n removed or renamed these. Remove them once no supported version has them.');
  }

  process.exit(1);
}

// Only run when invoked directly, so the parser above can be imported by tests without the
// script fetching anything or calling process.exit.
if (require.main === module) {
  main().catch(error => {
    console.error(`❌ Settings drift check failed: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  });
}
