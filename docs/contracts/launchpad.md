# launchpad

Launchpad sales with allocations, finalization, and claim flows.

```ts
import { createLaunchpadContract } from 'hive-stream';

await streamer.registerContract(createLaunchpadContract());
```

::: tip SQL adapter
Most built-in contracts persist state in SQL tables and require a SQL-capable adapter (SQLite or PostgreSQL).
:::

## Actions

### createSale

- **Trigger:** `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `saleId` | `string` | Yes |
| `title` | `string` | Yes |
| `tokenSymbol` | `string` | Yes |
| `purchaseAsset` | `string` | Yes |
| `unitPrice` | `string` | Yes |
| `totalUnits` | `number` | Yes |
| `closesAt` | `string` | Yes |
| `minUnitsPerBuyer` | `number` | No |
| `maxUnitsPerBuyer` | `number` | No |
| `metadata` | `record` | No |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"launchpad","action":"createSale","payload":{}}}
```

### contribute

- **Trigger:** `transfer`, `recurrent_transfer`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `saleId` | `string` | Yes |

Send as a transfer memo:

```json
{"hive_stream":{"contract":"launchpad","action":"contribute","payload":{}}}
```

### finalizeSale

- **Trigger:** `custom_json`, `time`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `saleId` | `string` | Yes |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"launchpad","action":"finalizeSale","payload":{}}}
```

### claimAllocation

- **Trigger:** `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `saleId` | `string` | Yes |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"launchpad","action":"claimAllocation","payload":{}}}
```
