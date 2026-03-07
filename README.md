# Hive Stream

A Node.js layer for Hive that allows you to watch for specific actions on the Hive blockchain.

## Install

```shell
npm install hive-stream
```

## Quick Usage

```javascript
const { Streamer } = require('hive-stream');

const ss = new Streamer();

// Watch for all custom JSON operations
ss.onCustomJson((op, { sender, isSignedWithActiveKey }, blockNumber, blockId, prevBlockId, trxId, blockTime) => {
  // React to custom JSON operations
});
```

`new Streamer()` is now side-effect free. The default SQLite adapter is created lazily on first use, and the built-in Express API is opt-in via `apiEnabled: true` on `start()` or an explicit `startApiServer()` call.

## Builder/Tooling Metadata

For external tooling (like visual builders), Hive Stream now exports a read-only metadata object:

```javascript
const { HIVE_STREAM_METADATA, getHiveStreamMetadata } = require('hive-stream');

console.log(HIVE_STREAM_METADATA.subscriptions);
console.log(getHiveStreamMetadata().writeOperations);
```

This metadata is static runtime data (no network calls) and includes config defaults, event callback signatures, write operation signatures, adapter metadata, contract trigger info, and valid `TimeAction` values.

## Configuration

The `Streamer` object can accept an object of configuration values which are all optional. However, some operations like transferring Hive Engine tokens or other operations on the blockchain that are not READ ONLY, will require the active key and/or posting keys supplied as well as a username.

The `blockCheckInterval` value is how often to check for new blocks or in cases of error or falling behind, to poll for new blocks. You should keep this as the default 1000ms value which is one second. This allows you to account for situations where blocks fall behind the main block.

The `blocksBehindWarning` value is a numeric value of the number of blocks your API will fall behind from the master before warning to the console.

To resume automatically from stored state, keep `resumeFromState` enabled (default). To force a specific start block, set `resumeFromState` to `false` and supply `lastBlockNumber`.

For faster catch-up, `catchUpBatchSize` controls how many blocks are processed per polling cycle, and `catchUpDelayMs` controls the delay between catch-up batches (set to `0` for fastest catch-up).

The `apiNodes` are the Hive API endpoints used for failover. Set `apiEnabled` to `true` if you want `start()` to boot the built-in API server, or call `startApiServer()` manually. If you want verbose logs, set `debugMode` to `true`. The configuration values and their defaults can be found in `src/config.ts`.

CamelCase config keys are recommended for readability. Legacy uppercase keys are still supported for backwards compatibility.

```
const options = {
  activeKey: '',
  postingKey: '',
  jsonId: 'hivestream',
  hiveEngineApi: 'https://api.hive-engine.com/rpc',
  hiveEngineId: 'ssc-mainnet-hive',
  payloadIdentifier: 'hive_stream',
  appName: 'hive-stream',
  username: '',
  lastBlockNumber: 0,
  blockCheckInterval: 1000,
  blocksBehindWarning: 25,
  resumeFromState: true,
  catchUpBatchSize: 50,
  catchUpDelayMs: 0,
  apiNodes: ['https://api.hive.blog', 'https://api.openhive.network', 'https://rpc.ausbit.dev'],
  apiEnabled: false,
  apiPort: 5001,
  debugMode: false
}

const ss = new Streamer(options);
```

If you want the built-in API without starting block streaming yet:

```javascript
await ss.startApiServer();
```

The configuration itself can also be overloaded using the `setConfig` method which allows you to pass one or more of the above configuration options, useful in situations where multiple keys might be used for issuing.

```
ss.setConfig({
  activeKey: 'newactivekey',
  username: 'newusername'
});
```

## Streamer

The following subscription methods are read only methods, they allow you to react to certain Hive and Hive Engine events on the blockchain. You do not need to pass in any keys to use these methods as they're purely read only.
These event subscriptions and contract actions are separate paths: subscriptions fire for matching operations, while contracts only run when a payload wrapper exists under `PAYLOAD_IDENTIFIER`.

**The following actions DO require calling the `start` method first to watch the blockchain**

#### Watch for transfers

