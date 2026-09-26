# dcabots

Time-based DCA bot scheduling and execution request events.

**Category:** finance

```ts
import { createDcaBotContract } from 'hive-stream';

await streamer.registerContract(createDcaBotContract());
```

::: tip SQL adapter
Most built-in contracts persist state in SQL tables and require a SQL-capable adapter (SQLite or PostgreSQL).
:::

## Options

| Option | Type | Required |
| --- | --- | --- |
| `name` | `string` | No |

## Actions

### createBot

- **Trigger:** `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `botId` | `string` | Yes |
| `baseAsset` | `string` | Yes |
| `quoteAsset` | `string` | Yes |
| `amountPerInterval` | `string` | Yes |
| `intervalHours` | `number` | Yes |
| `maxExecutions` | `number` | No |
| `slippageBps` | `number` | No |
| `startsAt` | `string` | No |
| `metadata` | `record` | No |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"dcabots","action":"createBot","payload":{"botId":"example-1","baseAsset":"HIVE","quoteAsset":"HBD","amountPerInterval":"1.000","intervalHours":24}}}
```

### pauseBot

- **Trigger:** `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `botId` | `string` | Yes |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"dcabots","action":"pauseBot","payload":{"botId":"example-1"}}}
```

### resumeBot

- **Trigger:** `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `botId` | `string` | Yes |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"dcabots","action":"resumeBot","payload":{"botId":"example-1"}}}
```

### executeDueBots

- **Trigger:** `custom_json`, `time`

**Payload**

_No payload validation defined for this action._

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"dcabots","action":"executeDueBots","payload":{}}}
```

### acknowledgeExecution

- **Trigger:** `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `botId` | `string` | Yes |
| `executionId` | `number` | Yes |
| `status` | `"placed" \| "filled" \| "failed" \| "cancelled"` | Yes |
| `externalRef` | `string` | No |
| `notes` | `string` | No |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"dcabots","action":"acknowledgeExecution","payload":{"botId":"example-1","executionId":1,"status":"placed"}}}
```
