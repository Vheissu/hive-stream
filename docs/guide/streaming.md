# Streaming & Subscriptions

Subscriptions are read-only: no keys required. Register handlers, call `start()`, and Hive Stream polls the chain with automatic node failover, invoking your callbacks in block order.

Callbacks run one at a time in the order the operations appear on chain. Async callbacks are awaited before the next one starts, so ordering holds even when a handler does I/O. A callback that throws is logged and reported to the [`onError` hook](./hooks) with phase `subscription`; the other callbacks and the rest of the block still run.

Subscriptions and contracts are separate paths: a subscription fires for every matching operation, while a contract action only runs when the operation carries a wrapped payload under your `payloadIdentifier`.

## Common events

```ts
// Transfers to a specific account
streamer.onTransfer('myaccount', (op, blockNumber, blockId, prevBlockId, trxId, blockTime, operationIndex) => {
    // op.from, op.to, op.amount ("1.000 HIVE"), op.memo
    // trxId + operationIndex identify the transfer: one transaction can carry several
});

// All custom JSON operations
streamer.onCustomJson((op, { sender, isSignedWithActiveKey }, blockNumber, blockId, prevBlockId, trxId, blockTime) => {
});

// Custom JSON with a specific id
streamer.onCustomJsonId('your-custom-json-id', (op, { sender, isSignedWithActiveKey }, blockNumber, blockId, prevBlockId, trxId, blockTime) => {
});

// Hive Engine operations, delivered only after the sidechain confirms it executed them
streamer.onHiveEngine((contractName, contractAction, contractPayload, sender, op, blockNumber, blockId, prevBlockId, trxId, blockTime) => {
});

// Posts and comments
streamer.onPost((op, ...meta) => {});
streamer.onComment((op, ...meta) => {});
```

## Every subscription

| Method | Fires on |
| --- | --- |
| `onTransfer(account, cb)` | Transfers where `op.to === account` |
| `onCustomJson(cb)` | Every custom JSON operation |
| `onCustomJsonId(id, cb)` | Custom JSON with a matching id |
| `onHiveEngine(cb)` | Hive Engine sidechain operations. The sidechain is asked whether it executed the transaction (retried while it catches up); a transaction it rejected, or one it hasn't indexed after three attempts, is not delivered and is reported to `onError` with phase `subscription`. A token transfer the sender can't fund is a valid Hive operation that only fails on the sidechain, so never credit a payment from the raw `custom_json` |
| `onPost(cb)` / `onComment(cb)` | Root posts / replies |
| `onVote(cb)` | Vote operations |
| `onFollow(cb)` / `onReblog(cb)` | Follow and reblog custom JSON |
| `onDelegate(cb)` | Vesting share delegations |
| `onPowerUp(cb)` / `onPowerDown(cb)` | Staking changes |
| `onClaimRewards(cb)` | Reward claims |
| `onAccountWitnessVote(cb)` | Witness votes |
| `onAccountUpdate(cb)` | Account/profile updates |
| `onDeleteComment(cb)` | Post/comment deletions |
| `onLimitOrder(cb)` | Internal market orders |
| `onSavingsTransfer(cb)` | Savings transfers |
| `onConvert(cb)` | HBD/HIVE conversions |
| `onEscrowTransfer/Approve/Dispute/Release(cb)` | Escrow lifecycle |
| `onBlock(cb)` | Every processed block, as `(block, blockNumber)` |
| `onAnyOperation(cb)` | Every operation of any type |

## Lifecycle

```ts
await streamer.start();   // begin polling from the resumed/configured block
await streamer.stop();    // stop timers, close the adapter and API server
```

For timer-free control — replays, tests, serverless — initialize without starting:

```ts
await streamer.init();                     // adapter, contracts, state; no timers
const n = await streamer.processPendingBlocks();  // process up to the target block, then return
```

## Irreversible vs head streaming

By default the streamer only processes blocks up to the **last irreversible block** (`streamMode: 'irreversible'`). An irreversible block can never be undone by a fork, so a payout triggered by it can never be "un-deposited". On Hive this costs a few seconds of latency at most.

```ts
new Streamer({ streamMode: 'irreversible' });   // default: safe for money
new Streamer({ streamMode: 'head' });           // lowest latency, forks possible
```

Use `head` mode for things where a rare reversal doesn't matter: feeds, notifications, UI updates. In `head` mode the streamer checks that every block links to the one before it. When it doesn't, a fork happened:

1. The streamer walks back (up to `maxForkDepth` blocks, default 20) until the provider's chain matches the block ids it processed.
2. It fires the `onFork` hook with the common ancestor and the orphaned blocks.
3. It rewinds the cursor to the common ancestor and processes the new branch.

Transactions that were re-included on the new branch do not run contract actions twice: the [idempotency ledger](./production#exactly-once-contract-actions) keys actions by transaction id, not block number. Transactions that only existed on the orphaned branch have **already run** and cannot be undone. `onFork` lists those blocks so you can reconcile. If no common ancestor is found within `maxForkDepth`, the streamer halts.

A block that doesn't link to a parent the provider still reports as canonical (a lagging or inconsistent node) is not processed; the streamer waits and tries again.

Providers that don't report `last_irreversible_block_num` (the HAF provider, custom providers) are treated as if every block they serve is irreversible.

## Catching up

If your app was offline, Hive Stream resumes from the last stored block and processes in batches (`catchUpBatchSize` per cycle, `catchUpDelayMs` apart) until it reaches the target block. The `onCaughtUp` hook fires each time it gets there after being behind. `getStatus()` reports the current position:

```ts
streamer.getStatus();
// {
//   streamMode: 'irreversible',
//   lastBlockNumber: 89123450, lastBlockId: '054fe...',
//   headBlockNumber: 89123452, irreversibleBlockNumber: 89123450,
//   targetBlockNumber: 89123450, blocksBehind: 0,
//   isCatchingUp: false, halted: false, lastError: null, ...
// }
```

## Order of work inside a block

For each block the streamer runs, in order:

1. `beforeBlock` hooks, then the adapter's `processBlock`, then `onBlock` subscribers.
2. Each operation in transaction order: `beforeOperation` → adapter → subscribers and contracts → `afterOperation`.
3. Due [time actions](./time-actions), evaluated against the block's own timestamp.
4. The checkpoint (the block is now recorded as processed), then `afterBlock` hooks.

Time actions run after the block's operations and use blockchain time, so replaying the same blocks always fires them at the same points.
