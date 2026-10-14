# Package Surface (5.x)

## Scaffolding CLI

The package ships a CLI (`npx hive-stream`) for starting new apps. Prefer it over hand-writing boilerplate when the task is "create a new Hive app":

- `npx hive-stream new <name> --template <minimal|game|exchange|social|blog|token|assets> --adapter <sqlite|mongodb|postgresql> --username <account> [--api] [--install] [--yes]`
- `npx hive-stream list` shows templates and adapters.
- Generated apps use `new Streamer({ env: true })` and read `HIVE_USERNAME`, `HIVE_POSTING_KEY`, and `HIVE_ACTIVE_KEY` from `.env`. They target Node 22, zod 4, TypeScript 6 and `tsx`. The `game` template turns on `refundRejectedTransfers`.
- The generator itself is pure and browser-safe: `generateProjectFiles(options)` from `hive-stream/scaffold` returns `{ files, template, adapter, nextSteps }`. `src/scaffold/` holds it; `src/cli/` is a thin filesystem wrapper.

## Source Of Truth

For generated code or reviews, prefer these files over memory:

- `src/index.ts` for exported factories and namespaces
- `src/metadata.ts` for machine-readable signatures and defaults
- `src/catalog/contracts.json` (`hive-stream/catalog`) for every built-in contract's category, storage requirement, options, actions, triggers, active-key requirements, payload fields and an example payload per action
- `docs/contracts/*.md` (generated from the same source) for per-contract semantics: what each action does, who may call it, which account it pays from
- `docs/guide/*.md` for guides: `security.md`, `escrow.md`, `hooks.md`, `configuration.md`, `troubleshooting.md`, `migrating-to-5.md`
- `examples/recipes/` for type-checked end-to-end apps (dice with fairness, tournament, tipping with hooks, bridge, escrow marketplace, P2P swap desk, DAO, multi-account, browser client)
- `README.md` for end-to-end usage
- `examples/flows/` and `examples/contracts/` for concrete patterns

`DOCUMENTATION.md` covers writing your own contracts; for built-in contract behaviour use the generated contract pages and the catalog, which can't drift from the code.

## Core Runtime Model

`Streamer` is the main entry point.

```ts
import { Streamer, SqliteAdapter } from 'hive-stream';

const streamer = new Streamer({ env: true, errorPolicy: 'halt', refundRejectedTransfers: true });

await streamer.registerAdapter(new SqliteAdapter());
await streamer.start();
```

Important runtime behavior:

