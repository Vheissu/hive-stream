# Transfer Flows

Flows automate what happens to incoming payments: burn a cut, forward to a treasury, split between collaborators, refund unsupported payments, or any combination — with integer-safe rounding and a previewable plan. All flows require an `activeKey`.

## One-liners

```ts
// Burn 67% of every incoming transfer
streamer.flows.autoBurnIncomingTransfers({
    percentage: 67,
    memo: ({ transaction }) => `Auto-burn 67% of ${transaction.id}`
});

// Forward everything to a treasury account
streamer.flows.autoForwardIncomingTransfers({ to: 'treasury', percentage: 100 });

// Split between accounts (remainder handling built in)
streamer.flows.autoSplitIncomingTransfers({
    recipients: [
        { account: 'null', percentage: 69, memo: 'Feel the burn' },
        { account: 'treasury' }   // receives the remainder
    ]
});

// Refund everything (e.g. rejecting unsupported payments)
streamer.flows.autoRefundIncomingTransfers({
    memo: ({ transfer }) => `Refunded ${transfer.rawAmount} to ${transfer.from}`
});

streamer.start();
```

## The general router

`autoRouteIncomingTransfers` mixes burns, transfers, groups, and on-top surcharges in one config:

```ts
streamer.flows.autoRouteIncomingTransfers({
    account: 'tweet-backup',
    routes: [
        { to: 'tweet-catcher', percentage: 20, memo: 'Tweet watcher share' },
        { group: [{ account: 'node-1' }, { account: 'node-2' }], percentage: 4, memo: 'Node operator share' },
        { type: 'burn', percentage: 70, memo: 'Burn share' },
        { to: 'platform-op', mode: 'onTop', percentage: 8, memo: 'Optional platform donation' }
    ]
});
```

- One base route may omit its percentage and automatically receives the remainder.
- `mode: 'onTop'` routes are a surcharge on the base amount: a `1.000 HBD` payout with an 8% donation should arrive as `1.080 HBD`.
- `group` routes split their share across members, equally or by weight.

## The chainable builder

The same flows, fluently:

```ts
streamer.flows
    .incomingTransfers()
    .burn(69, 'Feel the burn')
    .remainderTo('treasury', 'Treasury remainder')
    .start();
```

Single-step builders compile to the matching one-liner; multi-step builders compile to the router.

## Previewing the math

`.plan()` computes the exact rounded outcome without broadcasting anything:

```ts
const plan = streamer.flows
    .incomingTransfers('tweet-backup')
    .forwardTo('tweet-catcher', 20)
    .burn(70)
    .donateOnTop('platform-op', 8)
    .plan({ from: 'buyer', to: 'tweet-backup', amount: '1.080 HBD', memo: 'Archive this tweet' });

plan.baseAmount;   // "1.000"
plan.onTopAmount;  // "0.080"
plan.routes;       // exact per-route amounts
```

## Money helpers

For your own calculations, `streamer.money` exposes the same integer-safe math the flows use:

```ts
streamer.money.parseAssetAmount('1.000 HIVE');                  // { amount: '1.000', asset: 'HIVE' }
streamer.money.formatAmount('1.2399');                          // "1.239"
streamer.money.calculatePercentageAmount('10.000', 12.5);       // "1.250"
streamer.money.splitAmountByBasisPoints('1.000', [6900, 3100]); // ["0.690", "0.310"]
streamer.money.splitAmountByWeights('1.080', [10000, 800]);     // ["1.000", "0.080"]
```
