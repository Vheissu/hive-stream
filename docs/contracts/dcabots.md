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
{"hive_stream":{"contract":"dcabots","action":"createBot","payload":{}}}
```

### pauseBot

- **Trigger:** `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `botId` | `string` | Yes |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"dcabots","action":"pauseBot","payload":{}}}
```

### resumeBot

- **Trigger:** `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `botId` | `string` | Yes |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"dcabots","action":"resumeBot","payload":{}}}
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
{"hive_stream":{"contract":"dcabots","action":"acknowledgeExecution","payload":{}}}
```
