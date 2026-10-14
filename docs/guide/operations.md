# Broadcasting Operations

Write operations are promise-based methods on the streamer. Most require an `activeKey`; social operations use the `postingKey`. None require `start()` — you can use a streamer purely as a write client.

## Transfers and tokens

```ts
await streamer.transferHiveTokens('myapp', 'alice', '1.000', 'HIVE', 'memo');
await streamer.transferHiveTokensMultiple('myapp', ['alice', 'bob'], '1.000', 'HIVE');
await streamer.burnHiveTokens('myapp', '0.500', 'HIVE', 'burn memo');

// Hive Engine tokens
await streamer.transferHiveEngineTokens('myapp', 'alice', 'BEE', '1.234', 'memo');
await streamer.issueHiveEngineTokens('myapp', 'alice', 'MYTOKEN', '100');
await streamer.stakeEngineTokens('myapp', 'alice', 'MYTOKEN', '50');
```

## Chainable builders

Every common operation has a fluent builder under `streamer.ops`:

```ts
await streamer.ops
    .transfer()
    .from('alice').to('bob')
    .hive(1.25)
    .memo('Builder transfer')
    .send();

await streamer.ops
    .createProposal()
    .creator('alice').receiver('treasury')
    .startDate(new Date('2026-04-01')).endDate(new Date('2026-05-01'))
    .dailyHbd(12.5)
    .subject('Proposal').permlink('proposal')
    .send();

await streamer.ops.upvote().author('bob').permlink('my-post').weight(25).send();
await streamer.ops.voteProposals().voter('alice').ids(1, 2, 3).approve().send();
await streamer.ops.transferEngine().from('alice').to('bob').symbol('BEE').quantity('1.23').send();
```

Batch multiple operations into one transaction:

```ts
await streamer.batch()
    .transfer('myapp', 'alice', '1.000 HIVE', 'thanks')
    .customJson('myapp-log', { event: 'paid', to: 'alice' }, 'myapp')   // posting auth
    .vote('myapp', 'alice', 'her-post', 10000)
    .send();
```

## Social and account operations

```ts
await streamer.upvote('100.0', 'author', 'permlink');
await streamer.follow('myapp', 'alice');
await streamer.reblog('myapp', 'author', 'permlink');
await streamer.updateProfile('myapp', { name: 'My App', about: '...' });
await streamer.claimRewards('myapp', '0.000 HIVE', '0.100 HBD', '100.000000 VESTS');
await streamer.witnessVote('myapp', 'witness', true);
```

## Staking and savings

```ts
await streamer.powerUp('myapp', 'myapp', '10.000');
await streamer.powerDown('myapp', '1000.000000 VESTS');
await streamer.delegateVestingShares('myapp', 'alice', '1000.000000 VESTS');
await streamer.transferToSavings('myapp', 'myapp', '10.000', 'HBD');
await streamer.convert('myapp', '10.000');
```

## Escrow, multisig, governance

```ts
await streamer.escrowTransfer({ from, to, agent, escrow_id, hbd_amount, fee, ratification_deadline, escrow_expiration, json_meta });
await streamer.escrowApprove({ from, to, agent, who, escrow_id, approve: true });
await streamer.escrowRelease({ from, to, agent, who, receiver, escrow_id, hive_amount, hbd_amount });

await streamer.broadcastOperations(operations, signingKeys);
await streamer.broadcastMultiSigOperations(operations, [key1, key2]);
await streamer.updateAccountAuthorities('myapp', authorityUpdate);

await streamer.recurrentTransfer({ from, to, amount, memo, recurrence, executions });
await streamer.createProposal({ creator, receiver, start_date, end_date, daily_pay, subject, permlink });
```

Most write methods accept an optional trailing `signingKeys` parameter to sign with keys other than the configured ones.

## Posting authority

```ts
await streamer.hasPostingAuth('user', 'myapp');     // has `user` granted myapp posting auth?
await streamer.grantPostingAuth('user', 'myapp');
await streamer.revokePostingAuth('user', 'myapp');
```
