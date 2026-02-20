# Hive-Stream Documentation

## Introduction
Hive Stream is a Node.js library for streaming Hive blockchain activity and routing it to contracts you define. Contracts can react to:
- `custom_json` operations
- transfer memos
- time-based actions
- escrow operations

This document focuses on the contract system and how to build robust contracts using the new `defineContract`/`action` API.

By default, `new Streamer()` registers the SQLite adapter and starts the built-in Express API server on port `5001` when `NODE_ENV !== 'test'`.

---

## Concepts

### Contracts
A **contract** is a definition object with:
- a **name**
- one or more **actions**
- optional **lifecycle hooks**

Contracts are registered with the `Streamer` and called when a payload matches `contract` + `action`.

### Actions
An **action** is a handler function plus metadata such as:
- the trigger (`custom_json`, `transfer`, `time`, `escrow_transfer`, `escrow_approve`, `escrow_dispute`, `escrow_release`, or `recurrent_transfer`)
- an optional Zod schema to validate payloads
- whether it requires an active key signature

### Payload Identifier
Hive Stream extracts payloads from:
- **custom_json**: `op[1].json`
- **transfer memo**: `op[1].memo`
- **recurrent transfer memo**: `op[1].memo`
- **escrow metadata**: `op[1].json_meta`

It expects a wrapper object that looks like:

```
{
  "hive_stream": {
    "contract": "mycontract",
    "action": "doSomething",
    "payload": { "any": "data" },
    "meta": { "optional": true }
  }
}
```

The wrapper key `hive_stream` is the default `PAYLOAD_IDENTIFIER`. You can change it in config.

Relevant configuration defaults:

- `PAYLOAD_IDENTIFIER`: `hive_stream`
- `JSON_ID`: `hivestream`
- `HIVE_ENGINE_ID`: `ssc-mainnet-hive`
- `HIVE_ENGINE_API`: `https://api.hive-engine.com/rpc`

### Event Handlers vs Contracts
Streamer event handlers (`onTransfer`, `onCustomJson`, `onCustomJsonId`, etc.) and contract actions are different execution paths.

- Event handlers fire for matching blockchain operations.
- Contract actions only run when a valid wrapper exists under `PAYLOAD_IDENTIFIER` and the `contract` + `action` values match a registered contract action.

---

## Contract API

### Define a Contract

```ts
import { defineContract, action } from 'hive-stream';

const MyContract = defineContract({
    name: 'mycontract',
    actions: {
        hello: action(async (payload, ctx) => {
            console.log('hello', payload.name, ctx.sender);
        }, {
            trigger: 'custom_json'
        })
    }
});
```

### Register a Contract

```ts
import { Streamer } from 'hive-stream';

const streamer = new Streamer();
await streamer.registerContract(MyContract);
```

### Unregister a Contract

```ts
await streamer.unregisterContract('mycontract');
```

### Contract Lifecycle Hooks

```ts
const MyContract = defineContract({
    name: 'mycontract',
    hooks: {
        create: async ({ streamer, adapter, config }) => {
            // initialize tables, cache config, etc
        },
        destroy: async ({ streamer, adapter }) => {
            // cleanup resources
        }
    },
    actions: { ... }
});
```

---

## Contract Context

Every action receives a `ContractContext` with:

- `trigger`: `custom_json | transfer | time | escrow_transfer | escrow_approve | escrow_dispute | escrow_release | recurrent_transfer`
- `streamer`: access to Hive client and helpers
- `adapter`: database adapter
- `config`: resolved config values
- `block`: `{ number, id, previousId, time }`
- `transaction`: `{ id }`
- `sender`: Hive account invoking the action
- `transfer`: transfer details (only for `transfer` trigger)
- `customJson`: custom JSON details (only for `custom_json` trigger)
- `escrow`: escrow details (only for escrow triggers)
- `operation`: raw operation data and operation type for advanced use cases

### Example

```ts
action((payload, ctx) => {
    console.log(ctx.trigger);
    console.log(ctx.block.number, ctx.transaction.id);
    if (ctx.transfer) {
        console.log(ctx.transfer.amount, ctx.transfer.asset);
    }
});
```

---

## Payload Validation (Zod)

Use Zod to validate payloads and enforce strong inputs:

```ts
import { z } from 'zod';

const schema = z.object({
    amount: z.string().min(1),
    to: z.string().min(1)
});

const MyContract = defineContract({
    name: 'payments',
    actions: {
        send: action((payload, ctx) => {
            // payload is validated here
        }, { schema, trigger: 'custom_json' })
    }
});
```

If validation fails, the action is not executed and the error is logged.

---

## Triggers

Actions can be scoped to a trigger:

- `custom_json`: called when a custom JSON payload matches
- `transfer`: called when a transfer memo matches
- `time`: called by a `TimeAction`
- `escrow_transfer`: called when escrow transfer payload in `json_meta` matches
- `escrow_approve`: available as a trigger for escrow-related contracts
- `escrow_dispute`: available as a trigger for escrow-related contracts
- `escrow_release`: available as a trigger for escrow-related contracts
- `recurrent_transfer`: called when recurrent transfer memo payload matches

```ts
action(handler, { trigger: 'transfer' });
```

You can also allow multiple triggers:

```ts
action(handler, { trigger: ['custom_json', 'transfer'] });
```

---

## Active Key Enforcement

