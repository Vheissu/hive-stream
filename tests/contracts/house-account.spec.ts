import {
    createCoinflipContract,
    createDiceContract,
    createExchangeContract,
    createLottoContract,
    createRouletteContract,
    createRpsContract,
    SqliteAdapter,
    Streamer
} from '../../src';
import { FakeHiveClient, MemoryBlockProvider } from '../../src/testing';

// House accounts used to default to the maintainer's personal account. They
// now come from options.account or the streamer username, and registration
// fails loudly when neither is set.
const factories: Array<[string, (options: any) => any]> = [
    ['createDiceContract', createDiceContract],
    ['createCoinflipContract', createCoinflipContract],
    ['createRpsContract', createRpsContract],
    ['createRouletteContract', createRouletteContract],
    ['createLottoContract', createLottoContract],
    ['createExchangeContract', createExchangeContract]
];

async function createStreamer(username?: string): Promise<Streamer> {
    const streamer = new Streamer({
        ...(username ? { username } : {}),
        blockProvider: new MemoryBlockProvider(),
        client: new FakeHiveClient().asClient()
    });

    await streamer.registerAdapter(new SqliteAdapter(':memory:'));
    return streamer;
}

describe('built-in contract house accounts', () => {
    test.each(factories)('%s refuses to register without an account or streamer username', async (name, factory) => {
        const streamer = await createStreamer();

        await expect(streamer.registerContract(factory({}))).rejects.toThrow(`${name}: set options.account or the streamer username`);
        await streamer.stop();
    });

    // Lotto is covered separately: it never created its SQL tables (fixed next).
    test.each(factories.filter(([name]) => name !== 'createLottoContract'))('%s falls back to the streamer username', async (_name, factory) => {
        const streamer = await createStreamer('myhouse');

        await expect(streamer.registerContract(factory({}))).resolves.toBeUndefined();
        await streamer.stop();
    });

    test('an explicit account wins over the streamer username and is used for payouts', async () => {
        const streamer = await createStreamer('myhouse');
        const contract = createRpsContract({ account: 'explicit-house' });
        await streamer.registerContract(contract);

        const transferSpy = jest.spyOn(streamer, 'transferHiveTokens').mockResolvedValue({} as any);
        jest.spyOn(streamer, 'getTransaction').mockResolvedValue({} as any);
        jest.spyOn(streamer, 'verifyTransfer').mockResolvedValue(true as any);

        await contract.actions.play.handler({ move: 'rock' } as any, {
            trigger: 'transfer',
            streamer,
            adapter: streamer.getAdapter(),
            config: streamer.getConfig(),
            block: { number: 1, id: 'b1', previousId: 'b0', time: new Date('2026-01-01T00:00:00Z') },
            transaction: { id: 'trx-1', operationIndex: 0 },
            sender: 'alice',
            transfer: { from: 'alice', to: 'explicit-house', rawAmount: '0.001 HIVE', amount: '0.001', asset: 'HIVE', memo: '' }
        } as any);

        expect(transferSpy).toHaveBeenCalled();
        expect(transferSpy.mock.calls.every((call) => call[0] === 'explicit-house')).toBe(true);
        await streamer.stop();
    });
});
