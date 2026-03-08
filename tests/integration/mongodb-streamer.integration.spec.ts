import { action, defineContract } from '../../src/contracts/contract';
import {
    Streamer,
    MongodbAdapter,
    createRevenueSplitContract,
    createTokenContract,
    createNFTContract,
    createPollContract,
    createTipJarContract,
    createExchangeContract
} from '../../src';
import { createIsolatedMongoDatabase, isMongoTestAvailable } from '../helpers/external-adapters';

const describeIfMongo = isMongoTestAvailable() ? describe : describe.skip;

describeIfMongo('MongoDB streamer integration', () => {
    const customJsonOp = (sender: string, contract: string, actionName: string, payload: Record<string, any>, active = true) => ([
        'custom_json',
        {
            id: 'hivestream',
            json: JSON.stringify({
                hive_stream: {
                    contract,
                    action: actionName,
                    payload
                }
            }),
            required_auths: active ? [sender] : [],
            required_posting_auths: active ? [] : [sender]
        }
    ] as [string, any]);

    const transferOp = (sender: string, amount: string, contract: string, actionName: string, payload: Record<string, any>) => ([
        'transfer',
        {
            from: sender,
            to: 'app.contract',
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

    test('persists streamer operations and contract-emitted events in MongoDB', async () => {
        const mongoDb = await createIsolatedMongoDatabase('hive_stream_mongo');
        const streamer = new Streamer({
            JSON_ID: 'hivestream',
            PAYLOAD_IDENTIFIER: 'hive_stream'
        });
        const adapter = new MongodbAdapter(mongoDb.uri, mongoDb.dbName);

        const runtimeProbe = defineContract({
            name: 'runtimeprobe',
            actions: {
                registerProfile: action(async (payload: { profileId: string }, ctx) => {
                    await ctx.adapter.addEvent(new Date(), 'runtimeprobe', 'registerProfile', payload, {
                        sender: ctx.sender,
                        profileId: payload.profileId
                    });
                }, { trigger: 'custom_json' }),
                recordTip: action(async (payload: { roomId: string }, ctx) => {
                    await ctx.adapter.addEvent(new Date(), 'runtimeprobe', 'recordTip', payload, {
                        sender: ctx.sender,
                        roomId: payload.roomId,
                        amount: ctx.transfer?.rawAmount
                    });
                }, { trigger: 'transfer' })
            }
        });

        try {
            await streamer.registerAdapter(adapter);
            await streamer.registerContract(runtimeProbe);

            await streamer.processOperation(
                customJsonOp('alice', 'runtimeprobe', 'registerProfile', { profileId: 'alice-profile' }, false),
                1,
                'block-1',
                'block-0',
                'trx-1',
                new Date('2026-03-08T00:00:00.000Z')
            );
            await streamer.processOperation(
                transferOp('bob', '2.500 HIVE', 'runtimeprobe', 'recordTip', { roomId: 'general' }),
                2,
                'block-2',
                'block-1',
                'trx-2',
                new Date('2026-03-08T00:00:03.000Z')
            );

            const jsons = await adapter.getJson();
            const transfers = await adapter.getTransfers();
            const events = await adapter.getEventsByContract('runtimeprobe');
            const eventsByAlice = await adapter.getEventsByAccount('alice');

            expect(jsons).toHaveLength(1);
            expect(jsons?.[0].sender).toBe('alice');
            expect(jsons?.[0].isSignedWithActiveKey).toBe(false);
            expect(transfers).toHaveLength(1);
            expect(transfers?.[0].sender).toBe('bob');
            expect(transfers?.[0].amount).toBe('2.500 HIVE');
            expect(events).toHaveLength(2);
            expect(eventsByAlice).toHaveLength(1);

            await streamer.stop();

            const reopenedAdapter = new MongodbAdapter(mongoDb.uri, mongoDb.dbName);
            await reopenedAdapter.create();
            const reopenedEvents = await reopenedAdapter.getEventsByContract('runtimeprobe');
            const reopenedTransfers = await reopenedAdapter.getTransfersByAccount('bob');

            expect(reopenedEvents).toHaveLength(2);
            expect(reopenedTransfers).toHaveLength(1);

            await reopenedAdapter.destroy();
        } finally {
            await streamer.stop();
            await mongoDb.cleanup();
        }
    });

    test('rejects SQL-backed contracts with a clear adapter capability error', async () => {
        const mongoDb = await createIsolatedMongoDatabase('hive_stream_mongo_contracts');
        const streamer = new Streamer({
            JSON_ID: 'hivestream',
            PAYLOAD_IDENTIFIER: 'hive_stream'
        });
        const adapter = new MongodbAdapter(mongoDb.uri, mongoDb.dbName);

        try {
            await streamer.registerAdapter(adapter);
            const sqlBackedContracts = [
                createRevenueSplitContract(),
                createTokenContract(),
                createNFTContract(),
                createPollContract(),
                createTipJarContract(),
                createExchangeContract()
            ];

            for (const contract of sqlBackedContracts) {
                await expect(streamer.registerContract(contract))
                    .rejects
                    .toThrow('SQL-capable adapter');
            }
        } finally {
            await streamer.stop();
            await mongoDb.cleanup();
        }
    });
});
