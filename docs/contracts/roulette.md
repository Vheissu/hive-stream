# roulette

Roulette with straight, color, parity, dozen, column, and low/high bets.

**Category:** gambling

```ts
import { createRouletteContract } from 'hive-stream';

await streamer.registerContract(createRouletteContract());
```

::: tip SQL adapter
Most built-in contracts persist state in SQL tables and require a SQL-capable adapter (SQLite or PostgreSQL).
:::

## Options

| Option | Type | Required |
| --- | --- | --- |
| `name` | `string` | No |
| `account` | `string` | No |
| `tokenSymbol` | `string` | No |
| `validCurrencies` | `string[]` | No |
| `minAmount` | `number` | No |
| `maxAmount` | `number` | No |

## Actions

### spin

- **Trigger:** `transfer`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `betType` | `"straight" \| "color" \| "parity" \| "dozen" \| "column" \| "range"` | Yes |
| `value` | `string \| number` | Yes |
| `seed` | `string` | No |

Send as a transfer memo:

```json
{"hive_stream":{"contract":"roulette","action":"spin","payload":{}}}
```
