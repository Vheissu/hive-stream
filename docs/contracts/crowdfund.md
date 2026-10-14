# crowdfund

Crowdfunding campaigns with milestones, finalization, and refunds.

**Category:** fundraising

```ts
import { createCrowdfundContract } from 'hive-stream';

await streamer.registerContract(createCrowdfundContract());
```

::: tip SQL adapter
This contract keeps its state in SQL tables and needs a SQL-capable adapter (SQLite or PostgreSQL). Registering it on MongoDB fails.
:::

## Options

| Option | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | `string` | No |  |
| `account` | `string` | No | Account that receives contributions and pays milestone releases and refunds. Payouts are signed with the app's active key, so this must be the app account. Defaults to the streamer username. |

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

Contribute by sending the campaign asset to the app account; contributions to a missing, closed or expired campaign, or in the wrong asset, are refunded.

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

Creator releases a milestone's share of a funded campaign to the beneficiary from the app account; a failed broadcast can be retried by calling it again.

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

Refund your contributions to a failed campaign from the app account; a failed broadcast can be retried by calling it again.

- **Trigger:** `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `campaignId` | `string` | Yes |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"crowdfund","action":"refundContribution","payload":{"campaignId":"example-1"}}}
```
