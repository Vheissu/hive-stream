import { PrivateKey } from '@hiveio/dhive';
import { createLottoContract } from './../../src/contracts/lotto.contract';
import { TimeAction } from '../../src';
import { Streamer } from '../../src/streamer';
import { createTestStreamer, TestStreamer } from '../../src/testing';
import { createMockAdapter } from '../helpers/mock-adapter';

const ACTIVE_KEY = PrivateKey.fromSeed('hive-stream lotto spec').toString();

describe('Lotto Contract', () => {
    let sut: Streamer;
    let contract: ReturnType<typeof createLottoContract>;
    let adapter: any;

    beforeEach(async () => {
        sut = new Streamer();
        adapter = createMockAdapter();
        await sut.registerAdapter(adapter);

        contract = createLottoContract({ account: 'beggars', name: 'testlotto' });
    });

    afterEach(async () => {
        await sut.stop();
    });

    test('Registers the lotto contract', async () => {
        await sut.registerContract(contract);

        const findContract = sut['contracts'].find(c => c.name === 'testlotto');
        expect(findContract).not.toBeUndefined();
    });
});

describe('Lotto Contract on a fresh SQLite database', () => {
    let ts: TestStreamer;

    afterEach(async () => {
        await ts?.stop();
    });

    async function setup(options: Parameters<typeof createLottoContract>[0] = {}) {
        ts = await createTestStreamer({ username: 'lottohouse', activeKey: ACTIVE_KEY });
        ts.client.setAccount('lottohouse', { balance: '1000.000 HIVE' });
        await ts.streamer.registerContract(createLottoContract({
            cost: 1,
            minEntriesHourly: 2,
            hourlyWinnersPick: 1,
            feePercentage: 10,
            ...options
        }));
    }

    test('creates its tables on registration', async () => {
        await setup();

        const tables = await ts.adapter.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'lotto_%' ORDER BY name");
        expect(tables.map((row: any) => row.name)).toEqual(['lotto_draws', 'lotto_settings']);

        const [settings] = await ts.adapter.query('SELECT contract, enabled FROM lotto_settings');
        expect(settings).toEqual({ contract: 'hivelotto', enabled: 1 });
    });

    test('buys tickets into one active draw with JSON entries', async () => {
        await setup();

        const first = await ts.contractTransfer({ from: 'alice', to: 'lottohouse', amount: '1.000 HIVE', contract: 'hivelotto', action: 'buy', payload: { type: 'hourly' } });
        await ts.contractTransfer({ from: 'bob', to: 'lottohouse', amount: '1.000 HIVE', contract: 'hivelotto', action: 'buy', payload: { type: 'hourly' } });

        const draws = await ts.adapter.query('SELECT draw_id, type, status, entries FROM lotto_draws');
        expect(draws).toHaveLength(1);
        expect(draws[0].draw_id).toBe(`hivelotto:hourly:${first.transactionId}:0`);
        expect(draws[0].status).toBe('active');
        expect(JSON.parse(draws[0].entries).map((entry: any) => entry.account)).toEqual(['alice', 'bob']);
    });

    test('runs the hourly draw end to end and pays the winner from the house account', async () => {
        await setup({ fairness: true });
        await ts.streamer.registerAction(new TimeAction('1h', 'lotto-hourly', 'hivelotto', 'drawHourlyLottery'));

        await ts.contractTransfer({ from: 'alice', to: 'lottohouse', amount: '1.000 HIVE', contract: 'hivelotto', action: 'buy', payload: { type: 'hourly' } });
        await ts.contractTransfer({ from: 'bob', to: 'lottohouse', amount: '1.000 HIVE', contract: 'hivelotto', action: 'buy', payload: { type: 'hourly' } });

        await ts.advanceTime('1h');
        await ts.advanceBlocks(1);

        const [draw] = await ts.adapter.query('SELECT status, winners, fairness FROM lotto_draws');
        expect(draw.status).toBe('completed');

        const winners = JSON.parse(draw.winners);
        expect(winners).toHaveLength(1);
        expect(['alice', 'bob']).toContain(winners[0]);
        expect(JSON.parse(draw.fairness)).toEqual(expect.objectContaining({ serverSeedHash: expect.any(String) }));

        // Pot 2.000, 10% fee => 0.200 fee to the house (same account, so no transfer) and 1.800 to the winner.
        const payouts = ts.client.broadcasts.filter((broadcast) => JSON.stringify(broadcast.data).includes('Congratulations'));
        expect(payouts).toHaveLength(1);
        expect(JSON.stringify(payouts[0].data)).toContain('1.800 HIVE');
        expect(JSON.stringify(payouts[0].data)).toContain('"from":"lottohouse"');
    });
});
