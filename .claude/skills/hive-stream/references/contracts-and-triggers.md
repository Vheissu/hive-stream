# Contracts And Triggers

## Contract Helpers

Use the helper exports instead of inventing custom contract shapes:

```ts
import { action, defineContract } from 'hive-stream';
```

Minimal pattern:

```ts
import { z } from 'zod';
import { action, defineContract } from 'hive-stream';

const createTipContract = defineContract({
    name: 'tips',
    actions: {
        send: action(async (payload, ctx) => {
            console.log(payload.amount, ctx.sender);
        }, {
            trigger: 'custom_json',
            requiresActiveKey: true,
            schema: z.object({
                amount: z.string().min(1)
            })
        })
    }
});
```

Register it explicitly:

```ts
await streamer.registerContract(createTipContract);
```

## Payload Wrapper

Contract actions do not fire on raw transfers or raw custom JSON alone. They run only when the incoming operation contains the configured wrapper key, which defaults to `hive_stream`.

Expected shape:

```json
{
  "hive_stream": {
    "contract": "mycontract",
    "action": "doSomething",
    "payload": {},
    "meta": {}
  }
}
```

Default identifiers:

- wrapper key: `hive_stream`
- custom JSON id: `hivestream`

## Supported Triggers

Current trigger values:

- `custom_json`
- `transfer`
- `time`
- `escrow_transfer`
- `escrow_approve`
- `escrow_dispute`
- `escrow_release`
- `recurrent_transfer`

An action can accept one trigger or an array of triggers.

## Contract Context

Action handlers receive `ctx` with:

- `trigger`
- `streamer`
- `adapter`
- `config`
- `block` (`number`, `id`, `previousId`, `time`: blockchain time, use it instead of `new Date()` so replays are deterministic)
- `transaction` (`id`, `operationIndex`; key per-operation records with `operationRecordId(ctx.transaction.id, ctx.transaction.operationIndex)` so multi-op transactions don't collide)
- `sender`
- optional `transfer` (`from`, `to`, `amount`, `asset`, `rawAmount`, `memo`; also set for `recurrent_transfer`), `customJson`, or `escrow`
- raw `operation`

Use `ctx.transfer` only when the trigger is transfer-based, and use the raw `operation` only when the higher-level fields are insufficient.

Contract dispatch fires on any transfer carrying a wrapped memo, not only transfers to the app account. Handlers that take payments must check `ctx.transfer.to`.

## Time Actions

Use `TimeAction` for scheduled contract execution:

```ts
import { TimeAction } from 'hive-stream';

const action = new TimeAction(
    '30s',
    'exchange-matcher',
    'exchange',
    'matchOrders',
    { limit: 50 }
);

await streamer.registerAction(action);
```

The target contract action must use `trigger: 'time'`. Due time actions run after each block's operations, measured against the block timestamp. Persisted actions restore in `init()`; registering the same id again is a no-op.

Use `TimeAction.getValidTimeValues()` or `HIVE_STREAM_METADATA.timeAction.validValues` for the current supported schedule strings.

## Guardrails

- Use `requiresActiveKey: true` for sensitive custom JSON actions.
- Validate payloads with zod 4 instead of manual field checks.
- Use declarative `guards` (`allowedAssets`, `minAmount`, `maxAmount`, `rateLimit`, `allowedSenders`, `paused`) for common checks; they never refund, so keep explicit checks where a refund path matters.
- Contract hooks: `create`, `destroy`, `beforeAction` (return `false` to veto), `afterAction`, `onError`. See `reliability-and-hooks.md`.
- Handlers are awaited in order and block the stream while they run.
- Use money utilities (`streamer.money.*`, BigNumber) for amounts, never floats.
- Keep contract hooks small and infrastructure-oriented.
- If a contract needs SQL-only features, document that adapter requirement in the app code.
