# questpass

Seasonal passes with progress tracking and reward claims.

```ts
import { createQuestPassContract } from 'hive-stream';

await streamer.registerContract(createQuestPassContract());
```

::: tip SQL adapter
Most built-in contracts persist state in SQL tables and require a SQL-capable adapter (SQLite or PostgreSQL).
:::

## Actions

### createSeason

- **Trigger:** `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `seasonId` | `string` | Yes |
| `title` | `string` | Yes |
| `passPrice` | `string` | Yes |
| `asset` | `string` | Yes |
| `tiers` | `object[]` | Yes |
| `metadata` | `record` | No |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"questpass","action":"createSeason","payload":{}}}
```

### buyPass

- **Trigger:** `transfer`, `recurrent_transfer`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `seasonId` | `string` | Yes |

Send as a transfer memo:

```json
{"hive_stream":{"contract":"questpass","action":"buyPass","payload":{}}}
```

### recordProgress

- **Trigger:** `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `seasonId` | `string` | Yes |
| `account` | `string` | Yes |
| `points` | `number` | Yes |
| `sourceId` | `string` | No |
| `note` | `string` | No |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"questpass","action":"recordProgress","payload":{}}}
```

### claimReward

- **Trigger:** `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `seasonId` | `string` | Yes |
| `tierId` | `string` | Yes |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"questpass","action":"claimReward","payload":{}}}
```