- `new Streamer()` is side-effect free. Config is validated in the constructor (`ConfigValidationError`), including environment values that don't parse.
- Blocks are processed once irreversible by default, the cursor is saved after every block, and contract actions (and their rejections) are deduplicated by an idempotency ledger. See `reliability-and-hooks.md`.
- Transfer-triggered contract actions only run for transfers addressed to an app account (or the action's `allowedRecipients`). See `contracts-and-triggers.md`.
- The default SQLite adapter is created lazily on first use.
- The built-in Express API is opt-in via `apiEnabled: true` on `start()` or an explicit `startApiServer()` call. It has no authentication and binds to `apiHost` (default `127.0.0.1`); only set `apiHost: '0.0.0.0'` behind an authenticating proxy. `/transfers`, `/json` and `/events` are paged (`?limit=` default 100, max 1000; `?offset=`).
- `registerAdapter(...)`, `registerContract(...)`, and `registerAction(...)` are the main extension points.

## Several App Accounts

One process can act as several accounts (house + treasury, marketplace + escrow agent):

```ts
const streamer = new Streamer({
    env: true,                                      // HIVE_ACCOUNT / HIVE_ACTIVE_KEY / HIVE_POSTING_KEY = primary
    accounts: [
        { name: 'myapp-vault', activeKey: process.env.VAULT_ACTIVE_KEY },
        { name: 'myapp-agent', activeKey: process.env.AGENT_ACTIVE_KEY, postingKey: process.env.AGENT_POSTING_KEY }
    ]
});
```

- Env: `HIVE_ACCOUNTS` as a JSON array of the same shape.
- Runtime: `getAppAccounts()` (primary first), `isAppAccount(name)`, `addAccount({ name, activeKey?, postingKey? })`, `removeAccount(name)`.
- Transfers to any app account run contract actions (`allowedRecipients` defaults to the whole list); `ctx.transfer.to` says which one was paid.
- Every write method signs with the keys of the account it acts as (`transferHiveTokens('myapp-vault', ...)` uses the vault's active key). `streamer.batch()` / `broadcastOperations()` sign with every key the operations need. An account listed without keys signs with the primary keys (for accounts that granted the app account authority).
- `refundRejectedTransfers` refunds from the account that received the payment.
- `onTransfer(['myapp', 'myapp-vault'], cb)` subscribes to several accounts.
- Built-in contracts pay from one account (`options.account` or the primary username); register several instances with distinct `name`s for per-account markets.
- Run one streamer process per set of app accounts. Two processes on the same account both pay out.

## Choose The Right Surface

Use subscriptions for passive blockchain reactions (at-least-once, not covered by the ledger):

- `onTransfer(account | account[], cb)`: the callback's seventh argument is the operation index
- `onCustomJson`, `onCustomJsonId`
- `onHiveEngine`: only delivers transactions the sidechain confirmed it executed (retried three times while it indexes; rejected or still-unknown ones go to `onError` with phase `subscription`). Never credit token payments from raw `custom_json`.
- `onPost`, `onComment`, `onVote`, `onFollow`, `onReblog`, ... (`onAnyOperation` for everything)
- `onEscrowTransfer`, `onEscrowApprove`, `onEscrowDispute`, `onEscrowRelease`

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
- `createContractEscrowTransferOperation(...)` for the buyer-signed `escrow_transfer` that opens an escrow carrying a contract call
- direct `createContract*` helpers when no shared spec is available

Use hooks and guards for cross-cutting behaviour (metrics, allow-lists, bet limits, kill switches) instead of editing every handler. See `reliability-and-hooks.md`.

Use metadata when the task is scaffolding or introspection:

- `HIVE_STREAM_METADATA` / `getHiveStreamMetadata()` for subscriptions, write ops, config defaults, time values
- `hive-stream/catalog`: `contractCatalog`, `getCatalogContract(nameOrFactory)`, `getCatalogContractsByCategory()`, `getCatalogContractsForAdapter({ sql })` (pass `{ sql: false }` for MongoDB), `CONTRACT_CATEGORIES`. Each entry has `storage: 'sql' | 'any'`; each action has an `example` payload.
- `hive-stream/scaffold` for generating a project in memory (browser tools)

Browser-safe entry points (no Node built-ins): `hive-stream/client`, `hive-stream/scaffold`, `hive-stream/catalog`.

## Utilities Worth Knowing

- `Utils.verifyTransfer(transaction, from, to, amount, operationIndex?)` re-reads a transfer at its own operation index. Pass `ctx.transaction.operationIndex` so a multi-operation transaction can't pass on another operation's transfer.
- `Utils.formatEngineQuantity(quantity, label?)` formats a Hive Engine quantity or price as the plain decimal string the sidechain expects (BigNumber, 8 decimals max; rejects exponent notation, signs, zero and negatives).
- `transferHiveEngineTokensMultiple` / `issueHiveEngineTokensMultiple` (on `Utils` and the streamer) return `{ sent, failed }` per batch. A failing batch doesn't stop the rest; retry only the `failed` recipients because `sent` is on-chain.

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
- The default username is `testaccount`. Pass `username` matching the house account: `contractTransfer` sends to the username by default, and transfers to any other account are rejected (`recipient_not_allowed`).
- Inputs: `contractTransfer()`, `contractJson(sender, { contract, action, payload, activeKey? })`, `transfer(from, to, amount, memo)`, `customJson()`, `sendOperations([[type, data], ...])` for anything else (escrow operations included), `advanceBlocks(n)`, `advanceTime('30s' | '5m' | '1h' | '2d' | '1w')`.
- Assertions: `outgoingTransfers`, `comments` (captured `comment` operations, e.g. reply notifications), `broadcasts`, `ts.client.operations` / `transfers` / `customJsons`, `getEvents()`, `ts.adapter.query(...)`.
- Builders: `contractPayload()`, `contractMemo()` (also usable as escrow `json_meta`), `hive(n)` / `hbd(n)` -> `'1.500 HIVE'`.
- Read stubs: `ts.client.onCall(method, value | fn)`, `ts.client.setAccount(name, { balance })`. Give house accounts a bankroll or bets are refunded because the house can't cover them.
- Built-in games are provably fair by default, so tests assert through the event/memo proof or pass `fairness: false` for legacy block-id outcomes.
- `irreversibleLag` simulates LIB trailing head; `ts.provider.forkAt(...)` simulates microforks for `head` mode tests.
- `blockProvider` and `client` are injectable on any `Streamer` config for lower-level composition.

## Production Surface

- `streamer.getHealth()` -> `{ status: 'ok'|'behind'|'stalled'|'halted'|'stopped', healthy, blocksBehind, ... }`; served at `/health` (200/503) and `/status` by the built-in API.
- `streamer.getStatus()` adds `streamMode`, `irreversibleBlockNumber`, `targetBlockNumber`, `lastBlockId`, `halted`, `lastError`.
- After a halt, fix the cause and call `start()` again (or `processPendingBlocks()`); it resumes at the failed block and the ledger skips actions that already succeeded.
- `streamer.enableGracefulShutdown()`: SIGINT/SIGTERM handlers that finish the current block and write a checkpoint; returns a disposer.
- `streamer.replayBlocks(from, to, { force? })`: reprocess a historical range (streamer must be stopped; moves the cursor; ledger skips actions already run unless `force`).
- `streamer.init()` + `streamer.processPendingBlocks()`: timer-free block processing.
- `logger` config option (or `setLogger()`) routes all library output through a custom `debug/info/warn/error` logger; console by default.
- ESM works natively: `import { Streamer } from 'hive-stream'`; one class copy at runtime, `instanceof` always safe.

## Config Defaults Worth Remembering

- `JSON_ID`: `hivestream`
- `PAYLOAD_IDENTIFIER`: `hive_stream`
- `HIVE_ENGINE_ID`: `ssc-mainnet-hive`
- `HIVE_ENGINE_API`: `https://api.hive-engine.com/rpc`
- `API_NODES`: `https://api.hive.blog`, `https://api.openhive.network`, `https://rpc.ausbit.dev`
- `BLOCK_CHECK_INTERVAL`: `1000`
- `RESUME_FROM_STATE`: `true`
- `API_ENABLED`: `false`; `API_HOST`: `127.0.0.1`; `API_PORT`: `5001`
- `STREAM_MODE`: `irreversible`
- `CHECKPOINT_MODE`: `block`
- `ERROR_POLICY`: `skip` (recommend `halt` for money)
- `REFUND_REJECTED_TRANSFERS`: `false` (recommend `true` for apps that take payments)
- `API_TIMEOUT_MS`: `10000`

CamelCase config input keys like `activeKey`, `payloadIdentifier`, `apiNodes`, `apiHost`, `accounts`, and `refundRejectedTransfers` are preferred in application code.

Environment (`env: true`): the username comes from `HIVE_ACCOUNT`, `HIVE_USERNAME`, `ACCOUNT`, `USERNAME` (first match). Recommend `HIVE_ACCOUNT`: on Windows a bare `USERNAME` is the OS login and is ignored. Keys come from `HIVE_ACTIVE_KEY`/`ACTIVE_KEY` and `HIVE_POSTING_KEY`/`POSTING_KEY`; extra accounts from `HIVE_ACCOUNTS`; everything else from its uppercase name. Booleans accept `true/false`, `1/0`, `yes/no`, `on/off`; anything else (`IDEMPOTENCY_ENABLED=ture`, `ERROR_MAX_RETRIES=5x`) is a `ConfigValidationError`.

## Adapters And Providers

Available adapters:

- `SqliteAdapter`
- `MongodbAdapter`
- `PostgreSQLAdapter`

Available block providers:

- `HiveProvider`
- `HafProvider`
- `BlockProvider` base type

If a task needs SQL features such as `adapter.query(...)`, prefer SQLite or Postgres. Do not assume MongoDB supports raw SQL helpers. Only dice, coinflip, roulette, rps, lotto and limbo run on MongoDB (catalog `storage: 'any'`); every other built-in contract needs SQL and refuses to register on MongoDB.

Adapters page their stored data: `getTransfers` / `getJson` / `getEvents` accept `{ limit, offset }`, and `getCounts()` returns row counts. A custom adapter must persist the ledger (`hasProcessedOperation`, `markOperationProcessed`, `pruneProcessedOperations`); `AdapterBase` keeps it in memory only.

`mongodb` (^7) and `pg` (^8) are optional peer dependencies: install the driver for `MongodbAdapter`, `PostgreSQLAdapter` or `HafProvider`. SQLite (`better-sqlite3`) is bundled. `HafProvider` doesn't report the last irreversible block, so every block it serves is treated as irreversible.

The scaffolding CLI enforces this distinction: MongoDB is offered for `minimal` and `game`; SQL-backed templates use SQLite or PostgreSQL. Generated apps include `npm run verify` and an offline starter test.
