# hivelotto

A lottery-style game with scheduled draws.

**Category:** gambling

```ts
import { createLottoContract } from 'hive-stream';

await streamer.registerContract(createLottoContract());
```

::: tip Any adapter
This contract works with every built-in adapter, including MongoDB.
:::

## Options

| Option | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | `string` | No |  |
| `account` | `string` | No | House account that sells tickets and pays winners. Defaults to the streamer username. |
| `feeAccount` | `string` | No | Receives the fee share of each pot. Defaults to the house account. |
| `tokenSymbol` | `string` | No | Asset tickets are priced and paid out in (HIVE or HBD). Tickets paid in any other asset are refunded. |
| `validCurrencies` | `string[]` | No | Accepted ticket assets. Defaults to `[tokenSymbol]`; a ticket must also be paid in `tokenSymbol`. |
| `validDrawTypes` | `string[]` | No |  |
| `cost` | `number` | No |  |
| `minEntriesHourly` | `number` | No |  |
| `minEntriesDaily` | `number` | No |  |
| `hourlyWinnersPick` | `number` | No |  |
| `dailyWinnersPick` | `number` | No |  |
| `maxTicketsPerUser` | `number` | No |  |
| `feePercentage` | `number` | No |  |
| `notifyLosses` | `boolean` | No | Send a 0.001 notice transfer to entrants who did not win a draw (default false; results are always recorded on the draw). |
| `fairness` | `FairnessManager \| FairnessOptions \| boolean` | No | Provably-fair winner selection, on by default. The client seed is the sha256 of every entry's transaction id, so all entrants contribute entropy. Pass `false` for the legacy block-id RNG (not verifiable). |

## Actions

### buy

Buy a ticket for the hourly or daily draw by transferring the ticket cost in the lotto's asset. `type` must be "hourly" or "daily" (or another configured draw type); invalid tickets are refunded and overpayments are refunded down to the ticket cost.

- **Trigger:** `transfer`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `type` | `"hourly" \| "daily"` | Yes |

Send as a transfer memo:

```json
{"hive_stream":{"contract":"hivelotto","action":"buy","payload":{"type":"hourly"}}}
```

### drawHourlyLottery

- **Trigger:** `time`

**Payload**

_No payload validation defined for this action._

### drawDailyLottery

- **Trigger:** `time`

**Payload**

_No payload validation defined for this action._

### rotateSeed

Reveal the current server seed and commit to a new one (house account only).

- **Trigger:** `custom_json`, `time`
- **Requires active key signature**

**Payload**

_This action takes an empty payload._

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"hivelotto","action":"rotateSeed","payload":{}}}
```
