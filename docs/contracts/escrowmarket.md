# escrowmarket

A peer-to-peer marketplace settled through Hive native escrow, with the app account as escrow agent: listings, auto-ratified trades, shipping and delivery tracking, and agent dispute resolution.

**Category:** commerce

```ts
import { createEscrowMarketplaceContract } from 'hive-stream';

await streamer.registerContract(createEscrowMarketplaceContract());
```

::: tip SQL adapter
This contract keeps its state in SQL tables and needs a SQL-capable adapter (SQLite or PostgreSQL). Registering it on MongoDB fails.
:::

## Options

| Option | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | `string` | No |  |
| `account` | `string` | No | Escrow agent account. Buyers must name it as `agent`. Defaults to the streamer username. |
| `agentFeeBps` | `number` | No | Agent fee the buyer must include in the escrow, in basis points of the price (default 100 = 1%). |
| `ratificationHours` | `number` | No | Longest allowed gap between the escrow and its ratification deadline, in hours (default 24). |
| `expirationDays` | `number` | No | Minimum escrow lifetime (block time to expiration), in days (default 30). |
| `autoApprove` | `boolean` | No | Approve valid escrows as the agent automatically (default true). |
| `allowedAssets` | `string[]` | No | Assets listings may be priced in. Defaults to HIVE and HBD. |

## Actions

### createListing

List an item for sale at a fixed price in HIVE or HBD. The sender is the seller.

- **Trigger:** `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `listingId` | `string` | Yes |
| `title` | `string` | Yes |
| `price` | `string` | Yes |
| `asset` | `string` | Yes |
| `description` | `string` | No |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"escrowmarket","action":"createListing","payload":{"listingId":"example-1","title":"Example","price":"1.000","asset":"HIVE"}}}
```

### cancelListing

Withdraw a listing (seller only, while no trade is open on it).

- **Trigger:** `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `listingId` | `string` | Yes |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"escrowmarket","action":"cancelListing","payload":{"listingId":"example-1"}}}
```

### openTrade

Buy a listing: send escrow_transfer to the seller with this contract's account as agent, at least the price and the agent fee, and this call in json_meta. Invalid escrows are recorded as rejected and never ratified, so the chain returns the funds at the ratification deadline.

- **Trigger:** `escrow_transfer`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `listingId` | `string` | Yes |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"escrowmarket","action":"openTrade","payload":{"listingId":"example-1"}}}
```

### approveTrade

Agent only: ratify a pending escrow as the agent (when autoApprove is off, or to retry a failed approval).

- **Trigger:** `custom_json`
- **Requires active key signature**

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `tradeId` | `string` | Yes |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"escrowmarket","action":"approveTrade","payload":{"tradeId":"example-1"}}}
```

### markShipped

Seller marks a ratified trade as shipped.

- **Trigger:** `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `tradeId` | `string` | Yes |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"escrowmarket","action":"markShipped","payload":{"tradeId":"example-1"}}}
```

### confirmDelivery

Buyer records delivery. Funds move only when the buyer also broadcasts escrow_release to the seller; the contract closes the trade when it sees that release on chain.

- **Trigger:** `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `tradeId` | `string` | Yes |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"escrowmarket","action":"confirmDelivery","payload":{"tradeId":"example-1"}}}
```

### resolveDispute

Agent only: release a disputed escrow to the buyer or seller (the full balance unless amounts are given).

- **Trigger:** `custom_json`
- **Requires active key signature**

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `tradeId` | `string` | Yes |
| `receiver` | `"buyer" \| "seller"` | Yes |
| `hiveAmount` | `string` | No |
| `hbdAmount` | `string` | No |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"escrowmarket","action":"resolveDispute","payload":{"tradeId":"example-1","receiver":"buyer"}}}
```

### expireTrades

Scheduled sweep: marks unratified escrows past their deadline, and ratified escrows past expiration, as expired.

- **Trigger:** `time`

**Payload**

_This action takes an empty payload._
