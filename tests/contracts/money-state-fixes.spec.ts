import { PrivateKey } from '@hiveio/dhive';
import {
    TimeAction,
    createBookingContract,
    createBountyBoardContract,
    createBridgeContract,
    createCrowdfundContract,
    createGroupBuyContract,
    createInsurancePoolContract,
    createOracleBountyContract,
    createProposalTimelockContract,
    createSavingsContract,
    createStakingPoolContract,
    createTournamentContract
} from '../../src';
import { createTestStreamer, TestStreamer } from '../../src/testing';

const ACTIVE_KEY = PrivateKey.fromSeed('hive-stream money and state fixes').toString();
const START = new Date('2026-06-01T00:00:00.000Z');
const APP = 'app';

/**
 * One focused test per confirmed money/state bug in the built-in contracts,
 * driven through the real streamer pipeline with the offline testing kit.
 */
describe('built-in contract money and state fixes', () => {
    let ts: TestStreamer;
    let send: jest.SpyInstance;

    const start = async () => {
        ts = await createTestStreamer({ username: APP, activeKey: ACTIVE_KEY, startTime: START });
        send = jest.spyOn(ts.streamer, 'transferHiveTokens');
        return ts;
    };

    const json = (sender: string, contract: string, action: string, payload: Record<string, any> = {}) =>
        ts.contractJson(sender, { contract, action, payload, activeKey: true });

    const pay = (from: string, amount: string, contract: string, action: string, payload: Record<string, any> = {}) =>
        ts.contractTransfer({ from, amount, contract, action, payload });

    const rows = (sql: string, params: any[] = []) => ts.adapter.query(sql, params);

    const eventsNamed = async (action: string) => (await ts.getEvents()).filter((event: any) => event.data?.action === action);

    const sent = () => ts.outgoingTransfers.map((transfer: any) => [transfer.from, transfer.to, transfer.amount]);

    const failNextBroadcast = () => send.mockRejectedValueOnce(new Error('rpc down'));

    const inHours = (hours: number) => new Date(ts.currentTime.getTime() + hours * 3600_000).toISOString();

    afterEach(async () => {
        await ts?.stop();
        jest.restoreAllMocks();
    });

    describe('insurance pool', () => {
        const setupClaim = async (amount = '25.000') => {
            await start();
            await ts.streamer.registerContract(createInsurancePoolContract());
            await json('owner', 'insurancepool', 'createPool', {
                poolId: 'p1', title: 'Cover', asset: 'HBD', premiumAmount: '10.000', coverageCap: '50.000', coverageDays: 30
            });
            await pay('owner', '100.000 HBD', 'insurancepool', 'fundPool', { poolId: 'p1' });
            await pay('bob', '10.000 HBD', 'insurancepool', 'buyPolicy', { poolId: 'p1' });
            await json('bob', 'insurancepool', 'fileClaim', { poolId: 'p1', claimId: 'c1', amount, reason: 'storm damage' });
        };

        test('pays claims from the app account and only marks them paid after the broadcast', async () => {
            await setupClaim();

            failNextBroadcast();
            await json('owner', 'insurancepool', 'approveClaim', { claimId: 'c1' });

            let [claim] = await rows('SELECT status, approved_amount FROM insurance_claims');
            expect(claim).toEqual({ status: 'payout_failed', approved_amount: '25.000' });
            expect(ts.outgoingTransfers).toHaveLength(0);

            // Approving again cannot pay twice; the retry action sends it once.
            await json('owner', 'insurancepool', 'approveClaim', { claimId: 'c1' });
            await json('mallory', 'insurancepool', 'retryClaimPayout', { claimId: 'c1' });
            await json('bob', 'insurancepool', 'retryClaimPayout', { claimId: 'c1' });
            await json('bob', 'insurancepool', 'retryClaimPayout', { claimId: 'c1' });

            [claim] = await rows('SELECT status FROM insurance_claims');
            expect(claim.status).toBe('approved');
            expect(sent()).toEqual([[APP, 'bob', '25.000 HBD']]);

            const [pool] = await rows('SELECT reserve_balance FROM insurance_pools');
            expect(pool.reserve_balance).toBe('85');
        });

        test('caps the approved amount at the requested amount and rounds payouts down', async () => {
            await setupClaim('20.12345');

            await json('owner', 'insurancepool', 'approveClaim', { claimId: 'c1', amount: '30.000' });
            expect((await rows('SELECT status FROM insurance_claims'))[0].status).toBe('pending');

            await json('owner', 'insurancepool', 'approveClaim', { claimId: 'c1' });
            expect(sent()).toEqual([[APP, 'bob', '20.123 HBD']]);
            expect((await rows('SELECT approved_amount FROM insurance_claims'))[0].approved_amount).toBe('20.123');
        });
    });

    describe('crowdfund', () => {
        const createCampaign = async (deadlineHours: number, milestones?: any[]) => {
            await json('creator', 'crowdfund', 'createCampaign', {
                campaignId: 'cf1', title: 'Campaign', targetAmount: '100.000', asset: 'HIVE', deadline: inHours(deadlineHours),
                ...(milestones ? { milestones } : {})
            });
        };

        test('keys contributions per operation so two in one transaction both count', async () => {
            await start();
            await ts.streamer.registerContract(createCrowdfundContract());
            await createCampaign(24);

            const memo = ts.contractMemo('crowdfund', 'contribute', { campaignId: 'cf1' });
            await ts.sendOperations([
                ['transfer', { from: 'bob', to: APP, amount: '5.000 HIVE', memo }],
                ['transfer', { from: 'bob', to: APP, amount: '7.000 HIVE', memo }]
            ]);

            const contributions = await rows('SELECT transaction_id, amount FROM crowdfund_contributions ORDER BY id');
            expect(contributions).toHaveLength(2);
            expect(new Set(contributions.map((row: any) => row.transaction_id)).size).toBe(2);
            expect((await rows('SELECT current_amount FROM crowdfund_campaigns'))[0].current_amount).toBe('12');
        });

        test('refunds from the app account and retries a failed refund exactly once', async () => {
            await start();
            await ts.streamer.registerContract(createCrowdfundContract());
            await createCampaign(1);
            await pay('bob', '5.000 HIVE', 'crowdfund', 'contribute', { campaignId: 'cf1' });
            await ts.advanceTime('2h');
            await json('creator', 'crowdfund', 'finalizeCampaign', { campaignId: 'cf1' });

            failNextBroadcast();
            await json('bob', 'crowdfund', 'refundContribution', { campaignId: 'cf1' });
            expect((await rows('SELECT refunded FROM crowdfund_contributions'))[0].refunded).toBe(3);
            expect(await eventsNamed('crowdfund_refund_failed')).toHaveLength(1);

            await json('bob', 'crowdfund', 'refundContribution', { campaignId: 'cf1' });
            await json('bob', 'crowdfund', 'refundContribution', { campaignId: 'cf1' });

            expect((await rows('SELECT refunded FROM crowdfund_contributions'))[0].refunded).toBe(1);
            expect(sent()).toEqual([[APP, 'bob', '5.000 HIVE']]);
        });

        test('releases milestones from the app account, rounded down, retrying a failed release', async () => {
            await start();
            await ts.streamer.registerContract(createCrowdfundContract());
            await createCampaign(24, [{ title: 'Third', targetPercent: 33.3333 }]);
            await pay('bob', '100.001 HIVE', 'crowdfund', 'contribute', { campaignId: 'cf1' });
            await json('creator', 'crowdfund', 'finalizeCampaign', { campaignId: 'cf1' });

            failNextBroadcast();
            await json('creator', 'crowdfund', 'releaseMilestone', { campaignId: 'cf1', milestoneIndex: 0 });
            expect((await rows('SELECT status FROM crowdfund_milestones'))[0].status).toBe('release_failed');

            await json('creator', 'crowdfund', 'releaseMilestone', { campaignId: 'cf1', milestoneIndex: 0 });
            await json('creator', 'crowdfund', 'releaseMilestone', { campaignId: 'cf1', milestoneIndex: 0 });

            // 100.001 * 33.3333% = 33.33363333..., paid as 33.333 (never rounded up).
            expect((await rows('SELECT status, released_amount FROM crowdfund_milestones'))[0])
                .toEqual({ status: 'released', released_amount: '33.333' });
            expect(sent()).toEqual([[APP, 'creator', '33.333 HIVE']]);
        });
    });

    test('savings keys contributions per operation', async () => {
        await start();
        await ts.streamer.registerContract(createSavingsContract());
        await json('saver', 'savings', 'createGoal', { goalId: 'g1', title: 'Holiday', targetAmount: '100.000', asset: 'HIVE' });

        const memo = ts.contractMemo('savings', 'contribute', { goalId: 'g1' });
        await ts.sendOperations([
            ['transfer', { from: 'saver', to: APP, amount: '1.000 HIVE', memo }],
            ['transfer', { from: 'saver', to: APP, amount: '2.000 HIVE', memo }]
        ]);

        const contributions = await rows('SELECT transaction_id FROM savings_contributions');
        expect(contributions).toHaveLength(2);
        expect(new Set(contributions.map((row: any) => row.transaction_id)).size).toBe(2);
    });

    describe('bounty board', () => {
        test('closes a bounty once and zeroes the remainder', async () => {
            await start();
            await ts.streamer.registerContract(createBountyBoardContract());
            await pay('sponsor', '50.000 HIVE', 'bountyboard', 'createBounty', { bountyId: 'b1', title: 'Fix the bug' });

            await json('sponsor', 'bountyboard', 'closeBounty', { bountyId: 'b1' });
            await json('sponsor', 'bountyboard', 'closeBounty', { bountyId: 'b1' });

            const closed = await eventsNamed('bounty_closed');
            expect(closed).toHaveLength(1);
            expect(closed[0].data.data.remainingReward).toBe('50.000');
            expect((await rows('SELECT status, remaining_reward FROM bounty_board_bounties'))[0])
                .toEqual({ status: 'closed', remaining_reward: '0' });
        });

        test('reports and zeroes the remainder when the last award closes the bounty', async () => {
            await start();
            await ts.streamer.registerContract(createBountyBoardContract());
            await pay('sponsor', '50.000 HIVE', 'bountyboard', 'createBounty', { bountyId: 'b1', title: 'Fix the bug' });
            await json('dev', 'bountyboard', 'submitWork', { bountyId: 'b1', submissionId: 's1', url: 'https://example.com/pr/1' });
            await json('sponsor', 'bountyboard', 'awardBounty', { bountyId: 'b1', submissionId: 's1', amount: '20.000' });
            await json('sponsor', 'bountyboard', 'closeBounty', { bountyId: 'b1' });

            const closed = await eventsNamed('bounty_closed');
            expect(closed).toHaveLength(1);
            expect(closed[0].data.data.remainingReward).toBe('30');
            expect((await rows('SELECT remaining_reward FROM bounty_board_bounties'))[0].remaining_reward).toBe('0');
        });
    });

    test('group buy: an early withdrawal lowers the totals so the organizer is never paid refunded money', async () => {
        await start();
        await ts.streamer.registerContract(createGroupBuyContract());
        await json('org', 'groupbuy', 'createGroupBuy', { groupBuyId: 'gb1', title: 'Bulk order', targetAmount: '10.000', asset: 'HIVE', deadline: inHours(1) });
        await pay('bob', '10.000 HIVE', 'groupbuy', 'commit', { groupBuyId: 'gb1' });

        await json('bob', 'groupbuy', 'withdrawCommitment', { groupBuyId: 'gb1' });
        expect((await rows('SELECT current_amount, participant_count FROM group_buy_campaigns'))[0])
            .toEqual({ current_amount: '0', participant_count: 0 });

        await ts.advanceTime('2h');
        await json('org', 'groupbuy', 'finalizeGroupBuy', { groupBuyId: 'gb1' });

        const finalized = await eventsNamed('group_buy_finalized');
        expect(finalized).toHaveLength(1);
        expect(finalized[0].data.data.status).toBe('failed');
        expect(await eventsNamed('group_buy_withdrawal_requested')).toHaveLength(1);

        // Already withdrawn: nothing left to withdraw after the failure either.
        await json('bob', 'groupbuy', 'withdrawCommitment', { groupBuyId: 'gb1' });
        expect(await eventsNamed('group_buy_withdrawal_requested')).toHaveLength(1);
    });

    test('oracle bounty: a time-triggered finalizeRound rewards each report once', async () => {
        await start();
        await ts.streamer.registerContract(createOracleBountyContract());
        await json('owner', 'oraclebounty', 'createFeed', { feedId: 'f1', title: 'Price feed', rewardPerReport: '1.000', rewardAsset: 'HIVE' });
        await pay('owner', '10.000 HIVE', 'oraclebounty', 'fundFeed', { feedId: 'f1' });
        await json('alice', 'oraclebounty', 'submitReport', { feedId: 'f1', roundId: 'r1', value: 100 });
        await json('bob', 'oraclebounty', 'submitReport', { feedId: 'f1', roundId: 'r1', value: 101 });

        await ts.streamer.registerAction(new TimeAction('1m', 'finalize-r1', 'oraclebounty', 'finalizeRound', { feedId: 'f1', roundId: 'r1' }, ts.currentTime));
        await ts.advanceTime('2m');
        await ts.advanceTime('2m');
        await ts.advanceTime('2m');

        expect(await eventsNamed('oracle_round_finalized')).toHaveLength(1);
        const balances = await rows('SELECT account, balance FROM oracle_reward_balances ORDER BY account');
        expect(balances).toEqual([{ account: 'alice', balance: '1' }, { account: 'bob', balance: '1' }]);
        expect((await rows('SELECT budget_balance FROM oracle_feeds'))[0].budget_balance).toBe('8');

        // Late reports cannot join a finalized round.
        await json('carol', 'oraclebounty', 'submitReport', { feedId: 'f1', roundId: 'r1', value: 100 });
        expect(await rows('SELECT reporter FROM oracle_reports WHERE reporter = ?', ['carol'])).toHaveLength(0);
    });

    describe('booking', () => {
        const setupListing = async () => {
            await start();
            await ts.streamer.registerContract(createBookingContract());
            await json('host', 'bookings', 'createListing', { listingId: 'l1', title: 'Studio', price: '10', asset: 'HIVE', durationMinutes: 60 });
        };

        test('accepts a whole-number price paid with three decimals and refunds a wrong amount', async () => {
            await setupListing();

            await pay('guest', '10.000 HIVE', 'bookings', 'reserve', { listingId: 'l1', reservationId: 'r1', startAt: inHours(24) });
            await pay('guest', '9.000 HIVE', 'bookings', 'reserve', { listingId: 'l1', reservationId: 'r2', startAt: inHours(48) });
            await pay('guest', '10.000 HIVE', 'bookings', 'reserve', { listingId: 'l1', reservationId: 'r3', startAt: inHours(24) });

            expect(await rows('SELECT reservation_id, status FROM booking_reservations')).toEqual([{ reservation_id: 'r1', status: 'pending' }]);
            expect(sent()).toEqual([[APP, 'guest', '9.000 HIVE'], [APP, 'guest', '10.000 HIVE']]);
            expect(await eventsNamed('booking_refunded')).toHaveLength(2);
        });

        test('a cancelled booking cannot be completed and a completed one cannot be cancelled', async () => {
            await setupListing();
            await pay('guest', '10.000 HIVE', 'bookings', 'reserve', { listingId: 'l1', reservationId: 'r1', startAt: inHours(24) });
            await pay('guest', '10.000 HIVE', 'bookings', 'reserve', { listingId: 'l1', reservationId: 'r2', startAt: inHours(48) });

            await json('host', 'bookings', 'cancelReservation', { reservationId: 'r1' });
            await json('host', 'bookings', 'completeReservation', { reservationId: 'r1' });
            await json('host', 'bookings', 'confirmReservation', { reservationId: 'r1' });

            await json('host', 'bookings', 'completeReservation', { reservationId: 'r2' });
            await json('host', 'bookings', 'cancelReservation', { reservationId: 'r2' });

            expect(await rows('SELECT reservation_id, status FROM booking_reservations ORDER BY reservation_id')).toEqual([
                { reservation_id: 'r1', status: 'cancelled' },
                { reservation_id: 'r2', status: 'completed' }
            ]);
            expect(await eventsNamed('booking_cancelled')).toHaveLength(1);
            expect(await eventsNamed('booking_completed')).toHaveLength(1);
        });
    });

    test('proposal timelock: a scheduled executeProposal runs without a sender once the delay passes', async () => {
        await start();
        await ts.streamer.registerContract(createProposalTimelockContract());
        await json('owner', 'proposaltimelock', 'createQueue', { queueId: 'q1', title: 'Governance', approvers: ['bob'], threshold: 2, minDelayHours: 1 });
        await json('bob', 'proposaltimelock', 'createProposal', {
            queueId: 'q1', proposalId: 'p1', title: 'Rotate key', actionType: 'rotate', actionPayload: { account: 'treasury' }
        });
        await ts.streamer.registerAction(new TimeAction('1m', 'execute-p1', 'proposaltimelock', 'executeProposal', { proposalId: 'p1' }, ts.currentTime));

        // Ticks before approval and before the delay are quiet no-ops.
        await ts.advanceTime('2m');
        await json('owner', 'proposaltimelock', 'approveProposal', { proposalId: 'p1' });
        await json('bob', 'proposaltimelock', 'approveProposal', { proposalId: 'p1' });
        await ts.advanceTime('2m');
        expect((await rows('SELECT status FROM timelock_proposals'))[0].status).toBe('approved');

        await ts.advanceTime('2h');
        await ts.advanceTime('2m');

        expect((await rows('SELECT status FROM timelock_proposals'))[0].status).toBe('executed');
        expect(await eventsNamed('timelock_proposal_execution_requested')).toHaveLength(1);

        // An executed proposal can no longer be cancelled.
        await json('bob', 'proposaltimelock', 'cancelProposal', { proposalId: 'p1' });
        expect((await rows('SELECT status FROM timelock_proposals'))[0].status).toBe('executed');
    });

    describe('bridge', () => {
        const setupBridge = async () => {
            await start();
            await ts.streamer.registerContract(createBridgeContract({
                custodyAccount: APP,
                operators: ['op1', 'op2', 'op3'],
                threshold: 2,
                chains: ['eth'],
                maxPerTx: '1000',
                addressPattern: /^0x[0-9a-fA-F]{40}$/
            }));
        };

        test('an operator attestation replaces a front-running withdrawal request', async () => {
            await setupBridge();
            const burn = { sourceChain: 'eth', sourceTxId: '0xburn', recipient: 'alice', amount: '100.000', asset: 'HIVE' };

            // Mallory sees alice's burn and registers it to herself first.
            await json('mallory', 'bridge', 'requestWithdrawal', { sourceChain: 'eth', sourceTxId: '0xburn', amount: '100.000', asset: 'HIVE', recipient: 'mallory' });

            await json('op1', 'bridge', 'attestWithdrawal', burn);
            await json('op2', 'bridge', 'attestWithdrawal', burn);

            expect(sent()).toEqual([[APP, 'alice', '100.000 HIVE']]);
            const [record] = await rows('SELECT recipient, status, requested_by FROM bridge_withdrawals');
            expect(record).toEqual({ recipient: 'alice', status: 'released', requested_by: 'op1' });

            const events = (await rows('SELECT event FROM bridge_audit WHERE ref_id = ?', ['eth:0xburn'])).map((row: any) => row.event);
            expect(events).toContain('withdrawal_request_replaced');
        });

        test('rejects a withdrawal above maxPerTx when it is requested or attested', async () => {
            await setupBridge();

            await json('alice', 'bridge', 'requestWithdrawal', { sourceChain: 'eth', sourceTxId: '0xbig', amount: '5000.000', asset: 'HIVE' });
            await json('op1', 'bridge', 'attestWithdrawal', { sourceChain: 'eth', sourceTxId: '0xbig', recipient: 'alice', amount: '5000.000', asset: 'HIVE' });

            expect(await rows('SELECT withdrawal_id FROM bridge_withdrawals')).toEqual([]);
        });

        test('a failed deposit refund is marked refund_failed and an admin can retry it', async () => {
            await setupBridge();
            failNextBroadcast();
            const { transactionId } = await pay('alice', '5.000 HIVE', 'bridge', 'deposit', { chain: 'eth', address: 'not-an-address' });

            expect((await rows('SELECT status FROM bridge_deposits'))[0].status).toBe('refund_failed');

            await json('mallory', 'bridge', 'retryRefund', { depositId: transactionId });
            await json(APP, 'bridge', 'retryRefund', { depositId: transactionId });
            await json(APP, 'bridge', 'retryRefund', { depositId: transactionId });

            expect((await rows('SELECT status FROM bridge_deposits'))[0].status).toBe('refunded');
            expect(sent()).toEqual([[APP, 'alice', '5.000 HIVE']]);
        });
    });

    describe('tournament', () => {
        const createCup = (organizer: string, extra: Record<string, any> = {}) => json(organizer, 'tournaments', 'createTournament', {
            tournamentId: 'cup', title: 'Cup', asset: 'HIVE', entryFee: '1.000',
            registrationClosesAt: inHours(1), prizeSplitBps: [10000], ...extra
        });

        test('open tournaments are scored by the app account, never the organizer', async () => {
            await start();
            await ts.streamer.registerContract(createTournamentContract());

            await createCup('organizer', { oracle: 'organizer' });
            expect(await rows('SELECT tournament_id FROM tournaments')).toEqual([]);

            await createCup('organizer');
            expect((await rows('SELECT oracle FROM tournaments'))[0].oracle).toBe(APP);

            await pay('organizer', '1.000 HIVE', 'tournaments', 'enter', { tournamentId: 'cup' });
            await pay('alice', '1.000 HIVE', 'tournaments', 'enter', { tournamentId: 'cup' });
            await ts.advanceTime('2h');
            await json('organizer', 'tournaments', 'submitScore', { tournamentId: 'cup', player: 'organizer', score: 99 });

            expect((await rows('SELECT score FROM tournament_entries WHERE player = ?', ['organizer']))[0].score).toBeNull();
        });

        test('a failed prize is marked failed and retryPayouts sends it once', async () => {
            await start();
            await ts.streamer.registerContract(createTournamentContract());
            await createCup('organizer');
            await pay('alice', '1.000 HIVE', 'tournaments', 'enter', { tournamentId: 'cup' });
            await pay('bob', '1.000 HIVE', 'tournaments', 'enter', { tournamentId: 'cup' });
            await ts.advanceTime('2h');
            await json(APP, 'tournaments', 'submitScores', { tournamentId: 'cup', scores: [{ player: 'alice', score: 5 }, { player: 'bob', score: 9 }] });

            failNextBroadcast();
            await json(APP, 'tournaments', 'finalize', { tournamentId: 'cup' });
            expect((await rows('SELECT status FROM tournament_payouts'))[0].status).toBe('failed');
            expect((await rows('SELECT status FROM tournaments'))[0].status).toBe('finalized');

            await json('mallory', 'tournaments', 'retryPayouts', { tournamentId: 'cup' });
            await json('organizer', 'tournaments', 'retryPayouts', { tournamentId: 'cup' });
            await json('organizer', 'tournaments', 'retryPayouts', { tournamentId: 'cup' });

            expect((await rows('SELECT status FROM tournament_payouts'))[0].status).toBe('paid');
            expect(sent()).toEqual([[APP, 'bob', '2.000 HIVE']]);
        });

        test('a failed refund is retried instead of being marked refunded', async () => {
            await start();
            await ts.streamer.registerContract(createTournamentContract());
            await createCup('organizer');
            await pay('alice', '1.000 HIVE', 'tournaments', 'enter', { tournamentId: 'cup' });

            failNextBroadcast();
            await json('organizer', 'tournaments', 'cancelTournament', { tournamentId: 'cup' });
            expect((await rows('SELECT refunded FROM tournament_entries'))[0].refunded).toBe(3);

            await json(APP, 'tournaments', 'retryPayouts', { tournamentId: 'cup' });
            expect((await rows('SELECT refunded FROM tournament_entries'))[0].refunded).toBe(1);
            expect(sent()).toEqual([[APP, 'alice', '1.000 HIVE']]);
        });
    });

    describe('staking pool', () => {
        test('block accrual stops at the pool end time', async () => {
            await start();
            await ts.streamer.registerContract(createStakingPoolContract({ accrual: 'block' }));
            // Ends 30s (10 blocks) after creation.
            await json(APP, 'stakingpool', 'createPool', {
                poolId: 'sp', stakeAsset: 'HIVE', rewardAsset: 'HIVE', rewardRate: '1', endsAt: new Date(ts.currentTime.getTime() + 30_000).toISOString()
            });
            await pay(APP, '1000.000 HIVE', 'stakingpool', 'fundRewards', { poolId: 'sp' });
            await pay('alice', '10.000 HIVE', 'stakingpool', 'stake', { poolId: 'sp' });
            await ts.advanceBlocks(40);
            await json('alice', 'stakingpool', 'claim', { poolId: 'sp' });

            const [pool] = await rows('SELECT total_accrued, reward_reserve FROM staking_pools');
            // Staked 2 blocks after creation, so at most ~8 of the 10 blocks earn rewards.
            expect(Number(pool.total_accrued)).toBeGreaterThan(0);
            expect(Number(pool.total_accrued)).toBeLessThanOrEqual(10);
            expect(Number(pool.reward_reserve)).toBeGreaterThanOrEqual(990);
        });

        test('a failed claim is resent by the next claim instead of being lost', async () => {
            await start();
            await ts.streamer.registerContract(createStakingPoolContract());
            await json(APP, 'stakingpool', 'createPool', { poolId: 'sp', stakeAsset: 'HIVE', rewardAsset: 'HIVE', rewardRate: '0.01' });
            await pay(APP, '100.000 HIVE', 'stakingpool', 'fundRewards', { poolId: 'sp' });
            await pay('alice', '10.000 HIVE', 'stakingpool', 'stake', { poolId: 'sp' });
            await ts.advanceTime('100s');

            failNextBroadcast();
            await json('alice', 'stakingpool', 'claim', { poolId: 'sp' });
            const [failed] = await rows('SELECT status, amount FROM staking_claims');
            expect(failed.status).toBe('failed');

            await json('alice', 'stakingpool', 'claim', { poolId: 'sp' });

            const claims = await rows('SELECT status, amount FROM staking_claims ORDER BY id');
            expect(claims[0]).toEqual({ status: 'paid', amount: failed.amount });
            expect(claims.every((claim: any) => claim.status === 'paid')).toBe(true);
            expect(sent()[0]).toEqual([APP, 'alice', `${failed.amount} HIVE`]);
        });

        test('a failed unbonding release is retried by withdraw', async () => {
            await start();
            await ts.streamer.registerContract(createStakingPoolContract());
            await json(APP, 'stakingpool', 'createPool', { poolId: 'sp', stakeAsset: 'HIVE', rewardAsset: 'HIVE', rewardRate: '0' });
            await pay('alice', '10.000 HIVE', 'stakingpool', 'stake', { poolId: 'sp' });

            failNextBroadcast();
            await json('alice', 'stakingpool', 'unstake', { poolId: 'sp', amount: '10.000' });
            expect((await rows('SELECT status FROM staking_unbonding'))[0].status).toBe('failed');

            await json('alice', 'stakingpool', 'withdraw', { poolId: 'sp' });
            await json('alice', 'stakingpool', 'withdraw', { poolId: 'sp' });

            expect((await rows('SELECT status FROM staking_unbonding'))[0].status).toBe('released');
            expect(sent()).toEqual([[APP, 'alice', '10.000 HIVE']]);
        });
    });
});
