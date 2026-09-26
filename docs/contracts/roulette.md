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
| `account` | `string` | No |  |
| `tokenSymbol` | `string` | No |  |
| `validCurrencies` | `string[]` | No |  |
| `minAmount` | `number` | No |  |
| `maxAmount` | `number` | No |  |
| `fairness` | `FairnessManager \| FairnessOptions \| boolean` | No | Provably-fair commit-reveal draws (recommended). When omitted the legacy RNG (block ids plus an uncommitted per-bet server seed) is used. |

## Actions

### spin

Place a single-zero roulette bet by transferring to the house account.

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
