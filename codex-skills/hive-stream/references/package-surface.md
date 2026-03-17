# Package Surface

## Source Of Truth

For generated code or reviews, prefer these files over memory:

- `src/index.ts` for exported factories and namespaces
- `src/metadata.ts` for machine-readable signatures and defaults
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

- `new Streamer()` is side-effect free.
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

Use metadata when the task is scaffolding or introspection:

- `HIVE_STREAM_METADATA`
- `getHiveStreamMetadata()`

## Config Defaults Worth Remembering

- `JSON_ID`: `hivestream`
- `PAYLOAD_IDENTIFIER`: `hive_stream`
- `HIVE_ENGINE_ID`: `ssc-mainnet-hive`
- `HIVE_ENGINE_API`: `https://api.hive-engine.com/rpc`
- `API_NODES`: `https://api.hive.blog`, `https://api.openhive.network`, `https://rpc.ausbit.dev`
- `BLOCK_CHECK_INTERVAL`: `1000`
- `RESUME_FROM_STATE`: `true`
- `API_ENABLED`: `false`

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
