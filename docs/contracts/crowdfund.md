# crowdfund

Crowdfunding campaigns with milestones, finalization, and refunds.

**Category:** fundraising

```ts
import { createCrowdfundContract } from 'hive-stream';

await streamer.registerContract(createCrowdfundContract());
```

::: tip SQL adapter
Most built-in contracts persist state in SQL tables and require a SQL-capable adapter (SQLite or PostgreSQL).
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
| `description` | `string` | No |
| `targetAmount` | `string` | Yes |
| `asset` | `string` | Yes |
| `deadline` | `string` | Yes |
| `beneficiary` | `string` | No |
| `milestones` | `object[]` | No |
| `metadata` | `record` | No |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"crowdfund","action":"createCampaign","payload":{"campaignId":"example-1","title":"Example","targetAmount":"1.000","asset":"HIVE","deadline":"2030-01-01T00:00:00.000Z"}}}
```

### contribute

- **Trigger:** `transfer`, `recurrent_transfer`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `campaignId` | `string` | Yes |

Send as a transfer memo:

```json
{"hive_stream":{"contract":"crowdfund","action":"contribute","payload":{"campaignId":"example-1"}}}
```

### finalizeCampaign

- **Trigger:** `custom_json`, `time`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `campaignId` | `string` | Yes |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"crowdfund","action":"finalizeCampaign","payload":{"campaignId":"example-1"}}}
```

### releaseMilestone

- **Trigger:** `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `campaignId` | `string` | Yes |
| `milestoneIndex` | `number` | Yes |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"crowdfund","action":"releaseMilestone","payload":{"campaignId":"example-1","milestoneIndex":0}}}
```

### refundContribution

- **Trigger:** `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `campaignId` | `string` | Yes |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"crowdfund","action":"refundContribution","payload":{"campaignId":"example-1"}}}
```
