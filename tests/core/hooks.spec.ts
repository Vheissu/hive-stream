import { z } from 'zod';

import { action, defineContract, defineHooks, HookRegistry, Streamer } from '../../src';
import { createHarness, memo, transferOp } from './helpers';

function createEchoContract(calls: any[]) {
    return defineContract({
        name: 'echo',
        actions: {
            say: action((payload: any, ctx) => {
                calls.push({ payload, sender: ctx.sender });
            }, {
                trigger: ['transfer', 'custom_json'],
                schema: z.object({ text: z.string() })
            })
        }
    });
}

describe('Streamer hooks', () => {
    test('block and operation hooks run in order around processing', async () => {
        const order: string[] = [];
        const { streamer, provider } = await createHarness({
            config: {
                hooks: {
                    beforeBlock: ({ blockNumber }) => { order.push(`beforeBlock:${blockNumber}`); },
                    afterBlock: ({ blockNumber }) => { order.push(`afterBlock:${blockNumber}`); },
                    beforeOperation: ({ type, operationIndex }) => { order.push(`beforeOp:${type}:${operationIndex}`); },
                    afterOperation: ({ type, operationIndex }) => { order.push(`afterOp:${type}:${operationIndex}`); }
                }
            }
        });

        order.length = 0;
        streamer.onTransfer('app', () => { order.push('subscriber'); });
        provider.addBlock([transferOp('alice', '1.000 HIVE', '')]);
        await streamer.processPendingBlocks();

        expect(order).toEqual([
            'beforeBlock:2',
            'beforeOp:transfer:0',
            'subscriber',
            'afterOp:transfer:0',
            'afterBlock:2'
        ]);

        await streamer.stop();
    });

    test('beforeOperation returning false skips the operation', async () => {
        const seen: string[] = [];
        const { streamer, provider } = await createHarness();
        streamer.hook('beforeOperation', ({ data }) => data.from !== 'spammer');
        streamer.onTransfer('app', (op) => { seen.push(op.from); });

        provider.addBlock([transferOp('spammer', '0.001 HIVE', ''), transferOp('alice', '1.000 HIVE', '')]);
        await streamer.processPendingBlocks();

        expect(seen).toEqual(['alice']);
        await streamer.stop();
    });

    test('beforeContractAction can veto or transform, and throwing vetoes', async () => {
        const calls: any[] = [];
        const rejected: string[] = [];
        const { streamer, provider } = await createHarness();
        await streamer.registerContract(createEchoContract(calls));

        streamer.hook('beforeContractAction', ({ context, payload }) => {
            if (context.sender === 'banned') {
                return false;
            }

            if (context.sender === 'crash') {
                throw new Error('guard crashed');
            }

            return { payload: { text: payload.text.toUpperCase() } };
        });
        streamer.hook('onActionRejected', ({ reason, context }) => { rejected.push(`${context.sender}:${reason}`); });

        provider.addBlock([
            transferOp('alice', '1.000 HIVE', memo('echo', 'say', { text: 'hi' })),
            transferOp('banned', '1.000 HIVE', memo('echo', 'say', { text: 'hi' })),
            transferOp('crash', '1.000 HIVE', memo('echo', 'say', { text: 'hi' }))
        ]);
        await streamer.processPendingBlocks();

        expect(calls).toEqual([{ payload: { text: 'HI' }, sender: 'alice' }]);
        expect(rejected).toEqual(['banned:vetoed', 'crash:vetoed']);
        await streamer.stop();
    });

    test('afterContractAction reports duration; onInvalidPayload reports schema issues', async () => {
        const after = jest.fn();
        const invalid = jest.fn();
        const { streamer, provider } = await createHarness({ config: { hooks: { afterContractAction: after, onInvalidPayload: invalid } } });
        await streamer.registerContract(createEchoContract([]));

        provider.addBlock([
            transferOp('alice', '1.000 HIVE', memo('echo', 'say', { text: 'ok' })),
            transferOp('bob', '1.000 HIVE', memo('echo', 'say', { text: 42 }))
        ]);
        await streamer.processPendingBlocks();

        expect(after).toHaveBeenCalledWith(expect.objectContaining({ contract: 'echo', action: 'say', durationMs: expect.any(Number) }));
        expect(invalid).toHaveBeenCalledTimes(1);
        expect(invalid.mock.calls[0][0].issues[0].path).toEqual(['text']);
        await streamer.stop();
    });

    test('onActionRejected reports unknown contracts and triggers', async () => {
        const rejected: string[] = [];
        const { streamer, provider } = await createHarness();
        await streamer.registerContract(defineContract({
            name: 'jsononly',
            actions: { go: action(() => undefined, { trigger: 'custom_json' }) }
        }));
        streamer.hook('onActionRejected', ({ reason }) => { rejected.push(reason); });

        provider.addBlock([
            transferOp('alice', '1.000 HIVE', memo('missing', 'go')),
            transferOp('alice', '1.000 HIVE', memo('jsononly', 'nope')),
            transferOp('alice', '1.000 HIVE', memo('jsononly', 'go'))
        ]);
        await streamer.processPendingBlocks();

        expect(rejected).toEqual(['contract_not_found', 'action_not_found', 'trigger_not_allowed']);
        await streamer.stop();
    });

    test('onStart, onStop and onCaughtUp fire', async () => {
        const events: string[] = [];
        const { streamer, provider } = await createHarness({ genesis: false, config: { blockCheckInterval: 5 } });
        streamer.use({
            onStart: () => { events.push('start'); },
            onStop: () => { events.push('stop'); },
            onCaughtUp: ({ blockNumber }) => { events.push(`caughtUp:${blockNumber}`); }
        });

        provider.addBlock();
        await streamer.start();
        await new Promise((resolve) => setTimeout(resolve, 40));
        await streamer.stop();

        expect(events).toEqual(['start', 'caughtUp:1', 'stop']);
    });

    test('use() accepts plugin functions and returns a disposer', async () => {
        const seen: number[] = [];
        const { streamer, provider } = await createHarness();

        const dispose = streamer.use((instance) => {
            expect(instance).toBe(streamer);
            return { afterBlock: ({ blockNumber }) => { seen.push(blockNumber); } };
        });

        provider.addBlock();
        await streamer.processPendingBlocks();
        dispose();
        provider.addBlock();
        await streamer.processPendingBlocks();

        expect(seen).toEqual([2]);
        await streamer.stop();
    });

    test('hook() disposers remove a single handler', () => {
        const registry = new HookRegistry();
        const a = jest.fn();
        const b = jest.fn();
        const disposeA = registry.add('onStart', a);
        registry.add('onStart', b);

        disposeA();

        expect(registry.get('onStart')).toEqual([b]);
    });

    test('unknown hook names and non-functions are rejected', () => {
        expect(() => new Streamer({ hooks: { onBlok: () => undefined } as any })).toThrow(/Unknown streamer hook 'onBlok'/);
        expect(() => defineHooks({ onStart: 'nope' as any })).toThrow(/must be a function/);
        expect(() => new Streamer().hook('whenever' as any, () => undefined)).toThrow(/Unknown streamer hook/);
    });

    test('a throwing hook is isolated and reported', async () => {
        const onError = jest.fn();
        const { streamer, provider } = await createHarness({
            config: {
                hooks: {
                    afterBlock: () => { throw new Error('metrics down'); },
                    onError
                }
            }
        });

        provider.addBlock();
        expect(await streamer.processPendingBlocks()).toBe(1);
        expect(onError).toHaveBeenCalledWith(expect.objectContaining({ phase: 'hook', fatal: false }));
        await streamer.stop();
    });
});

