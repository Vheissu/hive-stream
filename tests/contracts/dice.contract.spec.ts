import { sleep } from '@hiveio/dhive/lib/utils';
import { DiceContract } from './../../src/contracts/dice.contract';
import { Streamer } from '../../src/streamer';
import { createMockAdapter } from '../helpers/mock-adapter';
import BigNumber from 'bignumber.js';

describe('Dice Contract', () => {
    let sut: Streamer;
    let contract: DiceContract;

    beforeEach(async () => {
        sut = new Streamer();
        await sut.registerAdapter(createMockAdapter());
        
        contract = new DiceContract();

        // @ts-ignore
        sut.api = jest.fn();
    });

    afterEach(async () => {
        await sut.stop();
    });

    afterAll(() => {
        jest.restoreAllMocks();
    });

    test('Registers the dice contract', () => {
        sut.registerContract('testdice', contract);

        const findContract = sut['contracts'].find(c => c.name === 'testdice');

        expect(findContract).not.toBeUndefined();
    });

    test('User wins a roll', async () => {
        sut.registerContract('testdice', contract);

        contract['_instance'] = sut;

        jest.spyOn(contract as any, 'roll');
        jest.spyOn(contract as any, 'getBalance').mockResolvedValue(new BigNumber(2000));

        jest.spyOn(sut, 'getTransaction').mockResolvedValue({test: 123} as any);
        jest.spyOn(sut, 'verifyTransfer').mockResolvedValue(true as any);
        jest.spyOn(sut, 'transferHiveTokens').mockResolvedValue(true as any);

        const memo = JSON.stringify({
            hivePayload: {
                id: 'hivestream',
                name: 'testdice',
                action: 'roll',
                payload: {
                    roll: 69
                }
            }
        });

        sut.processOperation(['transfer', { from: 'testuser', amount: '9.000 HIVE', memo }], 778782, 'dfjfsdfsdfsd34hfkj88787', 'fkjsdkfj', 'fhkjsdhfkjsdf', '2019-06-23' as any);

        await sleep(100);

        expect(contract['roll']).toBeCalled();
        expect(contract['_instance'].getTransaction).toBeCalledWith(778782, 'fhkjsdhfkjsdf');
        expect(contract['_instance'].transferHiveTokens).toBeCalledWith('beggars', 'testuser', '12.391', 'HIVE', 'You won 12.391 HIVE. Roll: 54, Your guess: 69');
    });

    test('User loses a roll', async () => {
        sut.registerContract('testdice', contract);

        contract['_instance'] = sut;

        jest.spyOn(contract as any, 'roll');
        jest.spyOn(contract as any, 'getBalance').mockResolvedValue(new BigNumber(2000));

        jest.spyOn(sut, 'getTransaction').mockResolvedValue({test: 123} as any);
        jest.spyOn(sut, 'verifyTransfer').mockResolvedValue(true as any);
        jest.spyOn(sut, 'transferHiveTokens').mockResolvedValue(true as any);

        const memo = JSON.stringify({
            hivePayload: {
                id: 'hivestream',
                name: 'testdice',
                action: 'roll',
                payload: {
                    roll: 69
                }
            }
        });

        sut.processOperation(['transfer', { from: 'testuser', amount: '9.000 HIVE', memo }], 778782, 'dfjfsdfsdfs4hfkj88787', 'fkjsdkfj', 'fhkjsdhfkjsdf', '2019-06-23' as any);

        await sleep(100);

        expect(contract['roll']).toBeCalled();
        expect(sut.getTransaction).toBeCalledWith(778782, 'fhkjsdhfkjsdf');
        expect(sut.transferHiveTokens).toBeCalledWith('beggars', 'testuser', '0.001', 'HIVE', 'You lost 9.000 HIVE. Roll: 81, Your guess: 69');
    });

    test('User sent an invalid amount, refund them', async () => {
        sut.registerContract('testdice', contract);

        contract['_instance'] = sut;

        jest.spyOn(contract as any, 'roll');
        jest.spyOn(contract as any, 'getBalance').mockResolvedValue(new BigNumber(2000));

        jest.spyOn(sut, 'getTransaction').mockResolvedValue({test: 123} as any);
        jest.spyOn(sut, 'verifyTransfer').mockResolvedValue(true as any);
        jest.spyOn(sut, 'transferHiveTokens').mockResolvedValue(true as any);

        const memo = JSON.stringify({
            hivePayload: {
                id: 'hivestream',
                name: 'testdice',
                action: 'roll',
                payload: {
                    roll: 69
                }
            }
        });

        sut.processOperation(['transfer', { from: 'testuser', amount: '100.000 HIVE', memo }], 778782, 'dfjfsdfsdfs4hfkj88787', 'fkjsdkfj', 'fhkjsdhfkjsdf', '2019-06-23' as any);

        await sleep(100);

        expect(contract['roll']).toBeCalled();
        expect(sut.getTransaction).toBeCalledWith(778782, 'fhkjsdhfkjsdf');
        expect(sut.transferHiveTokens).toBeCalledWith('beggars', 'testuser', '100.000', 'HIVE', '[Refund] You sent an invalid bet amount.');
    });

    test('User sent an unsupported currency, refund them', async () => {
        sut.registerContract('testdice', contract);

        contract['_instance'] = sut;

        jest.spyOn(contract as any, 'roll');
        jest.spyOn(contract as any, 'getBalance').mockResolvedValue(new BigNumber(2000));

        jest.spyOn(sut, 'getTransaction').mockResolvedValue({test: 123} as any);
        jest.spyOn(sut, 'verifyTransfer').mockResolvedValue(true as any);
        jest.spyOn(sut, 'transferHiveTokens').mockResolvedValue(true as any);

        const memo = JSON.stringify({
            hivePayload: {
                id: 'hivestream',
                name: 'testdice',
                action: 'roll',
                payload: {
                    roll: 69
                }
            }
        });

        sut.processOperation(['transfer', { from: 'testuser', amount: '10.000 HBD', memo }], 778782, 'dfjfsdfsdfs4hfkj88787', 'fkjsdkfj', 'fhkjsdhfkjsdf', '2019-06-23' as any);

        await sleep(100);

        expect(contract['roll']).toBeCalled();
        expect(sut.getTransaction).toBeCalledWith(778782, 'fhkjsdhfkjsdf');
        expect(sut.transferHiveTokens).toBeCalledWith('beggars', 'testuser', '10.000', 'HBD', '[Refund] Invalid bet params.');
    });

    test('Queue processes multiple concurrent rolls', async () => {
        sut.registerContract('testdice', contract);

        contract['_instance'] = sut;

        jest.spyOn(contract as any, 'getBalance').mockResolvedValue(new BigNumber(2000));
        jest.spyOn(sut, 'getTransaction').mockResolvedValue({test: 123} as any);
        jest.spyOn(sut, 'verifyTransfer').mockResolvedValue(true as any);
        jest.spyOn(sut, 'transferHiveTokens').mockResolvedValue(true as any);

        const memo1 = JSON.stringify({
            hivePayload: {
                id: 'hivestream',
                name: 'testdice',
                action: 'roll',
                payload: { roll: 50 }
            }
        });

        const memo2 = JSON.stringify({
            hivePayload: {
                id: 'hivestream',
                name: 'testdice',
                action: 'roll',
                payload: { roll: 75 }
            }
        });

        // Process multiple bets concurrently
        const bet1Promise = sut.processOperation(['transfer', { from: 'user1', amount: '5.000 HIVE', memo: memo1 }], 778782, 'block1', 'prevblock1', 'trx1', '2019-06-23' as any);
        const bet2Promise = sut.processOperation(['transfer', { from: 'user2', amount: '5.000 HIVE', memo: memo2 }], 778783, 'block2', 'prevblock2', 'trx2', '2019-06-23' as any);

        await Promise.all([bet1Promise, bet2Promise]);
        await sleep(200); // Allow queue processing to complete

        // Both transfers should have been processed
        expect(sut.transferHiveTokens).toHaveBeenCalledTimes(2);
    });
});