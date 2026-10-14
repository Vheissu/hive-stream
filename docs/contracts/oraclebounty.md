# oraclebounty

Oracle bounty feeds with report rounds and median finalization.

**Category:** utility

```ts
import { createOracleBountyContract } from 'hive-stream';

await streamer.registerContract(createOracleBountyContract());
```

::: tip SQL adapter
This contract keeps its state in SQL tables and needs a SQL-capable adapter (SQLite or PostgreSQL). Registering it on MongoDB fails.
:::

## Options

| Option | Type | Required |
| --- | --- | --- |
| `name` | `string` | No |

## Actions

### createFeed

- **Trigger:** `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `feedId` | `string` | Yes |
| `title` | `string` | Yes |
| `rewardPerReport` | `string` | Yes |
| `rewardAsset` | `string` | Yes |
| `toleranceBps` | `number` | No |
| `metadata` | `record` | No |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"oraclebounty","action":"createFeed","payload":{"feedId":"example-1","title":"Example","rewardPerReport":"1.000","rewardAsset":"HIVE"}}}
```

### fundFeed

- **Trigger:** `transfer`, `recurrent_transfer`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `feedId` | `string` | Yes |

Send as a transfer memo:

```json
{"hive_stream":{"contract":"oraclebounty","action":"fundFeed","payload":{"feedId":"example-1"}}}
```

### submitReport

- **Trigger:** `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `feedId` | `string` | Yes |
| `roundId` | `string` | Yes |
| `value` | `number` | Yes |
| `note` | `string` | No |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"oraclebounty","action":"submitReport","payload":{"feedId":"example-1","roundId":"example-1","value":1}}}
```

### finalizeRound

Compute the round median and credit in-tolerance reporters from the feed budget. Each round finalizes once.

- **Trigger:** `custom_json`, `time`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `feedId` | `string` | Yes |
| `roundId` | `string` | Yes |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"oraclebounty","action":"finalizeRound","payload":{"feedId":"example-1","roundId":"example-1"}}}
```

### withdrawRewards

- **Trigger:** `custom_json`

**Payload**

_No payload validation defined for this action._

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"oraclebounty","action":"withdrawRewards","payload":{}}}
```
