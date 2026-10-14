# roulette

Roulette with straight, color, parity, dozen, column, and low/high bets.

**Category:** gambling

```ts
import { createRouletteContract } from 'hive-stream';

await streamer.registerContract(createRouletteContract());
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
| `notifyLosses` | `boolean` | No | Send a 0.001 notice transfer on losses (default false; results are always recorded as events). |
| `fairness` | `FairnessManager \| FairnessOptions \| boolean` | No | Provably-fair commit-reveal draws, on by default. Pass options or a shared FairnessManager to customise, or `false` for the legacy RNG (block ids plus an uncommitted server seed; not verifiable). |

## Actions

### spin

Place a provably-fair single-zero roulette bet by transferring to the house account. `betType`/`value`: straight 0-36 (pays 36x), color red/black, parity odd/even, range low/high (2x), dozen or column 1-3 (3x). `seed` (optional client seed) at most 64 characters. Invalid bets are refunded.

- **Trigger:** `transfer`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `betType` | `"straight" \| "color" \| "parity" \| "dozen" \| "column" \| "range"` | Yes |
| `value` | `string \| number` | Yes |
| `seed` | `string` | No |

Send as a transfer memo:

```json
{"hive_stream":{"contract":"roulette","action":"spin","payload":{"betType":"straight","value":17}}}
```

### rotateSeed

Reveal the current server seed and commit to a new one (house account only).

- **Trigger:** `custom_json`, `time`
- **Requires active key signature**

**Payload**

_This action takes an empty payload._

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"roulette","action":"rotateSeed","payload":{}}}
```
