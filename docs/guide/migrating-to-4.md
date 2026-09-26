# Migrating to 4.0

Most apps upgrade by bumping three things (Node, hive-stream and zod) and reading the behaviour changes below. The API surface didn't shrink: code that compiled against 3.x mostly compiles against 4.0. What changed is how the streamer behaves when something goes wrong, and that's where you need to look.

## Install

```shell
npm install hive-stream@^4 zod@^4
```

- **Node 22 or later.** better-sqlite3 13 needs it.
- **zod 4.** Action and spec schemas are typed against zod 4's `ZodSchema`, so zod 3 schemas no longer type-check. See [Schemas](#schemas-zod-3-to-zod-4) below.
- **MongoDB and PostgreSQL drivers are optional peer dependencies.** Install the one you use. hive-stream loads it on first use and throws with an install hint if it's missing.

  ```shell
  npm install mongodb@^7   # MongoAdapter
  npm install pg@^8        # PostgreSQLAdapter or the HAF provider
  ```

  The MongoDB adapter's type declarations reference the driver's types. If you don't install `mongodb`, keep `skipLibCheck: true` in your tsconfig.
- Scripts that ran through `ts-node` can switch to `tsx`, which is what the CLI templates now use.

## Behaviour changes

### Blocks are processed once they're irreversible

3.x processed the head block, which a fork can still undo. 4.0 waits for `last_irreversible_block_num`. It usually trails head by a block or two, so apps see events a few seconds later.

```ts
// 3.x behaviour, now opt-in. Fork detection comes with it.
const streamer = new Streamer({ streamMode: 'head' });
```

