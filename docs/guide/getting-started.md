# Getting Started

Hive Stream is a Node.js library for building applications on the [Hive blockchain](https://hive.io). It watches the chain for the operations you care about, runs your contract logic when payments or custom JSON arrive, and gives you the write operations to respond: transfers, tokens, posts, votes, escrow and more.

## Pick a starting point

| You're building | Start with |
| --- | --- |
| A gambling app | [Dice recipe](./recipes#dice-with-provably-fair-rolls), then [Provably Fair Randomness](./fairness) |
| A game | [Tournament recipe](./recipes#a-paid-tournament-for-a-game), plus the [badges](/contracts/badges) and [questpass](/contracts/questpass) contracts |
| A social app | [Tipping recipe](./recipes#tips-with-public-thank-you-replies) and [Streaming & Subscriptions](./streaming) |
| A bridge or custody service | [Bridge recipe](./recipes#a-custody-bridge-with-operator-attestations) and [Running in Production](./production) |
| Something else | Read on, or scaffold a project with `npx hive-stream new` |

Upgrading an existing app from 3.x? Read [Migrating to 4.0](./migrating-to-4) first.

## Installation

```shell
npm install hive-stream zod
```

`zod` is what you write payload schemas with; Hive Stream depends on it too, so installing it yourself keeps one copy in your project. Node.js 22 or later is required. SQLite support is included; the MongoDB and PostgreSQL drivers are optional peer dependencies, so install `mongodb` or `pg` only if you use those adapters (or the HAF provider, which needs `pg`). Both module systems work and share one implementation:

```ts
import { Streamer } from 'hive-stream';        // ESM / TypeScript
const { Streamer } = require('hive-stream');   // CommonJS
```

::: tip Starting fresh?
`npx hive-stream new my-app` scaffolds a complete project with contracts, storage, environment config and payload examples. See [Scaffolding with the CLI](./cli).
:::

## Your first streamer

```ts
import { Streamer } from 'hive-stream';

// env: true reads HIVE_ACCOUNT, HIVE_ACTIVE_KEY and HIVE_POSTING_KEY from the environment (and .env)
const streamer = new Streamer({ env: true });

// React to incoming transfers
streamer.onTransfer('myaccount', (op, blockNumber, blockId, prevBlockId, trxId, blockTime) => {
    console.log(`${op.from} sent ${op.amount}: ${op.memo}`);
});

await streamer.start();
```

`new Streamer()` has no side effects: the default SQLite adapter is created on first use, and the built-in Express API is opt-in.

By default the streamer only processes a block once it's irreversible, which is usually a few seconds behind the head of the chain. A fork can't undo anything your app has already acted on. The cursor is saved after every block, so a restart picks up exactly where it stopped. See [Streaming](./streaming#irreversible-vs-head-streaming) if you need head-block latency instead.

## Your first contract

Contracts run when a transfer memo or custom JSON operation carries a wrapped payload. Define one with `defineContract` and `action`:

```ts
import { Streamer, defineContract, action } from 'hive-stream';
import { z } from 'zod';

const guestbook = defineContract({
    name: 'guestbook',
    actions: {
        sign: action(async (payload, ctx) => {
            console.log(`${ctx.sender} signed with: ${payload.message}`);
        }, {
            trigger: 'custom_json',
            schema: z.object({ message: z.string().max(280) })
        })
    }
});

const streamer = new Streamer({ env: true });
await streamer.registerContract(guestbook);
await streamer.start();
```

Anyone can now trigger it by broadcasting custom JSON with your configured id (default `hivestream`):

```json
{"hive_stream":{"contract":"guestbook","action":"sign","payload":{"message":"hello!"}}}
```

See [Writing Contracts](./contracts) for triggers, validation, lifecycle hooks, and payment-carrying actions.

When another part of the app needs to call this contract, use a shared contract spec and `createContractCaller()` instead of assembling JSON by hand. The caller validates the action, payload, trigger, and authority before it builds an operation. See [Calling Contracts Safely](./contract-calls).

## Test it without touching the chain

```ts
import { createTestStreamer } from 'hive-stream/testing';

const ts = await createTestStreamer({ username: 'myaccount' });
await ts.streamer.registerContract(guestbook);

await ts.contractJson('alice', {
    contract: 'guestbook',
    action: 'sign',
    payload: { message: 'hello!' }
});

await ts.stop();
```

Everything runs offline: simulated blocks, captured broadcasts, in-memory storage. See [Testing Your App](./testing).

## Where to next

- [Recipes](./recipes): dice, tournaments, tipping, bridges and browser frontends
- [Configuration](./configuration): keys, API nodes, stream mode, error policy
- [Hooks & Guards](./hooks): metrics, allow-lists, bet limits and kill switches
- [Calling Contracts Safely](./contract-calls): shared schemas and operation builders
- [Streaming & Subscriptions](./streaming): every event you can react to
- [Built-in Contracts](/contracts/): 48 ready-to-register contracts
- [Transfer Flows](./flows): split, forward, burn and refund payments
- [Running in Production](./production): persistence, error policy, health checks, PM2
