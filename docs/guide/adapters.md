# Storage Adapters

Adapters persist everything Hive Stream needs across restarts: the last processed block, time-based actions, operation logs, and contract state. Three ship with the library.

## SQLite (default)

Zero configuration — a `hive-stream.db` file appears in your working directory on first use.

```ts
import { Streamer, SqliteAdapter } from 'hive-stream';

const streamer = new Streamer(config);

// Optional: choose the database location, or ':memory:' for ephemeral state
await streamer.registerAdapter(new SqliteAdapter('./data/my-app.db'));
```

## PostgreSQL

The PostgreSQL driver is an optional peer dependency:

```shell
npm install pg
```

```ts
import { Streamer, PostgreSQLAdapter } from 'hive-stream';

const adapter = new PostgreSQLAdapter({
    connectionString: 'postgresql://user:pass@localhost:5432/hive_stream'
});
// or discrete options: { host, port, user, password, database }

await streamer.registerAdapter(adapter);
```

## MongoDB

The MongoDB driver (v7) is an optional peer dependency:

```shell
npm install mongodb
```

```ts
import { Streamer, MongodbAdapter } from 'hive-stream';

const adapter = new MongodbAdapter('mongodb://localhost:27017', 'hive_stream');
await streamer.registerAdapter(adapter);
```

::: warning SQL-backed contracts
Most built-in contracts persist state in SQL tables, so they require SQLite or PostgreSQL. MongoDB fully supports streamer persistence (block state, transfers, custom JSON) and custom contracts that manage their own state without raw SQL.
:::

## Choosing an adapter

| | SQLite | PostgreSQL | MongoDB |
| --- | --- | --- | --- |
| Setup | None | Server required | Server required |
| Built-in SQL contracts | ✅ | ✅ | ❌ |
| Best for | Bots, games, single-node apps | Multi-service production apps | Existing Mongo stacks, custom contracts |

## Writing your own

Extend `AdapterBase` and implement at minimum `loadState` and `saveState`:

```ts
import { AdapterBase } from 'hive-stream';

export class MyAdapter extends AdapterBase {
    public async loadState() {
        return { lastBlockNumber: 0, actions: [] };
    }

    public async saveState(data: { lastBlockNumber: number; actions: any[] }) {
        // persist somewhere
        return true;
    }
}
```

Optional overrides let you capture more: `processBlock`, `processOperation`, `processTransfer`, `processCustomJson`, `processEscrow`, the `find`/`insert`/`replace` document helpers, `query` and `runInTransaction` for SQL support (set `capabilities.sql = true`), `addEvent`/`getEvents` for contract event logs, and `getCounts` for the API's `/stats` route. The list methods (`getTransfers`, `getJson`, `getEvents`) take `{ limit, offset }`. The three shipped adapters in `src/adapters/` are the reference implementations.

::: warning Persist the idempotency ledger
`AdapterBase` keeps the ledger (`hasProcessedOperation`, `markOperationProcessed`, `pruneProcessedOperations`) in memory. That is enough for tests, but a custom adapter that doesn't override the three methods with real storage loses exactly-once protection on every restart: the block being processed when the process died runs its contract actions again. Store the records in your database, keyed by `key`, before relying on the adapter for money.
:::
