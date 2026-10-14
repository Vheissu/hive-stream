# Repository Guidelines

## Project Structure & Module Organization
- `src/` holds TypeScript source. Core entry points are `streamer.ts`, `api.ts`, and `index.ts`.
- `src/adapters/` contains SQLite/Mongo/Postgres adapters (each also stores the idempotency ledger); `src/contracts/` has the 48 built-in contract factories; `src/fairness/` has provably fair randomness; `src/hooks.ts` defines streamer hooks; `src/exchanges/` has rate helpers; `src/types/` centralizes shared types.
- Browser-safe entry points: `src/client/` (`hive-stream/client`), `src/scaffold/` (`hive-stream/scaffold`, used by the CLI in `src/cli/`), `src/catalog/` (`hive-stream/catalog`). They must not import Node built-ins or packages; `tests/browser-safe-entries.spec.ts` enforces it.
- `src/testing/` is the offline testing kit (`hive-stream/testing`).
- `tests/` contains Jest specs (`**/*.spec.ts`) plus `tests/integration/` and `tests/helpers/`.
- `dist/` is generated build output; `examples/` provides usage samples (type-checked by `tests/examples-typecheck.spec.ts`; `examples/recipes/` backs the Recipes docs page); `ecosystem.config.js` is a PM2 reference.
- Generated, never hand-edited: `docs/contracts/*.md` and `src/catalog/contracts.json` (`npm run docs:gen` / `catalog:gen`; add new contracts to `scripts/lib/contract-metadata.ts`), `src/scaffold/version.ts`.

## Build, Test, and Development Commands
- `npm install` installs dependencies.
- `npm run build` regenerates the version file and contract catalog, compiles TypeScript to `dist/`, and writes the ESM wrappers.
- `npm run docs:dev` / `npm run docs:build` regenerate contract reference pages and run VitePress.
- `npm run start` runs the local dev harness (`src/test.ts`) via tsx.
- `npm run watch` enables TypeScript watch mode.
- `npm test` runs the Jest suite.
- `npm run clean-tests` clears Jest cache if tests act stale.

## Coding Style & Naming Conventions
- TypeScript with CommonJS output; keep module boundaries within `src/`.
- Indent 4 spaces; prefer single quotes.
- File naming conventions: `*.adapter.ts`, `*.contract.ts`, `*.spec.ts`; shared types live in `src/types/`.
- No linter is configured; match the surrounding style before introducing new tooling.

## Testing Guidelines
- Framework: Jest + `ts-jest` (see `jest.config.js`).
- Place specs under `tests/` and name `*.spec.ts` (example: `tests/utils.spec.ts`).
- Use `tests/setup.ts` for shared mocks; integration tests live under `tests/integration/`.
- No coverage thresholds are configured; add focused tests for new adapters, contracts, or API routes.

## Commit & Pull Request Guidelines
- Follow Conventional Commits with scopes, as in history: `feat(api): ...`, `fix(contract): ...`, `chore(deps): ...`, `docs(readme): ...`.
- PRs should include: a clear summary, testing notes (`npm test`/`npm run build`), and docs/CHANGELOG updates for user-facing changes.

## Safety Defaults (5.0)
- Transfer-triggered contract actions run only for transfers addressed to an app account (`USERNAME` plus `accounts`), or to the action's `allowedRecipients` guard (`['*']` for non-custodial actions that verify the recipient themselves).
- `refundRejectedTransfers` (opt-in) sends rejected payments back from the account that received them; rejections are in the idempotency ledger first.
- Every write method signs with the keys of the account it acts as (`accounts` config); a batch is signed with every key it needs.
- The HTTP API binds to loopback and pages its list routes; `onHiveEngine` delivers only sidechain-verified transactions; flows dedupe per operation through the ledger.
- Escrow `approve`/`dispute`/`release` reach every action declaring that trigger, with the escrow details as the payload.

## Configuration & Security Notes
- Keys and usernames should come from env/config (see `src/config.ts`); never commit secrets.
- When adding new config, document defaults, add validation in `src/config.ts`, and keep backward compatibility.
- Money handling: use the BigNumber-based money utilities, never floats; use block time, not wall-clock time, in contracts so replays are deterministic.
