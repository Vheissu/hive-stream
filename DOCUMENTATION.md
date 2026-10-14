# Hive-Stream Documentation

## Introduction
Hive Stream is a Node.js library for streaming Hive blockchain activity and routing it to contracts you define. Contracts can react to:
- `custom_json` operations
- transfer memos
- time-based actions
- escrow operations

This document focuses on the contract system and how to build robust contracts with `defineContract` and `action`. The [docs site](https://vheissu.github.io/hive-stream/) has the guides, recipes and a generated reference page for every built-in contract.

`new Streamer()` has no side effects. The default SQLite adapter is created on first use, and the built-in Express API only starts when you call `startApiServer()` or enable it through config before `start()`.

### What 4.0 changed

- Blocks are processed once they're irreversible (`streamMode: 'irreversible'`, the default). `streamMode: 'head'` restores head-block processing, with fork detection.
- The cursor is saved after every block, and an idempotency ledger records each contract action by transaction id and operation index, so a replayed block never runs an action twice.
- `errorPolicy` (`'skip' | 'halt' | 'retry'`) decides what a failing handler does to the stream.
- Streamer hooks, contract hooks and declarative guards. See [Hooks and Guards](#hooks-and-guards).
- Provably fair randomness for the built-in games. See [Provably Fair Randomness](#provably-fair-randomness).
- Config is validated when the streamer is built.
- Node 22 or later, zod 4, and optional `mongodb`/`pg` peer dependencies.

### What 5.0 changed

- Transfer-triggered actions only run for transfers addressed to the streamer username (or the action's `allowedRecipients` guard; `['*']` for non-custodial actions).
- `refundRejectedTransfers: true` sends rejected payments back to the sender with the reason in the memo.
- The HTTP API binds to loopback (`apiHost`), pages its list routes and has no authentication.
- `onHiveEngine` delivers only transactions the sidechain confirmed; transfer flows record their payouts in the idempotency ledger, keyed per operation.
- Bad environment values throw `ConfigValidationError`; use `HIVE_ACCOUNT` rather than `USERNAME`.

Upgrading: read [Migrating to 5.0](https://vheissu.github.io/hive-stream/guide/migrating-to-5), and from 3.x [Migrating to 4.0](https://vheissu.github.io/hive-stream/guide/migrating-to-4) first.

---

## CLI

Hive Stream ships a scaffolding CLI. It generates a complete TypeScript app: package.json, tsconfig, `.env.example`, a wired-up `src/index.ts`, a starter custom contract, and a README with payload examples for every registered contract action. The same generator is available in memory, with no Node dependencies, as `hive-stream/scaffold`.

```shell
npx hive-stream new <name> [options]   # scaffold a new app
npx hive-stream list                   # show templates and adapters
```

Run `new` without options for interactive prompts, or pass flags for non-interactive use:

| Flag | Description |
| --- | --- |
| `-t, --template <id>` | `minimal`, `game`, `exchange`, `social`, `blog`, `token`, or `assets` |
| `-a, --adapter <id>` | `sqlite` (default), `mongodb`, or `postgresql` |
| `-u, --username <name>` | Hive account the app runs as |
| `--api` | Enable the built-in HTTP API server |
| `--install` | Run `npm install` after scaffolding |
| `-y, --yes` | Skip prompts and accept defaults |

Generated apps read `HIVE_USERNAME`, `HIVE_POSTING_KEY`, and `HIVE_ACTIVE_KEY` from `.env` via `new Streamer({ env: true })`.

SQLite and PostgreSQL support every template. MongoDB is limited to `minimal` and `game` because the remaining templates register SQL-backed contracts. Generated projects include TypeScript checking, an offline Jest contract test, a production build in `npm run verify`, and graceful SIGINT/SIGTERM shutdown.

---

## Concepts

### Contracts
A **contract** is a definition object with:
- a **name**
- one or more **actions**
- optional **lifecycle hooks**

Contracts are registered with the `Streamer` and called when a payload matches `contract` + `action`.

### Actions
An **action** is a handler function plus metadata such as:
- the trigger (`custom_json`, `transfer`, `time`, `escrow_transfer`, `escrow_approve`, `escrow_dispute`, `escrow_release`, or `recurrent_transfer`)
- an optional Zod schema to validate payloads
- whether it requires an active key signature

### Payload Identifier
Hive Stream extracts payloads from:
- **custom_json**: `op[1].json`
- **transfer memo**: `op[1].memo`
- **recurrent transfer memo**: `op[1].memo`
- **escrow metadata**: `op[1].json_meta`

It expects a wrapper object that looks like:

```
{
  "hive_stream": {
    "contract": "mycontract",
    "action": "doSomething",
    "payload": { "any": "data" },
    "meta": { "optional": true }
  }
}
```

The wrapper key `hive_stream` is the default `PAYLOAD_IDENTIFIER`. You can change it in config.

### Contract Call Client

Use `hive-stream/client` to share action schemas and build calls without hand-writing wrapper JSON:

```ts
import { createContractCaller, defineContractSpec } from 'hive-stream/client';
import { z } from 'zod';

const spec = defineContractSpec({
    name: 'guestbook',
    actions: {
        sign: {
            trigger: 'custom_json',
            schema: z.object({ message: z.string().max(280) })
        }
    }
});

const guestbook = createContractCaller(spec);
const operation = guestbook.customJson('alice', 'sign', { message: 'Hello' });
```

The client entry point performs no network calls and handles no keys. It validates action names, payload schemas, triggers, JSON values, and authority before returning a Hive operation tuple. Use `createContractMemo`, `createContractPayload`, `createContractCustomJsonOperation`, or `createContractTransferOperation` when a full shared spec is not available.

Relevant configuration defaults:

- `PAYLOAD_IDENTIFIER`: `hive_stream`
- `JSON_ID`: `hivestream`
- `HIVE_ENGINE_ID`: `ssc-mainnet-hive`
- `HIVE_ENGINE_API`: `https://api.hive-engine.com/rpc`

### Event Handlers vs Contracts
Streamer event handlers (`onTransfer`, `onCustomJson`, `onCustomJsonId`, etc.) and contract actions are different execution paths.

- Event handlers fire for matching blockchain operations.
- Contract actions only run when a valid wrapper exists under `PAYLOAD_IDENTIFIER` and the `contract` + `action` values match a registered contract action.

---

## Contract API

### Define a Contract

```ts
import { defineContract, action } from 'hive-stream';

const MyContract = defineContract({
    name: 'mycontract',
    actions: {
        hello: action(async (payload, ctx) => {
            console.log('hello', payload.name, ctx.sender);
        }, {
            trigger: 'custom_json'
        })
    }
});
```

`defineContract()` and `registerContract()` reject missing handlers, invalid schemas, unsupported triggers, and malformed lifecycle hooks during setup instead of waiting for the first matching chain operation.

### Register a Contract

```ts
import { Streamer } from 'hive-stream';

const streamer = new Streamer();
await streamer.registerContract(MyContract);
```

### Unregister a Contract

```ts
await streamer.unregisterContract('mycontract');
```

### Contract Lifecycle Hooks

```ts
const MyContract = defineContract({
    name: 'mycontract',
    hooks: {
        create: async ({ streamer, adapter, config }) => {
            // initialize tables, cache config, etc
        },
        destroy: async ({ streamer, adapter }) => {
            // cleanup resources
        },
        beforeAction: ({ action, payload, ctx }) => ctx.sender !== 'mallory',   // false vetoes the action
        afterAction: ({ action, durationMs }) => { /* metrics */ },
        onError: ({ action, error, ctx }) => { /* alerting */ }
    },
    actions: { ... }
});
```

See [Hooks and Guards](#hooks-and-guards) for streamer-wide hooks and declarative guards.

---

## Contract Context

Every action receives a `ContractContext` with:

- `trigger`: `custom_json | transfer | time | escrow_transfer | escrow_approve | escrow_dispute | escrow_release | recurrent_transfer`
- `streamer`: access to Hive client and helpers
- `adapter`: database adapter
- `config`: resolved config values
- `block`: `{ number, id, previousId, time }`
- `transaction`: `{ id, operationIndex }` (`operationIndex` is the operation's position in its transaction; absent for time triggers)
- `sender`: Hive account invoking the action
- `transfer`: `{ from, to, amount, asset, rawAmount, memo }` for `transfer` and `recurrent_transfer` triggers
- `customJson`: custom JSON details (only for `custom_json` trigger)
- `escrow`: escrow details (only for escrow triggers)
- `operation`: raw operation data and operation type for advanced use cases

### Example

```ts
action((payload, ctx) => {
    console.log(ctx.trigger);
    console.log(ctx.block.number, ctx.transaction.id);
    if (ctx.transfer) {
        console.log(ctx.transfer.amount, ctx.transfer.asset);
    }
});
```

---

## Payload Validation (Zod)

Use Zod to validate payloads and enforce strong inputs:

```ts
import { z } from 'zod';

const schema = z.object({
    amount: z.string().min(1),
    to: z.string().min(1)
});

const MyContract = defineContract({
    name: 'payments',
    actions: {
        send: action((payload, ctx) => {
            // payload is validated here
        }, { schema, trigger: 'custom_json' })
    }
});
```

If validation fails, the action is not executed, the issues are logged, and the `onInvalidPayload` hook fires with them.

Schemas are zod 4. Contract specs shared with a frontend through `hive-stream/client` use the same schemas, so the browser rejects a bad payload before the user signs it.

---

## Triggers

Actions can be scoped to a trigger:

- `custom_json`: called when a custom JSON payload matches
- `transfer`: called when a transfer memo matches
- `time`: called by a `TimeAction`
- `escrow_transfer`: called when escrow transfer payload in `json_meta` matches
- `escrow_approve`: available as a trigger for escrow-related contracts
- `escrow_dispute`: available as a trigger for escrow-related contracts
- `escrow_release`: available as a trigger for escrow-related contracts
- `recurrent_transfer`: called when recurrent transfer memo payload matches

```ts
action(handler, { trigger: 'transfer' });
```

You can also allow multiple triggers:

```ts
action(handler, { trigger: ['custom_json', 'transfer'] });
```

---

## Active Key Enforcement

Some actions should only run when the transaction is signed with an active key. Mark them with:

```ts
action(handler, { trigger: 'custom_json', requiresActiveKey: true });
```

This prevents posting-key JSONs from triggering sensitive actions like withdrawals.

---

## Error Handling

What happens when a handler throws depends on `errorPolicy`:

| Policy | Effect |
| --- | --- |
| `'skip'` (default) | The error is logged and reported to `onContractError` and `onError`; the stream moves on. |
| `'halt'` | The stream stops at the failing block. `getHealth()` reports `halted` and `getStatus().lastError` has the error. Nothing after that block is processed until you restart. |
| `'retry'` | The handler is retried `errorMaxRetries` times with doubling delays (`errorRetryDelayMs`), then the stream halts. |

A failed time action does not count as an execution, so it runs again on its next tick.

Use `'halt'` for anything that moves money. A stream that skips a failed payout keeps going and the missing payment is easy to overlook.

Subscription callbacks (`onTransfer` and friends) are awaited in order. A throwing callback is logged and reported to `onError` with phase `subscription`, and the other callbacks still run.

---

## Hooks and Guards

Streamer hooks observe or steer processing. Register them in config (`hooks: { ... }`), one at a time with `streamer.hook(name, handler)`, or as a plugin with `streamer.use(plugin)`. `defineHooks()` types a plugin object.

| Hook | Runs | Can change the outcome |
| --- | --- | --- |
| `onStart` / `onStop` | Around the streamer's lifetime | No |
| `beforeBlock` / `afterBlock` | Around each block; `afterBlock` runs after the checkpoint | No |
| `beforeOperation` | Before each operation reaches subscriptions and contracts | Return `false` to skip it |
| `afterOperation` | After each operation | No |
| `beforeContractAction` | After validation and guards, before the handler | Return `false` to veto, `{ payload }` to replace the payload |
| `afterContractAction` | After a handler succeeds, with `durationMs` | No |
| `onContractError` | Each failed handler attempt, with `attempt` and `willRetry` | No |
| `onInvalidPayload` | A payload failed its schema | No |
| `onActionRejected` | An action was not run, with a `reason` | No |
| `onFork` | A fork was detected in `head` mode | No |
| `onError` | Any reported error, with `phase` and `fatal` | No |
| `onCaughtUp` | The streamer reached its target block after being behind | No |
| `onCheckpoint` | The cursor was saved | No |

A hook that throws is logged and reported to `onError`. The exception is `beforeContractAction`: if it throws, the action is vetoed, so a crashing check can't let a payout through.

Guards are declarative checks on contracts or single actions. Action guards override contract guards field by field:

```ts
defineContract({
    name: 'shop',
    guards: { allowedAssets: ['HIVE', 'HBD'] },
    actions: {
        buy: action(handler, {
            trigger: 'transfer',
            guards: {
                minAmount: '1.000',
                maxAmount: 500,
                rateLimit: { max: 5, windowSeconds: 60 },
                blockedSenders: ['known-abuser']
            }
        }),
        withdraw: action(handler, {
            trigger: 'custom_json',
            requiresActiveKey: true,
            guards: { allowedSenders: ['shop-admin'] }
        })
    }
});
```

Guards: `allowedSenders`, `blockedSenders`, `allowedAssets`, `minAmount`, `maxAmount`, `rateLimit` and `paused`. Amount and asset guards only apply to triggers that carry an amount. A rejected transfer is not refunded automatically; handle `onActionRejected` if you need that (see the dice recipe for a replay-safe refund). `streamer.pauseContract(name, action?)` and `resumeContract()` pause at runtime.

---

## Provably Fair Randomness

The legacy RNG in dice, coinflip, roulette, rps and lotto seeds from block and transaction ids. A block producer or a player can influence those, so every built-in game uses commit-reveal seeds by default (`fairness: false` opts out). Pass an object or a shared manager to tune it:

```ts
import { createDiceContract, createFairness } from 'hive-stream';

await streamer.registerContract(createDiceContract({ account: 'myhouse' }));   // fairness on by default

// or share one manager, rotate every 1000 bets and publish commitments
const fairness = createFairness({ rotateAfter: 1000, onRotate: async ({ commitment }) => publish(commitment) });
```

The operator commits to `sha256(serverSeed)` before any bet. Each outcome is derived from `HMAC-SHA256(serverSeed, clientSeed:blockId:nonce:round)` with rejection sampling, so there is no modulo bias. Rotating the seed reveals it. Players check outcomes with `verifyOutcome()` from `hive-stream/client`, which runs in a browser. `createLimboContract` always uses this scheme. For your own contracts, call `fairness.draw(spec, { clientSeed, blockId })` inside the handler after `fairness.init({ adapter, scope })` in the create hook.

---

## Time-Based Actions

Time-based actions let you run contract logic on a schedule:

```ts
import { TimeAction } from 'hive-stream';

const matchAction = new TimeAction('30s', 'exchange-matcher', 'exchange', 'matchOrders', { limit: 50 });
await streamer.registerAction(matchAction);
```

The action must have `trigger: 'time'` in its definition. Due time actions run after each block's operations and are measured against the block's timestamp, so replays fire them at the same points as live streaming. Actions stored by the adapter are restored during `init()`.

---

## Testing Contracts

The `hive-stream/testing` module runs a real `Streamer` against simulated infrastructure: an in-memory block provider, a fake Hive client that records broadcasts, and an in-memory SQLite database. Nothing touches the network or disk, and no keys are needed: handlers that broadcast use throwaway keys, and the fake client records the operation instead of sending it. Built-in games that re-read their transaction get it from the simulated blocks.

### Setup

```ts
import { createTestStreamer, hive, hbd } from 'hive-stream/testing';

const ts = await createTestStreamer({ username: 'myapp' });
await ts.streamer.registerContract(myContract);
```

`createTestStreamer` accepts every regular streamer config option, plus:

- `adapter` — a storage adapter (defaults to in-memory SQLite, so built-in SQL contracts work out of the box)
- `startTime` — timestamp of the simulated chain's first block (defaults to now)
- `blockIntervalMs` — simulated block spacing (defaults to 3000)

### Driving the chain

Every method mints a block containing your operation and processes it synchronously — when the promise resolves, your contract has run.

```ts
// Transfer with a wrapped contract payload in the memo
await ts.contractTransfer({
    from: 'alice',
    contract: 'tipjar',
    action: 'tip',
    payload: { message: 'great post!' },
    amount: hbd(5)           // defaults to '1.000 HIVE'
                             // `to` defaults to the streamer's username
});

// Custom JSON with a wrapped contract payload
await ts.contractJson('alice', {
    contract: 'vault',
    action: 'open',
    activeKey: true          // sign with active authority (default: posting)
});

// Plain operations, for testing subscriptions
await ts.transfer('alice', 'myapp', hive(1), 'a plain memo');
await ts.customJson('bob', { follow: 'alice' }, { id: 'follow' });

// Raw operations, one block, single transaction
await ts.sendOperations([
    ['transfer', { from: 'a', to: 'b', amount: '1.000 HIVE', memo: '' }]
]);
```

### Time travel

TimeActions fire against simulated chain time, so scheduled logic is testable without waiting:

```ts
await ts.streamer.registerAction(new TimeAction('1h', 'hourly-draw', 'lotto', 'draw', {}, ts.currentTime));

await ts.advanceTime('1h');   // mints a block one hour later; the action fires
await ts.advanceBlocks(3);    // three empty blocks at normal 3s spacing
```

`advanceTime` accepts milliseconds or `'30s'`, `'5m'`, `'1h'`, `'2d'`, `'1w'`.

### Asserting on results

```ts
// Broadcasts your handlers attempted (payouts, refunds, custom JSON)
expect(ts.outgoingTransfers).toEqual([
    { from: 'myapp', to: 'alice', amount: '2.000 HIVE', memo: 'winnings' }
]);
expect(ts.broadcasts).toHaveLength(1);   // every broadcast, typed by kind

// Contract events recorded through the adapter
const events = await ts.getEvents();

// Query contract tables directly
const rows = await ts.adapter.query('SELECT * FROM tipjar_tips');

// Stub chain reads your handlers perform
ts.client.onCall('get_order_book', { bids: [], asks: [] });
ts.client.setAccount('alice', { balance: '100.000 HIVE' });
```

Call `await ts.stop()` when done (in `afterEach`, for example) to close the database.

---

## Adapter Requirements

Contracts can use any adapter, but some require SQL features:

- **SQL adapters** (SQLite/Postgres) support `adapter.query(...)`.
- **MongoDB adapter** does not support raw SQL.

If a contract uses `adapter.query`, it must document that it requires a SQL adapter.

---

## Building Contracts Step-by-Step

1. **Define the contract** with `defineContract`.
2. **Define actions** with `action`, specifying trigger and optional schema.
3. **Use hooks** (`create`, `destroy`) to initialize tables or cache configuration.
4. **Validate input** using Zod.
5. **Use `ctx`** for block/transaction context.
6. **Return when the work is done.** Handlers are awaited in order, so a slow handler slows the stream. Queue long work instead of awaiting it.
7. **Register the contract** with the streamer.

---

## Example Contract

```ts
import { defineContract, action } from 'hive-stream';
import { z } from 'zod';

const tipSchema = z.object({
    message: z.string().max(280).optional()
});

export const TipJar = defineContract({
    name: 'tipjar',
    actions: {
        tip: action(async (payload, ctx) => {
            if (!ctx.transfer) {
                throw new Error('Transfer context required');
            }

            console.log(`Tip from ${ctx.sender}: ${ctx.transfer.amount} ${ctx.transfer.asset}`);
            if (payload.message) {
                console.log(`Message: ${payload.message}`);
            }
        }, {
            schema: tipSchema,
            trigger: 'transfer'
        })
    }
});
```

---

## Built-in Contract Examples

- `createDiceContract` - Dice game using transfer bets (optional provably fair mode)
- `createCoinflipContract` - Coin flip game using transfer bets (optional provably fair mode)
- `createLottoContract` - Lottery system with scheduled draws (optional provably fair mode)
- `createLimboContract` - Provably fair limbo/crash game with payouts capped against the bankroll
- `createTournamentContract` - Paid tournaments with oracle-submitted scores and basis-point prize splits
- `createBadgesContract` - Non-transferable achievements issued by accounts or earned by rules
- `createStakingPoolContract` - Stake an asset and earn rewards with reward-per-share accounting
- `createBridgeContract` - Custody bridge with M-of-N operator attestations, limits and an audit trail
- `createTokenContract` - SQL-backed fungible tokens
- `createNFTContract` - SQL-backed NFTs
- `createRpsContract` - Rock/Paper/Scissors
- `createRouletteContract` - Roulette with straight, color, parity, dozen, column, and low/high bets (optional provably fair mode)
- `createPollContract` - Polls and votes
- `createTipJarContract` - Tip jar + message log
- `createExchangeContract` - Deposits/withdrawals/orders/matching (SQL)
- `createAuctionHouseContract` - Auctions with bids, reserve prices, and settlement
- `createSubscriptionContract` - Subscription plans with transfer and recurrent renewals
- `createCrowdfundContract` - Crowdfunding campaigns with milestones and refund flows
- `createBountyBoardContract` - Funded bounties, submissions, and award tracking
- `createInvoiceContract` - Invoices with partial/recurrent payments and overdue sweeps
- `createSavingsContract` - Savings goals with recurring contributions and withdrawals
- `createBookingContract` - Booking listings, reservations, confirmations, and cancellations
- `createGiftCardContract` - Gift card issuance, redemption, and cancellation
- `createGroupBuyContract` - Group buys with commitments, finalization, and withdrawals
- `createSweepstakesContract` - Paid-entry sweepstakes with deterministic draws
- `createDcaBotContract` - Time-driven DCA execution scheduling
- `createMultisigTreasuryContract` - Multisig vaults with approval queues and ready-to-execute proposals
- `createRevenueSplitContract` - Revenue splitting with internal balances and withdrawals
- `createPaywallContract` - Paid access windows and expiries for gated resources
- `createDomainRegistryContract` - Namespace-based domain registrations, renewals, and transfers
- `createRentalContract` - Escrow-backed rentals using `escrow_transfer`
- `createLaunchpadContract` - Fixed-price launchpad sales with allocations and claims
- `createPredictionMarketContract` - Prediction markets with paid positions and claims
- `createQuestPassContract` - Seasonal pass sales, point accrual, and tier claims
- `createCharityMatchContract` - Donation matching campaigns with sponsor-defined caps
- `createReferralContract` - Affiliate programs, conversion attribution, and payout balances
- `createInsurancePoolContract` - Insurance pools with premiums, active policies, claims, and reserve accounting
- `createOracleBountyContract` - Oracle feeds with funded report rounds, medians, and reward withdrawals
- `createGrantRoundsContract` - Matching grant rounds with project submissions, donations, and grant withdrawals
- `createPayrollContract` - Recurring payroll budgets with scheduled runs and recipient balances
- `createProposalTimelockContract` - Timelock approval queues for delayed governance-style actions
- `createBundleMarketplaceContract` - Bundle storefronts with inventory, purchases, and fulfillment tracking
- `createTicketingContract` - Event ticket sales with check-ins, refunds, capacity limits, transfers, and peer-to-peer resale
- `createFanClubContract` - Paid clubs with member renewals, points, and perk redemptions
- `createCheckpointContract` - Periodic on-chain state hashes so independent operators can verify they derive identical state

### Example Snippets

Use-case recipes (dice with fairness, tournaments, tipping with hooks, a bridge, an escrow marketplace, a swap desk, a DAO, several app accounts and a browser frontend) live in `examples/recipes/` and are explained in the [Recipes guide](https://vheissu.github.io/hive-stream/guide/recipes). A test type-checks every file under `examples/`.

Quick-start snippets live in `examples/contracts/`:

- `examples/contracts/rps.ts`
- `examples/contracts/roulette.ts`
- `examples/contracts/poll.ts`
- `examples/contracts/tipjar.ts`
- `examples/contracts/exchange.ts`

Most built-in contracts use SQL tables internally, so they require a SQL-capable adapter such as SQLite or PostgreSQL. MongoDB remains supported for streamer persistence and custom contracts that do not rely on raw SQL queries.

---

## Exchange Contract Guide

The exchange contract gives you a basic on-chain orderbook experience backed by a SQL adapter.

### Features
- Deposits via transfer memo
- Internal balances (available + locked)
- Order placement and cancellation
- Order matching
- Withdrawals (active key required)
- Internal transfers between exchange users
- Maker/taker fees (basis points)
- Order book snapshots for API consumption

### Notes
- Requires a SQL adapter (SQLite or Postgres).
- Uses `TimeAction` to run `matchOrders` periodically.
- Fees are charged on received assets (base for buyers, quote for sellers).

### Configuration Options
```
createExchangeContract({
  name: 'exchange',
  account: 'my-exchange',
  feeAccount: 'my-exchange-fees',
  makerFeeBps: 10,
  takerFeeBps: 20
})
```

### Example Payloads

**Create pair**
```
{"hive_stream": {"contract":"exchange","action":"createPair","payload":{"base":"HIVE","quote":"HBD"}}}
```

**Deposit** (send transfer to exchange account with memo)
```
{"hive_stream": {"contract":"exchange","action":"deposit","payload":{}}}
```

**Place order**
```
{"hive_stream": {"contract":"exchange","action":"placeOrder","payload":{"side":"buy","base":"HIVE","quote":"HBD","price":"2","amount":"5"}}}
```

**Cancel order**
```
{"hive_stream": {"contract":"exchange","action":"cancelOrder","payload":{"orderId":"..."}}}
```

**Snapshot orderbook**
```
{"hive_stream": {"contract":"exchange","action":"snapshotOrderBook","payload":{"base":"HIVE","quote":"HBD","depth":20}}}
```

**Withdraw**
```
{"hive_stream": {"contract":"exchange","action":"withdraw","payload":{"asset":"HBD","amount":"5.000"}}}
```

### API Endpoints

If you want the built-in API server to start alongside block streaming, configure:

```ts
const streamer = new Streamer({
    apiEnabled: true,
    apiPort: 5001
});

await streamer.start();
```

You can also run the API independently:

```ts
await streamer.startApiServer();
```

When the built-in API server is running, the following endpoints are available:

- `GET /exchange/balances` (optional query `?account=alice`)
- `GET /exchange/orders` (query `account`, `base`, `quote`, `status`)
- `GET /exchange/trades` (query `account`, `base`, `quote`)
- `GET /exchange/orderbook` (query `base`, `quote`, `limit`)

---

## Non-Custodial Assets Guide

The NFT and ticketing contracts support fully non-custodial trading: buyers pay sellers **directly**, and the contract only verifies the on-chain payment and flips ownership. Funds never pass through the app account.

### Direct NFT sales

1. The owner lists with `listNFT` (custom_json): `{"collectionSymbol":"ART","tokenId":"piece-1","price":"10.000","currency":"HIVE"}`.
2. The buyer sends the exact price **to the seller's account** with the memo `{"hive_stream":{"contract":"nft","action":"buyNFTDirect","payload":{"collectionSymbol":"ART","tokenId":"piece-1"}}}`.
3. The contract verifies the transfer recipient is the seller and the amount/currency match the listing, then transfers ownership.

The examples above assume the contract was registered as `createNFTContract({ name: 'nft' })` (what scaffolded apps do); the default registered name is `hivenft`.

Royalties cannot be enforced on a peer-to-peer payment; `buyNFTDirect` records the royalty owed (`royaltyDue`, `royaltyRecipient`) in the emitted event so marketplaces and sellers can honour them. The custodial `buyNFT` flow (payment to the app account, which pays out the seller and royalties) remains available.

### Batch minting

`mintBatchNFT` (custom_json, collection creator only) mints many tokens in one operation, either as numbered editions or an explicit list:

```json
{"collectionSymbol":"TICKETS","to":"some-account","editions":{"baseTokenId":"GA","count":100}}
{"collectionSymbol":"TICKETS","to":"some-account","tokens":[{"tokenId":"VIP-1","metadata":"{\"seat\":\"A1\"}"}]}
```

Editions mint `GA-1` … `GA-100` (up to 1,000 per operation); explicit lists allow up to 50 tokens with per-token metadata. Both respect the collection's maximum supply atomically.

### Ticket transfers and resale

Tickets from the ticketing contract are bearer assets:

- `transferTicket` (custom_json, owner only): `{"ticketId":"ticket-1","to":"friend-account"}`
- `listTicket` / `unlistTicket` (custom_json, owner only): `{"ticketId":"ticket-1","price":"3.000"}` — asset defaults to the event's asset
- `buyTicketDirect` (transfer memo): buyer pays the listed price **directly to the seller** with `{"hive_stream":{"contract":"ticketing","action":"buyTicketDirect","payload":{"ticketId":"ticket-1"}}}`

Transferring a ticket deactivates any active resale listing, and stale listings (where the seller no longer owns the ticket) are rejected at purchase time.

### State checkpoints

Because contract state is derived off-chain, anyone can verify an app by replaying the chain. `createCheckpointContract` makes that verification cheap: it periodically publishes a deterministic sha256 hash of your contract tables as a custom_json operation, and records other operators' published hashes with a match/mismatch verdict.

```ts
import { createCheckpointContract, TimeAction } from 'hive-stream';

await streamer.registerContract(createCheckpointContract({
    account: 'my-app-account',
    tables: ['nft_collections', 'nft_tokens', 'nft_listings']
}));

await streamer.registerAction(new TimeAction('1h', 'state-checkpoint', 'checkpoint', 'publishCheckpoint', {}));
```

The hash is order-independent (rows are hashed individually and sorted), so any adapter backend that holds the same logical state produces the same digest. Publishing requires a posting key for the configured account. Results land in the `state_checkpoints` table; a `matched = 0` row means your node's state diverges from the publisher's (or the hash was computed after state moved on — recompute at the same cadence to confirm).

---

## Social Operations

Follow, unfollow, mute, and reblog users directly from the streamer:

```typescript
// Direct methods
await streamer.follow('myaccount', 'targetuser');
await streamer.unfollow('myaccount', 'targetuser');
await streamer.mute('myaccount', 'spammer');
await streamer.reblog('myaccount', 'author', 'great-post');

// Or use builders
await streamer.ops.follow().follower('myaccount').following('targetuser').send();
await streamer.ops.unfollow().follower('myaccount').following('targetuser').send();
await streamer.ops.mute().follower('myaccount').following('spammer').send();
await streamer.ops.reblog().account('myaccount').author('author').permlink('great-post').send();
```

---

## Staking Operations

Power up, power down, delegate, and undelegate Hive Power:

```typescript
// Power up HIVE to HP
await streamer.powerUp('myaccount', 'myaccount', '100.000');
await streamer.ops.powerUp().from('myaccount').to('myaccount').amount(100).send();

// Power down (withdraw vesting)
await streamer.powerDown('myaccount', '50000.000000 VESTS');
await streamer.ops.powerDown().account('myaccount').vestingShares('50000.000000 VESTS').send();

// Cancel active power down
await streamer.cancelPowerDown('myaccount');
await streamer.ops.cancelPowerDown().account('myaccount').send();

// Delegate HP to another account
await streamer.delegateVestingShares('myaccount', 'recipient', '10000.000000 VESTS');
await streamer.ops.delegate().delegator('myaccount').delegatee('recipient').vestingShares('10000.000000 VESTS').send();

// Remove delegation
await streamer.undelegateVestingShares('myaccount', 'recipient');
await streamer.ops.undelegate().delegator('myaccount').delegatee('recipient').send();
```

---

## Account Operations

### Claim Rewards
```typescript
await streamer.claimRewards('myaccount', '1.000 HIVE', '0.500 HBD', '100.000000 VESTS');
await streamer.ops.claimRewards()
    .account('myaccount')
    .rewardHive('1.000 HIVE')
    .rewardHbd('0.500 HBD')
    .rewardVests('100.000000 VESTS')
    .send();
```

### Witness Voting
```typescript
await streamer.witnessVote('myaccount', 'goodwitness', true);
await streamer.ops.witnessVote().account('myaccount').witness('goodwitness').approve().send();

// Remove witness vote
await streamer.witnessVote('myaccount', 'badwitness', false);
await streamer.ops.witnessVote().account('myaccount').witness('badwitness').unapprove().send();
```

### Governance Proxy
```typescript
await streamer.setProxy('myaccount', 'trustedvoter');
await streamer.ops.setProxy().account('myaccount').proxy('trustedvoter').send();

// Remove proxy
await streamer.clearProxy('myaccount');
await streamer.ops.clearProxy().account('myaccount').send();
```

### Update Profile
```typescript
await streamer.updateProfile('myaccount', {
    name: 'My Display Name',
    about: 'Hive developer',
    location: 'Decentralized',
    website: 'https://example.com',
    profile_image: 'https://example.com/avatar.png',
    cover_image: 'https://example.com/cover.png'
});

// Or use the builder
await streamer.ops.updateProfile()
    .account('myaccount')
    .name('My Display Name')
    .about('Hive developer')
    .website('https://example.com')
    .profileImage('https://example.com/avatar.png')
    .set('custom_field', 'custom_value')
    .send();
```

### Account Lookup
```typescript
const account = await streamer.getAccount('alice');
const accounts = await streamer.getAccounts(['alice', 'bob', 'charlie']);
```

---

## Event Subscriptions

In addition to the existing `onTransfer`, `onCustomJson`, `onComment`, `onPost`, and escrow subscriptions, you can now subscribe to:

```typescript
// Watch all votes on the blockchain
streamer.onVote((data, blockNumber, blockId, prevBlockId, trxId, blockTime) => {
    console.log(`${data.voter} voted on @${data.author}/${data.permlink} with weight ${data.weight}`);
});

// Watch delegations
streamer.onDelegate((data, blockNumber, blockId, prevBlockId, trxId, blockTime) => {
    console.log(`${data.delegator} delegated ${data.vesting_shares} to ${data.delegatee}`);
});

// Watch power ups
streamer.onPowerUp((data, blockNumber, blockId, prevBlockId, trxId, blockTime) => {
    console.log(`${data.from} powered up ${data.amount} to ${data.to}`);
});

// Watch power downs
streamer.onPowerDown((data, blockNumber, blockId, prevBlockId, trxId, blockTime) => {
    console.log(`${data.account} started power down of ${data.vesting_shares}`);
});

// Watch reward claims
streamer.onClaimRewards((data, blockNumber, blockId, prevBlockId, trxId, blockTime) => {
    console.log(`${data.account} claimed rewards`);
});

// Watch witness votes
streamer.onAccountWitnessVote((data, blockNumber, blockId, prevBlockId, trxId, blockTime) => {
    console.log(`${data.account} ${data.approve ? 'voted for' : 'unvoted'} witness ${data.witness}`);
});
```

---

## Blockchain Helpers

### Reputation Score
```typescript
import { Utils } from 'hive-stream';

// Convert raw blockchain reputation to human-readable score (25-75 range)
const score = Utils.calculateReputation('253948692668213'); // e.g. 73.64
```

### VESTS / HP Conversion
```typescript
// Convert VESTS to Hive Power
const hp = Utils.vestToHP('1000000', totalVestingFundHive, totalVestingShares); // '500.000'

// Convert HP to VESTS
const vests = Utils.hpToVest('500', totalVestingFundHive, totalVestingShares); // '1000000.000000'

// Get formatted VESTS string for delegation/power down
const vestsStr = Utils.hpToVestString('500', totalVestingFundHive, totalVestingShares); // '1000000.000000 VESTS'
```

### Parse Profile Metadata
```typescript
const profile = Utils.parseProfileMetadata(account.posting_json_metadata);
// { name: 'Alice', about: '...', location: '...', website: '...', profile_image: '...', cover_image: '...' }
```

---

## Query Namespace

The `streamer.query` namespace provides read-only access to the entire Hive blockchain. No keys required.

### Chain State
```typescript
const props = await streamer.query.getDynamicGlobalProperties();
const chainProps = await streamer.query.getChainProperties();
const config = await streamer.query.getConfig();
const price = await streamer.query.getCurrentMedianHistoryPrice();
const rewardFund = await streamer.query.getRewardFund('post');
```

### Content & Discussions
```typescript
const post = await streamer.query.getContent('author', 'permlink');
const replies = await streamer.query.getContentReplies('author', 'permlink');
const votes = await streamer.query.getActiveVotes('author', 'permlink');

const trending = await streamer.query.getTrending({ tag: 'hive', limit: 10 });
const hot = await streamer.query.getHot({ limit: 20 });
const newPosts = await streamer.query.getCreated({ tag: 'dev', limit: 10 });
const blog = await streamer.query.getBlog('alice');
const feed = await streamer.query.getFeed('alice');
```

### Social Graph
```typescript
const followers = await streamer.query.getFollowers('alice', '', 'blog', 100);
const following = await streamer.query.getFollowing('alice', '', 'blog', 100);
const counts = await streamer.query.getFollowCount('alice');
```

### Delegations & Vesting
```typescript
const delegations = await streamer.query.getVestingDelegations('alice');
```

### Account History
```typescript
const history = await streamer.query.getAccountHistory('alice', -1, 100);
```

### Market & Orders
```typescript
const orderBook = await streamer.query.getOrderBook(50);
const openOrders = await streamer.query.getOpenOrders('alice');
```

### Resource Credits & Voting Power
```typescript
const rc = await streamer.query.getRCMana('alice');
const vp = await streamer.query.getVPMana('alice');
const rcAccounts = await streamer.query.findRCAccounts(['alice', 'bob']);
```

### Communities & Notifications
```typescript
const community = await streamer.query.getCommunity('hive-12345');
const communities = await streamer.query.listCommunities({ limit: 50 });
const notifications = await streamer.query.getAccountNotifications('alice');
const subs = await streamer.query.listAllSubscriptions('alice');
```

### Witnesses
```typescript
const witness = await streamer.query.getWitnessByAccount('someguy');
const topWitnesses = await streamer.query.getWitnessesByVote('', 100);
```

### Blocks & Transactions
```typescript
const block = await streamer.query.getBlock(12345678);
const header = await streamer.query.getBlockHeader(12345678);
const ops = await streamer.query.getOperations(12345678);
const txStatus = await streamer.query.findTransaction('trx-id-here');
```

### Conversions & Savings
```typescript
const conversions = await streamer.query.getConversionRequests('alice');
const collateralized = await streamer.query.getCollateralizedConversionRequests('alice');
const savingsWithdrawals = await streamer.query.getSavingsWithdrawFrom('alice');
```

### Proposals & Account Lookup
```typescript
const proposals = await streamer.query.getProposals({ status: 'votable', limit: 50 });
const accounts = await streamer.query.lookupAccounts('ali', 10);
```

---

## Savings Operations

```typescript
// Transfer to savings
await streamer.transferToSavings('myaccount', 'myaccount', '100', 'HIVE');
await streamer.ops.transferToSavings().from('myaccount').hive(100).send();

// Transfer from savings (3-day delay)
await streamer.transferFromSavings('myaccount', 'myaccount', '50', 'HBD', 1);
await streamer.ops.transferFromSavings().from('myaccount').hbd(50).requestId(1).send();

// Cancel pending savings withdrawal
await streamer.cancelTransferFromSavings('myaccount', 1);
```

---

## Convert Operations

```typescript
// Convert HBD to HIVE (3.5-day delay)
await streamer.convert('myaccount', '10.000 HBD');
await streamer.ops.convert().from('myaccount').hbd(10).send();

// Collateralized convert HIVE to HBD (instant, with collateral)
await streamer.collateralizedConvert('myaccount', '10.000 HIVE');
await streamer.ops.collateralizedConvert().from('myaccount').hive(10).send();
```

---

## Market Operations

```typescript
// Create a limit order (sell HIVE for HBD)
await streamer.ops.limitOrder()
    .owner('myaccount')
    .amountToSell('10.000 HIVE')
    .minToReceive('4.000 HBD')
    .expiration(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000))
    .send();

// Cancel an order
await streamer.ops.cancelOrder().owner('myaccount').orderId(12345).send();
```

---

## Content Operations

```typescript
// Delete a post or comment
await streamer.deleteComment('myaccount', 'my-permlink');
await streamer.ops.deleteComment().author('myaccount').permlink('my-permlink').send();

// Set post options with beneficiaries
await streamer.ops.commentOptions()
    .author('myaccount')
    .permlink('my-post')
    .maxAcceptedPayout('1000.000 HBD')
    .percentHbd(5000)
    .beneficiary('devfund', 500)
    .beneficiary('curator', 1000)
    .send();
```

---

## Vesting Withdrawal Routes

```typescript
// Route 50% of power-down to another account
await streamer.ops.withdrawRoute()
    .from('myaccount')
    .to('savings-account')
    .percent(5000)
    .autoVest(true) // Auto power-up at destination
    .send();
```

---

## Witness Operations

```typescript
// Publish price feed (witnesses only)
await streamer.feedPublish('mywitness', '0.400 HBD', '1.000 HIVE');
```

---

## Additional Event Subscriptions

```typescript
// Watch follows/unfollows/mutes
streamer.onFollow((data, blockNumber, blockId, prevBlockId, trxId, blockTime) => {
    console.log(`${data.follower} ${data.what.length ? 'followed' : 'unfollowed'} ${data.following}`);
});

// Watch reblogs
streamer.onReblog((data, blockNumber, blockId, prevBlockId, trxId, blockTime) => {
    console.log(`${data.account} reblogged @${data.author}/${data.permlink}`);
});

// Watch account updates
streamer.onAccountUpdate((data, blockNumber, blockId, prevBlockId, trxId, blockTime) => {
    console.log(`${data.account} updated their account`);
});

// Watch comment deletions
streamer.onDeleteComment((data, blockNumber, blockId, prevBlockId, trxId, blockTime) => {
    console.log(`${data.author} deleted ${data.permlink}`);
});

// Watch market activity
streamer.onLimitOrder((data, blockNumber, blockId, prevBlockId, trxId, blockTime) => {
    console.log('Market order activity:', data);
});

// Watch savings transfers
streamer.onSavingsTransfer((data, blockNumber, blockId, prevBlockId, trxId, blockTime) => {
    console.log('Savings transfer:', data);
});

// Watch HBD/HIVE conversions
streamer.onConvert((data, blockNumber, blockId, prevBlockId, trxId, blockTime) => {
    console.log('Conversion:', data);
});
```

---

## Content Helpers

```typescript
import { Utils } from 'hive-stream';

// Generate a permlink from a title
const permlink = Utils.generatePermlink('My Awesome Post!'); // 'my-awesome-post'

// Generate a reply permlink
const replyPermlink = Utils.generateReplyPermlink('parent-post'); // 're-parent-post-20260318...'

// Create post metadata JSON
const metadata = Utils.createPostMetadata({
    tags: ['hive', 'development'],
    image: ['https://example.com/hero.png'],
    description: 'A great post about Hive development',
    app: 'my-app/1.0'
});
```

---

## Account Validation

```typescript
// Validate account name format
const error = Utils.validateAccountName('alice'); // null (valid)
const error2 = Utils.validateAccountName('AB'); // 'Account name must be at least 3 characters'

// Quick boolean check
const valid = Utils.isValidAccountName('alice'); // true

// Check if account exists on chain
const exists = await Utils.accountExists(client, 'alice'); // true/false
```

---

## URL & Link Parsing

```typescript
// Parse Hive URLs
Utils.parseHiveUrl('@alice/my-post');
// { author: 'alice', permlink: 'my-post' }

Utils.parseHiveUrl('https://hive.blog/hive-12345/@alice/my-post');
// { author: 'alice', permlink: 'my-post', category: 'hive-12345' }
```

---

## Voting Power & Vote Value

```typescript
// Calculate current voting mana %
const mana = Utils.calculateVotingMana(account); // 98.5

// Get effective vesting shares (own + received - delegated)
const effectiveVests = Utils.getEffectiveVestingShares(account);

// Estimate vote value in USD
const voteValue = Utils.estimateVoteValue(
    mana,           // current voting mana %
    100,            // vote weight %
    effectiveVests, // effective vesting shares
    rewardFund,     // from query.getRewardFund()
    medianPrice     // from query.getCurrentMedianHistoryPrice()
);
```

---

## Memo Encryption

```typescript
// Encode a private memo
const encoded = Utils.encodeMemo(privateMemoKey, receiverPublicMemoKey, 'secret message');

// Decode a private memo
const decoded = Utils.decodeMemo(privateMemoKey, encodedMemo);
```

---

## Post Builder

The post builder is the easiest way to create posts and replies on Hive. It atomically combines `comment` + `comment_options` in a single transaction, handling beneficiaries, metadata, communities, and more.

```typescript
// Create a post with beneficiaries
await streamer.ops.post()
    .author('alice')
    .title('My First dApp Post')
    .body('Hello from hive-stream!')
    .tags('hive', 'dev', 'tutorial')
    .community('hive-169321')
    .beneficiary('devfund', 500)     // 5%
    .beneficiary('alice-savings', 1000)  // 10%
    .maxAcceptedPayout(100, 'HBD')
    .percentHbd(5000)                // 50% HBD
    .app('my-app/1.0')
    .image('https://example.com/hero.png')
    .description('A tutorial on building dApps')
    .metadata('canonical_url', 'https://myapp.com/posts/1')
    .send();

// Reply to a post
await streamer.ops.post()
    .author('bob')
    .parentAuthor('alice')
    .parentPermlink('my-first-dapp-post')
    .body('Great post! Very helpful.')
    .send();

// Post with zero payout (decline rewards)
await streamer.ops.post()
    .author('alice')
    .title('PSA: Important Announcement')
    .body('This is a community announcement.')
    .tags('psa')
    .maxAcceptedPayout(0, 'HBD')
    .send();
```

---

## Batch Operations

Batch multiple operations into a single atomic transaction:

```typescript
// Vote + comment in one transaction
await streamer.batch()
    .vote('alice', 'bob', 'great-post', 10000)
    .comment('alice', 're-great-post-reply', 'bob', 'great-post', '', 'Love this!', '{}')
    .send();

// Multiple transfers in one transaction
await streamer.batch()
    .transfer('alice', 'bob', '1.000 HIVE', 'payment 1')
    .transfer('alice', 'carol', '2.000 HIVE', 'payment 2')
    .transfer('alice', 'dave', '3.000 HIVE', 'payment 3')
    .send();

// Mix different operation types
await streamer.batch()
    .add(['transfer', { from: 'alice', to: 'bob', amount: '1.000 HIVE', memo: '' }])
    .customJson('myapp', { action: 'register' }, 'alice')
    .send();
```

---

## Authority Management

Manage posting authority for Hive apps:

```typescript
// Check if an app has posting authority
const hasAuth = await streamer.hasPostingAuth('alice', 'myapp');

// Grant posting authority to an app
await streamer.grantPostingAuth('alice', 'myapp');

// Revoke posting authority
await streamer.revokePostingAuth('alice', 'myapp');
```

---

## Power Down Schedule

Calculate when power down payments arrive:

```typescript
const schedule = Utils.calculatePowerDownSchedule(account);
// [
//   { week: 1, date: 2026-03-25T..., amount: '1000.000000', vestingShares: '1000.000000 VESTS' },
//   { week: 2, date: 2026-04-01T..., amount: '1000.000000', vestingShares: '1000.000000 VESTS' },
//   ...up to 13 weeks
// ]
```

---

## HBD Savings Interest

```typescript
const interest = Utils.calculateHbdInterest(
    account.savings_hbd_balance,  // '1000.000 HBD'
    account.savings_hbd_last_interest_payment,
    15  // current APR %
);
// '12.328' (pending interest in HBD)
```

---

## Payout Helpers

```typescript
// Is the post still earning?
Utils.isInPayoutWindow(post);  // true/false

// How long until payout?
Utils.timeUntilPayout(post);  // milliseconds (0 if already paid)

// What's the payout value?
Utils.getPendingPayout(post);  // '10.500' (HBD)
```

---

## Account Value Calculator

```typescript
const value = Utils.calculateAccountValue(
    account,
    hivePrice,           // e.g. 0.40 USD
    hbdPrice,            // e.g. 1.00 USD
    totalVestingFundHive,
    totalVestingShares
);
// {
//   hive: 100,           // liquid HIVE
//   hbd: 50,             // liquid HBD
//   savings_hive: 200,   // savings HIVE
//   savings_hbd: 100,    // savings HBD
//   hp: 500,             // Hive Power (HP)
//   total_hive: 800,     // total in HIVE terms
//   total_usd: 470.0     // total in USD
// }
```

---

## Content Extraction

```typescript
// Extract all images from a post body (for thumbnails, galleries)
const images = Utils.extractImagesFromBody(post.body);
// ['https://example.com/img1.png', 'https://example.com/img2.jpg']

// Extract all hyperlinks (excluding images)
const links = Utils.extractLinksFromBody(post.body);

// Generate a plain-text summary (for previews, SEO)
const summary = Utils.generatePostSummary(post.body, 200);
// 'Hello world. This is a great post about...'
```

---

## Hivesigner URLs

```typescript
// Generate signing URLs for any operation
const transferUrl = Utils.getTransferUrl('bob', 'thanks', '1.000 HIVE', 'https://myapp.com');
const voteUrl = Utils.getVoteUrl('alice', 'bob', 'great-post', 10000);
const delegateUrl = Utils.getDelegateUrl('alice', 'bob', '1000.000000 VESTS');
const followUrl = Utils.getFollowUrl('alice', 'bob');

// Generic signing URL for any operation type
const url = Utils.getHivesignerSignUrl('transfer', {
    from: 'alice', to: 'bob', amount: '1.000 HIVE'
}, 'https://myapp.com/callback');
```

---

## Transfer Memo Helpers

```typescript
// Check if a memo is encrypted
Utils.isEncryptedMemo('#encrypted-content');  // true
Utils.isEncryptedMemo('regular memo');        // false

// Create structured JSON memos (for exchanges, apps)
const memo = Utils.createJsonMemo({ action: 'deposit', orderId: 12345 });

// Parse JSON memos from transfers
const data = Utils.parseJsonMemo('{"action":"deposit","orderId":12345}');
// { action: 'deposit', orderId: 12345 }
Utils.parseJsonMemo('regular memo');  // null
```

---

## Utilities
The library includes additional helpers for JSON parsing, randomness, seeded RNG, and transfer verification. See `src/utils.ts` for the complete API.

---

## Tests
Contract tests live under `tests/contracts/`. Time action tests are in `tests/streamer-actions.spec.ts`.
