# launchpad

Launchpad sales with allocations, finalization, and claim flows.

**Category:** finance

```ts
import { createLaunchpadContract } from 'hive-stream';

await streamer.registerContract(createLaunchpadContract());
```

::: tip SQL adapter
This contract keeps its state in SQL tables and needs a SQL-capable adapter (SQLite or PostgreSQL). Registering it on MongoDB fails.
:::

## Options

| Option | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | `string` | No |  |
| `account` | `string` | No | Account that receives contributions and sends refunds (unfilled portions, and every contribution when a sale misses its soft cap). Contributions must be sent to it. Defaults to the streamer username. |

## Actions

### createSale

Open a token sale. Optional softCap is the minimum units that must sell; below it the sale fails and contributions are refunded.

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
| `softCap` | `number` | No |
| `metadata` | `record` | No |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"launchpad","action":"createSale","payload":{"saleId":"example-1","title":"Example","tokenSymbol":"HIVE","purchaseAsset":"HIVE","unitPrice":"1.000","totalUnits":1,"closesAt":"2030-01-01T00:00:00.000Z"}}}
```

### contribute

Buy sale units by sending payment to the launchpad account. Whole units are filled up to what remains; any unfilled portion is refunded.

- **Trigger:** `transfer`, `recurrent_transfer`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `saleId` | `string` | Yes |

Send as a transfer memo:

```json
{"hive_stream":{"contract":"launchpad","action":"contribute","payload":{"saleId":"example-1"}}}
```

### finalizeSale

Finalize a closed or sold-out sale. A sale below its soft cap fails and every contribution is refunded; calling it again retries failed refunds.

- **Trigger:** `custom_json`, `time`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `saleId` | `string` | Yes |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"launchpad","action":"finalizeSale","payload":{"saleId":"example-1"}}}
```

### claimAllocation

- **Trigger:** `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `saleId` | `string` | Yes |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"launchpad","action":"claimAllocation","payload":{"saleId":"example-1"}}}
```
