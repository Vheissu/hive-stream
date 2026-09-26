# tipjar

A tip jar with an optional message board.

**Category:** social

```ts
import { createTipJarContract } from 'hive-stream';

await streamer.registerContract(createTipJarContract());
```

::: tip SQL adapter
This contract keeps its state in SQL tables and needs a SQL-capable adapter (SQLite or PostgreSQL). Registering it on MongoDB fails.
:::

## Options

| Option | Type | Required |
| --- | --- | --- |
| `name` | `string` | No |

## Actions

### tip

- **Trigger:** `transfer`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `message` | `string` | No |

Send as a transfer memo:

```json
{"hive_stream":{"contract":"tipjar","action":"tip","payload":{}}}
```
