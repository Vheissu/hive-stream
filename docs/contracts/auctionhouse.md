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
{"hive_stream":{"contract":"auctionhouse","action":"createAuction","payload":{"auctionId":"example-1","title":"Example","assetRef":"example-1","paymentAsset":"HIVE","reservePrice":"1.000","endsAt":"2030-01-01T00:00:00.000Z"}}}
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
{"hive_stream":{"contract":"auctionhouse","action":"placeBid","payload":{"auctionId":"example-1"}}}
```

### settleAuction

- **Trigger:** `custom_json`, `time`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `auctionId` | `string` | Yes |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"auctionhouse","action":"settleAuction","payload":{"auctionId":"example-1"}}}
```

### cancelAuction

- **Trigger:** `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `auctionId` | `string` | Yes |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"auctionhouse","action":"cancelAuction","payload":{"auctionId":"example-1"}}}
```
