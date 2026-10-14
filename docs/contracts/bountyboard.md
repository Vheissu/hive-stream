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

| Option | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | `string` | No |  |
| `account` | `string` | No | Account that receives bounty rewards and refunds rejected ones. Refunds are signed with the app's active key, so this must be the app account. Defaults to the streamer username. |

## Actions

### createBounty

Fund a new bounty by sending the reward to the app account; a duplicate bounty id or an invalid or past deadline is refunded.

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

Close an open bounty (sponsor or scheduled). Emits bounty_closed with the unawarded remainder once and zeroes it.

- **Trigger:** `custom_json`, `time`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `bountyId` | `string` | Yes |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"bountyboard","action":"closeBounty","payload":{"bountyId":"example-1"}}}
```
