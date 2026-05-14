/**
 * Parse an n8n node typeVersion into a finite number.
 *
 * Accepts the raw shapes that show up across the codebase:
 *   - number (e.g. 1, 2.3) — what `INodeTypeDescription.version` is at runtime
 *   - number[] (e.g. [1, 2, 2.1]) — versioned nodes' supported set; we return the highest
 *   - string — comes back from SQLite where `version` is stored as TEXT
 *
 * Strings produced by `Number[].toString()` ("1,2") and JSON arrays ("[1, 2]") are also
 * handled. Multi-dot semver strings like "0.2.21" — which are npm package versions, not
 * typeVersions — are explicitly rejected: they aren't valid JS numbers and would coerce
 * to NaN, silently breaking version comparisons in the validator.
 *
 * Returns the parsed (max) version, or null if the value cannot be interpreted.
 */
export function parseTypeVersion(value: unknown): number | null {
  if (value == null) return null;

  if (typeof value === 'number') {
    // Reject negatives so this helper agrees with isValidTypeVersion and the
    // workflow validator's typeof-and-non-negative check. typeVersion 0 is valid.
    return Number.isFinite(value) && value >= 0 ? value : null;
  }

  if (Array.isArray(value)) {
    let max: number | null = null;
    for (const item of value) {
      const n = parseTypeVersion(item);
      if (n !== null && (max === null || n > max)) max = n;
    }
    return max;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;

    if (trimmed.startsWith('[')) {
      try {
        return parseTypeVersion(JSON.parse(trimmed));
      } catch {
        return null;
      }
    }

    if (trimmed.includes(',')) {
      return parseTypeVersion(trimmed.split(',').map((s) => s.trim()));
    }

    // Reject npm-package-style multi-dot strings like "0.2.21" or "2.1.17-rc.31".
    if ((trimmed.match(/\./g) || []).length > 1) return null;

    const n = Number(trimmed);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }

  return null;
}

/**
 * Returns true when `value` can be safely used as a typeVersion in a workflow.
 */
export function isValidTypeVersion(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}
