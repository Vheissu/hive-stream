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

If the app has a shared contract spec, drive tests with the same operation a browser or backend would build:

```ts
import { createContractCaller } from 'hive-stream/client';

const calls = createContractCaller(myContractSpec);
await ts.sendOperations([
    calls.customJson('alice', 'submit', { count: 3 })
]);
```

Bad action names, triggers, authority, and schema values fail before a simulated block is created.

## Options

`createTestStreamer` accepts every regular config option, plus:

| Option | Description |
| --- | --- |
| `adapter` | Storage adapter. Defaults to in-memory SQLite, so built-in SQL contracts work out of the box. |
| `startTime` | Timestamp of the simulated chain's first block (defaults to now). |
| `blockIntervalMs` | Simulated block spacing (defaults to 3000, like mainnet). |
| `irreversibleLag` | How many blocks the simulated last irreversible block trails head (defaults to 0). |

Handlers that broadcast work without keys: the test streamer uses throwaway active and posting keys unless you pass your own (or `env: true`), and nothing is ever sent.

Built-in games that re-read their transaction from the chain (dice, coinflip, roulette, rps, lotto) get it from the simulated blocks. Give the house account a bankroll with `ts.client.setAccount('myhouse', { balance: '1000.000 HIVE' })`, or bets are refunded because the house can't cover them.

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
