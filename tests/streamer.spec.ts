import { TimeAction } from '../src/actions';
import { Streamer } from '../src/streamer';

describe('Streamer', () => {
    let sut: Streamer;

    beforeEach(() => {
        sut = new Streamer({
            JSON_ID: 'testing'
        });
    });

    afterEach(() => {
        sut.stop();
    });

    describe('Adapters', () => {
        test('Registers adapter and calls the create lifecycle method', () => {
            const adapter = {
                create: jest.fn().mockResolvedValue(true),
                destroy: jest.fn()
            };

            sut.registerAdapter(adapter);

            expect(adapter.create).toBeCalled();
        });
    });

    describe('Actions', () => {
        test('Registers a new action', async () => {
            const adapter = {
                create: jest.fn().mockResolvedValue(true),
                destroy: jest.fn(),
                loadActions: jest.fn().mockResolvedValue([])
            };

            sut.registerAdapter(adapter);

            const action = new TimeAction('1m', 'testoneminute', 'testcontract', 'testmethod');

            await sut.registerAction(action);

            const foundAction = sut['actions'].find(a => a.id === 'testoneminute');

            expect(foundAction).not.toBeUndefined();
        });

        test('Does not allow duplicate actions of the same id', async () => {
            const adapter = {
                create: jest.fn().mockResolvedValue(true),
                destroy: jest.fn(),
                loadActions: jest.fn().mockResolvedValue([])
            };

            sut.registerAdapter(adapter);

            const action = new TimeAction('1m', 'testoneminute', 'testcontract', 'testmethod');
            const action2 = new TimeAction('1m', 'testoneminute', 'testcontract', 'testmethod');

            await sut.registerAction(action);
            await sut.registerAction(action2);

            expect(sut['actions'].length).toStrictEqual(1);
        });

        test('Registers actions loaded from adapter loadActions call', async () => {
            const adapter = {
                create: jest.fn().mockResolvedValue(true),
                destroy: jest.fn(),
                loadActions: jest.fn().mockResolvedValue([new TimeAction('1m', 'testoneminute', 'testcontract', 'testmethod')])
            };

            sut.registerAdapter(adapter);

            const action = new TimeAction('1h', 'testonehour', 'testcontract', 'testmethod');

            await sut.registerAction(action);

            const foundAction = sut['actions'].find(a => a.id === 'testoneminute');

            expect(foundAction).not.toBeUndefined();
        });
    });

    describe('Contracts', () => {
        test('Should register a new contract', () => {
            const contract = {
                myMethod: jest.fn()
            };

            sut.registerContract('testcontract', contract);

            expect(contract['_instance']).toBeInstanceOf(Streamer);
            expect(sut['contracts'].length).toStrictEqual(1);
        });

        test('Should register a new contract and call its create method', () => {
            const contract = {
                create: jest.fn(),
                myMethod: jest.fn()
            };

            sut.registerContract('testcontract', contract);

            expect(contract.create).toBeCalled();
            expect(contract['_instance']).toBeInstanceOf(Streamer);
            expect(sut['contracts'].length).toStrictEqual(1);
        });

        test('Should unregister a registered contract', () => {
            const contract = {
                myMethod: jest.fn()
            };

            sut.registerContract('testcontract', contract);
            sut.unregisterContract('testcontract');

            expect(sut['contracts'].length).toStrictEqual(0);
        });

        test('Should unregister a registered contract and call its destroy method', () => {
            const contract = {
                destroy: jest.fn(),
                myMethod: jest.fn()
            };

            sut.registerContract('testcontract', contract);
            sut.unregisterContract('testcontract');

            expect(contract.destroy).toBeCalled();
            expect(sut['contracts'].length).toStrictEqual(0);
        });
    });

    test('Start method should resume from previous block number', async () => {
        const adapter = {
            loadState: jest.fn().mockResolvedValue({ lastBlockNumber: 509992 })
        };

        sut.registerAdapter(adapter);

        jest.spyOn(sut as any, 'getBlock').mockImplementation(() => true);
        jest.spyOn(sut as any, 'getLatestBlock').mockImplementation(() => true);

        await sut.start();

        sut.stop();

        expect(sut['lastBlockNumber']).toStrictEqual(509992);
    });
});