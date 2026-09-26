# Package Surface

## Scaffolding CLI

The package ships a CLI (`npx hive-stream`) for starting new apps. Prefer it over hand-writing boilerplate when the task is "create a new Hive app":

- `npx hive-stream new <name> --template <minimal|game|exchange|social|blog|token|assets> --adapter <sqlite|mongodb|postgresql> --username <account> [--api] [--install] [--yes]`
- `npx hive-stream list` shows templates and adapters.
- Generated apps use `new Streamer({ env: true })` and read `HIVE_USERNAME`, `HIVE_POSTING_KEY`, and `HIVE_ACTIVE_KEY` from `.env`. They target Node 22, zod 4, TypeScript 6 and `tsx`.
- The generator itself is pure and browser-safe: `generateProjectFiles(options)` from `hive-stream/scaffold` returns `{ files, template, adapter, nextSteps }`. `src/scaffold/` holds it; `src/cli/` is a thin filesystem wrapper.

## Source Of Truth

For generated code or reviews, prefer these files over memory:

- `src/index.ts` for exported factories and namespaces
- `src/metadata.ts` for machine-readable signatures and defaults
- `src/catalog/contracts.json` (`hive-stream/catalog`) for every built-in contract's category, options, actions, triggers and payload fields
- `examples/recipes/` for type-checked end-to-end apps (dice with fairness, tournament, tipping with hooks, bridge, browser client)
- `README.md` for end-to-end usage
- `DOCUMENTATION.md` for contract semantics
- `examples/flows/` and `examples/contracts/` for concrete patterns

## Core Runtime Model

`Streamer` is the main entry point.

```ts
import { Streamer, SqliteAdapter } from 'hive-stream';

const streamer = new Streamer({ env: true });

await streamer.registerAdapter(new SqliteAdapter());
await streamer.start();
```

Important runtime behavior:

- `new Streamer()` is side-effect free. Config is validated in the constructor (`ConfigValidationError`).
- Blocks are processed once irreversible by default, the cursor is saved after every block, and contract actions are deduplicated by an idempotency ledger. See `reliability-and-hooks.md`.
- The default SQLite adapter is created lazily on first use.
- The built-in Express API is opt-in via `apiEnabled: true` on `start()` or an explicit `startApiServer()` call.
- `registerAdapter(...)`, `registerContract(...)`, and `registerAction(...)` are the main extension points.

## Choose The Right Surface

Use subscriptions for passive blockchain reactions:

- `onTransfer`
- `onCustomJson`
- `onCustomJsonId`
- `onHiveEngine`
- `onPost`
- `onComment`
- escrow subscriptions

Use contracts when the app should dispatch wrapped payloads into named handlers:

- `defineContract(...)`
- `action(...)`
- `registerContract(...)`

Use time actions for scheduled contract execution:

- `new TimeAction(...)`
- `registerAction(...)`

Use high-level namespaces when the app needs less boilerplate:

- `money.*` for amount parsing and allocation math
- `flows.*` for inbound transfer automation
- `ops.*` for fluent outbound write builders

Use `hive-stream/client` when another app surface needs to call a contract:

- `defineContractSpec(...)` for a shared schema/trigger definition
- `createContractCaller(...)` for typed payload, memo, custom JSON, and transfer builders
- direct `createContract*` helpers when no shared spec is available

Use hooks and guards for cross-cutting behaviour (metrics, allow-lists, bet limits, kill switches) instead of editing every handler. See `reliability-and-hooks.md`.

Use metadata when the task is scaffolding or introspection:

- `HIVE_STREAM_METADATA` / `getHiveStreamMetadata()` for subscriptions, write ops, config defaults, time values
- `hive-stream/catalog` (`contractCatalog`, `getCatalogContract()`, `getCatalogContractsByCategory()`, `CONTRACT_CATEGORIES`) for built-in contracts
- `hive-stream/scaffold` for generating a project in memory (browser tools)

Browser-safe entry points (no Node built-ins): `hive-stream/client`, `hive-stream/scaffold`, `hive-stream/catalog`.

## Testing (`hive-stream/testing`)

Always write tests with the bundled testing kit instead of mocking dhive or hitting mainnet:

