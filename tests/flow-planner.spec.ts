import { PrivateKey } from '@hiveio/dhive';
import { Streamer } from '../src/streamer';
import { createMockAdapter } from './helpers/mock-adapter';

describe('Flow planner', () => {
    const activeKey = PrivateKey.fromSeed('flow-planner-active').toString();
    let streamer: Streamer;

    beforeEach(async () => {
        streamer = new Streamer({
            ACTIVE_KEY: activeKey,
            JSON_ID: 'testing',
            PAYLOAD_IDENTIFIER: 'hive_stream',
            DEBUG_MODE: false
        });

        await streamer.registerAdapter(createMockAdapter());
    });

    afterEach(async () => {
        jest.restoreAllMocks();
        await streamer.stop();
    });

    test('plans grouped routes with an on-top donation from one inbound transfer', () => {
        const plan = streamer.planIncomingTransferRoutes(
            { from: 'buyer', to: 'tweet-backup', amount: '1.080 HBD', memo: 'Archive this tweet' },
            {
                routes: [
                    { to: 'tweet-catcher', percentage: 20, memo: 'Tweet watcher share' },
                    { group: [{ account: 'node-1' }, { account: 'node-2' }], percentage: 4, memo: 'Node operator share' },
                    { group: [{ account: 'wit-1' }, { account: 'wit-2' }], percentage: 6, memo: 'Witness share' },
                    { type: 'burn', percentage: 70, memo: 'Burn share' },
                    { to: 'platform-op', mode: 'onTop', percentage: 8, memo: 'Optional platform donation' }
                ]
            }
        );

        expect(plan.incomingAmount).toBe('1.080 HBD');
        expect(plan.asset).toBe('HBD');
        expect(plan.baseAmount).toBe('1.000');
        expect(plan.onTopAmount).toBe('0.080');
        expect(plan.routes).toEqual([
            {
                type: 'transfer',
                mode: 'base',
                amount: '0.200',
                asset: 'HBD',
                memo: 'Tweet watcher share',
                to: 'tweet-catcher',
                routeIndex: 0
            },
            {
                type: 'transfer',
                mode: 'base',
                amount: '0.020',
                asset: 'HBD',
                memo: 'Node operator share',
                to: 'node-1',
                routeIndex: 1,
                groupIndex: 0
            },
            {
                type: 'transfer',
                mode: 'base',
                amount: '0.020',
                asset: 'HBD',
                memo: 'Node operator share',
                to: 'node-2',
                routeIndex: 1,
                groupIndex: 1
            },
            {
                type: 'transfer',
                mode: 'base',
                amount: '0.030',
                asset: 'HBD',
                memo: 'Witness share',
                to: 'wit-1',
                routeIndex: 2,
                groupIndex: 0
            },
            {
                type: 'transfer',
                mode: 'base',
                amount: '0.030',
                asset: 'HBD',
                memo: 'Witness share',
                to: 'wit-2',
                routeIndex: 2,
                groupIndex: 1
            },
            {
                type: 'burn',
                mode: 'base',
                amount: '0.700',
                asset: 'HBD',
                memo: 'Burn share',
                routeIndex: 3
            },
            {
                type: 'transfer',
                mode: 'onTop',
                amount: '0.080',
                asset: 'HBD',
                memo: 'Optional platform donation',
                to: 'platform-op',
                routeIndex: 4
            }
        ]);
    });

    test('plans weighted group routes with safe rounding reconciliation', () => {
        const plan = streamer.planIncomingTransferRoutes('1.000 HIVE', {
            routes: [
                {
                    group: [
                        { account: 'node-1', weight: 3 },
                        { account: 'node-2', weight: 1 }
                    ],
                    percentage: 50,
                    split: 'weighted',
                    memo: 'Weighted node rewards'
                },
                {
                    type: 'burn',
                    memo: 'Burn the rest'
                }
            ]
        });

        expect(plan.baseAmount).toBe('1.000');
        expect(plan.onTopAmount).toBe('0.000');
        expect(plan.routes).toEqual([
            {
                type: 'transfer',
                mode: 'base',
                amount: '0.375',
                asset: 'HIVE',
                memo: 'Weighted node rewards',
                to: 'node-1',
                routeIndex: 0,
                groupIndex: 0
            },
            {
                type: 'transfer',
                mode: 'base',
                amount: '0.125',
                asset: 'HIVE',
                memo: 'Weighted node rewards',
                to: 'node-2',
                routeIndex: 0,
                groupIndex: 1
            },
            {
                type: 'burn',
                mode: 'base',
                amount: '0.500',
                asset: 'HIVE',
                memo: 'Burn the rest',
                routeIndex: 1
            }
        ]);
    });

    test('rejects on-top routes when there is no base route to distribute', () => {
        expect(() => streamer.planIncomingTransferRoutes('1.080 HBD', {
            routes: [
                { to: 'platform-op', mode: 'onTop', percentage: 8, memo: 'Optional donation' }
            ]
        })).toThrow('At least one base flow route is required');
    });

    test('executes grouped routes and on-top donations through autoRouteIncomingTransfers', async () => {
        const burnSpy = jest.spyOn(streamer, 'burnHiveTokens').mockResolvedValue({ id: 'burn-tx' } as any);
        const transferSpy = jest.spyOn(streamer, 'transferHiveTokens').mockResolvedValue({ id: 'transfer-tx' } as any);

        const handle = streamer.flows.autoRouteIncomingTransfers({
            account: 'tweet-backup',
            routes: [
                { to: 'tweet-catcher', percentage: 20, memo: 'Tweet watcher share' },
                { group: [{ account: 'node-1' }, { account: 'node-2' }], percentage: 4, memo: 'Node operator share' },
                { group: [{ account: 'wit-1' }, { account: 'wit-2' }], percentage: 6, memo: 'Witness share' },
                { type: 'burn', percentage: 70, memo: 'Burn share' },
                { to: 'platform-op', mode: 'onTop', percentage: 8, memo: 'Optional platform donation' }
            ]
        });

        await streamer.processOperation([
            'transfer',
            { from: 'buyer', to: 'tweet-backup', amount: '1.080 HBD', memo: 'Archive this tweet' }
        ], 101, 'block-101', 'block-100', 'trx-101', new Date('2026-03-12T01:00:00.000Z'));

        expect(transferSpy).toHaveBeenNthCalledWith(1, 'tweet-backup', 'tweet-catcher', '0.200', 'HBD', 'Tweet watcher share');
        expect(transferSpy).toHaveBeenNthCalledWith(2, 'tweet-backup', 'node-1', '0.020', 'HBD', 'Node operator share');
        expect(transferSpy).toHaveBeenNthCalledWith(3, 'tweet-backup', 'node-2', '0.020', 'HBD', 'Node operator share');
        expect(transferSpy).toHaveBeenNthCalledWith(4, 'tweet-backup', 'wit-1', '0.030', 'HBD', 'Witness share');
        expect(transferSpy).toHaveBeenNthCalledWith(5, 'tweet-backup', 'wit-2', '0.030', 'HBD', 'Witness share');
        expect(burnSpy).toHaveBeenCalledWith('tweet-backup', '0.700', 'HBD', 'Burn share');
        expect(transferSpy).toHaveBeenNthCalledWith(6, 'tweet-backup', 'platform-op', '0.080', 'HBD', 'Optional platform donation');

        handle.stop();
    });
});
