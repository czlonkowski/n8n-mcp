/**
 * Resolve the `@version` display gates of node properties for one typeVersion.
 *
 * Several typeVersions of an n8n node often share one implementation whose
 * properties carry `displayOptions.show['@version']` / `hide['@version']`.
 * n8n evaluates those against `node.typeVersion` (`displayParameter` in
 * n8n-workflow/node-helpers): `show` lists conditions of which one must hold,
 * `hide` removes the property when one holds, and `_cnd` objects carry
 * operators. Filtering a shared schema per version yields the property set a
 * workflow at that typeVersion can actually configure.
 *
 * Other display keys depend on parameter values and are left untouched.
 */

type VersionCondition = number | string | { _cnd: Record<string, any> };

function matchesCondition(condition: VersionCondition, version: number): boolean {
  if (typeof condition !== 'object' || condition === null || !('_cnd' in condition)) {
    return Number(condition) === version;
  }
  const [operator, target] = Object.entries(condition._cnd)[0] ?? [];
  switch (operator) {
    case 'eq': return version === Number(target);
    case 'not': return version !== Number(target);
    case 'gte': return version >= Number(target);
    case 'lte': return version <= Number(target);
    case 'gt': return version > Number(target);
    case 'lt': return version < Number(target);
    case 'between': return version >= Number(target?.from) && version <= Number(target?.to);
    default: return false;
  }
}

function matchesAny(conditions: unknown, version: number): boolean {
  const list = Array.isArray(conditions) ? conditions : [conditions];
  return list.some(condition => matchesCondition(condition as VersionCondition, version));
}

/** Whether a property is shown at the given typeVersion, considering only its `@version` gates. */
export function isShownAtVersion(property: any, version: number): boolean {
  const show = property?.displayOptions?.show?.['@version'];
  const hide = property?.displayOptions?.hide?.['@version'];
  if (show !== undefined && !matchesAny(show, version)) return false;
  if (hide !== undefined && matchesAny(hide, version)) return false;
  return true;
}

/**
 * Return the properties visible at `version`, recursing into the nested
 * properties of collections (`options`) and fixedCollections (`options[].values`).
 * Enum `options` of other property types are values, not properties, and pass through.
 */
export function filterPropertiesForVersion(properties: any[], version: string | number): any[] {
  const numeric = Number(version);
  if (!Number.isFinite(numeric)) return properties;
  return filterList(properties, numeric);
}

function filterList(properties: any[], version: number): any[] {
  const result: any[] = [];
  for (const property of properties) {
    if (!isShownAtVersion(property, version)) continue;

    if (property.type === 'collection' && Array.isArray(property.options)) {
      result.push({ ...property, options: filterList(property.options, version) });
    } else if (property.type === 'fixedCollection' && Array.isArray(property.options)) {
      result.push({
        ...property,
        options: property.options.map((group: any) =>
          Array.isArray(group?.values) ? { ...group, values: filterList(group.values, version) } : group
        )
      });
    } else {
      result.push(property);
    }
  }
  return result;
}
