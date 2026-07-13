# charitymatch

Donation campaigns with matched totals and closing summaries.

```ts
import { createCharityMatchContract } from 'hive-stream';

await streamer.registerContract(createCharityMatchContract());
```

::: tip SQL adapter
Most built-in contracts persist state in SQL tables and require a SQL-capable adapter (SQLite or PostgreSQL).
:::

## Actions

### createCampaign

- **Trigger:** `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `campaignId` | `string` | Yes |
| `title` | `string` | Yes |
| `beneficiary` | `string` | Yes |
| `asset` | `string` | Yes |
| `matchCap` | `string` | Yes |
| `matchBps` | `number` | Yes |
| `closesAt` | `string` | Yes |
| `metadata` | `record` | No |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"charitymatch","action":"createCampaign","payload":{}}}
```

### donate

- **Trigger:** `transfer`, `recurrent_transfer`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `campaignId` | `string` | Yes |

Send as a transfer memo:

```json
{"hive_stream":{"contract":"charitymatch","action":"donate","payload":{}}}
```

### closeCampaign

- **Trigger:** `custom_json`, `time`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `campaignId` | `string` | Yes |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"charitymatch","action":"closeCampaign","payload":{}}}
```
