# `search_nodes` Search Fix

## Findings

The source filter was applied in the main FTS and LIKE queries, but could be lost when an FTS error triggered the LIKE fallback. Fuzzy mode also loaded every node without applying `source`, and was not dispatched at all when FTS was unavailable. Separately, LIKE fallback limited candidates before ranking, so broad matches could crowd out an exact node-name match. The fallback treated `mode: "AND"` as OR, and custom validation did not reject invalid `source` values. Fuzzy results also omitted community metadata and requested examples.

## Changes

- Preserve source filtering through FTS fallbacks and fuzzy search.
- Route FUZZY mode consistently whether or not FTS is available, and include community metadata/examples in its results.
- Prioritize display-name and node-type matches before limiting LIKE candidates.
- Keep AND semantics when search uses LIKE.
- Validate `source` against `all`, `core`, `community`, and `verified`.
- Add regression coverage for ranking, FTS fallback filters, fuzzy behavior, AND semantics, and invalid source values.

## Verification

VS Code diagnostics report no errors in the changed source and test files. `npm install --package-lock-only --ignore-scripts --no-audit --no-fund` completed locally and reconciled `package-lock.json` with `package.json` (npm reported peer-dependency warnings). A subsequent `npm ci --ignore-scripts --no-audit --no-fund` did not complete and was stopped after prolonged inactivity. Vitest and `tsc` remained unavailable, so the focused tests and typecheck are unrun. The broad lockfile update is local-only and excluded from the search-fix branch.
