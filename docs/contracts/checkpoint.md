# checkpoint

Deterministic state hashes published on-chain for operator verification.

**Category:** utility

```ts
import { createCheckpointContract } from 'hive-stream';

await streamer.registerContract(createCheckpointContract({ tables: ['...'] }));
```

::: tip SQL adapter
Most built-in contracts persist state in SQL tables and require a SQL-capable adapter (SQLite or PostgreSQL).
:::

## Options

| Option | Type | Required |
| --- | --- | --- |
| `name` | `string` | No |
| `tables` | `string[]` | Yes |
| `account` | `string` | No |

## Actions

### publishCheckpoint

- **Trigger:** `time`, `custom_json`

**Payload**

_No payload validation defined for this action._

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"checkpoint","action":"publishCheckpoint","payload":{}}}
```

### recordCheckpoint

- **Trigger:** `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `checkpointId` | `string` | Yes |
| `blockNumber` | `number` | Yes |
| `stateHash` | `string` | Yes |
| `tables` | `string[]` | Yes |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"checkpoint","action":"recordCheckpoint","payload":{}}}
```