```javascript
ss.onTransfer('myaccount', (op, { sender, amount, asset, memo }, blockNumber, blockId, prevBlockId, trxId, blockTime) => {
  // Fires only when op.to === 'myaccount'
});
```

#### Watch for escrow operations
```javascript
ss.onEscrowTransfer((op, blockNumber, blockId, prevBlockId, trxId, blockTime) => {
  
});

ss.onEscrowApprove((op, blockNumber, blockId, prevBlockId, trxId, blockTime) => {
  
});

ss.onEscrowDispute((op, blockNumber, blockId, prevBlockId, trxId, blockTime) => {
  
});

ss.onEscrowRelease((op, blockNumber, blockId, prevBlockId, trxId, blockTime) => {
  
});
```

#### Watch for custom JSON operations
```javascript
ss.onCustomJson((op, { sender, isSignedWithActiveKey }, blockNumber, blockId, prevBlockId, trxId, blockTime) => {
  
})
```

#### Watch for custom JSON operations (with a specific ID)
```javascript
ss.onCustomJsonId((op, { sender, isSignedWithActiveKey }, blockNumber, blockId, prevBlockId, trxId, blockTime) => {
  
}, 'your-custom-json-id');
```

#### Watch for Hive Engine custom JSON operations
```javascript
ss.onHiveEngine((contractName, contractAction, contractPayload, sender, op, blockNumber, blockId, prevBlockId, trxId, blockTime) => {
  
});
```

#### Watch for post operations
```javascript
ss.onPost((op, blockNumber, blockId, prevBlockId, trxId, blockTime) => {

});
```

#### Watch for comment operations
```javascript
ss.onComment((op, blockNumber, blockId, prevBlockId, trxId, blockTime) => {

});
```

## Actions (active key)

All of the below methods require an active key has been supplied in the constructor above called `ACTIVE_KEY`. The methods below are all promised based, so you can `await` them or use `then` to confirm a successful result.

**The following actions do NOT require calling the `start` method first to watch the blockchain**

```javascript
const ss = new Streamer({
  ACTIVE_KEY: 'youractivekey'
});
```

### Transfer Hive (HIVE or HBD)
```javascript
transferHiveTokens(from, to, amount, symbol, memo = '') {

}
```

### Transfer Hive Engine Tokens
```javascript
transferHiveEngineTokens(from, to, symbol, quantity, memo = '') {

}
```

### Transfer Hive Engine Tokens to Multiple Accounts
```javascript
transferHiveEngineTokensMultiple(from, accounts = [], symbol, memo = '', amount = '0') {

}
```

### Issue Hive Engine Tokens
```javascript
issueHiveEngineTokens(from, to, symbol, quantity, memo = '') {

}
```

### Issue Hive Engine Tokens to Multiple Accounts
```javascript
issueHiveEngineTokensMultiple(from, accounts = [], symbol, memo = '', amount = '0') {

}
```

### Escrow Operations
```javascript
escrowTransfer({
  from,
  to,
  agent,
  escrow_id,
  hive_amount = '0.000 HIVE',
  hbd_amount = '0.000 HBD',
  fee,
  ratification_deadline,
  escrow_expiration,
  json_meta
}, signingKeys?)

escrowApprove({ from, to, agent, who, escrow_id, approve }, signingKeys?)
escrowDispute({ from, to, agent, who, escrow_id }, signingKeys?)
escrowRelease({ from, to, agent, who, receiver, escrow_id, hive_amount, hbd_amount }, signingKeys?)
```

### Multisig + Authority Helpers
```javascript
broadcastOperations(operations, signingKeys?)
broadcastMultiSigOperations(operations, signingKeys)
createAuthority(keyAuths, accountAuths, weightThreshold)
updateAccountAuthorities(account, authorityUpdate, signingKeys?)
```

### Recurrent Transfers + Governance
```javascript
recurrentTransfer({ from, to, amount, memo, recurrence, executions }, signingKeys?)
createProposal({ creator, receiver, start_date, end_date, daily_pay, subject, permlink }, signingKeys?)
updateProposalVotes({ voter, proposal_ids, approve }, signingKeys?)
removeProposals({ proposal_owner, proposal_ids }, signingKeys?)
```

