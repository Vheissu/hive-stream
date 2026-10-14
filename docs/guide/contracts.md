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

Definitions are checked during `defineContract()` and again at registration. Missing handlers, schemas without `safeParse()`, unsupported triggers, empty trigger lists, malformed hooks, and invalid guards fail during setup.

Contracts can also declare `beforeAction` / `afterAction` / `onError` hooks and declarative guards (allowed senders and assets, amount limits, rate limits, pausing). See [Hooks & Guards](./hooks).

## Triggers

Each action declares what invokes it:

| Trigger | Invoked by |
| --- | --- |
| `custom_json` | Custom JSON with your `jsonId` and a wrapped payload |
| `transfer` | A transfer whose memo carries a wrapped payload |
| `recurrent_transfer` | A recurrent transfer with a wrapped memo |
| `escrow_transfer` | An escrow whose `json_meta` carries a wrapped payload. `ctx.escrow` has the parties, amounts and deadlines |
| `escrow_approve` / `escrow_dispute` / `escrow_release` | These carry no JSON, so they reach *every* action that declares the trigger, with the escrow details as the payload and `who` as `ctx.sender`. A contract tracks the escrows it opened by filtering on `payload.escrowId` |
| `time` | [Time-based actions](./time-actions) — scheduled execution |

::: tip Only transfers to your account run paid actions
A transfer-triggered action runs only when the transfer was sent to the streamer username (or an account listed in the action's `allowedRecipients` guard). A wrapped memo on a payment between two other accounts is rejected with reason `recipient_not_allowed`, so nobody can run your payout handler by paying their own alt. Non-custodial flows where the buyer pays a third party directly (the built-in `buyNFTDirect` and `buyTicketDirect`) opt in with `guards: { allowedRecipients: ['*'] }` and verify `ctx.transfer.to` themselves. See [Hooks & Guards](./hooks#guards).
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
ctx.transaction    // { id, operationIndex }
ctx.transfer       // { from, to, amount, asset, rawAmount, memo } for transfer and recurrent_transfer triggers
ctx.customJson     // { id, json, isSignedWithActiveKey } for custom_json triggers
ctx.escrow         // escrow details for escrow triggers
ctx.operation      // { type, data } — the raw operation
```

## Validation

Attach a [Zod](https://zod.dev) schema to any action. Invalid payloads are rejected with a warning before your handler runs, so handler code can trust its input. The `onInvalidPayload` hook receives the Zod issues if you want to log them or tell the user.

A rejected transfer is kept unless you say otherwise. For an app that takes payments, set `refundRejectedTransfers: true` so a bet with a typo in it goes straight back to the sender with the reason in the memo. See [Hooks & Guards](./hooks#guards).

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

What happens when a handler throws is set by `errorPolicy`:

- `'skip'` (default): the error is logged and reported to `onContractError` / `onError`, the action is recorded as failed, and the stream moves on.
- `'halt'`: the streamer stops at that block without checkpointing it. After you fix the cause, restart (or call `processPendingBlocks()`) and the block is processed again. Actions that already succeeded in that block are skipped by the idempotency ledger.
- `'retry'`: the handler is retried up to `errorMaxRetries` times with exponential backoff, then the streamer halts.

A time-triggered action that fails under `'skip'` stays due and runs again on the next block.

## Write handlers to be safe to retry

Hive Stream records each contract action in an idempotency ledger after the handler returns, so a replayed block does not run it again. There is still a window: if the process dies after your handler broadcasts a payout but before the ledger write lands, that action runs again on restart. To close it:

- Record your own side effects keyed by `ctx.transaction.id` and `ctx.transaction.operationIndex` inside `adapter.runInTransaction()`, and check that record before paying out.
- Keep the broadcast as the last step of the handler.
- Under `errorPolicy: 'retry'`, assume the handler can run more than once for the same operation.

## Responding with payments

Handlers broadcast through the streamer:

```ts
payout: action(async (payload, ctx) => {
    // ctx.transfer is the payment that triggered this action; the streamer has
    // already checked that it was addressed to ctx.config.USERNAME.
    if (ctx.transfer.asset !== 'HIVE' || new BigNumber(ctx.transfer.amount).isLessThan('1')) {
        await ctx.streamer.transferHiveTokens(ctx.config.USERNAME, ctx.sender, ctx.transfer.amount, ctx.transfer.asset, '[Refund] Send at least 1 HIVE');
        return;
    }

    await ctx.streamer.transferHiveTokens(ctx.config.USERNAME, ctx.sender, '2.000', 'HIVE', 'Winner!');
}, { trigger: 'transfer', guards: { allowedAssets: ['HIVE'], minAmount: '1.000' } })
```

This requires an `activeKey` in config. The guards make the in-handler check redundant for transfers (they reject first), but keeping it means the handler is safe even if someone registers the contract with different guards. In tests, these broadcasts are captured, not sent — see [Testing Your App](./testing).

## Built-in contracts

Forty-eight ready-made contracts ship with the library — games, escrow marketplaces, swap desks, DAOs, subscriptions, payroll, and more. Browse the [contract reference](/contracts/), or read their source in `src/contracts/` as worked examples.
