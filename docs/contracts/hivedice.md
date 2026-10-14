# hivedice

A dice rolling game with configurable win chance and payout multipliers.

**Category:** gambling

```ts
import { createDiceContract } from 'hive-stream';

await streamer.registerContract(createDiceContract());
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
| `houseEdge` | `number` | No | House edge in percent (default 1). A win pays the fair odds x (100 - houseEdge) / 100, rounded down. |
| `minBet` | `number` | No |  |
| `maxBet` | `number` | No |  |
| `notifyLosses` | `boolean` | No | Send a 0.001 notice transfer on losses (default false; results are always recorded as events). |
| `fairness` | `FairnessManager \| FairnessOptions \| boolean` | No | Provably-fair commit-reveal draws, on by default. Pass options or a shared FairnessManager to customise, or `false` for the legacy block-id RNG (not verifiable, and a block producer can bias it). |

## Actions

### roll

Bet by transferring to the house account; you win when the provably-fair 1-100 roll is below your guess. `roll` must be a whole number from 2 to 96 (the win chance is roll - 1 percent) and `seed` (optional client seed) at most 64 characters; anything else is refunded.

- **Trigger:** `transfer`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `roll` | `number` | Yes |
| `seed` | `string` | No |

Send as a transfer memo:

```json
{"hive_stream":{"contract":"hivedice","action":"roll","payload":{"roll":10}}}
```

### rotateSeed

Reveal the current server seed and commit to a new one (house account only).

- **Trigger:** `custom_json`, `time`
- **Requires active key signature**

**Payload**

_This action takes an empty payload._

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"hivedice","action":"rotateSeed","payload":{}}}
```
