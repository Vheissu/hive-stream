# savings

Savings goals with recurring contributions and withdrawal requests.

**Category:** finance

```ts
import { createSavingsContract } from 'hive-stream';

await streamer.registerContract(createSavingsContract());
```

::: tip SQL adapter
Most built-in contracts persist state in SQL tables and require a SQL-capable adapter (SQLite or PostgreSQL).
:::

## Options

| Option | Type | Required |
| --- | --- | --- |
| `name` | `string` | No |

## Actions

### createGoal

- **Trigger:** `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `goalId` | `string` | Yes |
| `title` | `string` | Yes |
| `targetAmount` | `string` | Yes |
| `asset` | `string` | Yes |
| `deadline` | `string` | No |
| `allowEarlyWithdraw` | `boolean` | No |
| `metadata` | `record` | No |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"savings","action":"createGoal","payload":{"goalId":"example-1","title":"Example","targetAmount":"1.000","asset":"HIVE"}}}
```

### contribute

- **Trigger:** `transfer`, `recurrent_transfer`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `goalId` | `string` | Yes |

Send as a transfer memo:

```json
{"hive_stream":{"contract":"savings","action":"contribute","payload":{"goalId":"example-1"}}}
```

### withdraw

- **Trigger:** `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `goalId` | `string` | Yes |
| `amount` | `string` | No |
| `note` | `string` | No |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"savings","action":"withdraw","payload":{"goalId":"example-1"}}}
```

### closeGoal

- **Trigger:** `custom_json`, `time`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `goalId` | `string` | Yes |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"savings","action":"closeGoal","payload":{"goalId":"example-1"}}}
```
