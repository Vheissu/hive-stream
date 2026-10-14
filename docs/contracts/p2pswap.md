# p2pswap

A peer-to-peer swap desk for HIVE, HBD and Hive Engine tokens: HIVE/HBD swaps settle through Hive escrow with the app as agent, token swaps through the app account with retryable payouts.

**Category:** finance

```ts
import { createP2PSwapContract } from 'hive-stream';

await streamer.registerContract(createP2PSwapContract());
```

::: tip SQL adapter
This contract keeps its state in SQL tables and needs a SQL-capable adapter (SQLite or PostgreSQL). Registering it on MongoDB fails.
:::

## Options

| Option | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | `string` | No |  |
| `account` | `string` | No | The app account: escrow agent for HIVE/HBD swaps and the account that holds both legs of a swap involving a Hive Engine token. Defaults to the streamer username. |
| `feeBps` | `number` | No | Fee in basis points (max 2000, default 0). Custodial swaps deduct it from the maker's proceeds; escrow swaps require the taker's escrow to carry at least this agent fee in the buy-side asset. |
| `allowedAssets` | `string[]` | No | HIVE/HBD assets offers may sell or buy. Defaults to ['HIVE', 'HBD']. |
| `allowedTokens` | `string[]` | No | Hive Engine symbols offers may sell or buy. Defaults to [] (any symbol). |
| `offerTtlHours` | `number` | No | Default and maximum offer lifetime in hours. Defaults to 72. |

## Actions

### createOffer

Post an all-or-nothing offer to swap sell for buy. HIVE<->HBD offers settle through Hive escrow; offers with a Hive Engine token settle through the app account.

- **Trigger:** `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `offerId` | `string` | Yes |
| `sell` | `object` | Yes |
| `buy` | `object` | Yes |
| `expiresAt` | `string` | No |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"p2pswap","action":"createOffer","payload":{"offerId":"offer-1","sell":{"asset":"HIVE","amount":"100.000"},"buy":{"asset":"HBD","amount":"25.000"}}}}
```

### fundOffer

Maker deposits the sell side of a custodial offer (a HIVE/HBD transfer here, or a Hive Engine transfer with the same memo). Mismatched deposits are refunded.

- **Trigger:** `transfer`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `offerId` | `string` | No |

Send as a transfer memo:

```json
{"hive_stream":{"contract":"p2pswap","action":"fundOffer","payload":{"offerId":"offer-1"}}}
```

### takeOffer

Take an offer. Escrow offers: an escrow_transfer of the buy side to the maker with the app as agent. Custodial offers: pay the buy side to the app (transfer or Hive Engine transfer). Mismatched payments are refunded or the escrow rejected.

- **Trigger:** `transfer`, `escrow_transfer`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `offerId` | `string` | No |

Send as a transfer memo:

```json
{"hive_stream":{"contract":"p2pswap","action":"takeOffer","payload":{"offerId":"offer-1"}}}
```

### settle

Maker pays the sell side of a taken escrow offer straight to the taker; the app then approves the taker's escrow as agent.

- **Trigger:** `transfer`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `offerId` | `string` | No |

Send as a transfer memo:

```json
{"hive_stream":{"contract":"p2pswap","action":"settle","payload":{"offerId":"offer-1"}}}
```

### cancelOffer

Maker cancels an untaken offer; a funded custodial offer is refunded.

- **Trigger:** `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `offerId` | `string` | Yes |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"p2pswap","action":"cancelOffer","payload":{"offerId":"offer-1"}}}
```

### expireOffers

Scheduled: expire untaken offers (refunding deposits) and return escrows whose maker did not pay in time.

- **Trigger:** `time`

**Payload**

_This action takes an empty payload._

### retryPayouts

App account only: re-broadcast failed payouts, refunds and escrow approvals (all, or one payoutId) after checking the account history.

- **Trigger:** `custom_json`
- **Requires active key signature**

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `payoutId` | `string` | No |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"p2pswap","action":"retryPayouts","payload":{}}}
```
