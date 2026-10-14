# groupbuy

Threshold-based pooled purchases.

**Category:** commerce

```ts
import { createGroupBuyContract } from 'hive-stream';

await streamer.registerContract(createGroupBuyContract());
```

::: tip SQL adapter
This contract keeps its state in SQL tables and needs a SQL-capable adapter (SQLite or PostgreSQL). Registering it on MongoDB fails.
:::

## Options

| Option | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | `string` | No |  |
| `account` | `string` | No | Account that receives commitments and refunds rejected ones. Refunds are signed with the app's active key, so this must be the app account. Defaults to the streamer username. |

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

Commit funds by sending the group buy asset to the app account; commitments to a missing, closed or expired group buy, or in the wrong asset, are refunded.

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

Withdraw your commitments before the deadline (lowering the totals) or after the group buy failed.

- **Trigger:** `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `groupBuyId` | `string` | Yes |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"groupbuy","action":"withdrawCommitment","payload":{"groupBuyId":"example-1"}}}
```
