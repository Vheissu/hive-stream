# Repository Guidelines

## Project Structure & Module Organization
- `src/` holds TypeScript source. Core entry points are `streamer.ts`, `api.ts`, and `index.ts`.
- `src/adapters/` contains SQLite/Mongo/Postgres adapters; `src/contracts/` has contract examples; `src/exchanges/` has rate helpers; `src/types/` centralizes shared types.
- `tests/` contains Jest specs (`**/*.spec.ts`) plus `tests/integration/` and `tests/helpers/`.
- `dist/` is generated build output; `examples/` provides usage samples; `ecosystem.config.js` is a PM2 reference.

## Build, Test, and Development Commands
- `npm install` installs dependencies.
- `npm run build` compiles TypeScript to `dist/`.
- `npm run start` runs the local dev harness (`src/test.ts`) via ts-node.
- `npm run watch` enables TypeScript watch mode.
- `npm test` runs the Jest suite.
- `npm run clean-tests` clears Jest cache if tests act stale.

## Coding Style & Naming Conventions
- TypeScript with CommonJS output; keep module boundaries within `src/`.
- Indent 4 spaces; prefer single quotes (see `tslint.json`).
- File naming conventions: `*.adapter.ts`, `*.contract.ts`, `*.spec.ts`; shared types live in `src/types/`.
- TSLint rules in `tslint.json` are the baseline; match existing style before introducing new tooling.

## Testing Guidelines
- Framework: Jest + `ts-jest` (see `jest.config.js`).
- Place specs under `tests/` and name `*.spec.ts` (example: `tests/utils.spec.ts`).
- Use `tests/setup.ts` for shared mocks; integration tests live under `tests/integration/`.
- No coverage thresholds are configured; add focused tests for new adapters, contracts, or API routes.

## Commit & Pull Request Guidelines
- Follow Conventional Commits with scopes, as in history: `feat(api): ...`, `fix(contract): ...`, `chore(deps): ...`, `docs(readme): ...`.
- PRs should include: a clear summary, testing notes (`npm test`/`npm run build`), and docs/CHANGELOG updates for user-facing changes.

## Configuration & Security Notes
- Keys and usernames should come from env/config (see `src/config.ts`); never commit secrets.
- When adding new config, document defaults and keep backward compatibility.