### Upvote/Downvote Posts
```javascript
upvote(votePercentage = '100.0', username, permlink) {

}

downvote(votePercentage = '100.0', username, permlink) {

}
```

## Contracts

Hive Stream allows you to register contract definitions that execute when a transfer memo or custom JSON operation includes a contract wrapper. The payload lives under the `PAYLOAD_IDENTIFIER` key (default: `hive_stream`).
Regular event handlers like `onTransfer` and `onCustomJson` still run for matching operations even when no contract wrapper is present.

The payload shape is:

- `contract`: the name of the contract you registered
- `action`: the action name defined in your contract
- `payload`: data passed to the action
- `meta`: optional metadata

### Writing contracts

Contracts are defined with `defineContract` + `action`. Each action can specify a trigger (`custom_json`, `transfer`, `time`, `escrow_transfer`, `escrow_approve`, `escrow_dispute`, `escrow_release`, or `recurrent_transfer`) and an optional Zod schema for payload validation.

For a full contract-building guide (payloads, context, triggers, validation, error handling, and exchange setup), see `DOCUMENTATION.md`.

### Register a contract

Register a contract definition. Registration is async so hooks can initialize state.

```javascript
import { defineContract, action } from 'hive-stream';

const MyContract = defineContract({
    name: 'mycontract',
    actions: {
        hello: action(async (payload, ctx) => {
            console.log('hello', payload, ctx.sender);
        }, { trigger: 'custom_json' })
    }
});

await streamer.registerContract(MyContract);
```

### Unregister a contract

Unregister a contract that has been registered.

```javascript
await streamer.unregisterContract('mycontract');
```

### Example Payload

```javascript
JSON.stringify({
    hive_stream: {
        contract: 'hivedice',
        action: 'roll',
        payload: { roll: 22 }
    }
})
```

This will match a registered contract called `hivedice`, run the `roll` action, and pass the payload into your handler.

### Built-in Contract Examples

The library includes several built-in contract examples in the `src/contracts` folder:

- `createDiceContract` - A dice rolling game contract
- `createCoinflipContract` - A coin flip game contract
- `createLottoContract` - A lottery-style game contract
- `createTokenContract` - A contract for token operations
- `createNFTContract` - A contract for NFT operations
- `createRpsContract` - A rock-paper-scissors game contract
- `createPollContract` - A poll/voting contract
- `createTipJarContract` - A tip jar + message board contract
- `createExchangeContract` - A basic exchange with deposits, withdrawals, balances, and order matching (SQL adapter required)
- `createAuctionHouseContract` - Auctions with reserve prices, buy-now support, and timed settlement
- `createSubscriptionContract` - Subscription plans with transfer and recurrent-transfer renewals
- `createCrowdfundContract` - Crowdfunding campaigns with milestones, finalization, and refund tracking
- `createBountyBoardContract` - Funded bounties, submissions, and award selection
- `createInvoiceContract` - Invoices with partial payments, recurring payments, and overdue sweeps
- `createSavingsContract` - Savings goals with recurring contributions and withdrawal requests
- `createBookingContract` - Reservable listings with paid booking windows and confirmations
- `createGiftCardContract` - Gift card issuance, redemption, and cancellation flows
- `createGroupBuyContract` - Threshold-based pooled purchases and participant commitments
- `createSweepstakesContract` - Paid-entry sweepstakes with deterministic winner draws
- `createDcaBotContract` - Time-based DCA bot scheduling and execution request events
- `createMultisigTreasuryContract` - Multisig vaults, proposal approvals, and execution readiness tracking

These can be imported and used as examples for building your own contracts:

```javascript
import { createDiceContract, createCoinflipContract, createLottoContract } from 'hive-stream';
```

### Example Snippets

Sample snippets for the newest contracts live in `examples/contracts/`:

- `examples/contracts/rps.ts`
- `examples/contracts/poll.ts`
- `examples/contracts/tipjar.ts`
- `examples/contracts/exchange.ts`

