# rps

Rock-paper-scissors with wagers.

**Category:** games

```ts
import { createRpsContract } from 'hive-stream';

await streamer.registerContract(createRpsContract());
```

::: tip Any adapter
This contract works with every built-in adapter, including MongoDB.
:::

## Options

| Option | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | `string` | No |  |
| `account` | `string` | No | House account that receives bets and pays winners. Defaults to the streamer username. |
| `tokenSymbol` | `string` | No | Default accepted asset (HIVE). Winnings are always paid in the asset that was bet. |
| `validCurrencies` | `string[]` | No | Accepted assets (HIVE and/or HBD). Defaults to `[tokenSymbol]`. |
| `minAmount` | `number` | No |  |
| `maxAmount` | `number` | No |  |
| `houseEdge` | `number` | No | House edge in percent (default 2). A win pays the stake x 2 x (100 - houseEdge) / 100, rounded down; ties are refunded. |
| `notifyLosses` | `boolean` | No | Send a 0.001 notice transfer on losses (default false; results are always recorded as events). |
| `fairness` | `FairnessManager \| FairnessOptions \| boolean` | No | Provably-fair commit-reveal draws, on by default. Pass options or a shared FairnessManager to customise, or `false` for the legacy RNG (block ids plus an uncommitted server seed; not verifiable). |

## Actions

### play

Play provably-fair rock-paper-scissors against the house by transferring a wager. `move` must be "rock", "paper" or "scissors" and `seed` (optional client seed) at most 64 characters; anything else is refunded. Wins pay 2x the stake less the house edge (2% by default); ties are refunded.

- **Trigger:** `transfer`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `move` | `"rock" \| "paper" \| "scissors"` | Yes |
| `seed` | `string` | No |

Send as a transfer memo:

```json
{"hive_stream":{"contract":"rps","action":"play","payload":{"move":"rock"}}}
```

### rotateSeed

Reveal the current server seed and commit to a new one (house account only).

- **Trigger:** `custom_json`, `time`
- **Requires active key signature**

**Payload**

_This action takes an empty payload._

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"rps","action":"rotateSeed","payload":{}}}
```
