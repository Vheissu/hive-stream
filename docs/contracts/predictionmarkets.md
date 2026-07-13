# predictionmarkets

Prediction markets with positions, resolution, and winner claims.

```ts
import { createPredictionMarketContract } from 'hive-stream';

await streamer.registerContract(createPredictionMarketContract());
```

::: tip SQL adapter
Most built-in contracts persist state in SQL tables and require a SQL-capable adapter (SQLite or PostgreSQL).
:::

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
{"hive_stream":{"contract":"predictionmarkets","action":"createMarket","payload":{}}}
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
{"hive_stream":{"contract":"predictionmarkets","action":"buyPosition","payload":{}}}
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
{"hive_stream":{"contract":"predictionmarkets","action":"resolveMarket","payload":{}}}
```

### claimWinnings

- **Trigger:** `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `marketId` | `string` | Yes |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"predictionmarkets","action":"claimWinnings","payload":{}}}
```
