# Hive Stream grows up: offline testing, ESM, a real docs site, and production plumbing

Until this week, if you built a game or an app on hive-stream and wanted to test your contract logic, your options were bad. You could broadcast real operations to mainnet and burn Resource Credits waiting for blocks, or you could mock dhive yourself and hope your mocks matched what the streamer actually does. I know because the library's own integration tests did the first one, and the test account ran itself out of RC.

That's fixed, along with a pile of other things that separate a library you can use from a library you can trust. Here's what landed.

## Test your app without touching the chain

There's a new `hive-stream/testing` module. It runs a real `Streamer` against simulated infrastructure: blocks come from an in-memory provider, broadcasts get captured instead of sent, and state lives in an in-memory SQLite database, so the built-in SQL contracts work too. No network, no keys, no files on disk.

```ts
import { createTestStreamer, hive } from 'hive-stream/testing';

const ts = await createTestStreamer({ username: 'myapp' });
await ts.streamer.registerContract(myGameContract);

// A player pays 1 HIVE into your contract
await ts.contractTransfer({
    from: 'alice',
    contract: 'mygame',
    action: 'play',
    payload: { choice: 'heads' },
    amount: hive(1)
});

// Assert on the payout your contract tried to broadcast
expect(ts.outgoingTransfers).toEqual([
    { from: 'myapp', to: 'alice', amount: '2.000 HIVE', memo: 'You won!' }
]);

await ts.stop();
```

The part I'm happiest with is time travel. Scheduled contract logic (lottery draws, payroll runs, subscription sweeps) has always been painful to test because you had to wait for real intervals. Now:

```ts
await ts.streamer.registerAction(new TimeAction('week', 'weekly-draw', 'lotto', 'draw', {}, ts.currentTime));
await ts.advanceTime('1w');   // fires immediately, anchored to simulated chain time
```

A weekly draw tests in about 30 milliseconds.

This isn't a parallel fake implementation that will drift out of sync with the real one. `ts.streamer` is the actual `Streamer` class going through its actual dispatch, validation, and persistence paths. The simulation happens at the two seams the streamer already had: where blocks come from, and where broadcasts go out.

Building this surfaced a genuine bug, which is what testing kits are for. `TimeAction` reset its schedule anchor to wall-clock time instead of blockchain time after each execution. On a healthy node those are close enough that nobody noticed. Under clock skew, or during a replay, they aren't. That's fixed for everyone, not just for tests.

## ESM that doesn't lie to you

`import { Streamer } from 'hive-stream'` now resolves a proper ESM entry, and `hive-stream/testing` is a clean subpath export. Types check under both `nodenext` and `bundler` resolution.

One design decision worth explaining: there's no parallel ESM build. The `.mjs` entries are thin wrappers that re-export named bindings from the single CommonJS implementation. Dual-compiled packages ship two copies of every class, and the moment your app imports `Streamer` from one entry while a helper imports it from another, `instanceof` breaks in ways that take an afternoon to diagnose. hive-stream is a server-side library with native dependencies; nobody is tree-shaking it into a browser bundle. One implementation, two ways to import it, `instanceof` always safe. I'll take that trade every time.

## A documentation site

The README had grown to 770 lines and DOCUMENTATION.md past 1,200. Fine as reference material, useless for finding anything. There's now a VitePress site with twelve guides covering getting started, contracts, streaming, flows, testing, and production, plus a reference page for every one of the 40 built-in contracts.

The contract pages aren't hand-written. A generator instantiates each contract factory and introspects its actions, triggers, and Zod payload schemas, then writes the pages at build time. When a contract gains an action or a schema field changes, the docs update because they can't not update. Hand-maintained reference docs for 40 contracts would be wrong within a month and I know it.

`npm run docs:dev` runs it locally. It deploys to GitHub Pages on push.

## Production plumbing

Things a long-running process needs that you'd otherwise write yourself:

- `getHealth()` returns real state: `ok`, `behind`, `stalled`, or `stopped`, with blocks behind, uptime, and last-block age. The built-in API serves it at `/health` with proper 200/503 status codes, so you can point a load balancer at it. The old `/health` endpoint returned `status: 'ok'` unconditionally, which is worse than no health check because it looks like monitoring.
- `enableGracefulShutdown()` wires up SIGINT/SIGTERM handlers that stop polling, close the API server, run contract destroy hooks, and close the adapter before exiting.
- `replayBlocks(from, to)` reprocesses a historical range through your subscriptions, contracts, and adapters. Backfills and debugging, mostly.
- All library logging goes through a pluggable logger now. Console by default, exactly as before, but pass `logger: pino()` in config and you get structured logs everywhere.

Also, the live mainnet broadcast tests now require an explicit `RUN_LIVE_TESTS=1` on top of credentials. Running `npm test` should never spend your Resource Credits as a side effect. It did. Sorry, steembutton.

## The bigger picture

Earlier this month hive-stream shipped a scaffolding CLI (`npx hive-stream new`), non-custodial asset trading, and on-chain state checkpoints. This round was about everything around the features: proving your code works before it touches mainnet, importing the library without interop friction, finding answers without grepping a 1,200-line markdown file, and running the thing for months without babysitting it.

The goal is for hive-stream to be the obvious default for building on Hive, whatever you're building. Feature count was never the gap. The library has 40 contracts and over 1,300 tests. The gap was everything a developer hits in the first hour and the hundredth day, and that's what this release attacks.

If you build something with it, tell me what broke. That's how the last three features got picked.
