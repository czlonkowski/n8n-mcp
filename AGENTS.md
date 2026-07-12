# Repository Guidelines

## Project Structure & Module Organization

Core TypeScript lives in `src/`: MCP tools in `src/mcp/`, business logic in `src/services/`, persistence in `src/database/`, and shared code in `src/types/` and `src/utils/`. Tests mirror these areas in `tests/unit/` and `tests/integration/`; supporting fixtures and mocks stay under `tests/`. React/Vite apps live in `ui-apps/src/`, repo utilities in `scripts/`, TypeScript maintenance scripts in `src/scripts/` (compiled to `dist/scripts/` at build time), documentation in `docs/`, and generated skills/databases in `data/`. Treat `dist/`, coverage output, and `ui-apps/dist/` as generated.

## Build, Test, and Development Commands

- `npm install` installs root dependencies; repeat in `ui-apps/` for UI work.
- `npm run build` compiles production TypeScript to `dist/`.
- `npm run build:all` synchronizes skills, builds UI apps, and compiles the server.
- `npm run typecheck` (also `npm run lint`) performs strict checks without emitting.
- `npm run dev:http` rebuilds and restarts the HTTP server as sources change.
- `npm run rebuild` regenerates the node database; expect this to take several minutes.
- `npm run validate` checks generated node data after a build/rebuild.

## Coding Style & Naming Conventions

Use strict TypeScript, two-space indentation, single quotes, and semicolons. Prefer `camelCase` for variables/functions, `PascalCase` for classes/types, and kebab-case filenames such as `workflow-auto-fixer.ts`. Use configured `@/` and `@tests/` aliases where helpful. Keep modules focused, validate external input, and do not edit generated outputs. No separate formatter is configured; `npm run typecheck` is the required static check.

## Testing Guidelines

Vitest is the primary framework; MSW handles API mocking. Name tests `*.test.ts` and place them in the matching test subtree. Run `npm run test:unit` for fast checks, `npm run test:integration` for system behavior, and `npm run test:coverage` before substantial PRs. Thresholds are 75% for lines, functions, and statements and 70% for branches. Live n8n tests need configuration and clean database state; do not mask flakes with retries.

## Commit & Pull Request Guidelines

Recent history follows Conventional Commit prefixes such as `feat:`, `fix:`, `docs:`, `chore:`, and scoped forms like `ci(deps):`. Use a feature branch; never commit directly to `main`. PRs should explain intent and verification, link relevant issues, and include screenshots for UI changes. Enable “Allow edits by maintainers.” Follow the commit/PR attribution requirement in `CLAUDE.md`, but never add that attribution to product file contents.

## Security & Configuration

This is a public repository: never commit credentials, API keys, private URLs, or customer data. Start from `.env.example`, keep local secrets untracked, and validate workflows before deploying them to n8n.
