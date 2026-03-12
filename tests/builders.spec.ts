import { PrivateKey } from '@hiveio/dhive';
import { Streamer } from '../src/streamer';
import { createMockAdapter } from './helpers/mock-adapter';

describe('Builder APIs', () => {
    const activeKey = PrivateKey.fromSeed('builder-active').toString();
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

    describe('flows.incomingTransfers()', () => {
        test('routes a single burn step through autoBurnIncomingTransfers', () => {
            const handle = { account: 'alice', stop: jest.fn() };
            const spy = jest.spyOn(streamer, 'autoBurnIncomingTransfers').mockReturnValue(handle);

            const result = streamer.flows
                .incomingTransfers()
                .forAccount('alice')
                .allowSymbols('HIVE', 'HBD')
                .burn(69, 'burn it')
                .start();

            expect(result).toBe(handle);
            expect(spy).toHaveBeenCalledWith(expect.objectContaining({
                account: 'alice',
                allowedSymbols: ['HIVE', 'HBD'],
                percentage: 69,
                memo: 'burn it'
            }));
        });

        test('routes a single transfer step through autoForwardIncomingTransfers', () => {
            const handle = { account: 'alice', stop: jest.fn() };
            const spy = jest.spyOn(streamer, 'autoForwardIncomingTransfers').mockReturnValue(handle);

            streamer.flows
                .incomingTransfers('alice')
                .forwardTo('treasury', 25, 'skim')
                .start();

            expect(spy).toHaveBeenCalledWith(expect.objectContaining({
                account: 'alice',
                to: 'treasury',
                percentage: 25,
                memo: 'skim'
            }));
        });

        test('routes a single refund step through autoRefundIncomingTransfers', () => {
            const handle = { account: 'alice', stop: jest.fn() };
            const spy = jest.spyOn(streamer, 'autoRefundIncomingTransfers').mockReturnValue(handle);

            streamer.flows
                .incomingTransfers()
                .forAccount('alice')
                .refund('no thanks')
                .start();

            expect(spy).toHaveBeenCalledWith(expect.objectContaining({
                account: 'alice',
                memo: 'no thanks'
            }));
        });

        test('routes multi-step chains through autoRouteIncomingTransfers', () => {
            const handle = { account: 'alice', stop: jest.fn() };
            const spy = jest.spyOn(streamer, 'autoRouteIncomingTransfers').mockReturnValue(handle);

            streamer.flows
                .incomingTransfers('alice')
                .memo('default memo')
                .burn(69, 'burn share')
                .remainderTo('treasury')
                .start();

            expect(spy).toHaveBeenCalledWith(expect.objectContaining({
                account: 'alice',
                routes: [
                    expect.objectContaining({
                        type: 'burn',
                        percentage: 69,
                        memo: 'burn share'
                    }),
                    expect.objectContaining({
                        to: 'treasury',
                        memo: 'default memo'
                    })
                ]
            }));
        });

        test('routes grouped and on-top builder steps through autoRouteIncomingTransfers', () => {
            const handle = { account: 'alice', stop: jest.fn() };
            const spy = jest.spyOn(streamer, 'autoRouteIncomingTransfers').mockReturnValue(handle);

            streamer.flows
                .incomingTransfers('alice')
                .forwardTo('tweet-catcher', 20, 'Tweet watcher share')
                .forwardGroup([{ account: 'node-1' }, { account: 'node-2' }], 4, { memo: 'Node operator share' })
                .remainderToGroup([{ account: 'wit-1' }, { account: 'wit-2' }], { memo: 'Witness share' })
                .burn(70, 'Burn share')
                .donateOnTop('platform-op', 8, 'Optional platform donation')
                .start();

            expect(spy).toHaveBeenCalledWith(expect.objectContaining({
                account: 'alice',
                routes: [
                    expect.objectContaining({
                        to: 'tweet-catcher',
                        percentage: 20,
                        memo: 'Tweet watcher share'
                    }),
                    expect.objectContaining({
                        group: [{ account: 'node-1' }, { account: 'node-2' }],
                        percentage: 4,
                        memo: 'Node operator share'
                    }),
                    expect.objectContaining({
                        group: [{ account: 'wit-1' }, { account: 'wit-2' }],
                        memo: 'Witness share'
                    }),
                    expect.objectContaining({
                        type: 'burn',
                        percentage: 70,
                        memo: 'Burn share'
                    }),
                    expect.objectContaining({
                        to: 'platform-op',
                        mode: 'onTop',
                        percentage: 8,
                        memo: 'Optional platform donation'
                    })
                ]
            }));
        });

        test('executes mixed builder routes against real flow handlers', async () => {
            const burnSpy = jest.spyOn(streamer, 'burnHiveTokens').mockResolvedValue({ id: 'burn-tx' } as any);
            const transferSpy = jest.spyOn(streamer, 'transferHiveTokens').mockResolvedValue({ id: 'transfer-tx' } as any);

            const handle = streamer.flows
                .incomingTransfers()
                .forAccount('alice')
                .burn(69, 'burn share')
                .remainderTo('treasury', 'treasury share')
                .start();

            await streamer.processOperation([
                'transfer',
                { from: 'bob', to: 'alice', amount: '1.000 HIVE', memo: 'income' }
            ], 20, 'block-20', 'block-19', 'trx-20', new Date('2026-03-12T00:10:00.000Z'));

            expect(burnSpy).toHaveBeenCalledWith('alice', '0.690', 'HIVE', 'burn share');
            expect(transferSpy).toHaveBeenCalledWith('alice', 'treasury', '0.310', 'HIVE', 'treasury share');

            handle.stop();
        });

        test('supports refund builder helpers against real flow handlers', async () => {
            const transferSpy = jest.spyOn(streamer, 'transferHiveTokens').mockResolvedValue({ id: 'refund-tx' } as any);

            const handle = streamer.flows
                .incomingTransfers('alice')
                .refundPortion({ basisPoints: 5000 }, 'half back')
                .start();

            await streamer.processOperation([
                'transfer',
                { from: 'bob', to: 'alice', amount: '2.000 HBD', memo: 'income' }
            ], 21, 'block-21', 'block-20', 'trx-21', new Date('2026-03-12T00:11:00.000Z'));

            expect(transferSpy).toHaveBeenCalledWith('alice', 'bob', '1.000', 'HBD', 'half back');

            handle.stop();
        });

        test('plans grouped payouts and on-top donations from the builder', () => {
            const plan = streamer.flows
                .incomingTransfers('tweet-backup')
                .forwardTo('tweet-catcher', 20, 'Tweet watcher share')
                .forwardGroup([{ account: 'node-1' }, { account: 'node-2' }], 4, { memo: 'Node operator share' })
                .remainderToGroup([{ account: 'wit-1' }, { account: 'wit-2' }], { memo: 'Witness share' })
                .burn(70, 'Burn share')
                .donateOnTop('platform-op', 8, 'Optional platform donation')
                .plan('1.080 HBD');

            expect(plan.baseAmount).toBe('1.000');
            expect(plan.onTopAmount).toBe('0.080');
            expect(plan.routes.map((route) => ({
                type: route.type,
                mode: route.mode,
                amount: route.amount,
                to: route.to
            }))).toEqual([
                { type: 'transfer', mode: 'base', amount: '0.200', to: 'tweet-catcher' },
                { type: 'transfer', mode: 'base', amount: '0.020', to: 'node-1' },
                { type: 'transfer', mode: 'base', amount: '0.020', to: 'node-2' },
                { type: 'transfer', mode: 'base', amount: '0.030', to: 'wit-1' },
                { type: 'transfer', mode: 'base', amount: '0.030', to: 'wit-2' },
                { type: 'burn', mode: 'base', amount: '0.700', to: undefined },
                { type: 'transfer', mode: 'onTop', amount: '0.080', to: 'platform-op' }
            ]);
        });

        test('throws when start is called without steps', () => {
            expect(() => streamer.flows.incomingTransfers().start()).toThrow('Add at least one builder step');
        });
    });

    describe('ops builders', () => {
        test('ops.transfer builds and sends a HIVE transfer', () => {
            const spy = jest.spyOn(streamer, 'transferHiveTokens').mockResolvedValue({ id: 'tx' } as any);

            streamer.ops
                .transfer()
                .from('alice')
                .to('bob')
                .hive('1.2399')
                .memo('hello')
                .send();

            expect(spy).toHaveBeenCalledWith('alice', 'bob', '1.239', 'HIVE', 'hello');
        });

        test('ops.transfer accepts a full asset amount string', () => {
            const spy = jest.spyOn(streamer, 'transferHiveTokens').mockResolvedValue({ id: 'tx' } as any);

            streamer.ops
                .transfer()
                .from('alice')
                .to('bob')
                .amount('2.000 HBD')
                .send();

            expect(spy).toHaveBeenCalledWith('alice', 'bob', '2.000', 'HBD', '');
        });

        test('ops.burn builds and sends a HIVE burn', () => {
            const spy = jest.spyOn(streamer, 'burnHiveTokens').mockResolvedValue({ id: 'tx' } as any);

            streamer.ops
                .burn()
                .from('alice')
                .hive(0.6999)
                .memo('burn it')
                .send();

            expect(spy).toHaveBeenCalledWith('alice', '0.699', 'HIVE', 'burn it');
        });

        test('ops.escrowTransfer builds a formatted escrow transfer', () => {
            const spy = jest.spyOn(streamer, 'escrowTransfer').mockResolvedValue({ id: 'tx' } as any);

            const ratificationDeadline = new Date('2026-03-13T00:00:00.000Z');
            const expiration = new Date('2026-03-20T00:00:00.000Z');

            streamer.ops
                .escrowTransfer()
                .from('alice')
                .to('bob')
                .agent('carol')
                .id(42)
                .hive('1')
                .hbd('2')
                .fee('0.010 HIVE')
                .ratificationDeadline(ratificationDeadline)
                .expiration(expiration)
                .jsonMeta({ reason: 'trade' })
                .send();

            expect(spy).toHaveBeenCalledWith({
                from: 'alice',
                to: 'bob',
                agent: 'carol',
                escrow_id: 42,
                hive_amount: '1.000 HIVE',
                hbd_amount: '2.000 HBD',
                fee: '0.010 HIVE',
                ratification_deadline: ratificationDeadline,
                escrow_expiration: expiration,
                json_meta: { reason: 'trade' }
            }, undefined);
        });

        test('ops.recurrentTransfer builds a formatted recurrent transfer', () => {
            const spy = jest.spyOn(streamer, 'recurrentTransfer').mockResolvedValue({ id: 'tx' } as any);

            streamer.ops
                .recurrentTransfer()
                .from('alice')
                .to('bob')
                .hive(1.5)
                .memo('subscription')
                .recurrence(24)
                .executions(12)
                .send();

            expect(spy).toHaveBeenCalledWith({
                from: 'alice',
                to: 'bob',
                amount: '1.500 HIVE',
                memo: 'subscription',
                recurrence: 24,
                executions: 12
            }, undefined);
        });

        test('ops.createProposal builds a formatted proposal', () => {
            const spy = jest.spyOn(streamer, 'createProposal').mockResolvedValue({ id: 'tx' } as any);

            const startDate = new Date('2026-04-01T00:00:00.000Z');
            const endDate = new Date('2026-05-01T00:00:00.000Z');

            streamer.ops
                .createProposal()
                .creator('alice')
                .receiver('bob')
                .startDate(startDate)
                .endDate(endDate)
                .dailyHbd('12.5')
                .subject('Fund the thing')
                .permlink('fund-the-thing')
                .send();

            expect(spy).toHaveBeenCalledWith({
                creator: 'alice',
                receiver: 'bob',
                start_date: startDate,
                end_date: endDate,
                daily_pay: '12.500 HBD',
                subject: 'Fund the thing',
                permlink: 'fund-the-thing'
            }, undefined);
        });

        test('ops.transferEngine builds a Hive Engine transfer', () => {
            const spy = jest.spyOn(streamer, 'transferHiveEngineTokens').mockResolvedValue({ id: 'tx' } as any);

            streamer.ops
                .transferEngine()
                .from('alice')
                .to('bob')
                .symbol('BEE')
                .quantity('1.23456')
                .memo('engine transfer')
                .send();

            expect(spy).toHaveBeenCalledWith('alice', 'bob', 'BEE', '1.23456', 'engine transfer');
        });

        test('ops.burnEngine builds a Hive Engine burn', () => {
            const spy = jest.spyOn(streamer, 'burnHiveEngineTokens').mockResolvedValue({ id: 'tx' } as any);

            streamer.ops
                .burnEngine()
                .from('alice')
                .symbol('BEE')
                .quantity(5)
                .memo('engine burn')
                .send();

            expect(spy).toHaveBeenCalledWith('alice', 'BEE', '5', 'engine burn');
        });

        test('ops.issueEngine builds a Hive Engine issuance', () => {
            const spy = jest.spyOn(streamer, 'issueHiveEngineTokens').mockResolvedValue({ id: 'tx' } as any);

            streamer.ops
                .issueEngine()
                .from('issuer')
                .to('alice')
                .symbol('BEE')
                .quantity('1000')
                .memo('airdrop')
                .send();

            expect(spy).toHaveBeenCalledWith('issuer', 'alice', 'BEE', '1000', 'airdrop');
        });

        test('ops.voteProposals builds proposal vote updates', () => {
            const spy = jest.spyOn(streamer, 'updateProposalVotes').mockResolvedValue({ id: 'tx' } as any);

            streamer.ops
                .voteProposals()
                .voter('alice')
                .ids(1, 2, 3)
                .approve()
                .send();

            expect(spy).toHaveBeenCalledWith({
                voter: 'alice',
                proposal_ids: [1, 2, 3],
                approve: true
            }, undefined);
        });

        test('ops.removeProposals builds proposal removal requests', () => {
            const spy = jest.spyOn(streamer, 'removeProposals').mockResolvedValue({ id: 'tx' } as any);

            streamer.ops
                .removeProposals()
                .owner('alice')
                .ids(4, 5)
                .send();

            expect(spy).toHaveBeenCalledWith({
                proposal_owner: 'alice',
                proposal_ids: [4, 5]
            }, undefined);
        });

        test('ops.upvote uses the configured voter and passed target', () => {
            const spy = jest.spyOn(streamer, 'upvote').mockResolvedValue({ id: 'tx' } as any);

            streamer.ops
                .upvote()
                .author('bob')
                .permlink('my-post')
                .weight(25)
                .send();

            expect(spy).toHaveBeenCalledWith('25', 'bob', 'my-post');
        });

        test('ops.downvote defaults to full weight when not specified', () => {
            const spy = jest.spyOn(streamer, 'downvote').mockResolvedValue({ id: 'tx' } as any);

            streamer.ops
                .downvote()
                .author('bob')
                .permlink('spam-post')
                .send();

            expect(spy).toHaveBeenCalledWith('100.0', 'bob', 'spam-post');
        });
    });
});
