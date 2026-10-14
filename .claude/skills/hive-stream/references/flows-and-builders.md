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

Flows pay out exactly once. Each incoming transfer is keyed by transaction id + operation index (two transfers to the app in one transaction are both handled), and what a flow paid is recorded in the adapter's idempotency ledger (`flow:<name>:<trx>:<op>`), so a crash, halt, fork rewind or `replayBlocks()` never resends. `replayBlocks(..., { force: true })` deliberately runs them again. A custom `dedupeStore` (`{ has(key), add(key) }`) is still honoured; with `idempotency: false` and no store, the fallback is an in-memory set lost on restart.

Flows see every transfer to their account, including ones carrying a wrapped contract memo. Don't run a flow and a paid contract action on the same account unless both should act on the payment.

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
- social and account builders: `post()`, `follow()`, `unfollow()`, `mute()`, `reblog()`, `updateProfile()`, `commentOptions()`, `deleteComment()`, `subscribeCommunity()`, `unsubscribeCommunity()`
- wallet builders: `powerUp()`, `powerDown()`, `cancelPowerDown()`, `delegate()`, `undelegate()`, `claimRewards()`, `transferToSavings()`, `transferFromSavings()`, `convert()`, `collateralizedConvert()`, `limitOrder()`, `cancelOrder()`, `withdrawRoute()`, `cancelRecurrentTransfer()`, `witnessVote()`, `setProxy()`, `clearProxy()`
- Hive Engine builders: `stakeEngine()`, `unstakeEngine()`, `buyEngine()`, `sellEngine()`, `cancelEngineOrder()`, `delegateEngine()`, `undelegateEngine()`

Every write signs with the keys of the account it acts as (the `from`/author account), so with several app accounts configured (`accounts`) a builder acting as `myapp-vault` uses the vault's key. `streamer.batch()` collects operations into one transaction signed with every key it needs. `HIVE_STREAM_METADATA` lists the full write surface with signatures.

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

Prefer these helpers when generating payout plans or validating route math. Hive amounts should stay normalized to three-decimal asset strings. Hive Engine quantities go through `Utils.formatEngineQuantity()` (plain decimal string, up to 8 decimals).

Hive Engine batch helpers (`transferHiveEngineTokensMultiple`, `issueHiveEngineTokensMultiple`) return `{ sent, failed }`; retry only the `failed` recipients.
