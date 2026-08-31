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

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import {
  WORKFLOW_SETTINGS_PROPERTIES,
  type SettingsVersion,
} from '../src/constants/workflow-settings';

const SCHEMA_PATH = 'dist/public-api/v1/openapi.yml';
const SCHEMA_NAME = 'workflowSettings';
const ENTITY_INTERFACE = 'IWorkflowSettings';

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

/**
 * Pull the property names out of n8n-workflow's `IWorkflowSettings` declaration - the workflow
 * entity's settings type, which the Public API schema is supposed to mirror but has trailed
 * (engineType, issue #1043). Same philosophy as the schema parser: anything this cannot find
 * throws, because an empty result would read as "no entity-only properties".
 */
export function parseEntitySettingsProperties(dts: string): Set<string> {
  // Block comments could hide braces (breaking the depth count) or carry declaration-shaped
  // text; neither should reach the parser.
  const lines = dts.replace(/\/\*[\s\S]*?\*\//g, '').split('\n');
  // Anchored at line start (allowing export/declare) so comment lines mentioning the name
  // don't count as declarations.
  const declaration = new RegExp(
    `^\\s*(?:export\\s+)?(?:declare\\s+)?interface ${ENTITY_INTERFACE}\\b`
  );
  const declarationIndices = lines.flatMap((line, i) => (declaration.test(line) ? [i] : []));
  if (declarationIndices.length === 0) {
    throw new Error(
      `No "${ENTITY_INTERFACE}" interface in n8n-workflow's declarations. ` +
        'n8n may have renamed or moved it - check the package.'
    );
  }
  // These two shapes would parse cleanly but return a silently incomplete set, which reads as
  // "no entity-only properties" - the one failure mode this check must never have.
  if (declarationIndices.length > 1) {
    throw new Error(
      `"${ENTITY_INTERFACE}" is declared ${declarationIndices.length} times - declaration ` +
        'merging would hide properties from this parser. Teach it to merge the declarations.'
    );
  }
  const startIndex = declarationIndices[0];
  let header = '';
  for (let i = startIndex; i < lines.length; i++) {
    header += lines[i];
    if (lines[i].includes('{')) break;
  }
  if (/\bextends\b/.test(header)) {
    throw new Error(
      `"${ENTITY_INTERFACE}" extends a base type - inherited properties would be missed. ` +
        'Teach this parser about heritage clauses.'
    );
  }
  // The line-based walk below only sees properties on lines after the opening brace, so
  // content sharing the brace's line would be dropped silently. `header` ends at the line
  // carrying the brace, wherever it is.
  if (/\{\s*\S/.test(header)) {
    throw new Error(
      `"${ENTITY_INTERFACE}" has content on its opening-brace line - this parser reads ` +
        'one property per line. Teach it the inline form.'
    );
  }

  const names = new Set<string>();
  let depth = 0;
  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i];
    // Depth 1 is the interface body; nested object types sit deeper and their keys are not
    // settings properties. The check runs before this line's braces are counted, so a
    // `foo?: {` line still registers foo while its members do not.
    if (depth === 1) {
      const match = line.trim().match(/^(?:readonly\s+)?([A-Za-z][A-Za-z0-9_]*)\??:/);
      if (match) names.add(match[1]);
    }
    for (const char of line) {
      if (char === '{') depth++;
      else if (char === '}') depth--;
    }
    if (depth === 0 && i > startIndex) break;
  }

  if (names.size === 0) {
    throw new Error(
      `Parsed zero properties from "${ENTITY_INTERFACE}" - the declaration format changed`
    );
  }
  return names;
}

/**
 * The n8n-workflow version the target n8n release ships (an exact pin in its package.json),
 * or null when it cannot be determined - the axis still runs, this only powers a warning.
 */
async function fetchEntityPackagePin(version: string): Promise<string | null> {
  try {
    const response = await fetch(`https://unpkg.com/n8n@${version}/package.json`);
    if (!response.ok) return null;
    const pkg = (await response.json()) as { dependencies?: Record<string, string> };
    const pin = pkg.dependencies?.['n8n-workflow'];
    return pin ? pin.replace(/^[^0-9]*/, '') : null;
  } catch {
    return null;
  }
}

