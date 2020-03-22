import { Client } from 'dsteem';
import { Streamer } from './../src/streamer';

import fs from 'fs';
import { sleep } from 'dsteem/lib/utils';

jest.mock('fs');

describe('Streamer', () => {

    let sut: Streamer;

    beforeEach(() => {
        sut = new Streamer({});
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

        jest.spyOn(sut as any, 'getBlock');

        await sut['getBlock']();

        expect(sut['lastBlockNumber']).toStrictEqual(8882);

        // Wait for 3 block cycles to be called
        await sleep(3000);

        expect(sut['loadBlock']).toBeCalledWith(8882);

        expect(sut['getBlock']).toBeCalledTimes(3);
    });

    test('getBlock global properties returns null', async () => {
        jest.spyOn(sut['client'].database, 'getDynamicGlobalProperties').mockResolvedValue(null);

        jest.spyOn(sut as any, 'getBlock');
        jest.spyOn(sut as any, 'loadBlock');

        await sut['getBlock']();
        await sleep(1000);

        expect(sut['getBlock']).toBeCalled();
    });

    test('getBlock more than 25 blocks behind main block', async () => {
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

        jest.spyOn(sut as any, 'loadBlock');

        sut['lastBlockNumber'] = 8825;

        await sut['getBlock']();

        expect(sut['lastBlockNumber']).toStrictEqual(8882);

        // Load block should be called 57 times because we're 57 blocks behind
        expect(sut['loadBlock']).toBeCalledTimes(57);
    });

    test('getBlock client error should retry', async () => {
        jest.spyOn(sut['client'].database, 'getDynamicGlobalProperties').mockRejectedValue({ message: 'network error' });
        jest.spyOn(sut as any, 'getBlock');
        jest.spyOn(sut as any, 'loadBlock');

        expect(sut['attempts']).toStrictEqual(0);

        await sut['getBlock']();

        expect(sut['loadBlock']).not.toBeCalled();

        expect(sut['attempts']).toStrictEqual(1);
    });

});