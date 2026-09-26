# bridge

A custody bridge/peg with M-of-N operator attestations, fees, per-transaction and daily limits, a pause switch and a full audit trail.

**Category:** bridge

```ts
import { createBridgeContract } from 'hive-stream';

await streamer.registerContract(createBridgeContract({ custodyAccount: '...', operators: ['...'] }));
```

::: tip SQL adapter
Most built-in contracts persist state in SQL tables and require a SQL-capable adapter (SQLite or PostgreSQL).
:::

## Options

| Option | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | `string` | No |  |
| `custodyAccount` | `string` | Yes | Hive account that holds bridged funds. Deposits must be sent here. |
| `operators` | `string[]` | Yes | Accounts allowed to attest deposits and withdrawals. |
| `threshold` | `number` | No | Attestations required to act (M of N). Defaults to a strict majority. |
| `assets` | `string[]` | No | Hive assets the bridge accepts. Defaults to HIVE and HBD. |
| `chains` | `string[]` | No | Allowed external chain identifiers. When omitted any well-formed id is accepted. |
| `addressPattern` | `RegExp \| Record<string, RegExp>` | No | Validates destination addresses, globally or per chain. |
| `feeBps` | `number` | No | Fee charged on both directions, in basis points (max 2000). |
| `minAmount` | `string` | No |  |
| `maxPerTx` | `string` | No | Largest single deposit or withdrawal. |
| `dailyLimit` | `string` | No | Rolling 24h cap per asset and direction across all users. |
| `accountDailyLimit` | `string` | No | Rolling 24h cap on deposits per Hive account and asset. |
| `admins` | `string[]` | No | Accounts allowed to pause/unpause and retry releases. Defaults to the custody account. |

## Actions

### deposit

Deposit HIVE/HBD to the custody account with the destination chain and address; invalid deposits are refunded automatically.

- **Trigger:** `transfer`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `chain` | `string` | No |
| `address` | `string` | No |

Send as a transfer memo:

```json
{"hive_stream":{"contract":"bridge","action":"deposit","payload":{}}}
```

### attestDeposit

Operator attestation that a deposit was minted on the destination chain (or should be refunded). Acts at the M-of-N threshold.

- **Trigger:** `custom_json`
- **Requires active key signature**

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `depositId` | `string` | Yes |
| `decision` | `"minted" \| "refund"` | Yes |
| `externalTxId` | `string` | No |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"bridge","action":"attestDeposit","payload":{}}}
```

### requestWithdrawal

Register a withdrawal back to Hive for funds locked or burned on another chain.

- **Trigger:** `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `sourceChain` | `string` | Yes |
| `sourceTxId` | `string` | Yes |
| `amount` | `string` | Yes |
| `asset` | `string` | Yes |
| `recipient` | `string` | No |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"bridge","action":"requestWithdrawal","payload":{}}}
```

### attestWithdrawal

Operator attestation that a withdrawal is valid (release) or invalid (reject). Releases at the M-of-N threshold within limits.

- **Trigger:** `custom_json`
- **Requires active key signature**

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `sourceChain` | `string` | Yes |
| `sourceTxId` | `string` | Yes |
| `recipient` | `string` | Yes |
| `amount` | `string` | Yes |
| `asset` | `string` | Yes |
| `decision` | `"release" \| "reject"` | No |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"bridge","action":"attestWithdrawal","payload":{}}}
```

### executeWithdrawal

Retry a queued withdrawal, or (admins only) a failed release after manual reconciliation.

- **Trigger:** `custom_json`
- **Requires active key signature**

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `sourceChain` | `string` | Yes |
| `sourceTxId` | `string` | Yes |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"bridge","action":"executeWithdrawal","payload":{}}}
```

### processQueue

Scheduled release of withdrawals queued by a pause or the daily limit.

- **Trigger:** `time`

**Payload**

_This action takes an empty payload._

### setPaused

Pause or resume the bridge (admins only). Paused deposits are refunded and releases are queued.

- **Trigger:** `custom_json`
- **Requires active key signature**

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `paused` | `boolean` | Yes |
| `reason` | `string` | No |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"bridge","action":"setPaused","payload":{}}}
```
