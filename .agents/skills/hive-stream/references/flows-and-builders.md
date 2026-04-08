# Flows And Builders

## `flows.*` High-Level Automation

Use `flows.*` when the app reacts to inbound transfers and you want Hive Stream to handle routing math and broadcasting.

Available helpers:

- `flows.autoBurnIncomingTransfers(options)`
- `flows.autoForwardIncomingTransfers(options)`
- `flows.autoRefundIncomingTransfers(options)`
- `flows.autoSplitIncomingTransfers(options)`
- `flows.autoRouteIncomingTransfers(options)`
- `flows.planIncomingTransferRoutes(transfer, options)`
- `flows.incomingTransfers(account?)` for the chainable builder

Use `planIncomingTransferRoutes(...)` or builder `.plan(...)` when the task needs a dry run or preview.

## Chainable Transfer Flow Builder

```ts
const handle = streamer.flows
    .incomingTransfers('payments')
    .allowSymbols('HIVE', 'HBD')
    .forwardTo('treasury', 80)
    .burn(10, 'Operations burn')
    .remainderTo('ops')
    .start();
```

Useful chain methods:

- `forAccount(...)`
- `allowSymbols(...)`
- `memo(...)`
- `dedupeWith(...)`
- `ignoreZeroAmount(...)`
- `onError(...)`
- `burn(...)`
- `burnOnTop(...)`
- `forwardTo(...)`
- `forwardOnTop(...)`
- `forwardGroup(...)`
- `forwardGroupOnTop(...)`
- `remainderTo(...)`
- `remainderToGroup(...)`
- `refund(...)`
- `refundPortion(...)`
- `remainderToSender(...)`
- `plan(...)`
- `start()`

Routing rules worth preserving:

- One base route can omit allocation and receive the remainder.
- `mode: 'onTop'` is treated as a surcharge above the base payout amount.
- Builder single-step cases compile down to the simpler `auto*` helpers.

## `ops.*` Fluent Write Builders

Use `ops.*` when the task needs clearer, chainable outbound writes instead of direct method calls.

Available builders:

- `ops.transfer()`
- `ops.burn()`
- `ops.escrowTransfer()`
- `ops.recurrentTransfer()`
- `ops.createProposal()`
- `ops.transferEngine()`
- `ops.burnEngine()`
- `ops.issueEngine()`
- `ops.voteProposals()`
- `ops.removeProposals()`
- `ops.upvote()`
- `ops.downvote()`

Example:

```ts
await streamer.ops
    .transfer()
    .from('app-account')
    .to('treasury')
    .hbd('5.000')
    .memo('Revenue share')
    .send();
```

## `money.*` Helpers

Use the money namespace for exact asset math instead of ad hoc string parsing:

- `parseAssetAmount`
- `formatAmount`
- `formatAssetAmount`
- `calculatePercentageAmount`
- `calculateBasisPointsAmount`
- `splitAmountByBasisPoints`
- `splitAmountByPercentage`
- `splitAmountByWeights`

Prefer these helpers when generating payout plans or validating route math. Hive amounts should stay normalized to three-decimal asset strings.
