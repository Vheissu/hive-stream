# hivedice

A dice rolling game with configurable win chance and payout multipliers.

```ts
import { createDiceContract } from 'hive-stream';

await streamer.registerContract(createDiceContract());
```

::: tip SQL adapter
Most built-in contracts persist state in SQL tables and require a SQL-capable adapter (SQLite or PostgreSQL).
:::

## Actions

### roll

- **Trigger:** `transfer`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `roll` | `number` | Yes |

Send as a transfer memo:

```json
{"hive_stream":{"contract":"hivedice","action":"roll","payload":{}}}
```

### testauto

- **Trigger:** `time`

**Payload**

_No payload validation defined for this action._