describe('Contract hooks', () => {
    test('beforeAction can veto; afterAction and onError observe results', async () => {
        const events: string[] = [];
        const { streamer, provider } = await createHarness();

        await streamer.registerContract(defineContract({
            name: 'shop',
            hooks: {
                beforeAction: ({ ctx }) => ctx.sender !== 'mallory',
                afterAction: ({ action: name, durationMs }) => { events.push(`after:${name}:${typeof durationMs}`); },
                onError: ({ action: name, error }) => { events.push(`error:${name}:${error.message}`); }
            },
            actions: {
                buy: action(() => { events.push('buy'); }, { trigger: 'transfer' }),
                refund: action(() => { throw new Error('no stock'); }, { trigger: 'transfer' })
            }
        }));

        provider.addBlock([
            transferOp('alice', '1.000 HIVE', memo('shop', 'buy')),
            transferOp('mallory', '1.000 HIVE', memo('shop', 'buy')),
            transferOp('bob', '1.000 HIVE', memo('shop', 'refund'))
        ]);
        await streamer.processPendingBlocks();

        expect(events).toEqual(['buy', 'after:buy:number', 'error:refund:no stock']);
        await streamer.stop();
    });

    test('contract hooks are validated', () => {
        expect(() => defineContract({
            name: 'bad',
            hooks: { beforeAction: 'yes' as any },
            actions: { go: action(() => undefined) }
        })).toThrow(/beforeAction hook must be a function/);

        expect(() => defineContract({
            name: 'bad',
            hooks: { beforeEverything: () => undefined } as any,
            actions: { go: action(() => undefined) }
        })).toThrow(/unknown hook 'beforeEverything'/);
    });
});
