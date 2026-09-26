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
| `account` | `string` | No |  |
| `tokenSymbol` | `string` | No |  |
| `validCurrencies` | `string[]` | No |  |
| `houseEdge` | `number` | No |  |
| `minBet` | `number` | No |  |
| `maxBet` | `number` | No |  |
| `fairness` | `FairnessManager \| FairnessOptions \| boolean` | No | Provably-fair commit-reveal draws (recommended). `true` uses defaults; pass options or a shared FairnessManager to customise. When omitted the legacy block-id RNG is used for backwards compatibility. |

## Actions

### roll

Bet by transferring to the house account; wins when the 1-100 roll is below your guess.

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
