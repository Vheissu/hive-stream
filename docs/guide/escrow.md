# Escrow

Hive has escrow built into the chain: a buyer locks HIVE or HBD with a third-party *agent*, the seller and the agent approve, and the funds are released by the parties themselves or, after a dispute, by the agent. No contract on Hive Stream's side ever holds the money. That makes escrow the right primitive for peer-to-peer marketplaces, swap desks and any trade where the app should referee but not custody.

Hive Stream covers all four escrow operations on the read side (subscriptions and contract triggers) and the write side (broadcast helpers). The [escrow marketplace](./recipes#a-peer-to-peer-escrow-marketplace) and [swap desk](./recipes#a-peer-to-peer-swap-desk) recipes use everything on this page.

## How a Hive escrow runs

| Step | Operation | Who signs | What it does |
| --- | --- | --- | --- |
| 1 | `escrow_transfer` | buyer (`from`) | Locks `hive_amount`/`hbd_amount` plus the agent `fee`. Names the seller (`to`), the `agent`, a numeric `escrow_id` (unique per buyer), a `ratification_deadline` and an `escrow_expiration`. `json_meta` can carry a contract payload |
| 2 | `escrow_approve` | seller and agent (`who`) | Both must approve before the ratification deadline or the funds return to the buyer. `approve: false` cancels |
| 3 | `escrow_release` | buyer or seller (`who`) | Before any dispute, the buyer can release to the seller and the seller can release to the buyer, in parts or whole |
| 3b | `escrow_dispute` | buyer or seller (`who`) | Hands control to the agent |
| 3c | `escrow_release` | agent (`who`) | After a dispute only the agent can release, to either party (`receiver`) |

The agent fee is paid to the agent when the escrow is approved by both parties. After `escrow_expiration` the escrow can only be released by the agent.

## Reacting to escrows

Subscriptions see every escrow operation on the chain:

```ts
streamer.onEscrowTransfer((op, blockNumber, blockId, prevBlockId, trxId, blockTime) => {});
streamer.onEscrowApprove((op) => {});
streamer.onEscrowDispute((op) => {});
streamer.onEscrowRelease((op) => {});
```

Contracts get the same operations as triggers. An `escrow_transfer` whose `json_meta` carries a wrapped payload runs the named action, with `ctx.escrow` describing the escrow:

```ts
const market = defineContract({
    name: 'market',
    actions: {
        openTrade: action(async (payload, ctx) => {
            const escrow = ctx.escrow!;            // { type, from, to, agent, escrowId, hiveAmount, hbdAmount, fee, ratificationDeadline, expiration }

            if (escrow.agent !== ctx.config.USERNAME) {
                return;                            // not ours to referee
            }

            await ctx.adapter.insert('trades', { id: escrow.escrowId, buyer: escrow.from, seller: escrow.to, listing: payload.listingId, status: 'pending' });

            await ctx.streamer.escrowApprove({    // approve as agent
                from: escrow.from, to: escrow.to, agent: escrow.agent, who: escrow.agent, escrow_id: escrow.escrowId, approve: true
            });
        }, { trigger: 'escrow_transfer', schema: z.object({ listingId: z.string() }) }),

        track: action(async (payload, ctx) => {
            // payload is the escrow itself; ctx.sender is `who`
            if (ctx.trigger === 'escrow_release' && payload.receiver === payload.to) {
                await ctx.adapter.replace('trades', { id: payload.escrowId }, { status: 'completed' });
            }
        }, { trigger: ['escrow_approve', 'escrow_dispute', 'escrow_release'] })
    }
});
```

`escrow_approve`, `escrow_dispute` and `escrow_release` carry no JSON, so there is nothing to route them by. They reach *every* action that declares the trigger, with the escrow details as the payload and `who` as `ctx.sender`, and each action gets its own idempotency key. Filter on `payload.escrowId` (and the agent) to follow only the escrows you opened.

## Broadcasting escrow operations

The app signs with the keys of the account it acts as, so an agent account listed under [`accounts`](./configuration#several-app-accounts) works without extra wiring.

```ts
await streamer.escrowTransfer({
    from: 'buyer', to: 'seller', agent: 'myapp-agent', escrow_id: 1001,
    hive_amount: '25.000 HIVE', hbd_amount: '0.000 HBD', fee: '0.250 HIVE',
    ratification_deadline: new Date(Date.now() + 24 * 3600 * 1000),
    escrow_expiration: new Date(Date.now() + 30 * 24 * 3600 * 1000),
    json_meta: { hive_stream: { contract: 'market', action: 'openTrade', payload: { listingId: 'lamp-1' } } }
});                                                                   // signs as the buyer: only for apps that hold the buyer's key

await streamer.escrowApprove({ from: 'buyer', to: 'seller', agent: 'myapp-agent', who: 'myapp-agent', escrow_id: 1001, approve: true });
await streamer.escrowDispute({ from: 'buyer', to: 'seller', agent: 'myapp-agent', who: 'buyer', escrow_id: 1001 });
await streamer.escrowRelease({ from: 'buyer', to: 'seller', agent: 'myapp-agent', who: 'myapp-agent', receiver: 'buyer', escrow_id: 1001, hive_amount: '25.000 HIVE', hbd_amount: '0.000 HBD' });
```

In a real marketplace the buyer signs `escrow_transfer` in their own wallet. `hive-stream/client` builds the whole operation, wrapped payload included, for a frontend to hand to Hive Keychain:

```ts
import { createContractEscrowTransferOperation } from 'hive-stream/client';

const operation = createContractEscrowTransferOperation(
    { contract: 'market', action: 'openTrade', payload: { listingId: 'lamp-1' } },
    {
        from: 'buyer', to: 'seller', agent: 'myapp-agent', escrowId: 1001,
        hiveAmount: '25.000 HIVE', fee: '0.250 HIVE',
        ratificationDeadline: new Date(Date.now() + 24 * 3600 * 1000),
        expiration: new Date(Date.now() + 30 * 24 * 3600 * 1000)
    }
);

hive_keychain.requestBroadcast('buyer', [operation], 'Active', (response) => console.log(response));
```

## Testing

The testing kit injects escrow operations like any other:

```ts
const ts = await createTestStreamer({ username: 'myapp-agent' });
await ts.streamer.registerContract(market);

await ts.sendOperations([
    ['escrow_transfer', {
        from: 'buyer', to: 'seller', agent: 'myapp-agent', escrow_id: 1001,
        hive_amount: '25.000 HIVE', hbd_amount: '0.000 HBD', fee: '0.250 HIVE',
        ratification_deadline: '2026-01-02T00:00:00', escrow_expiration: '2026-02-01T00:00:00',
        json_meta: ts.contractMemo('market', 'openTrade', { listingId: 'lamp-1' })
    }]
]);

expect(ts.client.operations.flat()).toContainEqual(['escrow_approve', expect.objectContaining({ who: 'myapp-agent', approve: true })]);

await ts.sendOperations([['escrow_release', { from: 'buyer', to: 'seller', agent: 'myapp-agent', who: 'buyer', receiver: 'seller', escrow_id: 1001, hive_amount: '25.000 HIVE', hbd_amount: '0.000 HBD' }]]);
```

## Things to know

- Escrow holds HIVE and HBD only. For Hive Engine tokens the app has to custody one leg; the swap desk contract does that with pending/paid payout states.
- The agent fee is the agent's revenue; set it in the same asset as the amount so the contract can verify it with one comparison.
- `escrow_id` is chosen by the buyer and must be unique among that buyer's open escrows. Marketplaces usually derive it from a listing or order id.
- An escrow nobody approves returns to the buyer at the ratification deadline on its own; the app doesn't need to do anything, but should mark the trade expired (a time-triggered action is the usual way).
- Multiple contracts can watch the same escrow lifecycle; each action gets its own ledger entry, so replays are safe for all of them.
