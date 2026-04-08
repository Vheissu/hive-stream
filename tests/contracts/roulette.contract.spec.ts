import { sleep } from '@hiveio/dhive/lib/utils';
import { Streamer } from '../../src/streamer';
import { createRouletteContract } from '../../src/contracts/roulette.contract';
import { createMockAdapter } from '../helpers/mock-adapter';

jest.mock('uuid', () => ({
    v4: jest.fn()
}));

import { v4 as uuidv4 } from 'uuid';

describe('Roulette Contract', () => {
    let sut: Streamer;
    let contract: ReturnType<typeof createRouletteContract>;

    beforeEach(async () => {
        sut = new Streamer();
        await sut.registerAdapter(createMockAdapter());
        contract = createRouletteContract();

        // @ts-ignore
        sut.api = jest.fn();
    });

    afterEach(async () => {
        await sut.stop();
        jest.restoreAllMocks();
    });

    test('registers the contract', async () => {
        await sut.registerContract(contract);

        const findContract = sut['contracts'].find(c => c.name === 'roulette');
        expect(findContract).not.toBeUndefined();
    });

    test('user wins a straight-up bet', async () => {
        await sut.registerContract(contract);

        jest.spyOn(sut, 'getTransaction').mockResolvedValue({ test: 123 } as any);
        jest.spyOn(sut, 'verifyTransfer').mockResolvedValue(true as any);
        jest.spyOn(sut, 'transferHiveTokens').mockResolvedValue(true as any);
        jest.spyOn(sut['client'].database, 'getAccounts').mockResolvedValue([{ balance: '2000.000 HIVE' }] as any);

        (uuidv4 as jest.Mock).mockReturnValue('roulette-seed');

        const memo = JSON.stringify({
            hive_stream: {
                contract: 'roulette',
                action: 'spin',
                payload: {
                    betType: 'straight',
                    value: 17,
                    seed: '17'
                }
            }
        });

        await sut.processOperation(['transfer', { from: 'testuser', amount: '2.000 HIVE', memo }], 1, 'block-1', 'block-0', 'trx-straight', '2019-06-23' as any);

        await sleep(100);

        expect(sut.transferHiveTokens).toHaveBeenCalledWith(
            'beggars',
            'testuser',
            '72.000',
            'HIVE',
            '[Winner] | Bet: straight:17 | Number: 17 | Color: black | Seed: roulette-seed'
        );
    });

    test('user loses a color bet', async () => {
        await sut.registerContract(contract);

        jest.spyOn(sut, 'getTransaction').mockResolvedValue({ test: 123 } as any);
        jest.spyOn(sut, 'verifyTransfer').mockResolvedValue(true as any);
        jest.spyOn(sut, 'transferHiveTokens').mockResolvedValue(true as any);
        jest.spyOn(sut['client'].database, 'getAccounts').mockResolvedValue([{ balance: '2000.000 HIVE' }] as any);

        (uuidv4 as jest.Mock).mockReturnValue('roulette-seed');

        const memo = JSON.stringify({
            hive_stream: {
                contract: 'roulette',
                action: 'spin',
                payload: {
                    betType: 'color',
                    value: 'red',
                    seed: 'user-seed'
                }
            }
        });

        await sut.processOperation(['transfer', { from: 'testuser', amount: '3.000 HIVE', memo }], 1, 'block-1', 'block-0', 'trx-straight', '2019-06-23' as any);

        await sleep(100);

        expect(sut.transferHiveTokens).toHaveBeenCalledWith(
            'beggars',
            'testuser',
            '0.001',
            'HIVE',
            '[Lost] | Bet: color:red | Number: 8 | Color: black | Seed: roulette-seed'
        );
    });

    test('refunds invalid currency', async () => {
        await sut.registerContract(contract);

        jest.spyOn(sut, 'getTransaction').mockResolvedValue({ test: 123 } as any);
        jest.spyOn(sut, 'verifyTransfer').mockResolvedValue(true as any);
        jest.spyOn(sut, 'transferHiveTokens').mockResolvedValue(true as any);
        jest.spyOn(sut['client'].database, 'getAccounts').mockResolvedValue([{ balance: '2000.000 HIVE' }] as any);

        const memo = JSON.stringify({
            hive_stream: {
                contract: 'roulette',
                action: 'spin',
                payload: {
                    betType: 'range',
                    value: 'low'
                }
            }
        });

        await sut.processOperation(['transfer', { from: 'testuser', amount: '3.000 HBD', memo }], 1, 'block-1', 'block-0', 'trx-refund', '2019-06-23' as any);

        await sleep(100);

        expect(sut.transferHiveTokens).toHaveBeenCalledWith(
            'beggars',
            'testuser',
            '3.000',
            'HBD',
            '[Refund] You sent an invalid currency.'
        );
    });
});
