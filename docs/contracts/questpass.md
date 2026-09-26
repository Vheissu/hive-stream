# questpass

Seasonal passes with progress tracking and reward claims.

**Category:** games

```ts
import { createQuestPassContract } from 'hive-stream';

await streamer.registerContract(createQuestPassContract());
```

::: tip SQL adapter
This contract keeps its state in SQL tables and needs a SQL-capable adapter (SQLite or PostgreSQL). Registering it on MongoDB fails.
:::

## Options

| Option | Type | Required |
| --- | --- | --- |
| `name` | `string` | No |

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
{"hive_stream":{"contract":"questpass","action":"createSeason","payload":{"seasonId":"example-1","title":"Example","passPrice":"1.000","asset":"HIVE","tiers":[{"tierId":"example-1","minPoints":1,"rewardType":"example-1","rewardValue":"1.000"}]}}}
```

### buyPass

- **Trigger:** `transfer`, `recurrent_transfer`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `seasonId` | `string` | Yes |

Send as a transfer memo:

```json
{"hive_stream":{"contract":"questpass","action":"buyPass","payload":{"seasonId":"example-1"}}}
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
{"hive_stream":{"contract":"questpass","action":"recordProgress","payload":{"seasonId":"example-1","account":"alice","points":1}}}
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
{"hive_stream":{"contract":"questpass","action":"claimReward","payload":{"seasonId":"example-1","tierId":"example-1"}}}
```
