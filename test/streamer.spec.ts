import { Client } from '@hivechain/dhive';
import { Streamer } from './../src/streamer';

import fs from 'fs';
import { sleep } from 'dsteem/lib/utils';

jest.mock('fs');

describe('Streamer', () => {

    let sut: Streamer;

    beforeEach(() => {
        sut = new Streamer({});
    });

    afterEach(() => {
        sut.stop();
    });

    test('Constructor should instantiate client instance', () => {
        expect(sut['client']).toBeInstanceOf(Client);
    });

    test('setConfig properly assigns multiple values', () => {
        sut.setConfig({
            LAST_BLOCK_NUMBER: 1234
        });

        expect(sut['config'].LAST_BLOCK_NUMBER).toStrictEqual(1234);
    });

    test('state file does not exist', () => {
        (fs as any).existsSync.mockReturnValue(false);

        jest.spyOn(fs, 'readFileSync');

        sut.start();

        expect(fs.readFileSync).not.toBeCalled();
    });

    test('state file does exist', () => {
        (fs as any).existsSync.mockReturnValue(true);

        jest.spyOn(fs, 'readFileSync').mockReturnValue(`{"lastBlockNumber": 27777}`);

        sut.start();

        expect(fs.readFileSync).toBeCalledWith('hive-stream.json');

        expect(sut['lastBlockNumber']).toStrictEqual(27777);
    });

    test('getBlock gets a block', async () => {
        jest.spyOn(sut['client'].database, 'getDynamicGlobalProperties').mockResolvedValue({head_block_number: 8882} as any);

        jest.spyOn(sut['client'].database, 'getBlock').mockResolvedValue({
            block_id: 1234,
            previous: 1233,
            transaction_ids: ['sdasd', 'dasdad'],
            timestamp: new Date().toDateString(),
            transactions: {
                0: {
                    operations: {
                        0: {}
                    }
                }
            }
        } as any);

        jest.spyOn(sut as any, 'getBlock');
        jest.spyOn(sut as any, 'loadBlock');

        sut['lastBlockNumber'] = 0;

        await sut['getBlock']();

        expect(sut['lastBlockNumber']).toStrictEqual(8882);

        // Wait for 3 block cycles to be called
        await sleep(3000);

        sut['disableAllProcessing'] = true;

        expect(sut['loadBlock']).toBeCalledWith(8882);

        expect(sut['getBlock']).toBeCalledTimes(3);
    });

    test('getBlock global properties returns null', async () => {
        jest.spyOn(sut['client'].database, 'getDynamicGlobalProperties').mockResolvedValue(null);

        jest.spyOn(sut as any, 'getBlock');
        jest.spyOn(sut as any, 'loadBlock');

        await sut['getBlock']();

        await sleep(1000);

        sut['disableAllProcessing'] = true;

        expect(sut['getBlock']).toBeCalled();
    });

    test('getBlock client error should retry', async () => {
        jest.spyOn(sut['client'].database, 'getDynamicGlobalProperties').mockRejectedValue({ message: 'network error' });
        jest.spyOn(sut as any, 'getBlock');
        jest.spyOn(sut as any, 'loadBlock');

        expect(sut['attempts']).toStrictEqual(0);

        await sut['getBlock']();

        sut['disableAllProcessing'] = true;

        expect(sut['loadBlock']).not.toBeCalled();

        expect(sut['attempts']).toStrictEqual(1);
    });

    test('processOperation calls post subscriber', () => {
        const callback = jest.fn();

        sut.onPost(callback);

        const operation = [
            'comment',
            { parent_author: '' }
        ];

        sut.processOperation(operation, 1234, 'ffsdfsd', '34fdfsd', '4234ff', '2020-03-22T10:19:24.228Z' as any);

        expect(callback).toBeCalledWith({'parent_author': ''}, 1234, 'ffsdfsd', '34fdfsd', '4234ff', '2020-03-22T10:19:24.228Z');
    });

    test('processOperation calls comment subscriber', () => {
        const callback = jest.fn();

        sut.onComment(callback);

        const operation = [
            'comment',
            { parent_author: 'beggars' }
        ];

        sut.processOperation(operation, 1234, 'ffsdfsd', '34fdfsd', '4234ff', '2020-03-22T10:19:24.228Z' as any);

        expect(callback).toBeCalledWith({'parent_author': 'beggars'}, 1234, 'ffsdfsd', '34fdfsd', '4234ff', '2020-03-22T10:19:24.228Z');
    });

    test('processOperation calls transfer subscriber', () => {
        const callback = jest.fn();

        sut.onTransfer('beggars', callback);

        const operation = [
            'transfer',
            { to: 'beggars' }
        ];

        sut.processOperation(operation, 1234, 'ffsdfsd', '34fdfsd', '4234ff', '2020-03-22T10:19:24.228Z' as any);

        expect(callback).toBeCalledWith({'to': 'beggars'}, 1234, 'ffsdfsd', '34fdfsd', '4234ff', '2020-03-22T10:19:24.228Z');
    });

    test('processOperation calls custom json subscriber signed with active key', () => {
        const callback = jest.fn();

        sut.onCustomJson(callback);

        const operation = [
            'custom_json',
            { id: 'test', required_auths: ['beggars'] }
        ];

        sut.processOperation(operation, 1234, 'ffsdfsd', '34fdfsd', '4234ff', '2020-03-22T10:19:24.228Z' as any);

        expect(callback).toBeCalledWith({'id': 'test', 'required_auths': ['beggars']}, {'isSignedWithActiveKey': true, 'sender': 'beggars'}, 1234, 'ffsdfsd', '34fdfsd', '4234ff', '2020-03-22T10:19:24.228Z');
    });

    test('processOperation calls custom json subscriber signed without active key', () => {
        const callback = jest.fn();

        sut.onCustomJson(callback);

        const operation = [
            'custom_json',
            { id: 'test', required_posting_auths: ['beggars'] }
        ];

        sut.processOperation(operation, 1234, 'ffsdfsd', '34fdfsd', '4234ff', '2020-03-22T10:19:24.228Z' as any);

        expect(callback).toBeCalledWith({'id': 'test', 'required_posting_auths': ['beggars']}, {'isSignedWithActiveKey': false, 'sender': 'beggars'}, 1234, 'ffsdfsd', '34fdfsd', '4234ff', '2020-03-22T10:19:24.228Z');
    });

    test('processOperation calls custom json ID subscriber signed with active key', () => {
        const callback = jest.fn();

        sut.onCustomJsonId(callback, 'test');

        const operation = [
            'custom_json',
            { id: 'test', required_auths: ['beggars'] }
        ];

        sut.processOperation(operation, 1234, 'ffsdfsd', '34fdfsd', '4234ff', '2020-03-22T10:19:24.228Z' as any);

        expect(callback).toBeCalledWith({'id': 'test', 'required_auths': ['beggars']}, {'isSignedWithActiveKey': true, 'sender': 'beggars'}, 1234, 'ffsdfsd', '34fdfsd', '4234ff', '2020-03-22T10:19:24.228Z');
    });

    test('processOperation calls custom json ID subscriber signed without active key', () => {
        const callback = jest.fn();

        sut.onCustomJsonId(callback, 'test');

        const operation = [
            'custom_json',
            { id: 'test', required_posting_auths: ['beggars'] }
        ];

        sut.processOperation(operation, 1234, 'ffsdfsd', '34fdfsd', '4234ff', '2020-03-22T10:19:24.228Z' as any);

        expect(callback).toBeCalledWith({'id': 'test', 'required_posting_auths': ['beggars']}, {'isSignedWithActiveKey': false, 'sender': 'beggars'}, 1234, 'ffsdfsd', '34fdfsd', '4234ff', '2020-03-22T10:19:24.228Z');
    });

    describe('Contracts', () => {

        test('contract create lifecycle function should be called', () => {
            const contract = {
                create: jest.fn()
            };

            // Register our contract
            sut.registerContract('dice', contract);

            const findContract = sut['contracts'].find(c => c.name === 'dice');

            expect(contract.create).toBeCalled();
            expect(findContract).not.toBeUndefined();
        });

        test('contract destroy lifecycle function should be called and unregistered', () => {
            const contract = {
                create: jest.fn(),
                destroy: jest.fn()
            };

            // Register our contract
            sut.registerContract('dice', contract);

            sut.unregisterContract('dice');

            expect(contract.destroy).toBeCalled();

            const findContract = sut['contracts'].find(c => c.name === 'dice');

            expect(findContract).toBeUndefined();
        });

        test('contract action should be called from payload', () => {
            const contract = {
                roll: jest.fn()
            };

            // Register our contract
            sut.registerContract('dice', contract);
    
            const operation = [
                'custom_json',
                {
                    id: 'test',
                    required_auths: ['beggars'], 
                    json: JSON.stringify({
                        hiveContract: {
                            name: 'dice',
                            action: 'roll',
                            payload: {
                                roll: 12,
                                amount: '1',
                                direction: 'lesserThan'
                            }
                        }
                    })
                }
            ];
    
            sut.processOperation(operation, 1234, 'ffsdfsd', '34fdfsd', '4234ff', '2020-03-22T10:19:24.228Z' as any);

            expect(contract.roll).toBeCalledWith({amount: '1', roll: 12, direction: 'lesserThan'}, { isSignedWithActiveKey: true, sender: 'beggars' }, 'test');
        });

        test('contract should be updated with block info', () => {
            const contract = {
                updateBlockInfo: jest.fn()
            };

            // Register our contract
            sut.registerContract('dice', contract);
    
            const operation = [
                'custom_json',
                {
                    id: 'test',
                    required_auths: ['beggars'], 
                    json: JSON.stringify({
                        hiveContract: {
                            name: 'dice',
                            action: 'roll',
                            payload: {
                                roll: 12,
                                amount: '1',
                                direction: 'lesserThan'
                            }
                        }
                    })
                }
            ];
    
            sut.processOperation(operation, 1234, 'ffsdfsd', '34fdfsd', '4234ff', '2020-03-22T10:19:24.228Z' as any);

            expect(contract.updateBlockInfo).toBeCalledWith(1234, 'ffsdfsd', '34fdfsd', '4234ff');
        });

    });

});