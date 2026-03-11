import { Streamer } from '../src/streamer';
import { action, defineContract } from '../src/contracts/contract';
import { createMockAdapter } from './helpers/mock-adapter';

describe('Streamer lifecycle safety', () => {
    test('does not start the API server until start is called', async () => {
        const streamer = new Streamer({
            apiEnabled: true,
            apiPort: 0,
            debugMode: false
        });
        const getBlockSpy = jest.spyOn(streamer as any, 'getBlock').mockResolvedValue(undefined);

        expect(streamer.getApiServer()).toBeNull();

        await streamer.registerAdapter(createMockAdapter());
        await streamer.start();
        await streamer.start();

        expect(getBlockSpy).toHaveBeenCalledTimes(1);
        expect(streamer.getApiServer()).not.toBeNull();

        await streamer.stop();

        expect(streamer.getApiServer()).toBeNull();
    });

    test('reinitializes contract hooks when the adapter changes and tears them down on stop', async () => {
        const createHook = jest.fn();
        const destroyHook = jest.fn();
        const streamer = new Streamer({ debugMode: false });
        const firstAdapter = createMockAdapter();
        const secondAdapter = createMockAdapter();

        await streamer.registerAdapter(firstAdapter);
        await streamer.registerContract(defineContract({
            name: 'lifecycle',
            hooks: {
                create: createHook,
                destroy: destroyHook
            },
            actions: {
                noop: action(jest.fn(), { trigger: 'custom_json' })
            }
        }));

        expect(createHook).toHaveBeenCalledTimes(1);
        expect(destroyHook).toHaveBeenCalledTimes(0);

        await streamer.registerAdapter(secondAdapter);

        expect(destroyHook).toHaveBeenCalledTimes(1);
        expect(createHook).toHaveBeenCalledTimes(2);

        await streamer.stop();

        expect(destroyHook).toHaveBeenCalledTimes(2);
    });

    test('processes operations sequentially within a block', async () => {
        const streamer = new Streamer({ debugMode: false });
        const order: string[] = [];

        await streamer.registerAdapter(createMockAdapter());

        streamer['blockProvider'] = {
            getDynamicGlobalProperties: jest.fn().mockResolvedValue({ head_block_number: 1, time: '2025-01-01T00:00:00' }),
            getBlock: jest.fn().mockResolvedValue({
                timestamp: '2025-01-01T00:00:00',
                block_id: 'block-1',
                previous: 'block-0',
                transaction_ids: ['trx-1'],
                transactions: [{
                    operations: [
                        ['custom_json', {
                            id: 'first',
                            json: '{}',
                            required_auths: ['alice'],
                            required_posting_auths: []
                        }],
                        ['custom_json', {
                            id: 'second',
                            json: '{}',
                            required_auths: ['alice'],
                            required_posting_auths: []
                        }]
                    ]
                }]
            })
        } as any;

        jest.spyOn(streamer as any, 'processOperation').mockImplementation(async (operation: [string, any]) => {
            const id = operation[1].id;
            order.push(`start-${id}`);

            if (id === 'first') {
                await new Promise((resolve) => setTimeout(resolve, 10));
            }

            order.push(`end-${id}`);
        });

        await streamer['loadBlock'](1);
        await streamer.stop();

        expect(order).toEqual([
            'start-first',
            'end-first',
            'start-second',
            'end-second'
        ]);
    });
});
