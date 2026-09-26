# rentals

Escrow-backed rental agreements for items, passes, or assets.

**Category:** commerce

```ts
import { createRentalContract } from 'hive-stream';

await streamer.registerContract(createRentalContract());
```

::: tip SQL adapter
Most built-in contracts persist state in SQL tables and require a SQL-capable adapter (SQLite or PostgreSQL).
:::

## Options

| Option | Type | Required |
| --- | --- | --- |
| `name` | `string` | No |

## Actions

### createListing

- **Trigger:** `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `listingId` | `string` | Yes |
| `assetRef` | `string` | Yes |
| `title` | `string` | Yes |
| `collateralAmount` | `string` | Yes |
| `collateralAsset` | `string` | Yes |
| `dailyRate` | `string` | Yes |
| `rateAsset` | `string` | Yes |
| `maxDurationDays` | `number` | No |
| `metadata` | `record` | No |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"rentals","action":"createListing","payload":{}}}
```

### initiateRental

- **Trigger:** `escrow_transfer`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `listingId` | `string` | Yes |
| `rentalId` | `string` | Yes |
| `endsAt` | `string` | Yes |
| `note` | `string` | No |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"rentals","action":"initiateRental","payload":{}}}
```

### confirmReturn

- **Trigger:** `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `rentalId` | `string` | Yes |
| `note` | `string` | No |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"rentals","action":"confirmReturn","payload":{}}}
```

### closeRental

- **Trigger:** `custom_json`, `time`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `rentalId` | `string` | Yes |
| `note` | `string` | No |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"rentals","action":"closeRental","payload":{}}}
```
