import { PrivateKey } from '@hiveio/dhive';
import { createLottoContract } from './../../src/contracts/lotto.contract';
import { AdapterBase } from '../../src/adapters/base.adapter';
import { TimeAction } from '../../src';
import { Streamer } from '../../src/streamer';
import { createTestStreamer, TestStreamer } from '../../src/testing';
import { createMockAdapter } from '../helpers/mock-adapter';

const ACTIVE_KEY = PrivateKey.fromSeed('hive-stream lotto spec').toString();

/** A minimal document store standing in for MongoDB. */
class MemoryDocumentAdapter extends AdapterBase {
    public collections = new Map<string, any[]>();
    private nextId = 1;
    private state: any = { lastBlockNumber: 0 };

    public override async loadState(): Promise<any> {
        return this.state;
    }

    public override async saveState(data: any): Promise<boolean> {
        this.state = { ...this.state, ...data };
        return true;
    }

    private docs(table: string): any[] {
        if (!this.collections.has(table)) {
            this.collections.set(table, []);
        }

        return this.collections.get(table)!;
    }

    private matches(doc: any, query: Record<string, any>): boolean {
        return Object.entries(query).every(([key, value]) => doc[key] === value);
    }

    public override async find(table: string, query: Record<string, any>): Promise<any[]> {
        return this.docs(table).filter((doc) => this.matches(doc, query)).map((doc) => structuredClone(doc));
    }

    public override async findOne(table: string, query: Record<string, any>): Promise<any> {
        const [doc] = await this.find(table, query);
        return doc ?? null;
    }

    public override async insert(table: string, data: any): Promise<any> {
        const doc = { _id: `doc-${this.nextId++}`, ...structuredClone(data) };
        this.docs(table).push(doc);
        return true;
    }

    public override async replace(table: string, query: Record<string, any>, data: any): Promise<any> {
        const docs = this.docs(table);
        const index = docs.findIndex((doc) => this.matches(doc, query));

        if (index >= 0) {
            docs[index] = { ...structuredClone(data), _id: docs[index]._id };
        }

        return true;
    }
}

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

    test('refunds an unknown draw type instead of keeping the ticket money', async () => {
        await setup();

        await ts.contractTransfer({ from: 'alice', to: 'lottohouse', amount: '1.000 HIVE', contract: 'hivelotto', action: 'buy', payload: { type: 'weekly' } });

        expect(ts.outgoingTransfers).toEqual([expect.objectContaining({ to: 'alice', amount: '1.000 HIVE', memo: '[Refund] You specified an invalid draw type' })]);
        expect(await ts.adapter.query('SELECT draw_id FROM lotto_draws')).toHaveLength(0);
    });

    test('refunds tickets paid in an asset other than the lotto asset', async () => {
        await setup({ validCurrencies: ['HIVE', 'HBD'] });

        await ts.contractTransfer({ from: 'alice', to: 'lottohouse', amount: '1.000 HBD', contract: 'hivelotto', action: 'buy', payload: { type: 'hourly' } });

        expect(ts.outgoingTransfers).toEqual([expect.objectContaining({ amount: '1.000 HBD', memo: '[Refund] You sent an invalid currency.' })]);
    });

    test('an HBD lotto checks the HBD balance before paying out', async () => {
        ts = await createTestStreamer({ username: 'lottohouse', activeKey: ACTIVE_KEY });
        ts.client.setAccount('lottohouse', { balance: '0.000 HIVE', hbd_balance: '100.000 HBD' });
        await ts.streamer.registerContract(createLottoContract({ tokenSymbol: 'HBD', cost: 1, minEntriesHourly: 2, hourlyWinnersPick: 1, feePercentage: 10 }));
        await ts.streamer.registerAction(new TimeAction('1h', 'lotto-hourly', 'hivelotto', 'drawHourlyLottery'));

        await ts.contractTransfer({ from: 'alice', to: 'lottohouse', amount: '1.000 HBD', contract: 'hivelotto', action: 'buy', payload: { type: 'hourly' } });
        await ts.contractTransfer({ from: 'bob', to: 'lottohouse', amount: '1.000 HBD', contract: 'hivelotto', action: 'buy', payload: { type: 'hourly' } });
        await ts.advanceTime('1h');
        await ts.advanceBlocks(1);

        const [draw] = await ts.adapter.query('SELECT status FROM lotto_draws');
        expect(draw.status).toBe('completed');

        const payouts = ts.client.broadcasts.filter((broadcast) => JSON.stringify(broadcast.data).includes('Congratulations'));
        expect(payouts).toHaveLength(1);
        expect(JSON.stringify(payouts[0].data)).toContain('1.800 HBD');
        // Losers get no 0.001 notice unless notifyLosses is set.
        expect(ts.client.broadcasts.some((broadcast) => JSON.stringify(broadcast.data).includes("didn't win"))).toBe(false);
    });
});

describe('Lotto Contract on a document store', () => {
    let ts: TestStreamer;

    afterEach(async () => {
        await ts?.stop();
    });

    test('scopes draws and settings by contract name so two lottos never share a draw', async () => {
        const adapter = new MemoryDocumentAdapter();
        ts = await createTestStreamer({ username: 'lottohouse', activeKey: ACTIVE_KEY, adapter });
        ts.client.setAccount('lottohouse', { balance: '1000.000 HIVE' });
        await ts.streamer.registerContract(createLottoContract({ name: 'lottoa', cost: 1 }));
        await ts.streamer.registerContract(createLottoContract({ name: 'lottob', cost: 1 }));

        await ts.contractTransfer({ from: 'alice', to: 'lottohouse', amount: '1.000 HIVE', contract: 'lottoa', action: 'buy', payload: { type: 'hourly' } });
        await ts.contractTransfer({ from: 'bob', to: 'lottohouse', amount: '1.000 HIVE', contract: 'lottob', action: 'buy', payload: { type: 'hourly' } });
        await ts.contractTransfer({ from: 'carol', to: 'lottohouse', amount: '1.000 HIVE', contract: 'lottoa', action: 'buy', payload: { type: 'hourly' } });

        const settings = adapter.collections.get('settings')!;
        expect(settings.map((doc) => doc.contract).sort()).toEqual(['lottoa', 'lottob']);

        const draws = adapter.collections.get('lottery')!;
        expect(draws).toHaveLength(2);
        expect(draws.find((draw) => draw.contract === 'lottoa').entries.map((entry: any) => entry.account)).toEqual(['alice', 'carol']);
        expect(draws.find((draw) => draw.contract === 'lottob').entries.map((entry: any) => entry.account)).toEqual(['bob']);
    });
});