## Time-based Actions

It's like a cron job for your contracts. Time-based actions allow you to execute contract functions over a wide variety of different periods. Want to call a function every 3 seconds block time or want to call a function once per day? Time-based actions are an easy way to run time code.

The following example will run a contract action every 30 seconds. All you do is register a new `TimeAction` instance.

```
import { TimeAction, Streamer } from 'hive-stream';

const streamer = new Streamer({
    ACTIVE_KEY: ''
});

const testAction = new TimeAction('30s', 'test30s', 'hivedice', 'testauto');

streamer.registerAction(testAction);

streamer.start();
```

The `TimeAction` instance accepts the following values:

- timeValue - When should this action be run?
- uniqueId - A unique ID to describe your action
- contractName - The name of the contract
- contractAction - The action we are calling inside of the contract
- date - An optional final parameter that accepts a date of creation

```
new TimeAction(timeValue, uniqueId, contractName, contractAction, date)
```

### Valid time values

At the moment, the `timeValue` passed in as the first argument to `TimeAction` cannot accept just any value. However, there are many available out-of-the-box with more flexibility to come in the future.

- `3s` or `block` will run a task every block (3 seconds, approximately)
- `10s` will run a task every 10 seconds
- `30s` will run a task every 30 seconds
- `1m` or `minute` will run a task every 60 seconds (1 minute)
- `5m` will run a task every 5 minutes
- `15m` or `quarter` will run a task every 15 minutes
- `30m` or `halfhour` will run a task every 30 minutes
- `1h` or `hourly` will run a task every 60 minutes (every hour)
- `12h` or `halfday` will run a task every 12 hours (half a day)
- `24h`, `day`, or `daily` will run a task every 24 hours (day)
- `week` or `weekly` will run a task every 7 days (week)

Values will be persisted if using one of the database adapters that ship with the library.

## Adapters

The Hive Stream library supports custom adapters for various actions that take place in the library. When the library first loads, it makes a call to get the last block number or when a block is processed, storing the processed block number. This library ships with three adapters: SQLite, MongoDB, and PostgreSQL. These provide robust database storage for blockchain state and operations.

By default, Streamer uses SQLite adapter. To use a different adapter, use the `registerAdapter()` method:

### SQLite Adapter (Default)
```javascript
import { Streamer, SqliteAdapter } from 'hive-stream';

const streamer = new Streamer(config);
// SQLite is used by default, but you can explicitly register a custom SQLite database:
const adapter = new SqliteAdapter('./hive-stream.db');
await streamer.registerAdapter(adapter);
```

### MongoDB Adapter
```javascript
import { Streamer, MongodbAdapter } from 'hive-stream';

const streamer = new Streamer(config);
const adapter = new MongodbAdapter('mongodb://localhost:27017', 'hive_stream');
await streamer.registerAdapter(adapter);
```

### PostgreSQL Adapter
```javascript
import { Streamer, PostgreSQLAdapter } from 'hive-stream';

const streamer = new Streamer(config);
const adapter = new PostgreSQLAdapter({
    host: 'localhost',
    port: 5432,
    user: 'postgres',
    password: 'your_password',
    database: 'hive_stream'
});

// Or with connection string
const adapter = new PostgreSQLAdapter({
    connectionString: 'postgresql://user:pass@localhost:5432/hive_stream'
});

await streamer.registerAdapter(adapter);
```

When creating an adapter, at a minimum your adapter requires two methods: `loadState` and `saveState`. It must also extend `AdapterBase` which is exported from the package.

You can see a few adapters that ship with Hive Stream in the `src/adapters` directory.

## Permanently running with PM2

Simply copy the `ecosystem.config.js` file from this repository into your application, globally install `pm2` via `npm install pm2 -g` and change the `script` value below to reflect the main file of your application.

**ecosystem.config.js**

```
module.exports = {
  apps: [
    {
      name: 'hive-stream',
      script: 'index.js',
      ignore_watch: ['node_modules'],
      env: {
        NODE_ENV: 'development'
      },
      env_production: {
        NODE_ENV: 'production'
      }
    }
  ]
```
