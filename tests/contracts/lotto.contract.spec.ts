import { MongoClient, Db } from 'mongodb';
import { sleep } from '@hivechain/dhive/lib/utils';
import { LottoContract } from './../../src/contracts/lotto.contract';
import { Streamer } from '../../src/streamer';

import fiftyValidEntrants from './entrants.json';

describe('Lotto Contract', () => {
    let sut: Streamer;
    let contract: LottoContract;
    let connection: MongoClient;
    let db: Db;

    beforeAll(async () => {
        try {
            const url = `mongodb://127.0.0.1/lotto-test`
            connection = await MongoClient.connect(url, { useNewUrlParser: true, useUnifiedTopology: true });
            db = await connection.db();
        } catch (e) {
            throw e;
        }
    });

    beforeEach(() => {
        sut = new Streamer();
        contract = new LottoContract();
    });

    afterEach(async () => {
        sut.stop();

        await db.collection('lottery').deleteMany({});
    });

    afterAll(() => {
        connection.close();
        jest.restoreAllMocks();
    });

    test('Registers the lotto contract', () => {
        sut.registerContract('testlotto', contract);

        const findContract = sut['contracts'].find(c => c.name === 'testlotto');

        expect(findContract).not.toBeUndefined();
    });

    test('User enters the lotto', async () => {
        try {
            sut.registerContract('testlotto', contract);

            contract['_instance'] = sut;
            
            contract['adapter']['db'] = db;

            const lottery = db.collection('lottery');
            await lottery.insertOne({ startDate: new Date(), type: 'hourly', status: 'active', entries: [] });
    
            jest.spyOn(contract, 'buy');
            jest.spyOn(contract as any, 'getBalance').mockResolvedValue(2000);
    
            jest.spyOn(sut, 'getTransaction').mockResolvedValue({test: 123} as any);
            jest.spyOn(sut, 'verifyTransfer').mockResolvedValue(true as any);
            jest.spyOn(sut, 'transferHiveTokens').mockResolvedValue(true as any);
    
            const memo = JSON.stringify({
                hivePayload: {
                    id: 'hivestream',
                    name: 'testlotto',
                    action: 'buy',
                    payload: {
                        type: 'hourly'
                    }
                }
            });
    
            sut.processOperation(['transfer', { from: 'testuser', amount: '10.000 HIVE', memo }], 778782, 'dfjfsdfsdfsd34hfkj88787', 'fkjsdkfj', 'fhkjsdhfkjsdf', '2019-06-23' as any);
    
            await sleep(100);
    
            expect(contract.buy).toBeCalled();
        } catch (e) {
            throw e;
        }
    });

    test('Lotto draw is activated after hitting hourly entry limit', async () => {
        try {
            sut.registerContract('testlotto', contract);

            contract['_instance'] = sut;
            
            contract['adapter']['db'] = db;

            const entries = [];

            const fortynineEntrants = fiftyValidEntrants.slice(0, 49);

            for (const entrant of fortynineEntrants) {
                entries.push({
                    account: entrant.from,
                    transactionId: Array(15).fill(null).map(() => Math.random().toString(36).substr(2)).join(''),
                    date: new Date()
                });
            }

            const lottery = db.collection('lottery');
            await lottery.insertOne({ startDate: new Date(), type: 'hourly', status: 'active', entries });
    
            jest.spyOn(contract, 'buy');
            jest.spyOn(contract as any, 'getBalance').mockResolvedValue(2000);
    
            jest.spyOn(sut, 'getTransaction').mockResolvedValue({test: 123} as any);
            jest.spyOn(sut, 'verifyTransfer').mockResolvedValue(true as any);
            jest.spyOn(sut, 'transferHiveTokens').mockResolvedValue(true as any);

            const memo = JSON.stringify({
                hivePayload: {
                    id: 'hivestream',
                    name: 'testlotto',
                    action: 'buy',
                    payload: {
                        type: 'hourly'
                    }
                }
            });
    
            sut.processOperation(['transfer', { from: 'testuser', amount: '10.000 HIVE', memo }], 778782, 'dfjfsdfsdfsd34hfkj88787', 'fkjsdkfj', 'fhkjsdhfkjsdf', '2019-06-23' as any);
    
            await sleep(15000);
    
            expect(contract.buy).toBeCalled();
        } catch (e) {
            throw e;
        }
    });

});