# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Hive Stream is a Node.js library for streaming and reacting to blockchain actions on the Hive blockchain. It provides a layer for monitoring blockchain operations, executing contracts, and managing time-based actions. The library includes adapters for data persistence (SQLite, PostgreSQL, MongoDB), 45 built-in contracts, hooks and guards, provably fair randomness, and an offline testing kit.

## Development Commands

### Building and Development
- `npm run build` - Compiles TypeScript to JavaScript using tsconfig.build.json
- `npm run watch` - Watches TypeScript files and recompiles on changes
- `npm start` - Runs the dev harness (src/test.ts) using tsx

### Testing and Quality
- `npm test` - Runs Jest tests with verbose output from tests/ directory
- `npm run clean-tests` - Clears Jest cache

### Code Quality
- No linter is configured; match the existing style (4-space indent, single quotes)
- TypeScript 6, targeting ES2023 with CommonJS output (ESM wrappers generated at build time); Node >= 22
- Jest configured with ts-jest for TypeScript testing

## Code Style Guidelines
- Always use curly braces for if statements and never shorthand

## Architecture

### Core Components

**Streamer (`src/streamer.ts`)**: Block polling, operation dispatch, subscriptions, contract execution, time actions and the write-operation namespaces (`ops`, `flows`, `money`, `query`, `engine`). Processes blocks up to the last irreversible block by default (`streamMode: 'irreversible'`); `head` mode detects forks, rewinds to the common ancestor and fires `onFork`. The cursor is checkpointed after every block (`checkpointMode`). `errorPolicy` (`skip` / `halt` / `retry`) decides what a failing handler or storage write does.

**Hooks (`src/hooks.ts`)**: Streamer hooks (`beforeBlock`, `beforeOperation`, `beforeContractAction`, `afterContractAction`, `onActionRejected`, `onFork`, `onError`, `onCheckpoint`, ...) registered via config, `streamer.hook()` or `streamer.use()`. Hooks and subscription callbacks are awaited in order.

**Contracts (`src/contracts/`)**: `defineContract` / `action` in `contract.ts` (validation of actions, hooks and guards). 45 built-in factories (`create*Contract`). Contract hooks: `create`, `destroy`, `beforeAction`, `afterAction`, `onError`. Declarative guards: `allowedSenders`, `blockedSenders`, `allowedAssets`, `minAmount`, `maxAmount`, `rateLimit`, `paused`. New contracts should use block time (`ctx.block.time`) and key records with `operationRecordId(trxId, opIndex)`.

**Fairness (`src/fairness/`)**: Commit-reveal provably fair randomness (`createFairness`, `FairnessManager`), with a dependency-free SHA-256/HMAC so `verifyOutcome()` runs in browsers via `hive-stream/client`. Dice, coinflip, roulette, rps and lotto take an opt-in `fairness` option; limbo always uses it.

**Adapters (`src/adapters/`)**: SQLite (default, bundled), PostgreSQL and MongoDB (optional peer dependencies loaded lazily through `src/optional-dependency.ts`). Adapters persist state (`lastBlockNumber`, `lastBlockId`), time actions, events, and the idempotency ledger (`hasProcessedOperation` / `markOperationProcessed` / `pruneProcessedOperations`, table `processed_operations`). `AdapterBase` has an in-memory ledger default.

**Configuration (`src/config.ts`)**: camelCase and uppercase keys, env loading (`env: true`), and validation at construction (`ConfigValidationError`). `defineConfig()` / `validateConfig()`.

**Browser-safe entry points**: `hive-stream/client` (`src/client/`, contract call builders and fairness verifier), `hive-stream/scaffold` (`src/scaffold/`, pure project generator used by the CLI in `src/cli/`), `hive-stream/catalog` (`src/catalog/`, generated contract metadata). `tests/browser-safe-entries.spec.ts` fails if they import Node built-ins or packages.

**Testing kit (`src/testing/`)**: `createTestStreamer()` runs a real Streamer on `MemoryBlockProvider` + `FakeHiveClient` + in-memory SQLite.

### Generated files (don't hand-edit)

- `docs/contracts/*.md` and `src/catalog/contracts.json` come from `npm run docs:gen` / `npm run catalog:gen` (both run by `npm run build`), via `scripts/lib/contract-introspection.ts`. A new contract factory needs one line in `scripts/lib/contract-metadata.ts`.
- `src/scaffold/version.ts` comes from `scripts/generate-version.js`.
- ESM `.mjs` files in `dist/` are thin wrappers from `scripts/generate-esm-wrappers.js`; there is deliberately no dual build.

### Environment Variables

- `ACTIVE_KEY` / `HIVE_ACTIVE_KEY` - transfers, Hive Engine ops and active-authority custom JSON
- `POSTING_KEY` / `HIVE_POSTING_KEY` - posting operations
- `USERNAME` / `HIVE_ACCOUNT` / `HIVE_USERNAME` - the app account
- Reliability options also read from env (`STREAM_MODE`, `ERROR_POLICY`, `CHECKPOINT_MODE`, ...)

### Deployment

`ecosystem.config.js` is a PM2 reference. `enableGracefulShutdown()` finishes the current block and checkpoints on SIGINT/SIGTERM; `getHealth()` is served at `/health` when the API is enabled.

### Testing Strategy

Jest specs live in `tests/` (`tests/integration/` for adapters and live network suites, which need `RUN_LIVE_TESTS=1`). Prefer the testing kit for contract tests. `tests/examples-typecheck.spec.ts` compiles everything under `examples/` against `src/` with strict settings, so docs recipes stay correct.
