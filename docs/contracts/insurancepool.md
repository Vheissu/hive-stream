# insurancepool

Insurance pools with premium-backed policies, claims, and reserves.

**Category:** finance

```ts
import { createInsurancePoolContract } from 'hive-stream';

await streamer.registerContract(createInsurancePoolContract());
```

::: tip SQL adapter
This contract keeps its state in SQL tables and needs a SQL-capable adapter (SQLite or PostgreSQL). Registering it on MongoDB fails.
:::

## Options

| Option | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | `string` | No |  |
| `account` | `string` | No | Account that receives premiums and reserve funding and pays approved claims. Payouts are signed with the app's active key, so this must be the app account. Defaults to the streamer username. |

## Actions

### createPool

- **Trigger:** `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `poolId` | `string` | Yes |
| `title` | `string` | Yes |
| `asset` | `string` | Yes |
| `premiumAmount` | `string` | Yes |
| `coverageCap` | `string` | Yes |
| `coverageDays` | `number` | Yes |
| `metadata` | `record` | No |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"insurancepool","action":"createPool","payload":{"poolId":"example-1","title":"Example","asset":"HIVE","premiumAmount":"1.000","coverageCap":"1.000","coverageDays":24}}}
```

### fundPool

- **Trigger:** `transfer`, `recurrent_transfer`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `poolId` | `string` | Yes |

Send as a transfer memo:

```json
{"hive_stream":{"contract":"insurancepool","action":"fundPool","payload":{"poolId":"example-1"}}}
```

### buyPolicy

- **Trigger:** `transfer`, `recurrent_transfer`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `poolId` | `string` | Yes |

Send as a transfer memo:

```json
{"hive_stream":{"contract":"insurancepool","action":"buyPolicy","payload":{"poolId":"example-1"}}}
```

### fileClaim

- **Trigger:** `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `poolId` | `string` | Yes |
| `claimId` | `string` | Yes |
| `amount` | `string` | Yes |
| `reason` | `string` | Yes |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"insurancepool","action":"fileClaim","payload":{"poolId":"example-1","claimId":"example-1","amount":"1.000","reason":"Example text"}}}
```

### approveClaim

Pool owner approves a pending claim (up to the requested amount and the coverage cap) and pays it from the app account.

- **Trigger:** `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `claimId` | `string` | Yes |
| `amount` | `string` | No |
| `note` | `string` | No |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"insurancepool","action":"approveClaim","payload":{"claimId":"example-1"}}}
```

### retryClaimPayout

Re-send a claim payout whose broadcast failed (pool owner, claimant or app account).

- **Trigger:** `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `claimId` | `string` | Yes |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"insurancepool","action":"retryClaimPayout","payload":{"claimId":"example-1"}}}
```

### expirePolicies

- **Trigger:** `custom_json`, `time`

**Payload**

_No payload validation defined for this action._

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"insurancepool","action":"expirePolicies","payload":{}}}
```