Some actions should only run when the transaction is signed with an active key. Mark them with:

```ts
action(handler, { trigger: 'custom_json', requiresActiveKey: true });
```

This prevents posting-key JSONs from triggering sensitive actions like withdrawals.

---

## Error Handling

- Errors inside contract actions are caught and logged.
- **Time actions** bubble errors back into the scheduler so the action does **not** increment execution count if it fails.

Write actions defensively and always validate inputs.

---

## Time-Based Actions

Time-based actions let you run contract logic on a schedule:

```ts
import { TimeAction } from 'hive-stream';

const matchAction = new TimeAction('30s', 'exchange-matcher', 'exchange', 'matchOrders', { limit: 50 });
await streamer.registerAction(matchAction);
```

The action must have `trigger: 'time'` in its definition.

---

## Adapter Requirements

Contracts can use any adapter, but some require SQL features:

- **SQL adapters** (SQLite/Postgres) support `adapter.query(...)`.
- **MongoDB adapter** does not support raw SQL.

If a contract uses `adapter.query`, it must document that it requires a SQL adapter.

---

## Building Contracts Step-by-Step

1. **Define the contract** with `defineContract`.
2. **Define actions** with `action`, specifying trigger and optional schema.
3. **Use hooks** (`create`, `destroy`) to initialize tables or cache configuration.
4. **Validate input** using Zod.
5. **Use `ctx`** for block/transaction context.
6. **Return void** (actions are fire-and-forget).
7. **Register the contract** with the streamer.

---

## Example Contract

```ts
import { defineContract, action } from 'hive-stream';
import { z } from 'zod';

const tipSchema = z.object({
    message: z.string().max(280).optional()
});

export const TipJar = defineContract({
    name: 'tipjar',
    actions: {
        tip: action(async (payload, ctx) => {
            if (!ctx.transfer) {
                throw new Error('Transfer context required');
            }

            console.log(`Tip from ${ctx.sender}: ${ctx.transfer.amount} ${ctx.transfer.asset}`);
            if (payload.message) {
                console.log(`Message: ${payload.message}`);
            }
        }, {
            schema: tipSchema,
            trigger: 'transfer'
        })
    }
});
```

---

## Built-in Contract Examples

- `createDiceContract` - Dice game using transfer bets
- `createCoinflipContract` - Coin flip game using transfer bets
- `createLottoContract` - Lottery system with scheduled draws
- `createTokenContract` - SQL-backed fungible tokens
- `createNFTContract` - SQL-backed NFTs
- `createRpsContract` - Rock/Paper/Scissors
- `createPollContract` - Polls and votes
- `createTipJarContract` - Tip jar + message log
- `createExchangeContract` - Deposits/withdrawals/orders/matching (SQL)

### Example Snippets

Quick-start snippets live in `examples/contracts/`:

- `examples/contracts/rps.ts`
- `examples/contracts/poll.ts`
- `examples/contracts/tipjar.ts`
- `examples/contracts/exchange.ts`

---

## Exchange Contract Guide

The exchange contract gives you a basic on-chain orderbook experience backed by a SQL adapter.

### Features
- Deposits via transfer memo
- Internal balances (available + locked)
- Order placement and cancellation
- Order matching
- Withdrawals (active key required)
- Internal transfers between exchange users
- Maker/taker fees (basis points)
- Order book snapshots for API consumption

### Notes
- Requires a SQL adapter (SQLite or Postgres).
- Uses `TimeAction` to run `matchOrders` periodically.
- Fees are charged on received assets (base for buyers, quote for sellers).

### Configuration Options
```
createExchangeContract({
  name: 'exchange',
  account: 'my-exchange',
  feeAccount: 'my-exchange-fees',
  makerFeeBps: 10,
  takerFeeBps: 20
})
```

### Example Payloads

**Create pair**
```
{"hive_stream": {"contract":"exchange","action":"createPair","payload":{"base":"HIVE","quote":"HBD"}}}
```

**Deposit** (send transfer to exchange account with memo)
```
{"hive_stream": {"contract":"exchange","action":"deposit","payload":{}}}
```

**Place order**
```
{"hive_stream": {"contract":"exchange","action":"placeOrder","payload":{"side":"buy","base":"HIVE","quote":"HBD","price":"2","amount":"5"}}}
```

**Cancel order**
```
{"hive_stream": {"contract":"exchange","action":"cancelOrder","payload":{"orderId":"..."}}}
```

**Snapshot orderbook**
```
{"hive_stream": {"contract":"exchange","action":"snapshotOrderBook","payload":{"base":"HIVE","quote":"HBD","depth":20}}}
```

**Withdraw**
```
{"hive_stream": {"contract":"exchange","action":"withdraw","payload":{"asset":"HBD","amount":"5.000"}}}
```

### API Endpoints

If you run the built-in API server, the following endpoints are available:

- `GET /exchange/balances` (optional query `?account=alice`)
- `GET /exchange/orders` (query `account`, `base`, `quote`, `status`)
- `GET /exchange/trades` (query `account`, `base`, `quote`)
- `GET /exchange/orderbook` (query `base`, `quote`, `limit`)

---

## Utilities
The library includes helpers for JSON parsing, randomness, and transfer verification. See `src/utils.ts` for details.

---

## Tests
Contract tests live under `tests/contracts/`. Time action tests are in `tests/streamer-actions.spec.ts`.
