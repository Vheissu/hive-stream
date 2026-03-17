import {
    Streamer,
    MongodbAdapter,
    createLottoContract
} from '../../src';
import { createIsolatedMongoDatabase, isMongoTestAvailable } from '../helpers/external-adapters';

const describeIfMongo = isMongoTestAvailable() ? describe : describe.skip;

describeIfMongo('MongoDB adapter parity', () => {
    const transferOp = (sender: string, amount: string, contract: string, actionName: string, payload: Record<string, any>) => ([
        'transfer',
        {
            from: sender,
            to: 'beggars',
            amount,
            memo: JSON.stringify({
                hive_stream: {
                    contract,
                    action: actionName,
                    payload
                }
            })
        }
    ] as [string, any]);

    test('matches SQL adapter CRUD semantics for generic collections', async () => {
        const mongoDb = await createIsolatedMongoDatabase('hive_stream_mongo_adapter');
        const adapter = new MongodbAdapter(mongoDb.uri, mongoDb.dbName);

        try {
            await adapter.create();

            expect(await adapter.find('profiles', { id: 'missing' })).toEqual([]);
            expect(await adapter.findOne('profiles', { id: 'missing' })).toBeNull();

            expect(await adapter.insert('profiles', {
                id: 'alice',
                tier: 'gold',
                visits: 1
            })).toBe(true);

            expect(await adapter.find('profiles', { tier: 'gold' })).toEqual([
                expect.objectContaining({
                    id: 'alice',
                    tier: 'gold',
                    visits: 1
                })
            ]);

            const replacement = {
                id: 'alice',
                tier: 'platinum',
                visits: 2
            };

            expect(await adapter.replace('profiles', { id: 'alice' }, replacement)).toEqual(replacement);
            expect(await adapter.findOne('profiles', { id: 'alice' })).toEqual(expect.objectContaining(replacement));

            await adapter.destroy();

            const reopenedAdapter = new MongodbAdapter(mongoDb.uri, mongoDb.dbName);
            await reopenedAdapter.create();

            expect(await reopenedAdapter.findOne('profiles', { id: 'alice' })).toEqual(expect.objectContaining(replacement));

            await reopenedAdapter.destroy();
        } finally {
            await adapter.destroy();
            await mongoDb.cleanup();
        }
    });

    test('runs the lotto contract against MongoDB and persists state across reconnects', async () => {
        const mongoDb = await createIsolatedMongoDatabase('hive_stream_mongo_lotto');
        const streamer = new Streamer({
            JSON_ID: 'hivestream',
            PAYLOAD_IDENTIFIER: 'hive_stream'
        });
        const adapter = new MongodbAdapter(mongoDb.uri, mongoDb.dbName);

        try {
            await streamer.registerAdapter(adapter);
            await streamer.registerContract(createLottoContract());

            streamer['client'] = {
                database: {
                    getAccounts: jest.fn().mockResolvedValue([
                        { balance: '1000.000 HIVE' }
                    ])
                }
            } as any;
            streamer.getTransaction = jest.fn().mockResolvedValue({}) as any;
            streamer.verifyTransfer = jest.fn().mockResolvedValue(true) as any;
            streamer.transferHiveTokens = jest.fn().mockResolvedValue(true) as any;
            streamer.transferHiveTokensMultiple = jest.fn().mockResolvedValue(true) as any;

            const settings = await adapter.findOne('settings', {});
            expect(settings).toEqual(expect.objectContaining({ enabled: true }));

            await streamer.processOperation(
                transferOp('alice', '10.000 HIVE', 'hivelotto', 'buy', { type: 'hourly' }),
                1,
                'block-1',
                'block-0',
                'trx-1',
                new Date('2026-03-08T00:00:00.000Z')
            );
            await streamer.processOperation(
                transferOp('alice', '10.000 HIVE', 'hivelotto', 'buy', { type: 'hourly' }),
                2,
                'block-2',
                'block-1',
                'trx-2',
                new Date('2026-03-08T00:05:00.000Z')
            );

            const draws = await adapter.find('lottery', { status: 'active', type: 'hourly' });

            expect(draws).toHaveLength(1);
            expect(draws?.[0].entries).toHaveLength(2);
            expect(draws?.[0].entries.map((entry: any) => entry.account)).toEqual(['alice', 'alice']);

            await streamer.stop();

            const reopenedAdapter = new MongodbAdapter(mongoDb.uri, mongoDb.dbName);
            await reopenedAdapter.create();

            const reopenedSettings = await reopenedAdapter.findOne('settings', {});
            const reopenedDraw = await reopenedAdapter.findOne('lottery', { status: 'active', type: 'hourly' });

            expect(reopenedSettings).toEqual(expect.objectContaining({ enabled: true }));
            expect(reopenedDraw).toEqual(expect.objectContaining({
                status: 'active',
                type: 'hourly'
            }));
            expect(reopenedDraw?.entries).toHaveLength(2);

            await reopenedAdapter.destroy();
        } finally {
            await streamer.stop();
            await mongoDb.cleanup();
        }
    });
});
