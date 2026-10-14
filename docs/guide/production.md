# Running in Production

A Hive Stream app is a long-running Node.js process. This page covers keeping it alive, resuming cleanly, and observing it.

## State and resumption

With any adapter registered, the cursor (last processed block number and id) is saved after every block. On restart, the streamer resumes where it left off:

```ts
const streamer = new Streamer({ env: true, resumeFromState: true });  // default
```

If your app was down for an hour, catch-up processes the backlog in batches — tune `catchUpBatchSize` (blocks per cycle) and `catchUpDelayMs` (pause between batches, `0` for fastest).

To start from a specific block instead, set `resumeFromState: false` and `lastBlockNumber` to the block *before* it: `lastBlockNumber` is the last block already processed, so streaming begins at `lastBlockNumber + 1`.

If the per-block write is too much for your storage, `checkpointMode: 'interval'` saves at most every `checkpointIntervalMs`. More blocks are replayed after a crash, but the idempotency ledger still keeps contract actions from running twice. `stop()` always writes a final checkpoint.

Persisted [time actions](./time-actions) are restored during `init()`, so schedules survive restarts even before your code calls `registerAction()` again.

## Exactly-once contract actions

Replaying a block must never pay someone twice. Hive Stream keeps an idempotency ledger in your adapter (`processed_operations` table or collection). Before a contract action runs, the streamer checks for its key (transaction id plus operation index, or time action id plus block number). After the handler returns, it records the key.

This makes the following safe:

- a crash between processing a block and saving the checkpoint
- `checkpointMode: 'interval'`
- a fork in `head` mode that re-includes the same transaction in a different block
- `replayBlocks()` over a range that was already processed (pass `{ force: true }` to deliberately run actions again)

**The remaining window.** The ledger is written after your handler returns. If the process dies after the handler has broadcast a transfer but before the ledger write, the action runs again on restart. The window is milliseconds, but for a payout service it matters. Close it inside the handler: record the side effect keyed by `ctx.transaction.id` and `ctx.transaction.operationIndex` in the same database transaction as your state change, and check it before broadcasting. Subscriptions (`onTransfer` and friends) are not covered by the ledger and are at-least-once: after a crash they may see the last block again.

