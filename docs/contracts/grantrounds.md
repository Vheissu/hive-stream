# grantrounds

Matching grant rounds with submissions, donations, and allocations.

```ts
import { createGrantRoundsContract } from 'hive-stream';

await streamer.registerContract(createGrantRoundsContract());
```

::: tip SQL adapter
Most built-in contracts persist state in SQL tables and require a SQL-capable adapter (SQLite or PostgreSQL).
:::

## Actions

### createRound

- **Trigger:** `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `roundId` | `string` | Yes |
| `title` | `string` | Yes |
| `asset` | `string` | Yes |
| `closesAt` | `string` | Yes |
| `metadata` | `record` | No |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"grantrounds","action":"createRound","payload":{}}}
```

### fundRound

- **Trigger:** `transfer`, `recurrent_transfer`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `roundId` | `string` | Yes |

Send as a transfer memo:

```json
{"hive_stream":{"contract":"grantrounds","action":"fundRound","payload":{}}}
```

### submitProject

- **Trigger:** `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `roundId` | `string` | Yes |
| `projectId` | `string` | Yes |
| `title` | `string` | Yes |
| `recipient` | `string` | Yes |
| `summary` | `string` | No |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"grantrounds","action":"submitProject","payload":{}}}
```

### donateToProject

- **Trigger:** `transfer`, `recurrent_transfer`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `roundId` | `string` | Yes |
| `projectId` | `string` | Yes |

Send as a transfer memo:

```json
{"hive_stream":{"contract":"grantrounds","action":"donateToProject","payload":{}}}
```

### finalizeRound

- **Trigger:** `custom_json`, `time`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `roundId` | `string` | Yes |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"grantrounds","action":"finalizeRound","payload":{}}}
```

### withdrawGrant

- **Trigger:** `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `roundId` | `string` | Yes |
| `projectId` | `string` | Yes |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"grantrounds","action":"withdrawGrant","payload":{}}}
```
