import { sleep } from '@hiveio/dhive/lib/utils';
import { createDiceContract } from './../../src/contracts/dice.contract';
import { Streamer } from '../../src/streamer';
import { createMockAdapter } from '../helpers/mock-adapter';

describe('Dice Contract', () => {
    let sut: Streamer;
    let contract: ReturnType<typeof createDiceContract>;

    beforeEach(async () => {
        sut = new Streamer();
        await sut.registerAdapter(createMockAdapter());

        contract = createDiceContract({ name: 'testdice' });

        // @ts-ignore
        sut.api = jest.fn();
    });

    afterEach(async () => {
        await sut.stop();
    });

    afterAll(() => {
        jest.restoreAllMocks();
    });

    test('Registers the dice contract', async () => {
        await sut.registerContract(contract);

        const findContract = sut['contracts'].find(c => c.name === 'testdice');

        expect(findContract).not.toBeUndefined();
    });

    test('User wins a roll', async () => {
        await sut.registerContract(contract);

        jest.spyOn(sut, 'getTransaction').mockResolvedValue({ test: 123 } as any);
        jest.spyOn(sut, 'verifyTransfer').mockResolvedValue(true as any);
        jest.spyOn(sut, 'transferHiveTokens').mockResolvedValue(true as any);
        jest.spyOn(sut['client'].database, 'getAccounts').mockResolvedValue([{ balance: '2000.000 HIVE' }] as any);

        const memo = JSON.stringify({
            hive_stream: {
                contract: 'testdice',
                action: 'roll',
                payload: {
                    roll: 69
                }
            }
        });

        await sut.processOperation(['transfer', { from: 'testuser', amount: '9.000 HIVE', memo }], 778782, 'dfjfsdfsdfsd34hfkj88787', 'fkjsdkfj', 'fhkjsdhfkjsdf', '2019-06-23' as any);

        await sleep(100);

        expect(sut.getTransaction).toHaveBeenCalledWith(778782, 'fhkjsdhfkjsdf');
        expect(sut.transferHiveTokens).toHaveBeenCalledWith('beggars', 'testuser', '12.391', 'HIVE', 'You won 12.391 HIVE. Roll: 54, Your guess: 69');
    });

    test('User loses a roll', async () => {
        await sut.registerContract(contract);

        jest.spyOn(sut, 'getTransaction').mockResolvedValue({ test: 123 } as any);
        jest.spyOn(sut, 'verifyTransfer').mockResolvedValue(true as any);
        jest.spyOn(sut, 'transferHiveTokens').mockResolvedValue(true as any);
        jest.spyOn(sut['client'].database, 'getAccounts').mockResolvedValue([{ balance: '2000.000 HIVE' }] as any);

        const memo = JSON.stringify({
            hive_stream: {
                contract: 'testdice',
                action: 'roll',
                payload: {
                    roll: 10
                }
            }
        });

        await sut.processOperation(['transfer', { from: 'testuser', amount: '9.000 HIVE', memo }], 778782, 'dfjfsdfsdfsd34hfkj88787', 'fkjsdkfj', 'fhkjsdhfkjsdf', '2019-06-23' as any);

        await sleep(100);

        expect(sut.getTransaction).toHaveBeenCalledWith(778782, 'fhkjsdhfkjsdf');
        expect(sut.transferHiveTokens).toHaveBeenCalledWith('beggars', 'testuser', '0.001', 'HIVE', 'You lost 9.000 HIVE. Roll: 54, Your guess: 10');
    });
});
