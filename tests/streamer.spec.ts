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

            expect(adapter.create).toHaveBeenCalled();
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

            expect(contract.create).toHaveBeenCalled();
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

            expect(contract.destroy).toHaveBeenCalled();
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

    test('Start method should respect RESUME_FROM_STATE false', async () => {
        sut.setConfig({ LAST_BLOCK_NUMBER: 123, RESUME_FROM_STATE: false });
        
        const adapter = {
            create: jest.fn().mockResolvedValue(true),
            destroy: jest.fn(),
            loadActions: jest.fn().mockResolvedValue([]),
            loadState: jest.fn().mockResolvedValue({ lastBlockNumber: 999 }),
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

        expect(sut['lastBlockNumber']).toStrictEqual(123);

        sut.stop();
    });

    test('getBlock should process multiple blocks per batch when behind', async () => {
        const adapter = createMockAdapter();
        await sut.registerAdapter(adapter);

        sut.setConfig({ CATCH_UP_BATCH_SIZE: 3, BLOCK_CHECK_INTERVAL: 1, DEBUG_MODE: false });
        sut['lastBlockNumber'] = 10;

        const mockBlock = {
            block_id: 'block-id',
            previous: 'prev-id',
            transaction_ids: ['trx-1'],
            timestamp: '2023-01-01T00:00:00',
            transactions: []
        };

        sut['client'] = {
            database: {
                getDynamicGlobalProperties: jest.fn().mockResolvedValue({
                    head_block_number: 20,
                    time: '2023-01-01T00:00:00'
                }),
                getBlock: jest.fn().mockResolvedValue(mockBlock)
            }
        } as any;

        const loadBlockSpy = jest.spyOn(sut as any, 'loadBlock');

        await (sut as any).getBlock();
        clearTimeout(sut['blockNumberTimeout']);

        expect(loadBlockSpy).toHaveBeenCalledTimes(3);
        expect(sut['lastBlockNumber']).toStrictEqual(13);
    });
});
