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

It goes in a transfer memo, a `custom_json` body (id `hivestream` by default), or an `escrow_transfer`'s `json_meta`. Build it with `hive-stream/client` rather than by hand.

## Supported Triggers

Current trigger values:

- `custom_json` (the default when `trigger` is omitted)
- `transfer`
- `recurrent_transfer`
- `time`
- `escrow_transfer`
- `escrow_approve`
- `escrow_dispute`
- `escrow_release`

An action can accept one trigger or an array of triggers. If an action must be paid for, restrict it to `transfer`: amount and asset guards don't apply to a `custom_json` call of the same action.

## Transfers Must Be Addressed To The App

A transfer-triggered action (`transfer`, `recurrent_transfer`) only runs when the transfer was sent to an app account (the streamer username or an `accounts` entry) or an account in the action's `allowedRecipients` guard. A wrapped memo on a payment between two other accounts is rejected with `recipient_not_allowed`.

- House account differs from the streamer username: `registerContract({ ...createDiceContract({ account: 'myhouse' }), guards: { allowedRecipients: ['myhouse'] } })`, or list `myhouse` under `accounts`.
- Non-custodial action where the buyer pays a third party (seller): `guards: { allowedRecipients: ['*'] }` and verify `ctx.transfer.to` in the handler.
- Inside the handler, trust `ctx.transfer` (what the chain settled), not the payload (what the sender typed). Compare amounts with BigNumber.

## Contract Context

Action handlers receive `ctx` with:

- `trigger`
- `streamer`
- `adapter`
- `config`
- `block` (`number`, `id`, `previousId`, `time`: blockchain time, use it instead of `new Date()` so replays are deterministic)
- `transaction` (`id`, `operationIndex`; key per-operation records with `operationRecordId(ctx.transaction.id, ctx.transaction.operationIndex)` so multi-op transactions don't collide)
- `sender` (for escrow lifecycle triggers, the operation's `who`)
- optional `transfer` (`from`, `to`, `amount`, `asset`, `rawAmount`, `memo`; also set for `recurrent_transfer`), `customJson` (`id`, `json`, `isSignedWithActiveKey`), or `escrow` (`type`, `from`, `to`, `agent`, `escrowId`, `who`, `receiver`, `hiveAmount`, `hbdAmount`, `fee`, `ratificationDeadline`, `expiration`, `approved`)
- raw `operation`

Use `ctx.transfer` only when the trigger is transfer-based, and use the raw `operation` only when the higher-level fields are insufficient. When re-reading a transfer from chain, pass the operation index: `Utils.verifyTransfer(trx, from, to, amount, ctx.transaction.operationIndex)`.

## Escrow

Hive escrow locks HIVE/HBD with a third-party agent; the app as agent referees without custody. Guide: `docs/guide/escrow.md`; built-ins: `escrowmarket`, `p2pswap`, `rentals`.

- `escrow_transfer` carries a wrapped payload in `json_meta` and routes to the named action like a memo. Check `ctx.streamer.isAppAccount(ctx.escrow.agent)` before acting on it.
- `escrow_approve`, `escrow_dispute`, `escrow_release` carry no JSON. They reach *every* action that declares the trigger, with the escrow details (the `ctx.escrow` shape) as the payload and `who` as `ctx.sender`, each with its own ledger key. Filter on `payload.escrowId` / `payload.agent` to follow only your escrows, and omit a `schema` (or accept the escrow shape) on these actions.

```ts
track: action(async (payload, ctx) => {
    if (ctx.trigger === 'escrow_release' && payload.receiver === payload.to) { /* trade completed */ }
}, { trigger: ['escrow_approve', 'escrow_dispute', 'escrow_release'] })
```

Broadcasting (signed with the keys of the account it acts as, so an agent listed under `accounts` just works):

- `streamer.escrowTransfer({ from, to, agent, escrow_id, hive_amount, hbd_amount, fee, ratification_deadline, escrow_expiration, json_meta })` (signs as the buyer; only for apps holding the buyer's key)
- `streamer.escrowApprove({ from, to, agent, who, escrow_id, approve })`
- `streamer.escrowDispute({ from, to, agent, who, escrow_id })`
- `streamer.escrowRelease({ from, to, agent, who, receiver, escrow_id, hive_amount, hbd_amount })`
- `streamer.ops.escrowTransfer()` fluent builder
- Frontend: `createContractEscrowTransferOperation({ contract, action, payload }, { from, to, agent, escrowId, hiveAmount?, hbdAmount?, fee, ratificationDeadline, expiration })` from `hive-stream/client`, handed to Keychain `requestBroadcast(..., 'Active')`.

Testing:

```ts
await ts.sendOperations([['escrow_transfer', {
    from: 'buyer', to: 'seller', agent: 'myapp-agent', escrow_id: 1001,
    hive_amount: '25.000 HIVE', hbd_amount: '0.000 HBD', fee: '0.250 HIVE',
    ratification_deadline: '2026-01-02T00:00:00', escrow_expiration: '2026-02-01T00:00:00',
    json_meta: ts.contractMemo('market', 'openTrade', { listingId: 'lamp-1' })
}]]);
expect(ts.client.operations.flat()).toContainEqual(['escrow_approve', expect.objectContaining({ who: 'myapp-agent', approve: true })]);
```

Escrow holds HIVE and HBD only; `escrow_id` is chosen by the buyer and unique among their open escrows; an unapproved escrow returns to the buyer at the ratification deadline on its own.

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

The target contract action must use `trigger: 'time'`. Due time actions run after each block's operations, measured against the block timestamp. Persisted actions restore in `init()`; registering the same id again is a no-op (with a warning).

Use `TimeAction.getValidTimeValues()` or `HIVE_STREAM_METADATA.timeAction.validValues` for the current supported schedule strings.

## Guardrails

- Use `requiresActiveKey: true` for value-moving custom JSON actions; posting authority is granted to many frontends.
- Validate payloads with zod 4 instead of manual field checks. A payload replaced by `beforeContractAction` is validated too.
- Use declarative `guards` (`allowedRecipients`, `allowedAssets`, `minAmount`, `maxAmount`, `rateLimit`, `allowedSenders`, `blockedSenders`, `paused`) for common checks. Turn on `refundRejectedTransfers` so rejected payments go back.
- Contract hooks: `create`, `destroy`, `beforeAction` (return `false` to veto), `afterAction`, `onError`. See `reliability-and-hooks.md`.
- Handlers are awaited in order and block the stream while they run.
- Use money utilities (`streamer.money.*`, BigNumber) for amounts, never floats. Round payouts down.
- Write state first, broadcast last, and give payouts pending/paid/failed states with an explicit retry action (the built-ins use `retryPayouts`, `retryClaimPayout`, `retryRefund`).
- If a contract needs SQL-only features, document that adapter requirement in the app code.