If you stay on `head`, register an `onFork` hook: actions from orphaned blocks have already run, and the hook lists those blocks so you can reconcile. See [Irreversible vs head streaming](./streaming#irreversible-vs-head-streaming).

### The cursor is saved after every block

3.x saved state every five seconds, so a crash replayed up to five seconds of blocks and could repeat payouts. 4.0 writes the cursor after every block, and the idempotency ledger skips contract actions that already ran. To get the old write pattern:

```ts
new Streamer({ checkpointMode: 'interval', checkpointIntervalMs: 5000 });
```

The ledger stays on in both modes. Turn it off with `idempotency: false` only if your handlers are idempotent on their own.

### Configuration is validated

Bad values used to fail later, or not at all. Now the constructor and `setConfig()` throw a `ConfigValidationError` that lists every problem:

```ts
// Before: accepted, then polled in a tight loop.
// Now: throws "BLOCK_CHECK_INTERVAL must be an integer >= 1 (received 0)".
new Streamer({ blockCheckInterval: 0 });
```

Check your `apiNodes` in particular. Entries without a protocol (`api.hive.blog`) are rejected.

### Subscription callbacks are awaited in order

`onTransfer`, `onCustomJson` and the other subscriptions used to be fire-and-forget. Now each callback is awaited before the next one runs, and a throwing callback is logged and reported to `onError` without stopping the others.

A slow callback now slows the stream. If a handler does long work (sending email, calling a slow API), queue it rather than awaiting it:

```ts
// Before: ran concurrently with block processing, even if it took seconds.
streamer.onTransfer('myapp', async (op) => {
    await sendReceiptEmail(op.from);
});

// After: hand long work to a queue so the stream keeps moving.
streamer.onTransfer('myapp', (op) => {
    receiptQueue.push(op.from);
});
```

### Time actions run after the block's operations

Time actions used to fire on a timer, racing the operations in the current block, and were measured against wall-clock head time. Now they run after each block's operations and use that block's timestamp. Replays and catch-up give the same results as live streaming. An action that depended on seeing a transfer "before" the block containing it will now see it after.

Persisted time actions are also restored during `init()`. You no longer need to call `registerAction()` again for actions stored by the adapter, and doing so for the same id is harmless.

### `onBlock` receives the block being processed

```ts
streamer.onBlock((block, blockNumber) => {
    // 3.x: blockNumber was the previous block's number.
    // 4.0: blockNumber is this block's number.
});
```

If you worked around the off-by-one with `blockNumber + 1`, remove it.

### Built-in contracts need a house account

In 3.x, `dice`, `coinflip`, `rps`, `roulette`, `lotto` and `exchange` quietly defaulted their house account to `beggars`, an account your app doesn't control. In 4.0 they use `options.account`, falling back to the streamer's username, and registration fails if neither is set:

```ts
// Either pass the account explicitly...
await streamer.registerContract(createDiceContract({ account: 'myhouse' }));

// ...or configure the streamer username once and let contracts inherit it.
const streamer = new Streamer({ username: 'myhouse' });
await streamer.registerContract(createDiceContract());
```

The `lotto` and `exchange` fee account now defaults to the house account instead of `beggars`.

### Other changes

- Subscription lists over 1000 handlers log a warning instead of being trimmed.
- Adapter rows in `transfers` and `customJson` for the second and later operations in a transaction are keyed `trxId:opIndex`. The first operation keeps the bare transaction id, and duplicate inserts are ignored so replays don't fail.
- SQL adapters create a `processed_operations` table and add a `lastBlockId` column to `params` on startup. Custom adapters that extend `AdapterBase` get an in-memory ledger by default. Override `hasProcessedOperation`, `markOperationProcessed` and `pruneProcessedOperations` to persist it.
- `Streamer.broadcastOperations()` now signs a `custom_json` with `required_auths` using the active key. 3.x used the posting key, and the chain rejected those operations.
- `lotto` splits the pot across the winners actually drawn (3.x divided by the configured winner count, under-paying small draws) and rounds each share down.
- Game `seed` payload fields are capped at 64 characters.
- `createTestStreamer()` uses throwaway active and posting keys when you don't pass any, and answers `getBlock` reads from the simulated chain.

## Schemas: zod 3 to zod 4

hive-stream's own schemas are migrated. Yours need the usual zod 4 changes. The ones that come up most in contracts:

```ts
// z.record needs a key schema
z.record(z.any());                      // zod 3
z.record(z.string(), z.any());          // zod 4

// error messages
z.string().min(3, { message: 'Too short' });   // zod 3
z.string().min(3, { error: 'Too short' });     // zod 4 (message still works, deprecated)

// reading failures
result.error.errors;    // zod 3
result.error.issues;    // zod 4
```

The [zod 4 changelog](https://zod.dev/v4/changelog) covers the rest.

## New in 4.0 (not breaking)

- [Hooks and guards](./hooks): `beforeContractAction`, `onError`, `onFork` and a dozen more, plus declarative `allowedAssets`, `minAmount`, `rateLimit` and friends on contracts.
- [Error policy](./production#error-policy): `errorPolicy: 'skip' | 'halt' | 'retry'`.
- [Provably fair randomness](./fairness) for dice, coinflip, roulette, rps and lotto (opt-in with `fairness: true`), plus the new always-fair `limbo` game.
- New contracts: [bridge](/contracts/bridge), [tournaments](/contracts/tournaments), [stakingpool](/contracts/stakingpool), [limbo](/contracts/limbo) and [badges](/contracts/badges).
- [`hive-stream/scaffold` and `hive-stream/catalog`](./ui-integration) for browser tools.
- `defineConfig()`, `validateConfig()`, `ctx.transaction.operationIndex`, and `ctx.transfer` on `recurrent_transfer` triggers.

## Checklist

1. Run Node 22 or later.
2. Install `hive-stream@^4` and `zod@^4`, then `mongodb` or `pg` if you use those adapters.
3. Fix zod 4 type errors in your schemas.
4. Pass `account` to built-in game and exchange contracts, or set the streamer `username`.
5. Decide on `streamMode`. Keep the default unless you need head-block latency, and add an `onFork` hook if you don't.
6. Look for slow subscription callbacks and move long work to a queue.
7. Remove any `blockNumber + 1` workaround in `onBlock`.
8. Check time actions that assumed they ran before a block's operations.
9. Start the app once against your real config to catch `ConfigValidationError`s.
10. Run your tests. The [testing kit](./testing) processes blocks the same way as production, including the new ordering.
