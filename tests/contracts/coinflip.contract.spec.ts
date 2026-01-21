import { createCoinflipContract } from '../../src/contracts/coinflip.contract';
import { sleep } from '@hiveio/dhive/lib/utils';
import { Streamer } from '../../src/streamer';
import { createMockAdapter } from '../helpers/mock-adapter';

jest.mock('uuid', () => ({
    v4: jest.fn()
}));

import { v4 as uuidv4 } from 'uuid';

describe('Coinflip Contract', () => {
    let sut: Streamer;
    let contract: ReturnType<typeof createCoinflipContract>;

    beforeEach(async () => {
        sut = new Streamer();
        await sut.registerAdapter(createMockAdapter());
        contract = createCoinflipContract();

        // @ts-ignore
        sut.api = jest.fn();
    });

    afterEach(async () => {
        await sut.stop();
        jest.restoreAllMocks();
    });

    test('Registers the contract', async () => {
        await sut.registerContract(contract);

        const findContract = sut['contracts'].find(c => c.name === 'coinflip');
        expect(findContract).not.toBeUndefined();
    });

    test('User wins a flip', async () => {
        await sut.registerContract(contract);

        jest.spyOn(sut, 'getTransaction').mockResolvedValue({ test: 123 } as any);
        jest.spyOn(sut, 'verifyTransfer').mockResolvedValue(true as any);
        jest.spyOn(sut, 'transferHiveTokens').mockResolvedValue(true as any);
        jest.spyOn(sut['client'].database, 'getAccounts').mockResolvedValue([{ balance: '2000.000 HIVE' }] as any);

        (uuidv4 as jest.Mock).mockReturnValue('j93jgsjghjdhgjfhgkfdhgkj34872394723');

        const memo = JSON.stringify({
            hive_stream: {
                contract: 'coinflip',
                action: 'flip',
                payload: {
                    guess: 'heads',
                    seed: 'hj879879g7686876'
                }
            }
        });

        await sut.processOperation(['transfer', { from: 'testuser', amount: '9.000 HIVE', memo }], 778782, 'dfjfsdfsdfs4hfkj88787', 'fkjs7878dkfj', 'fhkjsdhfkjsdf', '2019-06-23' as any);

        await sleep(100);

        expect(sut.getTransaction).toHaveBeenCalledWith(778782, 'fhkjsdhfkjsdf');
        expect(sut.transferHiveTokens).toHaveBeenCalledWith('beggars', 'testuser', '18.000', 'HIVE', '[Winner] | Guess: heads | Server Roll: heads | Previous block id: fkjs7878dkfj | BlockID: dfjfsdfsdfs4hfkj88787 | Trx ID: fhkjsdhfkjsdf | Server Seed: j93jgsjghjdhgjfhgkfdhgkj34872394723');
    });

    test('User loses a flip', async () => {
        await sut.registerContract(contract);

        jest.spyOn(sut, 'getTransaction').mockResolvedValue({ test: 123 } as any);
        jest.spyOn(sut, 'verifyTransfer').mockResolvedValue(true as any);
        jest.spyOn(sut, 'transferHiveTokens').mockResolvedValue(true as any);
        jest.spyOn(sut['client'].database, 'getAccounts').mockResolvedValue([{ balance: '2000.000 HIVE' }] as any);

        (uuidv4 as jest.Mock).mockReturnValue('j93jgsjghjdhgjfhgkfdhgkj34872394723');

        const memo = JSON.stringify({
            hive_stream: {
                contract: 'coinflip',
                action: 'flip',
                payload: {
                    guess: 'heads',
                    seed: 'tulips'
                }
            }
        });

        await sut.processOperation(['transfer', { from: 'testuser', amount: '9.000 HIVE', memo }], 778782, 'dfjfsdfsdfs4hfkj88787', 'fkjs7878dkfj', 'fhkjsdhfkjsdf', '2019-06-23' as any);

        await sleep(100);

        expect(sut.getTransaction).toHaveBeenCalledWith(778782, 'fhkjsdhfkjsdf');
        expect(sut.transferHiveTokens).toHaveBeenCalledWith('beggars', 'testuser', '0.001', 'HIVE', '[Lost] | Guess: heads | Server Roll: tails | Previous block id: fkjs7878dkfj | BlockID: dfjfsdfsdfs4hfkj88787 | Trx ID: fhkjsdhfkjsdf | Server Seed: j93jgsjghjdhgjfhgkfdhgkj34872394723');
    });
});
