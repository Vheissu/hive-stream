# referrals

Affiliate programs with codes, funded budgets, and payout balances.

**Category:** social

```ts
import { createReferralContract } from 'hive-stream';

await streamer.registerContract(createReferralContract());
```

::: tip SQL adapter
This contract keeps its state in SQL tables and needs a SQL-capable adapter (SQLite or PostgreSQL). Registering it on MongoDB fails.
:::

## Options

| Option | Type | Required |
| --- | --- | --- |
| `name` | `string` | No |

## Actions

### createProgram

- **Trigger:** `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `programId` | `string` | Yes |
| `title` | `string` | Yes |
| `payoutAsset` | `string` | Yes |
| `rewardBps` | `number` | Yes |
| `maxPayoutPerConversion` | `string` | No |
| `metadata` | `record` | No |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"referrals","action":"createProgram","payload":{"programId":"example-1","title":"Example","payoutAsset":"HIVE","rewardBps":100}}}
```

### fundProgram

- **Trigger:** `transfer`, `recurrent_transfer`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `programId` | `string` | Yes |

Send as a transfer memo:

```json
{"hive_stream":{"contract":"referrals","action":"fundProgram","payload":{"programId":"example-1"}}}
```

### registerCode

- **Trigger:** `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `programId` | `string` | Yes |
| `code` | `string` | Yes |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"referrals","action":"registerCode","payload":{"programId":"example-1","code":"example-1"}}}
```

### recordConversion

- **Trigger:** `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `programId` | `string` | Yes |
| `code` | `string` | Yes |
| `buyer` | `string` | Yes |
| `grossAmount` | `string` | Yes |
| `asset` | `string` | Yes |
| `externalRef` | `string` | No |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"referrals","action":"recordConversion","payload":{"programId":"example-1","code":"example-1","buyer":"alice","grossAmount":"1.000","asset":"HIVE"}}}
```

### withdrawAffiliate

- **Trigger:** `custom_json`

**Payload**

_No payload validation defined for this action._

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"referrals","action":"withdrawAffiliate","payload":{}}}
```
