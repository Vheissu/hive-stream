import { TimeAction } from '../src/actions';
import { Streamer } from '../src/streamer';
import { action as contractAction, defineContract } from '../src/contracts/contract';
import { createMockAdapter } from './helpers/mock-adapter';
import { HiveProvider } from '../src/providers/hive-provider';
import { BlockProvider } from '../src/providers/block-provider';

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
            const mockContract = defineContract({
                name: 'testcontract',
                actions: {
                    testmethod: contractAction(jest.fn(), { trigger: 'time' })
                }
            });
            
            await sut.registerContract(mockContract);
            
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

            await sut.registerAdapter(adapter);

            const action = new TimeAction('1m', 'testoneminute', 'testcontract', 'testmethod');

            await sut.registerAction(action);

            const foundAction = sut['actions'].find(a => a.id === 'testoneminute');

            expect(foundAction).not.toBeUndefined();
        });

        test('Does not allow duplicate actions of the same id', async () => {
            const mockContract = defineContract({
                name: 'testcontract',
                actions: {
                    testmethod: contractAction(jest.fn(), { trigger: 'time' })
                }
            });
            
            await sut.registerContract(mockContract);
            
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

            await sut.registerAdapter(adapter);

            const action = new TimeAction('1m', 'testoneminute', 'testcontract', 'testmethod');
            const action2 = new TimeAction('1m', 'testoneminute', 'testcontract', 'testmethod');

            await sut.registerAction(action);
            await sut.registerAction(action2);

            expect(sut['actions'].length).toStrictEqual(1);
        });

        test('Registers actions loaded from adapter loadActions call', async () => {
            const mockContract = defineContract({
                name: 'testcontract',
                actions: {
                    testmethod: contractAction(jest.fn(), { trigger: 'time' })
                }
            });
            
            await sut.registerContract(mockContract);
            
            const adapter = {
                create: jest.fn().mockResolvedValue(true),
                destroy: jest.fn(),
                loadActions: jest.fn().mockResolvedValue([{
                    timeValue: '1m',
                    id: 'testoneminute',
                    contractName: 'testcontract',
                    contractAction: 'testmethod',
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
        test('Should register a new contract', async () => {
            const contract = defineContract({
                name: 'testcontract',
                actions: {
                    myMethod: contractAction(jest.fn())
                }
            });

            await sut.registerContract(contract);

            expect(sut['contracts'].length).toStrictEqual(1);
        });

        test('Should register a new contract and call its create hook', async () => {
            const createHook = jest.fn();
            const contract = defineContract({
                name: 'testcontract',
                hooks: {
                    create: createHook
                },
                actions: {
                    myMethod: contractAction(jest.fn())
                }
            });

            await sut.registerContract(contract);

            expect(createHook).toHaveBeenCalled();
            expect(sut['contracts'].length).toStrictEqual(1);
        });

        test('Should unregister a registered contract', async () => {
            const contract = defineContract({
                name: 'testcontract',
                actions: {
                    myMethod: contractAction(jest.fn())
                }
            });

            await sut.registerContract(contract);
            await sut.unregisterContract('testcontract');

            expect(sut['contracts'].length).toStrictEqual(0);
        });

        test('Should unregister a registered contract and call its destroy hook', async () => {
            const destroyHook = jest.fn();
            const contract = defineContract({
                name: 'testcontract',
                hooks: {
                    destroy: destroyHook
                },
                actions: {
                    myMethod: contractAction(jest.fn())
                }
            });

            await sut.registerContract(contract);
            await sut.unregisterContract('testcontract');

            expect(destroyHook).toHaveBeenCalled();
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

    describe('Block Providers', () => {
        test('default Streamer uses HiveProvider', () => {
            const provider = sut.getBlockProvider();

            expect(provider).toBeInstanceOf(HiveProvider);
        });

        test('custom provider passed via config is used', () => {
            const mockProvider: BlockProvider = {
                getDynamicGlobalProperties: jest.fn().mockResolvedValue({ head_block_number: 1, time: '' }),
                getBlock: jest.fn().mockResolvedValue(null),
            };

            const streamer = new Streamer({ blockProvider: mockProvider });

            expect(streamer.getBlockProvider()).toBe(mockProvider);
        });

        test('registerBlockProvider replaces existing provider', async () => {
            const mockProvider: BlockProvider = {
                getDynamicGlobalProperties: jest.fn().mockResolvedValue({ head_block_number: 1, time: '' }),
                getBlock: jest.fn().mockResolvedValue(null),
                create: jest.fn().mockResolvedValue(undefined),
                destroy: jest.fn().mockResolvedValue(undefined),
            };

            const oldProvider = sut.getBlockProvider();
            await sut.registerBlockProvider(mockProvider);

            expect(sut.getBlockProvider()).toBe(mockProvider);
            expect(sut.getBlockProvider()).not.toBe(oldProvider);
            expect(mockProvider.create).toHaveBeenCalled();
        });

        test('provider create() called on start, destroy() called on stop', async () => {
            const mockProvider: BlockProvider = {
                getDynamicGlobalProperties: jest.fn().mockResolvedValue({ head_block_number: 1, time: '' }),
                getBlock: jest.fn().mockResolvedValue(null),
                create: jest.fn().mockResolvedValue(undefined),
                destroy: jest.fn().mockResolvedValue(undefined),
            };

            const streamer = new Streamer({ blockProvider: mockProvider });
            await streamer.registerAdapter(createMockAdapter());

            jest.spyOn(streamer as any, 'getBlock').mockImplementation(() => true);
            jest.spyOn(streamer as any, 'getLatestBlock').mockImplementation(() => true);

            await streamer.start();

            expect(mockProvider.create).toHaveBeenCalled();

            await streamer.stop();

            expect(mockProvider.destroy).toHaveBeenCalled();
        });
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

        sut['blockProvider'] = {
            getDynamicGlobalProperties: jest.fn().mockResolvedValue({
                head_block_number: 20,
                time: '2023-01-01T00:00:00'
            }),
            getBlock: jest.fn().mockResolvedValue(mockBlock)
        } as any;

        const loadBlockSpy = jest.spyOn(sut as any, 'loadBlock');

        await (sut as any).getBlock();
        clearTimeout(sut['blockNumberTimeout']);

        expect(loadBlockSpy).toHaveBeenCalledTimes(3);
        expect(sut['lastBlockNumber']).toStrictEqual(13);
    });
});