Rejected actions are recorded too, so `onActionRejected` (and a refund issued there or by `refundRejectedTransfers`) fires once per transfer. [Transfer flows](./flows#each-transfer-is-paid-out-once) record their payouts in the same ledger.

Ledger rows older than `idempotencyRetentionBlocks` (about 7 days) are pruned automatically. Disable the ledger with `idempotency: false` only if your handlers are idempotent on their own.

**Run one streamer per set of app accounts.** The ledger protects against the same process reprocessing a block, not against two processes handling the same chain at once: two instances pointed at one account will each pay out. One process can act as several accounts (`accounts` in config); two processes must not share one. Rate-limit counters are in memory per process. If you need redundancy, keep a standby that is not started, and promote it (same database) when the primary goes away.

## Error policy

`errorPolicy` decides what a failure in a contract handler or a storage write does to the stream:

| Policy | Behaviour | Use when |
| --- | --- | --- |
| `skip` (default) | Log, report to `onError`, mark the action failed, continue | A failed action should not block everyone else (games, social apps) |
| `halt` | Stop processing at the failing block. Health becomes `halted`; the block is retried on restart | Correctness matters more than uptime (bridges, custody, accounting) |
| `retry` | Retry in place with exponential backoff (`errorMaxRetries`, `errorRetryDelayMs`), then halt | Failures are usually transient (a flaky database or payout API) and handlers are safe to repeat |

Subscription callbacks and hooks never halt the stream; their errors are always isolated and reported.

After a halt, `getHealth()` reports `halted` with `isStarted: false`, and `getStatus().lastError` has the phase, block number and message. Fix the cause and call `start()` again (or `processPendingBlocks()`); processing resumes at the failed block, and actions that already succeeded in it are skipped by the ledger. Under `retry`, the operation's subscriptions can fire more than once. A checkpoint that cannot be written follows the same policy: `skip` reports it and continues, `halt` stops.

Failures fetching blocks (a node down, a timeout) never halt. The streamer fails over between `apiNodes` (each request times out after `apiTimeoutMs`) and backs off exponentially up to `retryMaxDelayMs`, reporting each failure to `onError` with phase `block`.

## Graceful shutdown

One call registers signal handlers that stop polling, close the API server, run contract `destroy` hooks, and close the adapter before exiting:

```ts
streamer.enableGracefulShutdown();               // SIGINT + SIGTERM
streamer.enableGracefulShutdown(['SIGTERM']);    // custom signals
```

A second signal during shutdown forces exit. The call returns a disposer that removes the handlers.

## Structured logging

All library output flows through a pluggable logger. The default writes to the console; swap in pino, winston, or anything with `debug`/`info`/`warn`/`error`:

```ts
import pino from 'pino';

const streamer = new Streamer({
    env: true,
    logger: pino()   // or setLogger(pino()) from 'hive-stream'
});
```

Debug-level messages carry the detail previously gated behind `debugMode`; warnings cover rejected payloads and missing contracts; errors cover processing failures.

## Health checks

`getHealth()` returns a machine-readable summary, and the built-in API serves it at `/health` (HTTP 200 when healthy, 503 otherwise) — point your load balancer or orchestrator at it:

```ts
streamer.getHealth();
// {
//   status: 'ok' | 'behind' | 'stalled' | 'halted' | 'stopped',
//   healthy: true,
//   isStarted: true,
//   uptimeSeconds: 86400,
//   lastBlockAgeSeconds: 3,
//   lastBlockNumber: 89123456,
//   headBlockNumber: 89123457,
//   irreversibleBlockNumber: 89123455,
//   targetBlockNumber: 89123455,
//   blocksBehind: 1,
//   halted: false,
//   lastError: null,
//   isCatchingUp: false,
//   contracts: ['hivedice'],
//   actions: 2
// }
```

- `behind` — at least `blocksBehindWarning` blocks behind head (still returns 200; catch-up handles it)
- `stalled` — no block processed for 60 seconds while started (returns 503)
- `halted` — the error policy stopped processing; see `lastError` (returns 503)
- `stopped` — not started (returns 503)

`/status` serves the lighter `getStatus()` payload. Enable the API with `apiEnabled: true` or `startApiServer(port)`.

The API has no authentication and also serves your stored transfers, custom JSON and events (`/transfers`, `/json`, `/events`, paged with `?limit=` up to 1000 and `?offset=`; `/stats` for counts), so it binds to loopback (`apiHost: '127.0.0.1'`) by default. Probe it from the same host, or put a reverse proxy with authentication in front of it before setting `apiHost: '0.0.0.0'`.

## Replaying blocks

Reprocess a historical range through every subscription, contract, and adapter — for backfills and debugging:

```ts
const streamer = new Streamer({ env: true });
// register the same contracts/subscriptions as production...

const replayed = await streamer.replayBlocks(89000000, 89000100);
```

Replay refuses to run while the streamer is started, and moves the streaming cursor: afterwards the streamer resumes from the end of the range. Contract actions already in the idempotency ledger are skipped, so replaying a processed range only re-runs subscriptions and actions for contracts that weren't registered the first time. Pass `{ force: true }` to run every action again:

```ts
await streamer.replayBlocks(89000000, 89000100, { force: true });
```

## Observability with hooks

[Hooks](./hooks) are the place for metrics and alerting:

```ts
streamer.use({
    afterBlock: ({ blockNumber }) => metrics.gauge('hive.block', blockNumber),
    afterContractAction: ({ contract, action, durationMs }) => metrics.timing(`contract.${contract}.${action}`, durationMs),
    onActionRejected: ({ contract, action, reason }) => metrics.increment(`rejected.${contract}.${action}.${reason}`),
    onFork: ({ orphanedBlocks }) => alerts.warn(`fork: ${orphanedBlocks.length} blocks orphaned`),
    onError: ({ error, phase, fatal }) => fatal ? pager.trigger(error.message) : log.warn({ phase }, error.message)
});
```

## Process management with PM2

```shell
npm install pm2 -g
pm2 start ecosystem.config.js --env production
```

```js
// ecosystem.config.js
module.exports = {
    apps: [
        {
            name: 'hive-stream',
            script: 'index.js',
            ignore_watch: ['node_modules'],
            env: { NODE_ENV: 'development' },
            env_production: { NODE_ENV: 'production' }
        }
    ]
};
```

## Keys and safety

- Keep `ACTIVE_KEY` in the environment, never in code. `env: true` reads it for you.
- Read-only apps should run with no keys at all.
- Write methods accept per-call `signingKeys` if you need to isolate authority per operation.
- The [testing kit](./testing) lets CI exercise your full contract logic without any keys or network access.
