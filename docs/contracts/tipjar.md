# tipjar

A tip jar with an optional message board.

```ts
import { createTipJarContract } from 'hive-stream';

await streamer.registerContract(createTipJarContract());
```

::: tip SQL adapter
Most built-in contracts persist state in SQL tables and require a SQL-capable adapter (SQLite or PostgreSQL).
:::

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