function installedEntityPackageVersion(): string | null {
  try {
    const pkgPath = join(dirname(require.resolve('n8n-workflow')), '..', '..', 'package.json');
    return (require(pkgPath) as { version?: string }).version ?? null;
  } catch {
    return null;
  }
}

function readEntityDeclarations(): string {
  // Resolve from the installed n8n-workflow package (same release train as n8n and
  // n8n-nodes-base) so hoisting and store layouts don't matter.
  const dtsPath = join(dirname(require.resolve('n8n-workflow')), 'interfaces.d.ts');
  try {
    return readFileSync(dtsPath, 'utf8');
  } catch (error) {
    throw new Error(
      `Could not read ${dtsPath} (${error instanceof Error ? error.message : error}). ` +
        'If n8n-workflow moved its type declarations, update readEntityDeclarations in this script.'
    );
  }
}

export interface SettingsDrift {
  /** In the schema, unknown to our table - a new setting we would silently drop. */
  missing: string[];
  /** In our table, gone from n8n entirely - stale entries to prune. */
  removed: string[];
  /** In our table from a later n8n than the target - expected while the pin trails. */
  ahead: string[];
  /** Derived properties confirmed (or assumed, without an entity set) as entity-only. */
  entityOnly: string[];
  /** On the entity, rejected by the write schema, and not marked derived - the #1043 shape. */
  unhandledEntityOnly: string[];
  /** Marked entityOnly in our table but now published in the schema - stripping is a choice again. */
  publishedEntityOnly: string[];
}

/**
 * Classify every property of the three sources. Pure so the gate itself is testable;
 * `entityProperties` is null when the entity axis cannot run (see main).
 */
export function diffSettingsProperties(
  schemaProperties: Set<string>,
  entityProperties: Set<string> | null,
  target: SettingsVersion
): SettingsDrift {
  const ours = new Set(Object.keys(WORKFLOW_SETTINGS_PROPERTIES));

  const missing = [...schemaProperties].filter(name => !ours.has(name));

  // The entity-vs-schema axis: a property n8n persists on the workflow entity but leaves out of
  // the write schema comes back on GET and, echoed into a read-modify-write PUT, rejects the
  // whole request (additionalProperties: false). Such a property must be marked derived so every
  // write strips it. engineType (issue #1043) shipped exactly this way, and the schema-only diff
  // stayed green because the property was absent from both sides of it.
  // Handled means BOTH flags: derived makes writes strip it, entityOnly arms the
  // published-upstream detector below. Requiring one without the other would disarm the
  // detector for exactly the properties it exists for.
  const unhandledEntityOnly = entityProperties
    ? [...entityProperties].filter(name => {
        if (schemaProperties.has(name)) return false;
        const meta = WORKFLOW_SETTINGS_PROPERTIES[name];
        return !(meta?.derived === true && meta?.entityOnly === true);
      })
    : [];

  // The reverse transition: n8n published a property we strip because its schema used to reject
  // it. Stripping is no longer the only correct behaviour - callers might want to set it - so
  // the flag has to be reconsidered rather than silently kept.
  const publishedEntityOnly = [...schemaProperties].filter(
    name => WORKFLOW_SETTINGS_PROPERTIES[name]?.entityOnly === true
  );

  // A property we know but this version lacks is only drift when we claim it already existed:
  // one introduced in a later release is simply ahead of the pin, which is expected while the
  // pinned version trails n8n's newest. A derived property still on the entity is expected too -
  // it is stripped from every write, so the schema not naming it cannot break anything. Without
  // an entity set, a derived property is assumed entity-only when the target is new enough to
  // carry it, and ahead-of-the-pin otherwise.
  const unhandledSet = new Set(unhandledEntityOnly);
  const removed: string[] = [];
  const ahead: string[] = [];
  const entityOnly: string[] = [];
  for (const name of ours) {
    if (schemaProperties.has(name)) continue;
    if (unhandledSet.has(name)) continue; // already reported with its actionable message
    const meta = WORKFLOW_SETTINGS_PROPERTIES[name];
    const introducedLater = compareVersions(meta.since, target) > 0;
    if (meta.derived && (entityProperties ? entityProperties.has(name) : !introducedLater)) {
      entityOnly.push(name);
      continue;
    }
    (introducedLater ? ahead : removed).push(name);
  }

  return { missing, removed, ahead, entityOnly, unhandledEntityOnly, publishedEntityOnly };
}

