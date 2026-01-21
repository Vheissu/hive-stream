import { createLottoContract } from './../../src/contracts/lotto.contract';
import { Streamer } from '../../src/streamer';
import { createMockAdapter } from '../helpers/mock-adapter';

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe('Lotto Contract', () => {
    let sut: Streamer;
    let contract: ReturnType<typeof createLottoContract>;
    let adapter: any;

    beforeEach(async () => {
        sut = new Streamer();
        adapter = createMockAdapter();
        await sut.registerAdapter(adapter);

        contract = createLottoContract({ name: 'testlotto' });

        // @ts-ignore
        sut.api = jest.fn();
    });

    afterEach(async () => {
        await sut.stop();
    });

    test('Registers the lotto contract', async () => {
        await sut.registerContract(contract);

        const findContract = sut['contracts'].find(c => c.name === 'testlotto');
        expect(findContract).not.toBeUndefined();
    });

    test('Buys a lotto ticket and inserts a draw entry', async () => {
        await sut.registerContract(contract);

        jest.spyOn(sut, 'getTransaction').mockResolvedValue({ test: 123 } as any);
        jest.spyOn(sut, 'verifyTransfer').mockResolvedValue(true as any);

        const insertSpy = jest.spyOn(adapter, 'insert').mockResolvedValue(true as any);
        jest.spyOn(adapter, 'find').mockResolvedValue([] as any);

        const memo = JSON.stringify({
            hive_stream: {
                contract: 'testlotto',
                action: 'buy',
                payload: {
                    type: 'hourly'
                }
            }
        });

        await sut.processOperation(['transfer', { from: 'testuser', amount: '10.000 HIVE', memo }], 778782, 'blockid', 'prev', 'trxid', '2019-06-23' as any);

        await wait(50);

        expect(insertSpy).toHaveBeenCalled();
    });
});
