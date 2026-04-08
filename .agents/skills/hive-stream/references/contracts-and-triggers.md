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
- `block`
- `transaction`
- `sender`
- optional `transfer`, `customJson`, or `escrow`
- raw `operation`

Use `ctx.transfer` only when the trigger is transfer-based, and use the raw `operation` only when the higher-level fields are insufficient.

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

The target contract action must use `trigger: 'time'`.

Use `TimeAction.getValidTimeValues()` or `HIVE_STREAM_METADATA.timeAction.validValues` for the current supported schedule strings.

## Guardrails

- Use `requiresActiveKey: true` for sensitive custom JSON actions.
- Validate payloads with Zod instead of manual field checks.
- Keep contract hooks small and infrastructure-oriented.
- If a contract needs SQL-only features, document that adapter requirement in the app code.
