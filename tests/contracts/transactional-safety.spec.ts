import { Streamer } from '../../src/streamer';
import { SqliteAdapter } from '../../src/adapters/sqlite.adapter';
import { createTokenContract } from '../../src/contracts/token.contract';
import { createExchangeContract } from '../../src/contracts/exchange.contract';

const createCustomJsonContext = (streamer: Streamer, adapter: SqliteAdapter, sender: string) => ({
    trigger: 'custom_json' as const,
    streamer,
    adapter,
    config: streamer['config'],
    block: { number: 123, id: 'block-123', previousId: 'block-122', time: new Date() },
    transaction: { id: `trx-${sender}-${Date.now()}` },
    sender,
    customJson: { id: streamer['config'].JSON_ID, json: {}, isSignedWithActiveKey: true }
});

describe('Contract transactional safety', () => {
    test('rolls back token transfers when the final event write fails', async () => {
        const streamer = new Streamer({ debugMode: false });
        const adapter = new SqliteAdapter(':memory:');
        const contract = createTokenContract();

        await streamer.registerAdapter(adapter);
        await streamer.registerContract(contract);

        const aliceContext = createCustomJsonContext(streamer, adapter, 'alice');

        await contract.actions.createToken.handler({
            symbol: 'TEST',
            name: 'Test Token',
            precision: 3,
            maxSupply: '1000'
        }, aliceContext);

        await contract.actions.issueTokens.handler({
            symbol: 'TEST',
            to: 'alice',
            amount: '100'
        }, aliceContext);

        jest.spyOn(adapter, 'addEvent').mockImplementationOnce(async () => {
            throw new Error('event persistence failed');
        });

        await expect(contract.actions.transferTokens.handler({
            symbol: 'TEST',
            to: 'bob',
            amount: '10'
        }, aliceContext)).rejects.toThrow('event persistence failed');

        const aliceBalance = await adapter.query(
            'SELECT balance FROM token_balances WHERE account = ? AND symbol = ?',
            ['alice', 'TEST']
        );
        const bobBalance = await adapter.query(
            'SELECT balance FROM token_balances WHERE account = ? AND symbol = ?',
            ['bob', 'TEST']
        );
        const transfers = await adapter.query(
            'SELECT from_account, to_account, amount FROM token_transfers ORDER BY id ASC'
        );

        expect(aliceBalance[0].balance).toBe('100');
        expect(bobBalance.length).toBe(0);
        expect(transfers).toHaveLength(1);
        expect(transfers[0]).toEqual(expect.objectContaining({
            from_account: 'null',
            to_account: 'alice',
            amount: '100'
        }));

        await streamer.stop();
    });

    test('rolls back exchange order placement when the final event write fails', async () => {
        const streamer = new Streamer({
            jsonId: 'hivestream',
            payloadIdentifier: 'hive_stream',
            debugMode: false
        });
        const adapter = new SqliteAdapter(':memory:');
        const contract = createExchangeContract({ name: 'exchange' });

        await streamer.registerAdapter(adapter);
        await streamer.registerContract(contract);

        const aliceContext = createCustomJsonContext(streamer, adapter, 'alice');
        const depositContext = {
            ...aliceContext,
            trigger: 'transfer' as const,
            transaction: { id: 'trx-deposit-alice' },
            transfer: {
                from: 'alice',
                to: 'exchange',
                rawAmount: '100.000 HBD',
                amount: '100.000',
                asset: 'HBD',
                memo: ''
            }
        };

        await contract.actions.createPair.handler({ base: 'HIVE', quote: 'HBD' }, aliceContext);
        await contract.actions.deposit.handler({}, depositContext);

        jest.spyOn(adapter, 'addEvent').mockImplementationOnce(async () => {
            throw new Error('event persistence failed');
        });

        await expect(contract.actions.placeOrder.handler({
            side: 'buy',
            base: 'HIVE',
            quote: 'HBD',
            price: '2',
            amount: '5'
        }, aliceContext)).rejects.toThrow('event persistence failed');

        const balanceRows = await adapter.query(
            'SELECT available, locked FROM exchange_balances WHERE account = ? AND asset = ?',
            ['alice', 'HBD']
        );
        const orderRows = await adapter.query(
            'SELECT id FROM exchange_orders WHERE account = ?',
            ['alice']
        );

        expect(balanceRows[0]).toEqual(expect.objectContaining({
            available: '100.000',
            locked: '0.000'
        }));
        expect(orderRows).toHaveLength(0);

        await streamer.stop();
    });

});
