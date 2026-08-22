# Writing Contracts

Contracts are how your app reacts to payments and signed messages. A contract runs when a transfer memo or custom JSON operation carries a wrapped payload naming it:

```json
{"hive_stream":{"contract":"hivedice","action":"roll","payload":{"roll":22}}}
```

The wrapper key (`hive_stream`) is your configured `payloadIdentifier`; for custom JSON the operation id must also match your `jsonId`.

## Defining a contract

```ts
import { defineContract, action } from 'hive-stream';
import { z } from 'zod';

const dice = defineContract({
    name: 'mydice',
    hooks: {
        create: async ({ adapter }) => {
            await adapter.query(`CREATE TABLE IF NOT EXISTS rolls (...)`);
        },
        destroy: async () => { /* cleanup */ }
    },
    actions: {
        roll: action(async (payload, ctx) => {
            // payload is validated and typed by the schema below
            if (ctx.transfer) {
                // this action was triggered by a payment
            }
        }, {
            trigger: 'transfer',
            schema: z.object({ roll: z.number().int().min(2).max(96) })
        })
    }
});

await streamer.registerContract(dice);
```

Registration is async so `create` hooks can initialize tables. Unregister with `await streamer.unregisterContract('mydice')`.

Definitions are checked during `defineContract()` and again at registration. Missing handlers, schemas without `safeParse()`, unsupported triggers, empty trigger lists, and malformed lifecycle hooks fail during setup.

## Triggers

Each action declares what invokes it:

| Trigger | Invoked by |
| --- | --- |
| `custom_json` | Custom JSON with your `jsonId` and a wrapped payload |
| `transfer` | A transfer whose memo carries a wrapped payload |
| `recurrent_transfer` | A recurrent transfer with a wrapped memo |
| `escrow_transfer` / `escrow_approve` / `escrow_dispute` / `escrow_release` | Escrow lifecycle operations |
| `time` | [Time-based actions](./time-actions) — scheduled execution |

::: warning Transfers dispatch on any wrapped memo
Contract dispatch fires on any transfer carrying a wrapped memo — not only transfers to your app account. This is what makes non-custodial peer-to-peer flows possible (direct NFT sales, ticket resale). If your action should only accept payments to your account, check `ctx.transfer.to` in the handler.
:::

## The context object

Every handler receives `(payload, ctx)`:

```ts
ctx.trigger        // which trigger fired
ctx.sender         // the account that sent the operation
ctx.streamer       // the Streamer — broadcast responses from here
ctx.adapter        // your storage adapter
ctx.config         // resolved config
ctx.block          // { number, id, previousId, time }
ctx.transaction    // { id }
ctx.transfer       // { from, to, amount, asset, rawAmount, memo } for transfer triggers
ctx.customJson     // { id, json, isSignedWithActiveKey } for custom_json triggers
ctx.escrow         // escrow details for escrow triggers
ctx.operation      // { type, data } — the raw operation
```

## Validation

Attach a [Zod](https://zod.dev) schema to any action. Invalid payloads are rejected with a warning before your handler runs, so handler code can trust its input.

Put schemas that are also needed by a frontend or CLI in a [shared contract spec](./contract-calls). This keeps client-side checks and server dispatch on the same definition.

## Active key enforcement

For sensitive custom JSON actions, require the active authority:

```ts
withdraw: action(handler, {
    trigger: 'custom_json',
    requiresActiveKey: true
})
```

Operations signed only with a posting key are rejected.

## Error handling

Exceptions thrown by handlers are caught and logged; block processing continues. Time-triggered actions are the exception — their errors propagate so scheduling can account for the failure.

## Responding with payments

Handlers broadcast through the streamer:

```ts
payout: action(async (payload, ctx) => {
    await ctx.streamer.transferHiveTokens(
        ctx.config.USERNAME,
        ctx.sender,
        '2.000',
        'HIVE',
        'Winner!'
    );
}, { trigger: 'transfer' })
```

This requires an `activeKey` in config. In tests, these broadcasts are captured, not sent — see [Testing Your App](./testing).

## Built-in contracts

Forty ready-made contracts ship with the library — games, marketplaces, subscriptions, payroll, and more. Browse the [contract reference](/contracts/), or read their source in `src/contracts/` as worked examples.
