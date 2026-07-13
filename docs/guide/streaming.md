# Streaming & Subscriptions

Subscriptions are read-only: no keys required. Register handlers, call `start()`, and Hive Stream polls the chain with automatic node failover, invoking your callbacks in block order.

Subscriptions and contracts are separate paths: a subscription fires for every matching operation, while a contract action only runs when the operation carries a wrapped payload under your `payloadIdentifier`.

## Common events

```ts
// Transfers to a specific account
streamer.onTransfer('myaccount', (op, blockNumber, blockId, prevBlockId, trxId, blockTime) => {
    // op.from, op.to, op.amount ("1.000 HIVE"), op.memo
});

// All custom JSON operations
streamer.onCustomJson((op, { sender, isSignedWithActiveKey }, blockNumber, blockId, prevBlockId, trxId, blockTime) => {
});

// Custom JSON with a specific id
streamer.onCustomJsonId('your-custom-json-id', (op, { sender, isSignedWithActiveKey }, blockNumber, blockId, prevBlockId, trxId, blockTime) => {
});

// Hive Engine operations (verified against the sidechain before firing)
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
| `onHiveEngine(cb)` | Hive Engine sidechain operations |
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
| `onBlock(cb)` | Every processed block |
| `onAnyOperation(cb)` | Every operation of any type |

## Lifecycle

```ts
await streamer.start();   // begin polling from the resumed/configured block
await streamer.stop();    // stop timers, close the adapter and API server
```

For timer-free control — replays, tests, serverless — initialize without starting:

```ts
await streamer.init();                     // adapter, contracts, state; no timers
const n = await streamer.processPendingBlocks();  // process up to head, then return
```

## Catching up

If your app was offline, Hive Stream resumes from the last stored block and processes in batches (`catchUpBatchSize` per cycle, `catchUpDelayMs` apart) until it reaches head. `getStatus()` reports the current position.
