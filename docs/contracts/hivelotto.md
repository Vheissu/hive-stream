# hivelotto

A lottery-style game with scheduled draws.

```ts
import { createLottoContract } from 'hive-stream';

await streamer.registerContract(createLottoContract());
```

::: tip SQL adapter
Most built-in contracts persist state in SQL tables and require a SQL-capable adapter (SQLite or PostgreSQL).
:::

## Actions

### buy

- **Trigger:** `transfer`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `type` | `"hourly" | "daily"` | Yes |

Send as a transfer memo:

```json
{"hive_stream":{"contract":"hivelotto","action":"buy","payload":{}}}
```

### drawHourlyLottery

- **Trigger:** `time`

**Payload**

_No payload validation defined for this action._

### drawDailyLottery

- **Trigger:** `time`

**Payload**

_No payload validation defined for this action._
