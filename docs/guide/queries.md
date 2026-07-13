# Querying the Chain

The `streamer.query` namespace covers chain reads without leaving the library — no keys required, automatic node failover included.

## Chain state

```ts
await streamer.query.getDynamicGlobalProperties();
await streamer.query.getChainProperties();
await streamer.query.getCurrentMedianHistoryPrice();
await streamer.query.getRewardFund();
await streamer.query.getConfig();
```

## Accounts

```ts
await streamer.getAccount('alice');
await streamer.getAccounts(['alice', 'bob']);
await streamer.query.lookupAccounts('ali', 10);
await streamer.query.getAccountHistory('alice', -1, 100);
await streamer.query.getRCMana('alice');       // resource credits
await streamer.query.getVPMana('alice');       // voting power
await streamer.query.getAccountNotifications('alice');
```

Blockchain helpers convert raw values into useful ones:

```ts
Utils.getReputationScore(account.reputation);   // e.g. 72.4
// VESTS ↔ HP conversion and profile metadata parsing are also exported
```

## Content and social graph

```ts
await streamer.query.getContent('author', 'permlink');
await streamer.query.getContentReplies('author', 'permlink');
await streamer.query.getDiscussions('trending', { tag: 'hive', limit: 20 });
await streamer.query.getBlog('alice');
await streamer.query.getFeed('alice');
await streamer.query.getTrending();
await streamer.query.getActiveVotes('author', 'permlink');

await streamer.query.getFollowers('alice');
await streamer.query.getFollowing('alice');
await streamer.query.getFollowCount('alice');
await streamer.query.getCommunity('hive-167922');
```

## Market, witnesses, governance

```ts
await streamer.query.getOrderBook(50);
await streamer.query.getOpenOrders('alice');

await streamer.query.getWitnessByAccount('witness');
await streamer.query.getWitnessesByVote('', 30);

await streamer.query.getProposals({ start: [], limit: 10 });
await streamer.query.getConversionRequests('alice');
await streamer.query.getSavingsWithdrawFrom('alice');
```

## Blocks and transactions

```ts
await streamer.query.getBlock(89000000);
await streamer.query.getBlockHeader(89000000);
await streamer.query.getOperations(89000000);
await streamer.query.findTransaction('trxid');
await streamer.getTransaction(blockNumber, trxId);
await streamer.getAccountTransfers('alice');
```

## Hive Engine

The `streamer.engine` namespace queries the Hive Engine sidechain — token balances, and more:

```ts
await streamer.query.getTokenBalances('alice');
```

## Exchange rates

`HiveRates` fetches HIVE/HBD fiat rates with pluggable exchange sources (CoinGecko included):

```ts
import { HiveRates } from 'hive-stream';

const rates = new HiveRates();
await rates.fetchRates();
rates.fiatToHiveRate('USD');
```