```ts
import { createTestStreamer, hive } from 'hive-stream/testing';

const ts = await createTestStreamer({ username: 'myapp' });
await ts.streamer.registerContract(myContract);
await ts.contractTransfer({ from: 'alice', contract: 'mygame', action: 'play', amount: hive(1) });
expect(ts.outgoingTransfers).toHaveLength(1);   // captured, never broadcast
await ts.advanceTime('1h');                     // fires due TimeActions
await ts.stop();
```

- Runs a real `Streamer` offline: in-memory blocks (`MemoryBlockProvider`), captured broadcasts (`FakeHiveClient`), in-memory SQLite (built-in SQL contracts work).
- Other helpers: `contractJson()`, `transfer()`, `customJson()`, `sendOperations()`, `advanceBlocks(n)`, `getEvents()`, `ts.adapter.query(...)`, `ts.client.onCall(...)`/`setAccount(...)` for read stubs, `hive(n)`/`hbd(n)` formatters.
- Handlers that broadcast work without keys (throwaway keys are configured), and built-in games that re-read their transaction get it from the simulated blocks. Give house accounts a bankroll with `ts.client.setAccount('myhouse', { balance: '1000.000 HIVE' })`.
- `irreversibleLag` simulates LIB trailing head; `ts.provider.forkAt(...)` simulates microforks for `head` mode tests.
- `blockProvider` and `client` are injectable on any `Streamer` config for lower-level composition.

## Production Surface

- `streamer.getHealth()` → `{ status: 'ok'|'behind'|'stalled'|'halted'|'stopped', healthy, blocksBehind, ... }`; served at `/health` (200/503) and `/status` by the built-in API.
- `streamer.getStatus()` adds `streamMode`, `irreversibleBlockNumber`, `targetBlockNumber`, `lastBlockId`, `halted`, `lastError`.
- `streamer.enableGracefulShutdown()` — SIGINT/SIGTERM handlers that finish the current block and write a checkpoint; returns a disposer.
- `streamer.replayBlocks(from, to, { force? })` — reprocess a historical range (streamer must be stopped; moves the cursor; ledger skips actions already run unless `force`).
- `streamer.init()` + `streamer.processPendingBlocks()` — timer-free block processing.
- `logger` config option (or `setLogger()`) routes all library output through a custom `debug/info/warn/error` logger; console by default.
- ESM works natively: `import { Streamer } from 'hive-stream'` — one class copy at runtime, `instanceof` always safe.

## Config Defaults Worth Remembering

- `JSON_ID`: `hivestream`
- `PAYLOAD_IDENTIFIER`: `hive_stream`
- `HIVE_ENGINE_ID`: `ssc-mainnet-hive`
- `HIVE_ENGINE_API`: `https://api.hive-engine.com/rpc`
- `API_NODES`: `https://api.hive.blog`, `https://api.openhive.network`, `https://rpc.ausbit.dev`
- `BLOCK_CHECK_INTERVAL`: `1000`
- `RESUME_FROM_STATE`: `true`
- `API_ENABLED`: `false`
- `STREAM_MODE`: `irreversible`
- `CHECKPOINT_MODE`: `block`
- `ERROR_POLICY`: `skip` (recommend `halt` for money)
- `API_TIMEOUT_MS`: `10000`

CamelCase config input keys like `activeKey`, `payloadIdentifier`, `apiNodes`, and `resumeFromState` are preferred in application code.

## Adapters And Providers

Available adapters:

- `SqliteAdapter`
- `MongodbAdapter`
- `PostgreSQLAdapter`

Available block providers:

- `HiveProvider`
- `HafProvider`
- `BlockProvider` base type

If a task needs SQL features such as `adapter.query(...)`, prefer SQLite or Postgres. Do not assume MongoDB supports raw SQL helpers.

`mongodb` (^7) and `pg` (^8) are optional peer dependencies: install the driver for `MongodbAdapter`, `PostgreSQLAdapter` or `HafProvider`. SQLite (`better-sqlite3`) is bundled. `HafProvider` doesn't report the last irreversible block, so every block it serves is treated as irreversible.

The scaffolding CLI enforces this distinction: MongoDB is offered for `minimal` and `game`; SQL-backed templates use SQLite or PostgreSQL. Generated apps include `npm run verify` and an offline starter test.
