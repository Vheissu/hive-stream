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

| Option | Type | Required |
| --- | --- | --- |
| `name` | `string` | No |
| `account` | `string` | No |
| `tokenSymbol` | `string` | No |
| `validCurrencies` | `string[]` | No |
| `minAmount` | `number` | No |
| `maxAmount` | `number` | No |

## Actions

### play

- **Trigger:** `transfer`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `move` | `"rock" \| "paper" \| "scissors"` | Yes |
| `seed` | `string` | No |

Send as a transfer memo:

```json
{"hive_stream":{"contract":"rps","action":"play","payload":{}}}
```
