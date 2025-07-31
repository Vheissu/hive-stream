import { sleep } from '@hiveio/dhive/lib/utils';

import { TimeAction } from './../../src/actions';
import { LottoContract } from './../../src/contracts/lotto.contract';
import { Streamer } from '../../src/streamer';

import fiftyValidEntrants from './entrants.json';

describe('Lotto Contract', () => {
    let sut: Streamer;
    let contract: LottoContract;

    beforeEach(async () => {
        sut = new Streamer({ ACTIVE_KEY: '' });
        contract = new LottoContract();

        // @ts-ignore
        sut.adapter = {
            db: jest.fn(),
            create: jest.fn(),
            destroy: jest.fn(),
            loadActions: jest.fn(),
            loadState: jest.fn(),
            saveState: jest.fn(),
            processBlock: jest.fn(),
            processOperation: jest.fn(),
            processTransfer: jest.fn(),
            processCustomJson: jest.fn(),
            find: jest.fn(),
            findOne: jest.fn(),
            insert: jest.fn(),
            replace: jest.fn()
        };

        jest.restoreAllMocks();

        await sut.start();
    });

    afterEach(async () => {
        await sut.stop();
    });

    test('Registers the lotto contract', () => {
        sut.registerContract('testlotto', contract as any);

        const findContract = sut['contracts'].find(c => c.name === 'testlotto');

        expect(findContract).not.toBeUndefined();
    });

    test('User enters the lotto, existing draw found', async () => {
        try {
            sut.registerContract('testlotto', contract as any);

            contract['_instance'] = sut;

            const mockEntry = { startDate: new Date(), type: 'hourly', status: 'active', entries: [] };

            jest.spyOn(sut['adapter'], 'find').mockResolvedValue(mockEntry);
    
            jest.spyOn(contract, 'buy');
            jest.spyOn(contract as any, 'getBalance').mockResolvedValue(2000);
    
            jest.spyOn(sut, 'getTransaction').mockResolvedValue({test: 123} as any);
            jest.spyOn(sut, 'verifyTransfer').mockResolvedValue(true as any);
            jest.spyOn(sut, 'transferHiveTokens').mockResolvedValue(true as any);
            jest.spyOn(sut, 'transferHiveTokensMultiple').mockResolvedValue(true as any);
    
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

    test('User enters the lotto, but they have hit the entry limit', async () => {
        try {
            sut.registerContract('testlotto', contract as any);

            contract['_instance'] = sut;

            const entries = [];

            for (const entrant of fiftyValidEntrants) {
                // @ts-ignore
                entries.push({
                    account: entrant.from,
                    date: new Date()
                });
            }

            const mockData = { startDate: new Date(), type: 'hourly', status: 'active', entries };
            jest.spyOn(sut['adapter'], 'find').mockResolvedValue(mockData);
    
            jest.spyOn(contract, 'buy');
            jest.spyOn(contract as any, 'getBalance').mockResolvedValue(2000);
    
            jest.spyOn(sut, 'getTransaction').mockResolvedValue({test: 123} as any);
            jest.spyOn(sut, 'verifyTransfer').mockResolvedValue(true as any);
            jest.spyOn(sut, 'transferHiveTokens').mockResolvedValue(true as any);
            jest.spyOn(sut, 'transferHiveTokensMultiple').mockResolvedValue(true as any);
            jest.spyOn(contract, 'getPreviousUserTicketsForCurrentDrawType').mockResolvedValue(3);
    
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
    
            sut.processOperation(['transfer', { from: 'beggars', amount: '10.000 HIVE', memo }], 778782, 'dfjfsdfsdfsd34hfkj88787', 'fkjsdkfj', 'fhkjsdhfkjsdf', '2019-06-23' as any);
    
            await sleep(100);
    
            expect(sut.transferHiveTokens).toBeCalledWith('beggars', 'beggars', '10.000', 'HIVE', '[Refund] You have exceeded the allowed number of entries');
        } catch (e) {
            throw e;
        }
    });

    test('Draw the hourly lottery', async () => {
        try {
            sut.registerContract('testlotto', contract as any);

            contract['_instance'] = sut;
            
            const entries = [];

            for (const entrant of fiftyValidEntrants) {
                // @ts-ignore
                entries.push({
                    account: entrant.from,
                    date: new Date()
                });
            }

            const mockInsertedData = { startDate: new Date(), type: 'hourly', status: 'active', entries };
            jest.spyOn(sut['adapter'], 'find').mockResolvedValue(mockInsertedData);
    
            jest.spyOn(contract, 'buy');
            jest.spyOn(contract as any, 'getBalance').mockResolvedValue(2000);
    
            jest.spyOn(sut, 'getTransaction').mockResolvedValue({test: 123} as any);
            jest.spyOn(sut, 'verifyTransfer').mockResolvedValue(true as any);
            jest.spyOn(sut, 'transferHiveTokens').mockResolvedValue(true as any);
            jest.spyOn(sut, 'transferHiveTokensMultiple').mockResolvedValue(true as any);
    
            const drawn = await contract.drawHourlyLottery();

            if (drawn) {
                expect(drawn).toHaveLength(3);
                expect(sut.transferHiveTokensMultiple).toBeCalledTimes(2);
                expect(sut.transferHiveTokensMultiple).toBeCalledWith('beggars', expect.any(Array), '164.667', 'HIVE', expect.stringContaining('Congratulations you won the hourly lottery. You won 164.667 HIVE'));
                expect(sut.transferHiveTokensMultiple).toBeCalledWith(expect.any(String), expect.any(Array), '0.001', 'HIVE', expect.stringContaining('Sorry, you didn\'t win the hourly draw. Winners:'));
            }
        } catch (e) {
            throw e;
        }
    });

    test('Draw the hourly lottery, but not enough entrants, so we refund', async () => {
        try {
            sut.registerContract('testlotto', contract as any);

            contract['_instance'] = sut;
            
            const entries = [];
            const reducedEntries = fiftyValidEntrants.slice(0, 2);

            for (const entrant of reducedEntries) {
                // @ts-ignore
                entries.push({
                    account: entrant.from,
                    date: new Date()
                });
            }

            const mockResponse = [{ startDate: new Date(), type: 'hourly', status: 'active', entries }];
            jest.spyOn(sut['adapter'], 'find').mockResolvedValue(mockResponse);
    
            jest.spyOn(contract, 'buy');
            jest.spyOn(contract as any, 'getBalance').mockResolvedValue(2000);
    
            jest.spyOn(sut, 'getTransaction').mockResolvedValue({test: 123} as any);
            jest.spyOn(sut, 'verifyTransfer').mockResolvedValue(true as any);
            jest.spyOn(sut, 'transferHiveTokens').mockResolvedValue(true as any);
            jest.spyOn(sut, 'transferHiveTokensMultiple').mockResolvedValue(true as any);
    
            const drawn = await contract.drawHourlyLottery();

            expect(sut.transferHiveTokensMultiple).toBeCalledTimes(1);
        } catch (e) {
            throw e;
        }
    });

    test('Draw the hourly lottery, balance cannot afford to pay out winnings', async () => {
        try {
            sut.registerContract('testlotto', contract as any);

            contract['_instance'] = sut;
            
            const entries = [];

            for (const entrant of fiftyValidEntrants) {
                // @ts-ignore
                entries.push({
                    account: entrant.from,
                    date: new Date()
                });
            }

            const mockData = [{ startDate: new Date(), type: 'hourly', status: 'active', entries }];
            jest.spyOn(sut['adapter'], 'find').mockResolvedValue(mockData);
    
            jest.spyOn(contract, 'buy');
            jest.spyOn(contract as any, 'getBalance').mockResolvedValue(10);
    
            jest.spyOn(sut, 'getTransaction').mockResolvedValue({test: 123} as any);
            jest.spyOn(sut, 'verifyTransfer').mockResolvedValue(true as any);
            jest.spyOn(sut, 'transferHiveTokens').mockResolvedValue(true as any);
            jest.spyOn(sut, 'transferHiveTokensMultiple').mockResolvedValue(true as any);

            expect(contract.drawHourlyLottery()).rejects.toEqual(new Error('Balance is less than amount to pay out'));
        } catch (e) {
            throw e;
        }
    });

    test('Draw the daily lottery', async () => {
        try {
            sut.registerContract('testlotto', contract as any);

            contract['_instance'] = sut;
            
            const entries = [];
            const entrants = [...fiftyValidEntrants, ...fiftyValidEntrants];

            for (const entrant of entrants) {
                // @ts-ignore
                entries.push({
                    account: entrant.from,
                    date: new Date()
                });
            }

            const mockData = [{ startDate: new Date(), type: 'daily', status: 'active', entries }];
            jest.spyOn(sut['adapter'], 'find').mockResolvedValue(mockData);
    
            jest.spyOn(contract, 'buy');
            jest.spyOn(contract as any, 'getBalance').mockResolvedValue(2000);
    
            jest.spyOn(sut, 'getTransaction').mockResolvedValue({test: 123} as any);
            jest.spyOn(sut, 'verifyTransfer').mockResolvedValue(true as any);
            jest.spyOn(sut, 'transferHiveTokens').mockResolvedValue(true as any);
            jest.spyOn(sut, 'transferHiveTokensMultiple').mockResolvedValue(true as any);
    
            const drawn = await contract.drawDailyLottery();

            expect(drawn).toHaveLength(10);
            expect(sut.transferHiveTokensMultiple).toBeCalledWith('beggars', expect.any(Array), '98.800', 'HIVE', 'Congratulations you won the daily lottery. You won 98.800 HIVE');
        } catch (e) {
            throw e;
        }
    });

    test('User attempts to enter lotto with invalid currency, refund them', async () => {
        try {
            sut.registerContract('testlotto', contract as any);

            contract['_instance'] = sut;

            const mockData = { startDate: new Date(), type: 'hourly', status: 'active', entries: [] };
            jest.spyOn(sut['adapter'], 'find').mockResolvedValue(mockData);
    
            jest.spyOn(contract, 'buy');
            jest.spyOn(contract as any, 'getBalance').mockResolvedValue(2000);
    
            jest.spyOn(sut, 'getTransaction').mockResolvedValue({test: 123} as any);
            jest.spyOn(sut, 'verifyTransfer').mockResolvedValue(true as any);
            jest.spyOn(sut, 'transferHiveTokens').mockResolvedValue(true as any);
            jest.spyOn(sut, 'transferHiveTokensMultiple').mockResolvedValue(true as any);
    
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
    
            sut.processOperation(['transfer', { from: 'testuser', amount: '10.000 HBD', memo }], 778782, 'dfjfsdfsdfsd34hfkj88787', 'fkjsdkfj', 'fhkjsdhfkjsdf', '2019-06-23' as any);
    
            await sleep(100);
    
            expect(sut.transferHiveTokens).toBeCalledWith('beggars', 'testuser', '10.000', 'HBD', '[Refund] You sent an invalid currency.');
        } catch (e) {
            throw e;
        }
    });

});