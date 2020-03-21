import { Client } from 'dsteem';
import { Streamer } from './../src/streamer';

import fs from 'fs';

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

});