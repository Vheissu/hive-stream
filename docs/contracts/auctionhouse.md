# auctionhouse

Auctions with reserve prices, buy-now support, and timed settlement.

**Category:** commerce

```ts
import { createAuctionHouseContract } from 'hive-stream';

await streamer.registerContract(createAuctionHouseContract());
```

::: tip SQL adapter
Most built-in contracts persist state in SQL tables and require a SQL-capable adapter (SQLite or PostgreSQL).
:::

## Options

| Option | Type | Required |
| --- | --- | --- |
| `name` | `string` | No |

## Actions

### createAuction

- **Trigger:** `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `auctionId` | `string` | Yes |
| `title` | `string` | Yes |
| `description` | `string` | No |
| `assetType` | `string` | No |
| `assetRef` | `string` | Yes |
| `paymentAsset` | `string` | Yes |
| `reservePrice` | `string` | Yes |
| `buyNowPrice` | `string` | No |
| `startsAt` | `string` | No |
| `endsAt` | `string` | Yes |
| `metadata` | `record` | No |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"auctionhouse","action":"createAuction","payload":{}}}
```

### placeBid

- **Trigger:** `transfer`, `recurrent_transfer`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `auctionId` | `string` | Yes |
| `note` | `string` | No |

Send as a transfer memo:

```json
{"hive_stream":{"contract":"auctionhouse","action":"placeBid","payload":{}}}
```

### settleAuction

- **Trigger:** `custom_json`, `time`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `auctionId` | `string` | Yes |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"auctionhouse","action":"settleAuction","payload":{}}}
```

### cancelAuction

- **Trigger:** `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `auctionId` | `string` | Yes |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"auctionhouse","action":"cancelAuction","payload":{}}}
```
