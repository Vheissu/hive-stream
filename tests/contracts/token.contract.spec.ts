import { createTokenContract } from '../../src/contracts/token.contract';
import { Streamer } from '../../src/streamer';
import { createMockAdapter } from '../helpers/mock-adapter';

const createContext = (streamer: Streamer, adapter: any, sender: string) => ({
    trigger: 'custom_json' as const,
    streamer,
    adapter,
    config: streamer['config'],
    block: { number: 123, id: 'block123', previousId: 'prevblock123', time: new Date() },
    transaction: { id: 'txn123' },
    sender,
    customJson: { id: 'hivestream', json: {}, isSignedWithActiveKey: true }
});

describe('TokenContract', () => {
    let streamer: Streamer;
    let adapter: any;
    let contract: ReturnType<typeof createTokenContract>;

    beforeEach(async () => {
        streamer = new Streamer();
        adapter = createMockAdapter();
        await streamer.registerAdapter(adapter);
        contract = createTokenContract();
        await streamer.registerContract(contract);
    });

    afterEach(async () => {
        await streamer.stop();
    });

    test('Creates a token', async () => {
        const ctx = createContext(streamer, adapter, 'alice');
        const payload = {
            symbol: 'TEST',
            name: 'Test Token',
            url: 'https://example.com',
            precision: 3,
            maxSupply: '1000000'
        };

        await contract.actions.createToken.handler(payload, ctx);

        expect(adapter.queries.join(' ')).toContain('INSERT INTO tokens');
        expect(adapter.events.length).toBeGreaterThan(0);
        expect(adapter.events[0].action).toBe('createToken');
    });

    test('Rejects duplicate token symbols', async () => {
        adapter.setTestContext({ existingToken: 'TEST' });
        const ctx = createContext(streamer, adapter, 'alice');
        const payload = {
            symbol: 'TEST',
            name: 'Test Token',
            maxSupply: '1000000'
        };

        await expect(contract.actions.createToken.handler(payload, ctx))
            .rejects
            .toThrow('Token with symbol TEST already exists');
    });

    test('Prevents non-creators from issuing tokens', async () => {
        const ctx = createContext(streamer, adapter, 'bob');
        const payload = {
            symbol: 'TEST',
            to: 'carol',
            amount: '100'
        };

        await expect(contract.actions.issueTokens.handler(payload, ctx))
            .rejects
            .toThrow('Only the token creator can issue new tokens');
    });

    test('Prevents transfers with insufficient balance', async () => {
        adapter.setTestContext({ insufficientBalance: true });
        const ctx = createContext(streamer, adapter, 'alice');
        const payload = {
            symbol: 'TEST',
            to: 'bob',
            amount: '9999'
        };

        await expect(contract.actions.transferTokens.handler(payload, ctx))
            .rejects
            .toThrow('Insufficient balance');
    });
});
