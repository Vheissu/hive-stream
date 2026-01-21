import { Streamer } from '../../src/streamer';
import { SqliteAdapter } from '../../src/adapters/sqlite.adapter';
import { createExchangeContract } from '../../src/contracts/exchange.contract';

describe('Exchange Contract', () => {
    let streamer: Streamer;
    let adapter: SqliteAdapter;
    let contract: ReturnType<typeof createExchangeContract>;

    beforeEach(async () => {
        streamer = new Streamer({
            JSON_ID: 'hivestream',
            PAYLOAD_IDENTIFIER: 'hive_stream'
        });

        adapter = new SqliteAdapter(':memory:');
        await streamer.registerAdapter(adapter);

        contract = createExchangeContract({ name: 'exchange' });
        await streamer.registerContract(contract);
    });

    afterEach(async () => {
        await streamer.stop();
    });

    const baseContext = (trigger: 'custom_json' | 'transfer' | 'time', sender: string) => ({
        trigger,
        streamer,
        adapter,
        config: streamer['config'],
        block: { number: 100, id: 'block', previousId: 'prev', time: new Date() },
        transaction: { id: `trx-${trigger}-${sender}` },
        sender,
        customJson: trigger === 'custom_json' ? { id: 'hivestream', json: {}, isSignedWithActiveKey: true } : undefined,
        transfer: trigger === 'transfer' ? { from: sender, to: 'exchange', rawAmount: '', amount: '', asset: '', memo: '' } : undefined
    });

    test('Deposits, places orders, and matches', async () => {
        await contract.actions.createPair.handler({ base: 'HIVE', quote: 'HBD' }, baseContext('custom_json', 'alice'));

        const aliceDepositContext = baseContext('transfer', 'alice');
        aliceDepositContext.transfer.rawAmount = '100.000 HBD';
        aliceDepositContext.transfer.amount = '100.000';
        aliceDepositContext.transfer.asset = 'HBD';
        await contract.actions.deposit.handler({}, aliceDepositContext);

        const bobDepositContext = baseContext('transfer', 'bob');
        bobDepositContext.transfer.rawAmount = '10.000 HIVE';
        bobDepositContext.transfer.amount = '10.000';
        bobDepositContext.transfer.asset = 'HIVE';
        await contract.actions.deposit.handler({}, bobDepositContext);

        await contract.actions.placeOrder.handler({
            side: 'buy',
            base: 'HIVE',
            quote: 'HBD',
            price: '2',
            amount: '5'
        }, baseContext('custom_json', 'alice'));

        await contract.actions.placeOrder.handler({
            side: 'sell',
            base: 'HIVE',
            quote: 'HBD',
            price: '2',
            amount: '5'
        }, baseContext('custom_json', 'bob'));

        await contract.actions.matchOrders.handler({ base: 'HIVE', quote: 'HBD', limit: 10, snapshot: true, depth: 20 }, baseContext('time', 'system'));

        const aliceHive = await adapter.query('SELECT available, locked FROM exchange_balances WHERE account = ? AND asset = ?', ['alice', 'HIVE']);
        const bobHbd = await adapter.query('SELECT available, locked FROM exchange_balances WHERE account = ? AND asset = ?', ['bob', 'HBD']);

        expect(aliceHive[0].available).toBe('4.995');
        expect(bobHbd[0].available).toBe('9.980');

        const snapshots = await adapter.query(
            'SELECT bids, asks FROM exchange_orderbook_snapshots WHERE base_asset = ? AND quote_asset = ?',
            ['HIVE', 'HBD']
        );
        expect(snapshots.length).toBeGreaterThan(0);
    });
});
