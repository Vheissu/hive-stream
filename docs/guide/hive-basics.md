# Hive Basics

What you need to know about the Hive blockchain before building on it. If you already run a Hive app, skip to [Getting Started](./getting-started).

## Accounts and keys

A Hive account is a name, not an address: `alice`, `my-game`, `hive-167922`. Names are 3 to 16 lowercase characters, digits, dots and dashes. Creating one costs a small fee or an account creation token; services such as [signup.hive.io](https://signup.hive.io) list the options.

Every account has four key pairs. Each one is an *authority* that can sign a different set of operations:

| Key | What it signs | Hive Stream needs it for |
| --- | --- | --- |
| **Posting** | Posts, comments, votes, follows, reblogs, and `custom_json` with posting authority | `postingKey`: replies, votes, posting-authority custom JSON |
| **Active** | Transfers, power up/down, escrow, market orders, Hive Engine operations, `custom_json` with active authority | `activeKey`: every transfer your contracts send |
| **Owner** | Changing the other keys, recovering the account | Never. Keep it offline |
| **Memo** | Encrypting and decrypting transfer memos | Optional: reading encrypted memos |

Private keys start with `5`, public keys with `STM`. An app that only reads the chain needs no keys at all. An app that pays out needs the active key of the account it pays from, which is why that account should be a dedicated one holding only what the app needs. See [Security](./security).

## Operations, transactions and blocks

Users act on Hive by broadcasting *operations* (`transfer`, `custom_json`, `comment`, `vote`, …), bundled into a signed *transaction*. Witnesses produce one *block* every 3 seconds containing those transactions. Hive Stream reads blocks in order and hands each operation to your subscriptions and contracts.

Two operations carry data for apps:

- **`transfer`** moves HIVE or HBD from one account to another, with a memo of up to 2048 bytes. A memo starting with `#` is encrypted for the recipient's memo key. Amounts have exactly three decimals: `1.000 HIVE`, `0.500 HBD`.
- **`custom_json`** carries an arbitrary JSON string (up to 8192 bytes) under an *id* (up to 32 characters). It moves no money. The `id` is how apps find their own operations in the stream: Hive Engine uses `ssc-mainnet-hive`, Hive Stream apps use `hivestream` by default (`jsonId` in config). An operation is signed either with posting authority (`required_posting_auths`) or active authority (`required_auths`); your contracts can require the active one with `requiresActiveKey`.

A contract call in Hive Stream is a wrapped payload in either place:

```json
{"hive_stream":{"contract":"guestbook","action":"sign","payload":{"message":"hello"}}}
```

As a transfer memo it is a *paid* call (the transfer is the payment); as `custom_json` with id `hivestream` it is a free one. The wrapper key (`hive_stream`) is `payloadIdentifier` in config.

## Irreversibility

A block is *irreversible* once enough witnesses have built on it; before that a fork can replace it. On Hive this usually takes one or two blocks. Hive Stream only processes irreversible blocks by default (`streamMode: 'irreversible'`), so nothing your app reacts to can be undone. `streamMode: 'head'` follows the newest block for lower latency and handles forks when they happen. See [Streaming](./streaming#irreversible-vs-head-streaming).

## Resource Credits

Hive has no transaction fees. Each account has *Resource Credits* (RC) that regenerate over time, in proportion to its Hive Power (staked HIVE). Every operation spends some, and an account with no RC left cannot broadcast until it regenerates. Two things follow for an app:

- Your app account needs Hive Power, or an RC delegation, to broadcast its replies and payouts. A few hundred HP covers a busy app. `streamer.query.getRCMana('myapp')` shows the current level.
- Your users need RC too. New accounts have very little, so a first-time user may not be able to send a `custom_json` operation every few seconds.

## Hive Engine

[Hive Engine](https://hive-engine.com) is a sidechain for custom tokens, run as a layer on top of Hive: every Hive Engine action is a `custom_json` operation with id `ssc-mainnet-hive` that the sidechain nodes execute. A token transfer the sender cannot fund is still a valid Hive operation; it only fails on the sidechain. That is why `onHiveEngine` asks the sidechain whether it executed the transaction before delivering it, and why your app must never credit a token payment from the raw `custom_json`. Token balances, orders and transfers go through `streamer.engine` and `streamer.ops`; see [Querying the Chain](./queries) and [Broadcasting Operations](./operations).

## API nodes

Apps read the chain through public API nodes (`https://api.hive.blog`, `https://api.openhive.network`, …). They are free, run by witnesses and the community, and rate limited. Hive Stream fails over between the nodes in `apiNodes` and times each request out after `apiTimeoutMs`. For a production app that catches up on hours of blocks, or needs to stay up when the public nodes are busy, run your own node, or read blocks straight from a [HAF](https://gitlab.syncad.com/hive/haf) database with `HafProvider`. Keep `catchUpBatchSize` modest on public nodes.

## Testing without the real chain

Hive Stream's [testing kit](./testing) runs your contracts against simulated blocks, offline, with every broadcast captured. That is where development and CI belong. When you need the real thing, Hive has a public testnet (`https://testnet.openhive.network`, chain id published on its status page); to use it, inject a dhive `Client` configured with that chain id through the `client` config option. Mainnet is also fine for a final check with small amounts, because a transfer of `0.001 HIVE` costs nothing but RC.

## Where to look things up

- [developers.hive.io](https://developers.hive.io): operation reference, API docs, tutorials
- [hiveblocks.com](https://hiveblocks.com) and [hivehub.dev](https://hivehub.dev): block explorers, handy for checking what your app broadcast
- [Hive Keychain](https://hive-keychain.com): the browser wallet most frontends use to sign operations. The [client entry point](./contract-calls) builds the operations Keychain signs
