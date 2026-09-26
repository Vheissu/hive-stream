import { action, defineContract, TimeAction } from '../../src';
import { createHarness, memo, transferOp } from './helpers';

async function setup(guards: any, contractGuards?: any) {
    const calls: string[] = [];
    const rejected: string[] = [];
    const harness = await createHarness();

    await harness.streamer.registerContract(defineContract({
        name: 'bet',
        guards: contractGuards,
        actions: {
            place: action((_payload, ctx) => { calls.push(ctx.sender); }, {
                trigger: ['transfer', 'custom_json'],
                guards
            })
        }
    }));

    harness.streamer.hook('onActionRejected', ({ reason, context }) => { rejected.push(`${context.sender}:${reason}`); });

    return { ...harness, calls, rejected };
}

describe('Declarative action guards', () => {
    test('allowedSenders and blockedSenders', async () => {
        const { streamer, provider, calls, rejected } = await setup({ allowedSenders: ['alice', 'bob'], blockedSenders: ['bob'] });

        provider.addBlock([
            transferOp('alice', '1.000 HIVE', memo('bet', 'place')),
            transferOp('bob', '1.000 HIVE', memo('bet', 'place')),
            transferOp('carol', '1.000 HIVE', memo('bet', 'place'))
        ]);
        await streamer.processPendingBlocks();

        expect(calls).toEqual(['alice']);
        expect(rejected).toEqual(['bob:sender_not_allowed', 'carol:sender_not_allowed']);
        await streamer.stop();
    });

    test('allowedAssets, minAmount and maxAmount apply to transfers', async () => {
        const { streamer, provider, calls, rejected } = await setup({ allowedAssets: ['hive'], minAmount: '1', maxAmount: 100 });

        provider.addBlock([
            transferOp('a', '1.000 HIVE', memo('bet', 'place')),
            transferOp('b', '0.999 HIVE', memo('bet', 'place')),
            transferOp('c', '100.001 HIVE', memo('bet', 'place')),
            transferOp('d', '5.000 HBD', memo('bet', 'place')),
            transferOp('e', '100.000 HIVE', memo('bet', 'place'))
        ]);
        await streamer.processPendingBlocks();

        expect(calls).toEqual(['a', 'e']);
        expect(rejected).toEqual(['b:amount_too_low', 'c:amount_too_high', 'd:asset_not_allowed']);
        await streamer.stop();
    });

    test('amount guards do not block custom_json calls', async () => {
        const { streamer, provider, calls } = await setup({ minAmount: 10 });

        provider.addBlock([['custom_json', {
            id: 'hivestream',
            json: memo('bet', 'place'),
            required_auths: [],
            required_posting_auths: ['alice']
        }]]);
        await streamer.processPendingBlocks();

        expect(calls).toEqual(['alice']);
        await streamer.stop();
    });

    test('rateLimit counts calls per sender in blockchain time', async () => {
        const { streamer, provider, calls, rejected } = await setup({ rateLimit: { max: 2, windowSeconds: 60 } });

        provider.addBlock([
            transferOp('alice', '1.000 HIVE', memo('bet', 'place')),
            transferOp('alice', '1.000 HIVE', memo('bet', 'place')),
            transferOp('alice', '1.000 HIVE', memo('bet', 'place')),
            transferOp('bob', '1.000 HIVE', memo('bet', 'place'))
        ]);
        await streamer.processPendingBlocks();

        expect(calls).toEqual(['alice', 'alice', 'bob']);
        expect(rejected).toEqual(['alice:rate_limited']);

        provider.addBlock([transferOp('alice', '1.000 HIVE', memo('bet', 'place'))], {
            time: new Date(provider.currentTime.getTime() + 61_000)
        });
        await streamer.processPendingBlocks();

        expect(calls).toEqual(['alice', 'alice', 'bob', 'alice']);
        await streamer.stop();
    });

    test('paused guards and runtime pauseContract/resumeContract', async () => {
        const { streamer, provider, calls, rejected } = await setup(undefined, { paused: false });

        streamer.pauseContract('bet');
        expect(streamer.isContractPaused('bet', 'place')).toBe(true);
        provider.addBlock([transferOp('alice', '1.000 HIVE', memo('bet', 'place'))]);
        await streamer.processPendingBlocks();

        streamer.resumeContract('bet');
        streamer.pauseContract('bet', 'place');
        provider.addBlock([transferOp('bob', '1.000 HIVE', memo('bet', 'place'))]);
        await streamer.processPendingBlocks();

        streamer.resumeContract('bet', 'place');
        provider.addBlock([transferOp('carol', '1.000 HIVE', memo('bet', 'place'))]);
        await streamer.processPendingBlocks();

        expect(calls).toEqual(['carol']);
        expect(rejected).toEqual(['alice:paused', 'bob:paused']);
        await streamer.stop();
    });

    test('contract-level guards apply to every action and action guards override them', async () => {
        const { streamer, provider, calls } = await setup({ minAmount: 0 }, { minAmount: 5, allowedAssets: ['HIVE'] });

        provider.addBlock([
            transferOp('a', '1.000 HIVE', memo('bet', 'place')),
            transferOp('b', '1.000 HBD', memo('bet', 'place'))
        ]);
        await streamer.processPendingBlocks();

        expect(calls).toEqual(['a']);
        await streamer.stop();
    });

    test('paused time actions skip the tick without counting it', async () => {
        const ticks: number[] = [];
        const { streamer, provider } = await createHarness();

        await streamer.registerContract(defineContract({
            name: 'draw',
            actions: {
                run: action((_payload, ctx) => { ticks.push(ctx.block.number); }, { trigger: 'time', guards: { allowedSenders: ['nobody'] } })
            }
        }));
        await streamer.registerAction(new TimeAction('1m', 'draw-run', 'draw', 'run', {}, provider.currentTime));

        streamer.pauseContract('draw');
        provider.addBlock([], { time: new Date(provider.currentTime.getTime() + 60_000) });
        await streamer.processPendingBlocks();
        expect(ticks).toEqual([]);
        expect(streamer.getAction('draw-run')!.executionCount).toBe(0);

        streamer.resumeContract('draw');
        provider.addBlock([], { time: new Date(provider.currentTime.getTime() + 60_000) });
        await streamer.processPendingBlocks();

        // Sender guards don't apply to time triggers.
        expect(ticks).toEqual([3]);
        await streamer.stop();
    });

    test('guards are validated at definition time', () => {
        const define = (guards: any) => defineContract({ name: 'x', actions: { go: action(() => undefined, { guards }) } });

        expect(() => define({ allowedSenders: 'alice' })).toThrow(/allowedSenders must be an array/);
        expect(() => define({ minAmount: -1 })).toThrow(/minAmount must be a non-negative number/);
        expect(() => define({ minAmount: 5, maxAmount: 1 })).toThrow(/minAmount must not exceed/);
        expect(() => define({ rateLimit: { max: 0, windowSeconds: 10 } })).toThrow(/rateLimit/);
        expect(() => define({ paused: 'yes' })).toThrow(/paused must be a boolean/);
        expect(() => define({ maxBet: 5 })).toThrow(/unknown guard 'maxBet'/);
        expect(() => defineContract({ name: 'y', guards: { allowedAssets: [''] } as any, actions: { go: action(() => undefined) } }))
            .toThrow(/allowedAssets/);
    });
});
