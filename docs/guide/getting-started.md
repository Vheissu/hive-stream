# Getting Started

Hive Stream is a Node.js library for building applications on the [Hive blockchain](https://hive.io). It watches the chain for operations you care about, runs your contract logic when payments or custom JSON arrive, and gives you the write operations to respond — transfers, tokens, posts, votes, escrow, and more.

## Installation

```shell
npm install hive-stream
```

Node.js 22 or later is required. SQLite support is included; the MongoDB and PostgreSQL drivers are optional peer dependencies, so install `mongodb` or `pg` only if you use those adapters (or the HAF provider, which needs `pg`). Both module systems work and share one implementation:

```ts
import { Streamer } from 'hive-stream';        // ESM / TypeScript
const { Streamer } = require('hive-stream');   // CommonJS
```

::: tip Starting fresh?
`npx hive-stream new my-app` scaffolds a complete project — contracts, storage, environment config, and payload examples included. See [Scaffolding with the CLI](./cli).
:::

## Your first streamer

```ts
import { Streamer } from 'hive-stream';

const streamer = new Streamer({ username: 'myaccount' });

// React to incoming transfers
streamer.onTransfer('myaccount', (op, blockNumber, blockId, prevBlockId, trxId, blockTime) => {
    console.log(`${op.from} sent ${op.amount}: ${op.memo}`);
});

await streamer.start();
```

`new Streamer()` is side-effect free: the default SQLite adapter is created lazily on first use, and the built-in Express API is opt-in.

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

const streamer = new Streamer({ username: 'myaccount' });
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

Everything runs offline — simulated blocks, captured broadcasts, in-memory storage. See [Testing Your App](./testing).

## Where to next

- [Configuration](./configuration) — keys, API nodes, catch-up behavior
- [Calling Contracts Safely](./contract-calls) — shared schemas and operation builders
- [Streaming & Subscriptions](./streaming) — every event you can react to
- [Built-in Contracts](/contracts/) — 40 ready-to-register contracts
- [Transfer Flows](./flows) — split, forward, burn, and refund payments
- [Running in Production](./production) — persistence, resumption, PM2
