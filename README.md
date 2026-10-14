# Hive Stream

A Node.js library for building apps on the Hive blockchain. It streams blocks, runs your contract code when a transfer memo or custom JSON calls it, and gives you the write operations to respond. People use it for dice sites, game tournaments, tipping bots, token exchanges and custody bridges.

**Documentation:** [vheissu.github.io/hive-stream](https://vheissu.github.io/hive-stream/). Guides, recipes, a reference page for every built-in contract, testing and production. Run it locally with `npm run docs:dev`.

**Upgrading?** 5.0 changes defaults that could lose money (which transfers run paid actions, where the HTTP API listens, what `onHiveEngine` delivers). Read [Migrating to 5.0](https://vheissu.github.io/hive-stream/guide/migrating-to-5) before you bump; 3.x users start with [Migrating to 4.0](https://vheissu.github.io/hive-stream/guide/migrating-to-4).

## Install

```shell
npm install hive-stream zod
```

Node.js 22 or later. SQLite works out of the box. For the MongoDB or PostgreSQL adapters (or the HAF block provider) install the driver as well: `npm install mongodb` or `npm install pg`. `import` and `require` both work and resolve to the same implementation.

Or scaffold a whole project:

```shell
npx hive-stream new my-app
npx hive-stream new my-game --template game --username my-account
npx hive-stream list
```

Templates: `minimal`, `game`, `exchange`, `social`, `blog`, `token` and `assets`. Each one comes with registered contracts, `.env` handling, an offline test and `npm run verify`.

## Quick start

```ts
import { Streamer, defineContract, action } from 'hive-stream';
import { z } from 'zod';

// env: true reads HIVE_ACCOUNT, HIVE_ACTIVE_KEY and HIVE_POSTING_KEY from the environment and .env
const streamer = new Streamer({ env: true });

// Plain subscriptions: react to anything on chain
streamer.onTransfer('myaccount', (op) => {
    console.log(`${op.from} sent ${op.amount}`);
});

// Contracts: named actions with validated payloads
const guestbook = defineContract({
    name: 'guestbook',
    actions: {
        sign: action(async (payload, ctx) => {
            console.log(`${ctx.sender} signed: ${payload.message}`);
        }, {
            trigger: 'custom_json',
            schema: z.object({ message: z.string().max(280) })
        })
    }
});

await streamer.registerContract(guestbook);
streamer.enableGracefulShutdown();
await streamer.start();
```

Anyone can call the contract by broadcasting custom JSON with id `hivestream`:

```json
{"hive_stream":{"contract":"guestbook","action":"sign","payload":{"message":"hello"}}}
```

## What you're building

| App | Start here |
| --- | --- |
| Gambling | [Dice recipe](https://vheissu.github.io/hive-stream/guide/recipes#dice-with-provably-fair-rolls): provably fair rolls, bet limits, refunds |
| Games | [Tournament recipe](https://vheissu.github.io/hive-stream/guide/recipes#a-paid-tournament-for-a-game), plus badges and quest passes |
| Social | [Tipping recipe](https://vheissu.github.io/hive-stream/guide/recipes#tips-with-public-thank-you-replies), subscriptions for posts, votes and follows |
| Bridges | [Bridge recipe](https://vheissu.github.io/hive-stream/guide/recipes#a-custody-bridge-with-operator-attestations): M-of-N operator attestations, limits, audit trail |
| Marketplaces and P2P trading | [Escrow marketplace](https://vheissu.github.io/hive-stream/guide/recipes#a-peer-to-peer-escrow-marketplace) and [swap desk](https://vheissu.github.io/hive-stream/guide/recipes#a-peer-to-peer-swap-desk) recipes: native Hive escrow with the app as agent, several app accounts |
| DAOs | [DAO recipe](https://vheissu.github.io/hive-stream/guide/recipes#a-dao-with-a-treasury): stake-weighted proposals, quorum, timelock, treasury payouts |

The recipes live in [`examples/recipes`](examples/recipes) and a test type-checks them against the current API. New to Hive? [Hive Basics](https://vheissu.github.io/hive-stream/guide/hive-basics) covers accounts, keys, operations and Resource Credits in one page, and [Troubleshooting](https://vheissu.github.io/hive-stream/guide/troubleshooting) is where to look when a contract doesn't fire.

## Built for real money

The defaults assume your handlers move funds:

- **Irreversible blocks only.** A block is processed once it can't be undone by a fork, usually a few seconds after it's produced. `streamMode: 'head'` trades that for lower latency, with fork detection and an `onFork` hook.
- **A checkpoint after every block.** A restart resumes from the exact block it stopped at.
- **An idempotency ledger.** Every contract action is recorded by transaction id and operation index, so a replayed block never runs it twice.
- **An error policy you choose.** `errorPolicy: 'skip' | 'halt' | 'retry'`. `halt` stops at the failing block and reports it through `getHealth()`.
- **Only transfers to your account run paid actions.** A wrapped memo on a payment between two other accounts is rejected, so nobody can trigger your payout handler by paying their own alt. Hive Engine events are delivered only after the sidechain confirms them.
- **Rejected payments can go straight back.** `refundRejectedTransfers: true` returns any transfer whose action failed validation or a guard, with the reason in the memo.

```ts
const streamer = new Streamer({
    env: true,
    errorPolicy: 'halt',
    refundRejectedTransfers: true,
    hooks: {
        onError: ({ error, phase, fatal }) => alerts.send(`${phase}: ${error.message}`, { fatal })
    }
});
```

Config is validated when the streamer is built. A zero poll interval or an API node without `https://` throws a `ConfigValidationError` listing every problem. See [Configuration](https://vheissu.github.io/hive-stream/guide/configuration), [Running in Production](https://vheissu.github.io/hive-stream/guide/production) and [Security](https://vheissu.github.io/hive-stream/guide/security).

## Hooks and guards

Hooks observe or steer processing: `beforeBlock`, `beforeOperation`, `beforeContractAction` (veto or rewrite a payload), `afterContractAction`, `onActionRejected`, `onFork`, `onError`, `onCaughtUp` and more. Guards are declarative checks on contract actions:

```ts
await streamer.registerContract({
    ...createDiceContract({ account: 'myhouse' }),
    guards: {
        allowedAssets: ['HIVE'],
        maxAmount: 50,
        rateLimit: { max: 10, windowSeconds: 60 }
    }
});

streamer.hook('afterContractAction', ({ contract, action, durationMs }) => {
    metrics.timing(`${contract}.${action}`, durationMs);
});

streamer.pauseContract('hivedice');   // maintenance mode, no redeploy
```

See [Hooks & Guards](https://vheissu.github.io/hive-stream/guide/hooks).

## Provably fair randomness

Block-id randomness can be nudged by the witness producing the block and by the player choosing their transaction. The fairness module commits to a server seed before any bet, derives outcomes with HMAC-SHA256 and rejection sampling, and reveals seeds on rotation. Every built-in game uses it by default (`fairness: false` opts out). Players verify with the same code in a browser:

```ts
import { verifyOutcome } from 'hive-stream/client';

const { valid } = verifyOutcome({ serverSeed, ...proof }, { type: 'dice', sides: 100 }, settledRoll);
```

See [Provably Fair Randomness](https://vheissu.github.io/hive-stream/guide/fairness).

## Built-in contracts

48 contracts you can register as they are. Every one has a [reference page](https://vheissu.github.io/hive-stream/contracts/) with options, actions and payloads. The ones that take money check the recipient, refund what they can't accept, and retry payouts that failed to broadcast.

| Category | Contracts |
| --- | --- |
| Gambling | dice, coinflip, roulette, lotto, limbo, sweepstakes, prediction markets |
| Games | tournaments, badges, quest passes, rock-paper-scissors |
| Social | tip jar, fan clubs, referrals |
| Commerce | escrow marketplace (native Hive escrow, app as agent), auction house, bookings, bounty board, bundle marketplace, gift cards, group buys, invoices, paywall, rentals, subscriptions, ticketing |
| Finance | peer-to-peer swap desk (HIVE, HBD and Hive Engine tokens, escrow-settled), exchange (order book), staking pool, DCA bots, insurance pool, launchpad, payroll, revenue split, savings |
| Assets | tokens, NFTs, domain registry |
| Bridge | custody bridge with operator attestations |
| Fundraising | crowdfunding, charity matching, grant rounds |
| Governance | DAO (stake-weighted votes, quorum, timelock, treasury), polls, multisig treasury, proposal timelock |
| Utility | state checkpoints, oracle bounties |

## Testing without a node

`hive-stream/testing` runs the real streamer against simulated blocks and records every broadcast:

```ts
import { createTestStreamer } from 'hive-stream/testing';
import { createDiceContract } from 'hive-stream';

const ts = await createTestStreamer({ username: 'myhouse' });
ts.client.setAccount('myhouse', { balance: '1000.000 HIVE' });   // the bankroll
await ts.streamer.registerContract(createDiceContract({ account: 'myhouse' }));

await ts.contractTransfer({ from: 'alice', amount: '5.000 HIVE', contract: 'hivedice', action: 'roll', payload: { roll: 50 } });
await ts.advanceTime('1h');   // fire due time actions

console.log(ts.outgoingTransfers);   // the payout or loss notice, with the fairness proof
await ts.stop();
```

See [Testing Your App](https://vheissu.github.io/hive-stream/guide/testing).

## Frontends and tooling

These entry points have no Node dependencies and run in a browser:

- `hive-stream/client` builds contract memos and `custom_json` operations, validates payloads against shared zod specs, and verifies fairness proofs.
- `hive-stream/scaffold` generates the same project files as `npx hive-stream new`, in memory.
- `hive-stream/catalog` describes every built-in contract (category, options, actions, payload fields) as data, for pickers and form builders.

`HIVE_STREAM_METADATA` from the main entry lists subscriptions, write operations, config defaults and time action values for visual builders. See [Building UIs and Tools](https://vheissu.github.io/hive-stream/guide/ui-integration).

## Storage

SQLite is the default and needs no setup. PostgreSQL and MongoDB adapters are included:

```ts
import { PostgreSQLAdapter } from 'hive-stream';

await streamer.registerAdapter(new PostgreSQLAdapter({ connectionString: process.env.DATABASE_URL }));
```

Most built-in contracts need a SQL adapter. To write your own, extend `AdapterBase` and implement `loadState` and `saveState`. See [Storage Adapters](https://vheissu.github.io/hive-stream/guide/adapters).

## Running in production

`enableGracefulShutdown()` finishes the current block and writes a checkpoint on SIGINT or SIGTERM. `getHealth()` is also served at `GET /health` (200 or 503) when `apiEnabled` is on. `replayBlocks(from, to)` reprocesses a range for backfills. A PM2 config is in [`ecosystem.config.js`](ecosystem.config.js). See [Running in Production](https://vheissu.github.io/hive-stream/guide/production).

## AI skills

Companion skills for Claude Code (`.claude/skills/hive-stream`) and Codex (`codex-skills/hive-stream`) teach coding agents the package API. Install instructions are in [AI-SKILLS.md](AI-SKILLS.md).

## Development

```shell
npm test            # Jest; live network suites need RUN_LIVE_TESTS=1
npm run build       # CommonJS build, ESM wrappers, contract catalog
npm run docs:dev    # regenerates contract reference pages, then serves the docs
```

Contract reference pages and `src/catalog/contracts.json` are generated. Don't edit them by hand.

## License

MIT
