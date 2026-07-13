# revenuesplit

Revenue share ledgers and withdrawal requests for collaborators.

```ts
import { createRevenueSplitContract } from 'hive-stream';

await streamer.registerContract(createRevenueSplitContract());
```

::: tip SQL adapter
Most built-in contracts persist state in SQL tables and require a SQL-capable adapter (SQLite or PostgreSQL).
:::

## Actions

### createSplit

- **Trigger:** `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `splitId` | `string` | Yes |
| `title` | `string` | Yes |
| `recipients` | `object[]` | Yes |
| `metadata` | `record` | No |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"revenuesplit","action":"createSplit","payload":{}}}
```

### updateSplit

- **Trigger:** `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `splitId` | `string` | Yes |
| `recipients` | `object[]` | Yes |
| `metadata` | `record` | No |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"revenuesplit","action":"updateSplit","payload":{}}}
```

### distribute

- **Trigger:** `transfer`, `recurrent_transfer`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `splitId` | `string` | Yes |

Send as a transfer memo:

```json
{"hive_stream":{"contract":"revenuesplit","action":"distribute","payload":{}}}
```

### withdraw

- **Trigger:** `custom_json`

**Payload**

_No payload validation defined for this action._

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"revenuesplit","action":"withdraw","payload":{}}}
```