async function main(): Promise<void> {
  const explicitVersion = process.argv[2];
  const version = resolveVersion();
  console.log(`🔍 Checking workflow settings against n8n ${version}\n`);

  const schemaProperties = parseSchemaProperties(await fetchSchemaFile(version));

  // The entity axis reads the INSTALLED n8n-workflow, which only describes the pinned dependency
  // set. Compared against an explicitly requested other version it would manufacture skew
  // findings (an old schema "missing" every newer entity property), so it runs in default mode
  // only - which is the mode `npm run update:n8n` uses, right after installing the new set.
  let entityProperties: Set<string> | null = null;
  if (!explicitVersion) {
    entityProperties = parseEntitySettingsProperties(readEntityDeclarations());
    // The pin names an n8n-nodes-base release, not an n8n one, and sibling n8n patch releases
    // can reuse subpackage versions - so confirm the fetched schema's release actually ships
    // the n8n-workflow we parsed. On a mismatch the axis still runs: it can only fail loudly
    // (a human investigates at update time), never silently pass what a matching set would fail.
    const installed = installedEntityPackageVersion();
    const expected = await fetchEntityPackagePin(version);
    if (installed && expected && installed !== expected) {
      console.log(
        `⚠️  Installed n8n-workflow ${installed} differs from n8n ${version}'s pin ${expected} - ` +
          'entity findings may reflect a neighbouring release.\n'
      );
    }
  } else {
    console.log('ℹ️  Entity axis skipped: the installed n8n-workflow may not match the requested version.\n');
  }

  const { missing, removed, ahead, entityOnly, unhandledEntityOnly, publishedEntityOnly } =
    diffSettingsProperties(schemaProperties, entityProperties, parseVersion(version));
  const ours = new Set(Object.keys(WORKFLOW_SETTINGS_PROPERTIES));

  console.log(`   n8n schema: ${schemaProperties.size} properties`);
  if (entityProperties) console.log(`   n8n entity: ${entityProperties.size} properties`);
  console.log(`   ours:       ${ours.size} properties\n`);

  if (ahead.length > 0) {
    console.log(`ℹ️  ${ahead.length} known from a later n8n than the pin (expected): ${ahead.join(', ')}\n`);
  }
  if (entityOnly.length > 0) {
    console.log(`ℹ️  ${entityOnly.length} entity-only, stripped on write (expected): ${entityOnly.join(', ')}\n`);
  }

  if (
    missing.length === 0 &&
    removed.length === 0 &&
    unhandledEntityOnly.length === 0 &&
    publishedEntityOnly.length === 0
  ) {
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

  if (unhandledEntityOnly.length > 0) {
    console.error(
      `\n❌ ${unhandledEntityOnly.length} property/properties on the workflow entity but not in the write schema:`
    );
    for (const name of unhandledEntityOnly) console.error(`   ± ${name}`);
    console.error(
      '\n   n8n persists these and echoes them from GET, but the Public API write schema rejects'
    );
    console.error(
      '   them, so read-modify-write updates fail. Add them to src/constants/workflow-settings.ts'
    );
    console.error(
      '   with derived: true, entityOnly: true so every write strips them and the check can'
    );
    console.error('   tell when n8n publishes them later (see issue #1043).');
  }

  if (publishedEntityOnly.length > 0) {
    console.error(
      `\n❌ ${publishedEntityOnly.length} stripped property/properties now in the write schema:`
    );
    for (const name of publishedEntityOnly) console.error(`   ± ${name}`);
    console.error(
      '\n   These are stripped because the schema used to reject them, but this n8n accepts them,'
    );
    console.error(
      '   so callers could be allowed to set them. Decide: drop entityOnly (and derived) in'
    );
    console.error('   src/constants/workflow-settings.ts, or keep stripping deliberately.');
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
