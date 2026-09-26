# limbo

A provably-fair limbo/crash game: pick a target multiplier and win when the committed-seed result reaches it, with bankroll-based payout caps.

**Category:** gambling

```ts
import { createLimboContract } from 'hive-stream';

await streamer.registerContract(createLimboContract({ account: '...' }));
```

::: tip Any adapter
This contract works with every built-in adapter, including MongoDB.
:::

## Options

| Option | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | `string` | No |  |
| `account` | `string` | Yes | House account that receives bets and pays winners. |
| `assets` | `string[]` | No | Accepted assets. Defaults to HIVE. |
| `houseEdgeBps` | `number` | No | House edge in basis points (default 100 = 1%). |
| `minBet` | `string` | No |  |
| `maxBet` | `string` | No |  |
| `minTarget` | `string` | No | Lowest and highest target multipliers a player may choose. |
| `maxTarget` | `string` | No |  |
| `maxPayout` | `string` | No | Absolute cap on any single payout, in the bet's asset. |
| `maxPayoutBankrollBps` | `number` | No | Cap any single payout at this share of the available bankroll (basis points, default 100 = 1%). |
| `notifyLosses` | `boolean` | No | Send a 0.001 notice transfer on losses (default false; results are always recorded as events). |
| `fairness` | `FairnessManager \| FairnessOptions` | No | Fairness configuration. Always enabled for this game; defaults to block-entropy commit-reveal. |

## Actions

### bet

Bet with a target multiplier (e.g. "2.5"); you win bet x target when the provably-fair result reaches it.

- **Trigger:** `transfer`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `target` | `string \| number` | No |
| `seed` | `string` | No |

Send as a transfer memo:

```json
{"hive_stream":{"contract":"limbo","action":"bet","payload":{}}}
```

### rotateSeed

Reveal the current server seed and commit to a new one (house account only).

- **Trigger:** `custom_json`, `time`
- **Requires active key signature**

**Payload**

_This action takes an empty payload._

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"limbo","action":"rotateSeed","payload":{}}}
```
