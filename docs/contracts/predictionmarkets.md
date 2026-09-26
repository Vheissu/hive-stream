# predictionmarkets

Prediction markets with positions, resolution, and winner claims.

**Category:** gambling

```ts
import { createPredictionMarketContract } from 'hive-stream';

await streamer.registerContract(createPredictionMarketContract());
```

::: tip SQL adapter
This contract keeps its state in SQL tables and needs a SQL-capable adapter (SQLite or PostgreSQL). Registering it on MongoDB fails.
:::

## Options

| Option | Type | Required |
| --- | --- | --- |
| `name` | `string` | No |

## Actions

### createMarket

- **Trigger:** `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `marketId` | `string` | Yes |
| `title` | `string` | Yes |
| `asset` | `string` | Yes |
| `options` | `string[]` | Yes |
| `closesAt` | `string` | Yes |
| `metadata` | `record` | No |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"predictionmarkets","action":"createMarket","payload":{"marketId":"example-1","title":"Example","asset":"HIVE","options":["Yes","No"],"closesAt":"2030-01-01T00:00:00.000Z"}}}
```

### buyPosition

- **Trigger:** `transfer`, `recurrent_transfer`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `marketId` | `string` | Yes |
| `option` | `number` | Yes |

Send as a transfer memo:

```json
{"hive_stream":{"contract":"predictionmarkets","action":"buyPosition","payload":{"marketId":"example-1","option":1}}}
```

### resolveMarket

- **Trigger:** `custom_json`, `time`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `marketId` | `string` | Yes |
| `winningOption` | `number` | Yes |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"predictionmarkets","action":"resolveMarket","payload":{"marketId":"example-1","winningOption":1}}}
```

### claimWinnings

- **Trigger:** `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `marketId` | `string` | Yes |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"predictionmarkets","action":"claimWinnings","payload":{"marketId":"example-1"}}}
```
