# groupbuy

Threshold-based pooled purchases.

**Category:** commerce

```ts
import { createGroupBuyContract } from 'hive-stream';

await streamer.registerContract(createGroupBuyContract());
```

::: tip SQL adapter
Most built-in contracts persist state in SQL tables and require a SQL-capable adapter (SQLite or PostgreSQL).
:::

## Options

| Option | Type | Required |
| --- | --- | --- |
| `name` | `string` | No |

## Actions

### createGroupBuy

- **Trigger:** `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `groupBuyId` | `string` | Yes |
| `title` | `string` | Yes |
| `targetAmount` | `string` | Yes |
| `asset` | `string` | Yes |
| `deadline` | `string` | Yes |
| `minParticipants` | `number` | No |
| `metadata` | `record` | No |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"groupbuy","action":"createGroupBuy","payload":{"groupBuyId":"example-1","title":"Example","targetAmount":"1.000","asset":"HIVE","deadline":"2030-01-01T00:00:00.000Z"}}}
```

### commit

- **Trigger:** `transfer`, `recurrent_transfer`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `groupBuyId` | `string` | Yes |

Send as a transfer memo:

```json
{"hive_stream":{"contract":"groupbuy","action":"commit","payload":{"groupBuyId":"example-1"}}}
```

### finalizeGroupBuy

- **Trigger:** `custom_json`, `time`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `groupBuyId` | `string` | Yes |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"groupbuy","action":"finalizeGroupBuy","payload":{"groupBuyId":"example-1"}}}
```

### withdrawCommitment

- **Trigger:** `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `groupBuyId` | `string` | Yes |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"groupbuy","action":"withdrawCommitment","payload":{"groupBuyId":"example-1"}}}
```
