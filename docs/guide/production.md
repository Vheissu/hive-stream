# Running in Production

A Hive Stream app is a long-running Node.js process. This page covers keeping it alive, resuming cleanly, and observing it.

## State and resumption

With any adapter registered, the last processed block persists automatically (throttled to every 5 seconds). On restart, the streamer resumes where it left off:

```ts
const streamer = new Streamer({ env: true, resumeFromState: true });  // default
```

If your app was down for an hour, catch-up processes the backlog in batches — tune `catchUpBatchSize` (blocks per cycle) and `catchUpDelayMs` (pause between batches, `0` for fastest).

To force a specific start block instead, set `resumeFromState: false` and `lastBlockNumber`.

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
//   status: 'ok' | 'behind' | 'stalled' | 'stopped',
//   healthy: true,
//   isStarted: true,
//   uptimeSeconds: 86400,
//   lastBlockAgeSeconds: 3,
//   lastBlockNumber: 89123456,
//   headBlockNumber: 89123457,
//   blocksBehind: 1,
//   isCatchingUp: false,
//   contracts: ['hivedice'],
//   actions: 2
// }
```

- `behind` — at least `blocksBehindWarning` blocks behind head (still returns 200; catch-up handles it)
- `stalled` — no block processed for 60 seconds while started (returns 503)
- `stopped` — not started (returns 503)

`/status` serves the lighter `getStatus()` payload. Enable the API with `apiEnabled: true` or `startApiServer(port)`.

## Replaying blocks

Reprocess a historical range through every subscription, contract, and adapter — for backfills and debugging:

```ts
const streamer = new Streamer({ env: true });
// register the same contracts/subscriptions as production...

const replayed = await streamer.replayBlocks(89000000, 89000100);
```

Replay refuses to run while the streamer is started, and moves the streaming cursor: afterwards the streamer resumes from the end of the range. Make contract handlers idempotent (keyed by transaction id) if you replay against live state.

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
