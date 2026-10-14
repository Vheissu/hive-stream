# auctionhouse

Auctions with reserve prices, buy-now support, and timed settlement.

**Category:** commerce

```ts
import { createAuctionHouseContract } from 'hive-stream';

await streamer.registerContract(createAuctionHouseContract());
```

::: tip SQL adapter
This contract keeps its state in SQL tables and needs a SQL-capable adapter (SQLite or PostgreSQL). Registering it on MongoDB fails.
:::

## Options

| Option | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | `string` | No |  |
| `account` | `string` | No | Account that holds bids in custody, refunds outbid bidders and pays sellers. Bids must be sent to it. Defaults to the streamer username. |

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

Bid by sending the full bid amount to the auction account. Outbid bidders are refunded automatically; bids that cannot be accepted are sent back.

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

Close an ended auction: pays the seller when the reserve is met, otherwise refunds the highest bidder. Calling it again retries any payout whose transfer failed.

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
