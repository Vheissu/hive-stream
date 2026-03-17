# Hive-Stream Documentation

## Introduction
Hive Stream is a Node.js library for streaming Hive blockchain activity and routing it to contracts you define. Contracts can react to:
- `custom_json` operations
- transfer memos
- time-based actions
- escrow operations

This document focuses on the contract system and how to build robust contracts using the new `defineContract`/`action` API.

`new Streamer()` is side-effect free. The default SQLite adapter is initialized lazily, and the built-in Express API only starts when you call `startApiServer()` or enable it through config before `start()`.

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
        }
    },
    actions: { ... }
});
```

---

## Contract Context

Every action receives a `ContractContext` with:

- `trigger`: `custom_json | transfer | time | escrow_transfer | escrow_approve | escrow_dispute | escrow_release | recurrent_transfer`
- `streamer`: access to Hive client and helpers
- `adapter`: database adapter
- `config`: resolved config values
- `block`: `{ number, id, previousId, time }`
- `transaction`: `{ id }`
- `sender`: Hive account invoking the action
- `transfer`: transfer details (only for `transfer` trigger)
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

If validation fails, the action is not executed and the error is logged.

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

- Errors inside contract actions are caught and logged.
- **Time actions** bubble errors back into the scheduler so the action does **not** increment execution count if it fails.

Write actions defensively and always validate inputs.

---

## Time-Based Actions

Time-based actions let you run contract logic on a schedule:

```ts
import { TimeAction } from 'hive-stream';

const matchAction = new TimeAction('30s', 'exchange-matcher', 'exchange', 'matchOrders', { limit: 50 });
await streamer.registerAction(matchAction);
```

The action must have `trigger: 'time'` in its definition.

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
6. **Return void** (actions are fire-and-forget).
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

- `createDiceContract` - Dice game using transfer bets
- `createCoinflipContract` - Coin flip game using transfer bets
- `createLottoContract` - Lottery system with scheduled draws
- `createTokenContract` - SQL-backed fungible tokens
- `createNFTContract` - SQL-backed NFTs
- `createRpsContract` - Rock/Paper/Scissors
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
- `createTicketingContract` - Event ticket sales with check-ins, refunds, and capacity limits
- `createFanClubContract` - Paid clubs with member renewals, points, and perk redemptions

### Example Snippets

Quick-start snippets live in `examples/contracts/`:

- `examples/contracts/rps.ts`
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

## Utilities
The library includes helpers for JSON parsing, randomness, and transfer verification. See `src/utils.ts` for details.

---

## Tests
Contract tests live under `tests/contracts/`. Time action tests are in `tests/streamer-actions.spec.ts`.
