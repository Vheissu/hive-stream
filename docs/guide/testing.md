# Testing Your App

`hive-stream/testing` runs a real `Streamer` against simulated infrastructure: blocks come from an in-memory provider, broadcasts are captured instead of sent, and state lives in an in-memory SQLite database. Nothing touches the network or disk — tests are fast, deterministic, and need no keys.

```ts
import { createTestStreamer, hive } from 'hive-stream/testing';

const ts = await createTestStreamer({ username: 'myapp' });
await ts.streamer.registerContract(myContract);

await ts.contractTransfer({
    from: 'alice',
    contract: 'mygame',
    action: 'play',
    payload: { choice: 'heads' },
    amount: hive(1)
});

expect(ts.outgoingTransfers).toEqual([
    { from: 'myapp', to: 'alice', amount: '2.000 HIVE', memo: 'You won!' }
]);

await ts.stop();
```

`ts.streamer` is a genuine `Streamer` — the same dispatch, validation, persistence, and scheduling paths that run in production.

## Options

`createTestStreamer` accepts every regular config option, plus:

| Option | Description |
| --- | --- |
| `adapter` | Storage adapter. Defaults to in-memory SQLite, so built-in SQL contracts work out of the box. |
| `startTime` | Timestamp of the simulated chain's first block (defaults to now). |
| `blockIntervalMs` | Simulated block spacing (defaults to 3000, like mainnet). |

If your handlers broadcast, set any valid-format `activeKey` — nothing is ever sent.

## Driving the chain

Each method mints a block with your operation and processes it before resolving — no waiting, no polling:

```ts
// Contract payload in a transfer memo
await ts.contractTransfer({ from, contract, action, payload, amount, to });

// Contract payload in custom JSON (posting authority by default)
await ts.contractJson('alice', { contract, action, payload, activeKey: true });

// Plain operations, for subscriptions
await ts.transfer('alice', 'myapp', hive(1), 'plain memo');
await ts.customJson('bob', { follow: 'alice' }, { id: 'follow' });

// Anything else, as raw operations
await ts.sendOperations([['transfer', { from: 'a', to: 'b', amount: '1.000 HIVE', memo: '' }]]);
```

## Time travel

TimeActions fire against simulated chain time:

```ts
import { TimeAction } from 'hive-stream';

await ts.streamer.registerAction(new TimeAction('1h', 'draw', 'lotto', 'draw', {}, ts.currentTime));

await ts.advanceTime('1h');    // the action fires now
await ts.advanceBlocks(5);     // five empty blocks at 3s spacing
```

`advanceTime` accepts milliseconds or `'30s'`, `'5m'`, `'1h'`, `'2d'`, `'1w'`.

## Asserting on results

```ts
ts.outgoingTransfers;                  // transfers your handlers attempted
ts.broadcasts;                         // every captured broadcast, typed by kind
await ts.getEvents();                  // contract events recorded via the adapter
await ts.adapter.query('SELECT ...');  // contract tables, directly
```

## Stubbing chain reads

Handlers that read the chain get fixture data from the fake client:

```ts
ts.client.onCall('get_order_book', { bids: [], asks: [] });
ts.client.onCall('condenser_api.get_content', (params) => ({ author: params[0] }));
ts.client.setAccount('alice', { balance: '100.000 HIVE' });
```

## Jest patterns

```ts
describe('my contract', () => {
    let ts: TestStreamer;

    beforeEach(async () => {
        ts = await createTestStreamer({ username: 'myapp' });
        await ts.streamer.registerContract(createMyContract());
    });

    afterEach(async () => {
        await ts.stop();
    });

    test('pays out winners', async () => {
        await ts.contractTransfer({ from: 'alice', contract: 'mygame', action: 'play', amount: hive(1) });
        expect(ts.outgoingTransfers).toHaveLength(1);
    });
});
```

## Building blocks

The pieces compose individually when you need lower-level control:

- `MemoryBlockProvider` — an in-memory `BlockProvider`; use it with any streamer via the `blockProvider` config option.
- `FakeHiveClient` — the broadcast recorder / read stubber; inject into any streamer via the `client` config option.
- `streamer.init()` + `streamer.processPendingBlocks()` — timer-free block processing on any streamer, with any provider.
