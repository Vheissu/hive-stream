import { CoinflipContract } from '../../src/contracts/coinflip.contract';
import { sleep } from '@hiveio/dhive/lib/utils';
import { Streamer } from '../../src/streamer';
import { createMockAdapter } from '../helpers/mock-adapter';

// Mock uuid module at the top level
jest.mock('uuid', () => ({
    v4: jest.fn()
}));

import { v4 as uuidv4 } from 'uuid';

describe('Coinflip Contract', () => {
    let sut: Streamer;
    let contract: CoinflipContract;

    beforeEach(async () => {
        sut = new Streamer();
        await sut.registerAdapter(createMockAdapter());
        
        contract = new CoinflipContract();

        // @ts-ignore
        sut.api = jest.fn();
    });

    afterEach(async () => {
        await sut.stop();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    afterAll(() => {
        jest.resetAllMocks();
    });

    test('Registers the contract', () => {
        sut.registerContract('coinflip', contract);

        const findContract = sut['contracts'].find(c => c.name === 'coinflip');

        expect(findContract).not.toBeUndefined();
    });

    test('User wins a flip', async () => {
        sut.registerContract('coinflip', contract);

        contract['_instance'] = sut;

        jest.spyOn(contract as any, 'flip');

        jest.spyOn(sut, 'getTransaction').mockResolvedValue({test: 123} as any);
        jest.spyOn(sut, 'verifyTransfer').mockResolvedValue(true as any);
        jest.spyOn(sut, 'transferHiveTokens').mockResolvedValue(true as any);

        const memo = JSON.stringify({
            hivePayload: {
                id: 'hivestream',
                name: 'coinflip',
                action: 'flip',
                payload: {
                    guess: 'heads',
                    seed: 'hj879879g7686876'
                }
            }
        });

        (uuidv4 as jest.Mock).mockReturnValue('j93jgsjghjdhgjfhgkfdhgkj34872394723');

        sut.processOperation(['transfer', { from: 'testuser', amount: '9.000 HIVE', memo }], 778782, 'dfjfsdfsdfs4hfkj88787', 'fkjs7878dkfj', 'fhkjsdhfkjsdf', '2019-06-23' as any);

        await sleep(100);

        expect(contract['flip']).toBeCalled();
        expect(contract['_instance'].getTransaction).toBeCalledWith(778782, 'fhkjsdhfkjsdf');
        expect(contract['_instance'].transferHiveTokens).toBeCalledWith('beggars', 'testuser', '18.000', 'HIVE', '[Winner] | Guess: heads | Server Roll: heads | Previous block id: fkjs7878dkfj | BlockID: dfjfsdfsdfs4hfkj88787 | Trx ID: fhkjsdhfkjsdf | Server Seed: j93jgsjghjdhgjfhgkfdhgkj34872394723');
    });

    test('User loses a flip', async () => {
        sut.registerContract('coinflip', contract);

        contract['_instance'] = sut;

        jest.spyOn(contract as any, 'flip');

        jest.spyOn(sut, 'getTransaction').mockResolvedValue({test: 123} as any);
        jest.spyOn(sut, 'verifyTransfer').mockResolvedValue(true as any);
        jest.spyOn(sut, 'transferHiveTokens').mockResolvedValue(true as any);

        const memo = JSON.stringify({
            hivePayload: {
                id: 'hivestream',
                name: 'coinflip',
                action: 'flip',
                payload: {
                    guess: 'heads',
                    seed: 'tulips'
                }
            }
        });

        (uuidv4 as jest.Mock).mockReturnValue('j93jgsjghjdhgjfhgkfdhgkj34872394723');

        sut.processOperation(['transfer', { from: 'testuser', amount: '9.000 HIVE', memo }], 778782, 'dfjfsdfsdfs4hfkj88787', 'fkjs7878dkfj', 'fhkjsdhfkjsdf', '2019-06-23' as any);

        await sleep(100);

        expect(contract['flip']).toBeCalled();
        expect(contract['_instance'].getTransaction).toBeCalledWith(778782, 'fhkjsdhfkjsdf');
        expect(contract['_instance'].transferHiveTokens).toBeCalledWith('beggars', 'testuser', '0.001', 'HIVE', '[Lost] | Guess: heads | Server Roll: tails | Previous block id: fkjs7878dkfj | BlockID: dfjfsdfsdfs4hfkj88787 | Trx ID: fhkjsdhfkjsdf | Server Seed: j93jgsjghjdhgjfhgkfdhgkj34872394723');
    });

    test('User sent an unsupported currency, refund them', async () => {
        sut.registerContract('coinflip', contract);

        contract['_instance'] = sut;

        jest.spyOn(contract as any, 'flip');

        jest.spyOn(sut, 'getTransaction').mockResolvedValue({test: 123} as any);
        jest.spyOn(sut, 'verifyTransfer').mockResolvedValue(true as any);
        jest.spyOn(sut, 'transferHiveTokens').mockResolvedValue(true as any);

        const memo = JSON.stringify({
            hivePayload: {
                id: 'hivestream',
                name: 'coinflip',
                action: 'flip',
                payload: {
                    guess: 'heads'
                }
            }
        });

        sut.processOperation(['transfer', { from: 'testuser', amount: '10.000 HBD', memo }], 778782, 'dfjfsdfsdfs4hfkj88787', 'fkjsdkfj', 'fhkjsdhfkjsdf', '2019-06-23' as any);

        await sleep(100);

        expect(contract['flip']).toBeCalled();
        expect(sut.getTransaction).toBeCalledWith(778782, 'fhkjsdhfkjsdf');
        expect(sut.transferHiveTokens).toBeCalledWith('beggars', 'testuser', '10.000', 'HBD', '[Refund] You sent an invalid currency.');
    });
});