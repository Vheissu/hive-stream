# bountyboard

Funded bounties, submissions, and award selection.

**Category:** commerce

```ts
import { createBountyBoardContract } from 'hive-stream';

await streamer.registerContract(createBountyBoardContract());
```

::: tip SQL adapter
This contract keeps its state in SQL tables and needs a SQL-capable adapter (SQLite or PostgreSQL). Registering it on MongoDB fails.
:::

## Options

| Option | Type | Required |
| --- | --- | --- |
| `name` | `string` | No |

## Actions

### createBounty

- **Trigger:** `transfer`, `recurrent_transfer`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `bountyId` | `string` | Yes |
| `title` | `string` | Yes |
| `description` | `string` | No |
| `deadline` | `string` | No |
| `maxWinners` | `number` | No |
| `metadata` | `record` | No |

Send as a transfer memo:

```json
{"hive_stream":{"contract":"bountyboard","action":"createBounty","payload":{"bountyId":"example-1","title":"Example"}}}
```

### submitWork

- **Trigger:** `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `bountyId` | `string` | Yes |
| `submissionId` | `string` | Yes |
| `url` | `string` | Yes |
| `description` | `string` | No |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"bountyboard","action":"submitWork","payload":{"bountyId":"example-1","submissionId":"example-1","url":"https://example.com"}}}
```

### awardBounty

- **Trigger:** `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `bountyId` | `string` | Yes |
| `submissionId` | `string` | Yes |
| `amount` | `string` | No |
| `note` | `string` | No |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"bountyboard","action":"awardBounty","payload":{"bountyId":"example-1","submissionId":"example-1"}}}
```

### closeBounty

- **Trigger:** `custom_json`, `time`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `bountyId` | `string` | Yes |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"bountyboard","action":"closeBounty","payload":{"bountyId":"example-1"}}}
```
