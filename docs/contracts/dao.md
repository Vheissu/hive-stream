# dao

A DAO treasury with stake-weighted voting (Hive Power, Hive Engine stake or one per account), quorum, proposal deposits, an admin veto timelock and retryable payouts.

**Category:** governance

```ts
import { createDaoContract } from 'hive-stream';

await streamer.registerContract(createDaoContract());
```

::: tip SQL adapter
This contract keeps its state in SQL tables and needs a SQL-capable adapter (SQLite or PostgreSQL). Registering it on MongoDB fails.
:::

## Options

| Option | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | `string` | No |  |
| `account` | `string` | No | Treasury account: receives deposits and proposal deposits and sends payouts. Defaults to the streamer username. |
| `votingPower` | `'hive-power' \| 'engine-token' \| 'equal'` | No | How votes are weighted, snapshotted when the vote is cast: 'hive-power' (the voter's own Hive Power; delegations in or out are ignored), 'engine-token' (the voter's staked `tokenSymbol`) or 'equal' (one per account). Defaults to 'hive-power'. |
| `tokenSymbol` | `string` | No | Hive Engine token whose stake weights votes. Required for 'engine-token'. |
| `proposalDeposit` | `string` | No | Deposit a proposer sends with createProposal, in `depositAsset`. Refunded when the proposal reaches quorum and kept by the treasury otherwise (spam protection). Defaults to '1.000'. |
| `depositAsset` | `string` | No | Asset of the proposal deposit. Defaults to 'HIVE'. |
| `votingPeriodHours` | `number` | No | How long a proposal is open for voting. Defaults to 72. |
| `timelockHours` | `number` | No | Delay between a proposal passing and its payouts, during which admins can veto. Defaults to 24. |
| `quorum` | `string` | No | Absolute quorum: the voting weight (for + against) a proposal needs, in HP for 'hive-power', tokens for 'engine-token' and voters for 'equal'. Total Hive Power can't be summed per app, so quorum is an amount, not a share of supply. Defaults to '1000'. |
| `passThresholdBps` | `number` | No | Share of the votes cast that must support a proposal, in basis points; a proposal passes when its support is strictly above it (1-9999). Defaults to 5000 (simple majority). |
| `admins` | `string[]` | No | Accounts that can veto during the timelock and change parameters. Defaults to the treasury account. |
| `allowedAssets` | `string[]` | No | Assets the treasury accepts and pays out. Defaults to ['HIVE', 'HBD']. |

## Actions

### deposit

Fund the treasury with a transfer to the treasury account. Assets the treasury does not accept are refunded.

- **Trigger:** `transfer`

**Payload**

_This action takes an empty payload._

Send as a transfer memo:

```json
{"hive_stream":{"contract":"dao","action":"deposit","payload":{}}}
```

### createProposal

Open a proposal by sending the proposal deposit. Wrong deposits, invalid payloads and payouts above the available treasury balance are refunded.

- **Trigger:** `transfer`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `proposalId` | `unknown` | No |
| `title` | `unknown` | No |
| `description` | `unknown` | No |
| `payouts` | `unknown` | No |
| `expiresAt` | `unknown` | No |

Send as a transfer memo:

```json
{"hive_stream":{"contract":"dao","action":"createProposal","payload":{"proposalId":"grant-42","title":"Fund the community meetup","description":"Venue and catering for the October meetup.","payouts":[{"to":"organizer","amount":"250.000","asset":"HIVE"}]}}}
```

### vote

Vote for or against an open proposal. Weight is snapshotted when the vote is cast; a later vote by the same account replaces it.

- **Trigger:** `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `proposalId` | `string` | Yes |
| `support` | `boolean` | Yes |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"dao","action":"vote","payload":{"proposalId":"example-1","support":true}}}
```

### tally

Close proposals whose voting period has ended (anyone, or a scheduled time action): mark them passed or failed, refund or keep deposits and start the timelock.

- **Trigger:** `custom_json`, `time`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `proposalId` | `string` | No |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"dao","action":"tally","payload":{}}}
```

### execute

Pay out passed proposals whose timelock has elapsed (anyone, or a scheduled time action). Call it with a proposalId to retry failed payouts.

- **Trigger:** `custom_json`, `time`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `proposalId` | `string` | No |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"dao","action":"execute","payload":{}}}
```

### vetoProposal

Admin-only: veto a passed proposal during its timelock.

- **Trigger:** `custom_json`
- **Requires active key signature**

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `proposalId` | `string` | Yes |
| `reason` | `string` | No |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"dao","action":"vetoProposal","payload":{"proposalId":"example-1"}}}
```

### cancelProposal

Proposer-only: withdraw a proposal before anyone votes. The deposit stays with the treasury.

- **Trigger:** `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `proposalId` | `string` | Yes |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"dao","action":"cancelProposal","payload":{"proposalId":"example-1"}}}
```

### setParams

Admin-only: change quorum, pass threshold, voting period, timelock or proposal deposit for new proposals.

- **Trigger:** `custom_json`
- **Requires active key signature**

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `quorum` | `string` | No |
| `passThresholdBps` | `number` | No |
| `votingPeriodHours` | `number` | No |
| `timelockHours` | `number` | No |
| `proposalDeposit` | `string` | No |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"dao","action":"setParams","payload":{"quorum":"2500","timelockHours":48}}}
```
