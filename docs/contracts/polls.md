# polls

Polls and voting.

```ts
import { createPollContract } from 'hive-stream';

await streamer.registerContract(createPollContract());
```

::: tip SQL adapter
Most built-in contracts persist state in SQL tables and require a SQL-capable adapter (SQLite or PostgreSQL).
:::

## Actions

### createPoll

- **Trigger:** `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `pollId` | `string` | Yes |
| `question` | `string` | Yes |
| `options` | `string[]` | Yes |
| `durationHours` | `number` | No |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"polls","action":"createPoll","payload":{}}}
```

### vote

- **Trigger:** `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `pollId` | `string` | Yes |
| `option` | `number` | Yes |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"polls","action":"vote","payload":{}}}
```
