# polls

Polls and voting.

**Category:** governance

```ts
import { createPollContract } from 'hive-stream';

await streamer.registerContract(createPollContract());
```

::: tip SQL adapter
This contract keeps its state in SQL tables and needs a SQL-capable adapter (SQLite or PostgreSQL). Registering it on MongoDB fails.
:::

## Options

| Option | Type | Required |
| --- | --- | --- |
| `name` | `string` | No |

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
{"hive_stream":{"contract":"polls","action":"createPoll","payload":{"pollId":"example-1","question":"Example text","options":["Yes","No"]}}}
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
{"hive_stream":{"contract":"polls","action":"vote","payload":{"pollId":"example-1","option":1}}}
```
