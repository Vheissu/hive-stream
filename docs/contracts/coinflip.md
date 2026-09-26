# coinflip

A heads-or-tails coin flip game.

**Category:** gambling

```ts
import { createCoinflipContract } from 'hive-stream';

await streamer.registerContract(createCoinflipContract());
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

### flip

- **Trigger:** `transfer`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `guess` | `"heads" \| "tails"` | Yes |
| `seed` | `string` | No |

Send as a transfer memo:

```json
{"hive_stream":{"contract":"coinflip","action":"flip","payload":{}}}
```
