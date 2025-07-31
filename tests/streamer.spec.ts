import { TimeAction } from '../src/actions';
import { Streamer } from '../src/streamer';
import { createMockAdapter } from './helpers/mock-adapter';

describe('Streamer', () => {
    let sut: Streamer;

    beforeEach(async () => {
        sut = new Streamer({
            JSON_ID: 'testing'
        });
        
        await sut.registerAdapter(createMockAdapter());
    });

    afterEach(async () => {
        await sut.stop();
    });

    describe('Adapters', () => {
        test('Registers adapter and calls the create lifecycle method', async () => {
            const adapter = {
                create: jest.fn().mockResolvedValue(true),
                destroy: jest.fn(),
                loadActions: jest.fn().mockResolvedValue([]),
                loadState: jest.fn().mockResolvedValue(null),
                saveState: jest.fn().mockResolvedValue(true),
                processBlock: jest.fn(),
                processOperation: jest.fn(),
                processTransfer: jest.fn(),
                processCustomJson: jest.fn(),
                find: jest.fn(),
                findOne: jest.fn(),
                insert: jest.fn(),
                replace: jest.fn(),
                addEvent: jest.fn(),
                client: null,
                db: null
            } as any;

            await sut.registerAdapter(adapter);

            expect(adapter.create).toBeCalled();
        });
    });

    describe('Actions', () => {
        test('Registers a new action', async () => {
            const mockContract = {
                testmethod: jest.fn()
            };
            
            sut.registerContract('testcontract', mockContract);
            
            const adapter = {
                create: jest.fn().mockResolvedValue(true),
                destroy: jest.fn(),
                loadActions: jest.fn().mockResolvedValue([]),
                loadState: jest.fn().mockResolvedValue(null),
                saveState: jest.fn().mockResolvedValue(true),
                processBlock: jest.fn(),
                processOperation: jest.fn(),
                processTransfer: jest.fn(),
                processCustomJson: jest.fn(),
                find: jest.fn(),
                findOne: jest.fn(),
                insert: jest.fn(),
                replace: jest.fn(),
                client: null,
                db: null
            } as any;

            sut.registerAdapter(adapter);

            const action = new TimeAction('1m', 'testoneminute', 'testcontract', 'testmethod');

            await sut.registerAction(action);

            const foundAction = sut['actions'].find(a => a.id === 'testoneminute');

            expect(foundAction).not.toBeUndefined();
        });

        test('Does not allow duplicate actions of the same id', async () => {
            const mockContract = {
                testmethod: jest.fn()
            };
            
            sut.registerContract('testcontract', mockContract);
            
            const adapter = {
                create: jest.fn().mockResolvedValue(true),
                destroy: jest.fn(),
                loadActions: jest.fn().mockResolvedValue([]),
                loadState: jest.fn().mockResolvedValue(null),
                saveState: jest.fn().mockResolvedValue(true),
                processBlock: jest.fn(),
                processOperation: jest.fn(),
                processTransfer: jest.fn(),
                processCustomJson: jest.fn(),
                find: jest.fn(),
                findOne: jest.fn(),
                insert: jest.fn(),
                replace: jest.fn(),
                client: null,
                db: null
            } as any;

            sut.registerAdapter(adapter);

            const action = new TimeAction('1m', 'testoneminute', 'testcontract', 'testmethod');
            const action2 = new TimeAction('1m', 'testoneminute', 'testcontract', 'testmethod');

            await sut.registerAction(action);
            await sut.registerAction(action2);

            expect(sut['actions'].length).toStrictEqual(1);
        });

        test('Registers actions loaded from adapter loadActions call', async () => {
            const mockContract = {
                testmethod: jest.fn()
            };
            
            sut.registerContract('testcontract', mockContract);
            
            const adapter = {
                create: jest.fn().mockResolvedValue(true),
                destroy: jest.fn(),
                loadActions: jest.fn().mockResolvedValue([{
                    timeValue: '1m',
                    id: 'testoneminute',
                    contractName: 'testcontract',
                    contractMethod: 'testmethod',
                    payload: {},
                    date: new Date().toISOString(),
                    enabled: true,
                    executionCount: 0
                }]),
                loadState: jest.fn().mockResolvedValue(null),
                saveState: jest.fn().mockResolvedValue(true),
                processBlock: jest.fn(),
                processOperation: jest.fn(),
                processTransfer: jest.fn(),
                processCustomJson: jest.fn(),
                find: jest.fn(),
                findOne: jest.fn(),
                insert: jest.fn(),
                replace: jest.fn(),
                client: null,
                db: null
            } as any;

            await sut.registerAdapter(adapter);

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
        // Override config to not have a preset LAST_BLOCK_NUMBER
        sut.setConfig({ LAST_BLOCK_NUMBER: 0 });
        
        const adapter = {
            create: jest.fn().mockResolvedValue(true),
            destroy: jest.fn(),
            loadActions: jest.fn().mockResolvedValue([]),
            loadState: jest.fn().mockResolvedValue({ lastBlockNumber: 509992 }),
            saveState: jest.fn().mockResolvedValue(true),
            processBlock: jest.fn(),
            processOperation: jest.fn(),
            processTransfer: jest.fn(),
            processCustomJson: jest.fn(),
            find: jest.fn(),
            findOne: jest.fn(),
            insert: jest.fn(),
            replace: jest.fn(),
            client: null,
            db: null
        } as any;

        await sut.registerAdapter(adapter);

        jest.spyOn(sut as any, 'getBlock').mockImplementation(() => true);
        jest.spyOn(sut as any, 'getLatestBlock').mockImplementation(() => true);

        await sut.start();

        expect(sut['lastBlockNumber']).toStrictEqual(509992);

        sut.stop();
    });
});