# rps

Rock-paper-scissors with wagers.

**Category:** games

```ts
import { createRpsContract } from 'hive-stream';

await streamer.registerContract(createRpsContract());
```

::: tip SQL adapter
Most built-in contracts persist state in SQL tables and require a SQL-capable adapter (SQLite or PostgreSQL).
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

### play

Play rock-paper-scissors against the house by transferring a wager; ties are refunded.

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
