# coinflip

A heads-or-tails coin flip game.

**Category:** gambling

```ts
import { createCoinflipContract } from 'hive-stream';

await streamer.registerContract(createCoinflipContract());
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
| `houseEdge` | `number` | No | House edge in percent (default 2). A win pays the stake x 2 x (100 - houseEdge) / 100, rounded down. |
| `notifyLosses` | `boolean` | No | Send a 0.001 notice transfer on losses (default false; results are always recorded as events). |
| `fairness` | `FairnessManager \| FairnessOptions \| boolean` | No | Provably-fair commit-reveal draws, on by default. Pass options or a shared FairnessManager to customise, or `false` for the legacy RNG (block ids plus an uncommitted server seed; not verifiable). |

## Actions

### flip

Bet on a provably-fair coin flip by transferring to the house account. `guess` must be "heads" or "tails" and `seed` (optional client seed) at most 64 characters; anything else is refunded. Winners receive 2x the stake less the house edge (2% by default).

- **Trigger:** `transfer`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `guess` | `"heads" \| "tails"` | Yes |
| `seed` | `string` | No |

Send as a transfer memo:

```json
{"hive_stream":{"contract":"coinflip","action":"flip","payload":{"guess":"heads"}}}
```

### rotateSeed

Reveal the current server seed and commit to a new one (house account only).

- **Trigger:** `custom_json`, `time`
- **Requires active key signature**

**Payload**

_This action takes an empty payload._

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"coinflip","action":"rotateSeed","payload":{}}}
```
