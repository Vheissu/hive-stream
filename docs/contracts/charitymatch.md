# charitymatch

Donation campaigns with matched totals and closing summaries.

**Category:** fundraising

```ts
import { createCharityMatchContract } from 'hive-stream';

await streamer.registerContract(createCharityMatchContract());
```

::: tip SQL adapter
This contract keeps its state in SQL tables and needs a SQL-capable adapter (SQLite or PostgreSQL). Registering it on MongoDB fails.
:::

## Options

| Option | Type | Required |
| --- | --- | --- |
| `name` | `string` | No |

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
{"hive_stream":{"contract":"charitymatch","action":"createCampaign","payload":{"campaignId":"example-1","title":"Example","beneficiary":"alice","asset":"HIVE","matchCap":"1.000","matchBps":100,"closesAt":"2030-01-01T00:00:00.000Z"}}}
```

### donate

- **Trigger:** `transfer`, `recurrent_transfer`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `campaignId` | `string` | Yes |

Send as a transfer memo:

```json
{"hive_stream":{"contract":"charitymatch","action":"donate","payload":{"campaignId":"example-1"}}}
```

### closeCampaign

- **Trigger:** `custom_json`, `time`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `campaignId` | `string` | Yes |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"charitymatch","action":"closeCampaign","payload":{"campaignId":"example-1"}}}
```
