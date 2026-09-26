# sweepstakes

Paid-entry sweepstakes with deterministic winner draws.

**Category:** gambling

```ts
import { createSweepstakesContract } from 'hive-stream';

await streamer.registerContract(createSweepstakesContract());
```

::: tip SQL adapter
Most built-in contracts persist state in SQL tables and require a SQL-capable adapter (SQLite or PostgreSQL).
:::

## Options

| Option | Type | Required |
| --- | --- | --- |
| `name` | `string` | No |

## Actions

### createSweepstakes

- **Trigger:** `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `drawId` | `string` | Yes |
| `title` | `string` | Yes |
| `entryFee` | `string` | Yes |
| `asset` | `string` | Yes |
| `closesAt` | `string` | Yes |
| `maxEntries` | `number` | No |
| `maxEntriesPerAccount` | `number` | No |
| `metadata` | `record` | No |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"sweepstakes","action":"createSweepstakes","payload":{"drawId":"example-1","title":"Example","entryFee":"1.000","asset":"HIVE","closesAt":"2030-01-01T00:00:00.000Z"}}}
```

### enterSweepstakes

- **Trigger:** `transfer`, `recurrent_transfer`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `drawId` | `string` | Yes |
| `entries` | `number` | No |

Send as a transfer memo:

```json
{"hive_stream":{"contract":"sweepstakes","action":"enterSweepstakes","payload":{"drawId":"example-1"}}}
```

### drawWinner

- **Trigger:** `custom_json`, `time`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `drawId` | `string` | Yes |
| `seed` | `string` | No |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"sweepstakes","action":"drawWinner","payload":{"drawId":"example-1"}}}
```
