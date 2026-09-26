# insurancepool

Insurance pools with premium-backed policies, claims, and reserves.

**Category:** finance

```ts
import { createInsurancePoolContract } from 'hive-stream';

await streamer.registerContract(createInsurancePoolContract());
```

::: tip SQL adapter
Most built-in contracts persist state in SQL tables and require a SQL-capable adapter (SQLite or PostgreSQL).
:::

## Options

| Option | Type | Required |
| --- | --- | --- |
| `name` | `string` | No |

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

### expirePolicies

- **Trigger:** `custom_json`, `time`

**Payload**

_No payload validation defined for this action._

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"insurancepool","action":"expirePolicies","payload":{}}}
```
