import { sleep } from '@hivechain/dhive/lib/utils';
import { Streamer } from '../../src/streamer';
import { LottoContract } from '../../src/contracts/lotto.contract';

describe('Lotto Contract', () => {
    let sut: Streamer;
    let lottoContract: LottoContract;

    beforeEach(() => {
        sut = new Streamer({
            JSON_ID: 'test',
            PAYLOAD_IDENTIFIER: 'hiveContract'
        });

        (sut['client'] as any) = {
            database: {
                getAccounts: jest.fn()
            }
        };

        lottoContract = new LottoContract();
    });

    afterEach(() => {
        jest.resetAllMocks();
        sut.stop();
    });

    test('The buy method should be called', async () => {
        (sut['client'] as any).database.getAccounts = jest.fn(() => Promise.resolve([
            {
                balance: '2000.234 HIVE'
            }
        ]));

        sut.registerContract('lotto', lottoContract);

        jest.spyOn(lottoContract, 'buy');
        
        const operation = createOperation('transfer', {
            from: 'beggars',
            amount: '10.000 HIVE',
            memo: JSON.stringify({
                hiveContract: {
                    id: 'test',
                    name: 'lotto',
                    action: 'buy',
                    payload: {
                        type: 'hourly'
                    }
                }
            })

        });
        const operation2 = createOperation('transfer', {
            from: 'aggroed',
            amount: '10.000 HIVE',
            memo: JSON.stringify({
                hiveContract: {
                    id: 'test',
                    name: 'lotto',
                    action: 'buy',
                    payload: {
                        type: 'daily'
                    }
                }
            })
        });

        sut.processOperation(operation, 42323417, '52676', '1542355627', '0d972c0e076a3a2b2117e313b3a20743cad246bc', '2020-03-22T10:19:24.228Z' as any);
        sut.processOperation(operation2, 42323418, '52677', '1542355628', '0kdjasdkjdaksjd3123jhkjdhfkjsdhfkjshdkjfhsdkjfhsd', '2020-03-22T10:19:24.228Z' as any);
        sut.processOperation(operation, 42323419, '52678', '1542355629', '0fsdfsdfsdfsdfsdf9845092384', '2020-03-22T10:19:24.228Z' as any);
        sut.processOperation(operation, 42323420, '52679', '1542355630', '0fhjsdlkjfhlskdjflksdjflksjd', '2020-03-22T10:19:24.228Z' as any);
        sut.processOperation(operation, 42323421, '52680', '1542355631', '0dkfjsd89723hjdsfkh978216hsjagfdnbm', '2020-03-22T10:19:24.228Z' as any);

        expect(lottoContract.buy).toBeCalledTimes(5);

        expect(lottoContract.buy).toBeCalledWith({type: 'hourly'}, {amount: '10.000 HIVE', sender: 'beggars'});
        expect(lottoContract.buy).toBeCalledWith({type: 'daily'}, {amount: '10.000 HIVE', sender: 'aggroed'});
    });

    test('User attempted to buy a ticket with an invalid currency, refund them', async () => {
        sut.registerContract('lotto', lottoContract);

        jest.spyOn(lottoContract, 'buy');
        
        const operation = createOperation('transfer', {
            from: 'beggars',
            amount: '10.000 HBD',
            memo: JSON.stringify({
                hiveContract: {
                    id: 'test',
                    name: 'lotto',
                    action: 'buy',
                    payload: {
                        type: 'hourly'
                    }
                }
            })

        });
        
        jest.spyOn(lottoContract as any, 'getBalance').mockResolvedValue(2000);
        jest.spyOn(lottoContract['_instance'], 'getTransaction').mockResolvedValue({} as any);
        jest.spyOn(lottoContract['_instance'], 'verifyTransfer').mockResolvedValue(true);
        jest.spyOn(lottoContract['_instance'], 'transferHiveTokens').mockResolvedValue({} as any);

        sut.processOperation(operation, 42323417, '52676', '1542355627', '0d972c0e076a3a2b2117e313b3a20743cad246bc', '2020-03-22T10:19:24.228Z' as any);

        await sleep(550);

        expect(sut.transferHiveTokens).toBeCalledWith('beggars', 'beggars', '10.000', 'HBD', '[Refund] You sent an invalid currency.');
    });

    test('User sent too much, refund them', async () => {
        sut.registerContract('lotto', lottoContract);

        jest.spyOn(lottoContract, 'buy');
        
        const operation = createOperation('transfer', {
            from: 'beggars',
            amount: '52.000 HIVE',
            memo: JSON.stringify({
                hiveContract: {
                    id: 'test',
                    name: 'lotto',
                    action: 'buy',
                    payload: {
                        type: 'hourly'
                    }
                }
            })

        });
        
        jest.spyOn(lottoContract as any, 'getBalance').mockResolvedValue(2000);
        jest.spyOn(lottoContract['_instance'], 'getTransaction').mockResolvedValue({} as any);
        jest.spyOn(lottoContract['_instance'], 'verifyTransfer').mockResolvedValue(true);
        jest.spyOn(lottoContract['_instance'], 'transferHiveTokens').mockResolvedValue({} as any);

        sut.processOperation(operation, 42323417, '52676', '1542355627', '0d972c0e076a3a2b2117e313b3a20743cad246bc', '2020-03-22T10:19:24.228Z' as any);

        await sleep(1000);

        expect(sut.transferHiveTokens).toBeCalledWith('beggars', 'beggars', '52.000', 'HIVE', '[Refund] A ticket costs 10 HIVE. You sent 52.000 HIVE');
    });

    test('User sent invalid draw type, refund them', async () => {
        sut.registerContract('lotto', lottoContract);

        jest.spyOn(lottoContract, 'buy');
        
        const operation = createOperation('transfer', {
            from: 'beggars',
            amount: '10.000 HIVE',
            memo: JSON.stringify({
                hiveContract: {
                    id: 'test',
                    name: 'lotto',
                    action: 'buy',
                    payload: {
                        type: 'fsff'
                    }
                }
            })

        });
        
        jest.spyOn(lottoContract as any, 'getBalance').mockResolvedValue(2000);
        jest.spyOn(lottoContract['_instance'], 'getTransaction').mockResolvedValue({} as any);
        jest.spyOn(lottoContract['_instance'], 'verifyTransfer').mockResolvedValue(true);
        jest.spyOn(lottoContract['_instance'], 'transferHiveTokens').mockResolvedValue({} as any);

        sut.processOperation(operation, 42323417, '52676', '1542355627', '0d972c0e076a3a2b2117e313b3a20743cad246bc', '2020-03-22T10:19:24.228Z' as any);

        await sleep(550);

        expect(sut.transferHiveTokens).toBeCalledWith('beggars', 'beggars', '10.000', 'HIVE', '[Refund] You specified an invalid draw type');
    });
});

function createOperation(type, payload) {
    return [
        type,
        payload
    ];
}