# rps

Rock-paper-scissors with wagers.

```ts
import { createRpsContract } from 'hive-stream';

await streamer.registerContract(createRpsContract());
```

::: tip SQL adapter
Most built-in contracts persist state in SQL tables and require a SQL-capable adapter (SQLite or PostgreSQL).
:::

## Actions

### play

- **Trigger:** `transfer`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `move` | `"rock" | "paper" | "scissors"` | Yes |
| `seed` | `string` | No |

Send as a transfer memo:

```json
{"hive_stream":{"contract":"rps","action":"play","payload":{}}}
```
