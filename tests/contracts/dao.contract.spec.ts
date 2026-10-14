import BigNumber from 'bignumber.js';
import { TimeAction, createDaoContract, type DaoContractOptions } from '../../src';
import { createTestStreamer, type TestStreamer } from '../../src/testing';
import { makeContext } from '../helpers/contract-context';

// 1000 HIVE backs 2000 VESTS, so 1 HP = 2 VESTS.
const GLOBAL_PROPS = { total_vesting_fund_hive: '1000.000 HIVE', total_vesting_shares: '2000.000000 VESTS' };
const vests = (hp: number) => `${(hp * 2).toFixed(6)} VESTS`;

const PROPOSAL = {
    proposalId: 'grant-1',
    title: 'Fund the meetup',
    description: 'Venue and catering',
    payouts: [{ to: 'bob', amount: '100.000', asset: 'HIVE' }]
};

describe('DAO contract', () => {
    let ts: TestStreamer;
    let errors: string[];
    let rejections: string[];
    let contract: ReturnType<typeof createDaoContract>;

    const setup = async (options: DaoContractOptions = {}) => {
        ts = await createTestStreamer();
        ts.client.onCall('get_dynamic_global_properties', GLOBAL_PROPS);
        ts.client.setAccount('alice', { vesting_shares: vests(2000) });
        ts.client.setAccount('bob', { vesting_shares: vests(800) });
        ts.client.setAccount('carol', { vesting_shares: vests(500) });
        // Delegations in or out never count towards voting power.
        ts.client.setAccount('erin', { vesting_shares: vests(10), received_vesting_shares: vests(5000) });

        contract = createDaoContract({ votingPeriodHours: 1, timelockHours: 2, quorum: '1000', ...options });
        await ts.streamer.registerContract(contract);

        errors = [];
        rejections = [];
        ts.streamer.hook('onContractError', ({ error }) => {
            errors.push(error.message);
        });
        ts.streamer.hook('onActionRejected', ({ reason }) => {
            rejections.push(reason);
        });
    };

    const query = (sql: string, params: any[] = []): Promise<any[]> => (ts.adapter as any).query(sql, params);
    const proposal = async (id = 'grant-1') => (await query('SELECT * FROM dao_proposals WHERE proposal_id = ?', [id]))[0];
    const payouts = (id = 'grant-1') => query('SELECT * FROM dao_payouts WHERE proposal_id = ? ORDER BY payout_index', [id]);

    const balance = async (asset = 'HIVE') => {
        const rows = await query('SELECT direction, amount FROM dao_ledger WHERE asset = ? AND direction IN (?, ?)', [asset, 'in', 'out']);
        return rows.reduce((total: BigNumber, row: any) => row.direction === 'in' ? total.plus(row.amount) : total.minus(row.amount), new BigNumber(0)).toFixed(3);
    };

    const deposit = (from: string, amount: string) => ts.contractTransfer({ from, contract: 'dao', action: 'deposit', amount });
    const propose = (from: string, payload: Record<string, any> = PROPOSAL, amount = '1.000 HIVE') =>
        ts.contractTransfer({ from, contract: 'dao', action: 'createProposal', payload, amount });
    const call = (sender: string, action: string, payload: Record<string, any> = {}, activeKey = false) =>
        ts.contractJson(sender, { contract: 'dao', action, payload, activeKey });
    const vote = (voter: string, support: boolean, proposalId = 'grant-1') => call(voter, 'vote', { proposalId, support });
    const transfersTo = (to: string) => ts.outgoingTransfers.filter((transfer) => transfer.to === to);
    const eventNames = async () => (await ts.getEvents()).map((event: any) => event.data.action);

    afterEach(async () => {
        jest.restoreAllMocks();
        await ts?.stop();
    });

    test('runs the full lifecycle with Hive Power weights and scheduled tally and execute', async () => {
        await setup();
        await ts.streamer.registerAction(new TimeAction('1m', 'dao-tally', 'dao', 'tally'));
        await ts.streamer.registerAction(new TimeAction('1m', 'dao-execute', 'dao', 'execute'));

        await deposit('funder', '500.000 HIVE');
        await propose('alice');
        expect((await proposal()).status).toBe('active');

        await vote('alice', true);
        await vote('carol', false);
        await vote('erin', true);

        const votes = await query('SELECT voter, support, weight FROM dao_votes ORDER BY voter');
        expect(votes).toEqual([
            { voter: 'alice', support: 1, weight: '2000' },
            { voter: 'carol', support: 0, weight: '500' },
            { voter: 'erin', support: 1, weight: '10' }
        ]);

        await ts.advanceTime('1h');

        const tallied = await proposal();
        expect(tallied).toMatchObject({ status: 'queued', for_weight: '2010', against_weight: '500', voter_count: 3, deposit_status: 'refunded' });
        expect(transfersTo('alice')).toEqual([expect.objectContaining({ from: 'testaccount', amount: '1.000 HIVE' })]);
        expect(transfersTo('bob')).toHaveLength(0);

        // Still timelocked an hour later.
        await ts.advanceTime('1h');
        expect((await proposal()).status).toBe('queued');

        await ts.advanceTime('61m');
        expect((await proposal()).status).toBe('executed');
        expect(transfersTo('bob')).toEqual([expect.objectContaining({ from: 'testaccount', amount: '100.000 HIVE', memo: '[DAO] Fund the meetup (grant-1)' })]);
        expect((await payouts())[0].status).toBe('paid');
        expect(await balance()).toBe('400.000');

        await ts.advanceTime('1h');
        expect(transfersTo('bob')).toHaveLength(1);
        expect(errors).toEqual([]);

        expect(await eventNames()).toEqual(expect.arrayContaining([
            'dao_deposit', 'dao_proposal_created', 'dao_vote_cast', 'dao_proposal_passed',
            'dao_deposit_refunded', 'dao_proposal_executing', 'dao_payout_paid', 'dao_proposal_executed'
        ]));
    });

    test('keeps the deposit when quorum is not reached', async () => {
        await setup();
        await deposit('funder', '500.000 HIVE');
        await propose('alice');
        await vote('carol', true);

        await ts.advanceTime('1h');
        await call('dave', 'tally');

        expect(await proposal()).toMatchObject({ status: 'failed', status_reason: 'quorum_not_reached', deposit_status: 'kept' });
        expect(transfersTo('alice')).toHaveLength(0);
        expect(await balance()).toBe('501.000');
        expect((await payouts())[0].status).toBe('cancelled');

        // Tally is idempotent: running it again changes nothing.
        await call('dave', 'tally', { proposalId: 'grant-1' });
        expect(await balance()).toBe('501.000');
        expect(errors).toEqual([]);
    });

    test('fails a proposal that reaches quorum but loses the vote, refunding the deposit', async () => {
        await setup();
        await deposit('funder', '500.000 HIVE');
        await propose('carol');
        await vote('carol', true);
        await vote('alice', false);

        await expect(contract.actions.tally.handler({ proposalId: 'grant-1' }, makeContext(ts.streamer, { sender: 'dave', time: ts.currentTime })))
            .rejects.toThrow('is open until');

        await ts.advanceTime('1h');
        await call('dave', 'tally');

        expect(await proposal()).toMatchObject({ status: 'failed', status_reason: 'rejected', for_weight: '500', against_weight: '2000', deposit_status: 'refunded' });
        expect(transfersTo('carol')).toEqual([expect.objectContaining({ amount: '1.000 HIVE' })]);

        await ts.advanceTime('3h');
        await call('dave', 'execute', { proposalId: 'grant-1' });
        expect(errors).toContain('Proposal grant-1 is failed');
        expect(transfersTo('bob')).toHaveLength(0);
    });

    test('rejects execute before the timelock elapses', async () => {
        await setup();
        await deposit('funder', '500.000 HIVE');
        await propose('alice');
        await vote('alice', true);
        await ts.advanceTime('1h');
        await call('dave', 'tally');

        await call('dave', 'execute', { proposalId: 'grant-1' });
        expect(errors).toEqual([expect.stringContaining('is timelocked until')]);

        // A sweep skips it quietly.
        await call('dave', 'execute');
        expect((await proposal()).status).toBe('queued');
        expect(transfersTo('bob')).toHaveLength(0);

        await ts.advanceTime('2h');
        await call('dave', 'execute', { proposalId: 'grant-1' });
        expect((await proposal()).status).toBe('executed');
        expect(transfersTo('bob')).toHaveLength(1);
    });

    test('lets admins veto during the timelock only', async () => {
        await setup({ admins: ['council'] });
        await deposit('funder', '500.000 HIVE');
        await propose('alice');
        await vote('alice', true);
        await ts.advanceTime('1h');
        await call('dave', 'tally');

        await call('council', 'vetoProposal', { proposalId: 'grant-1' });
        expect(rejections).toContain('active_key_required');

        await call('alice', 'vetoProposal', { proposalId: 'grant-1' }, true);
        expect(errors).toContain('alice is not a DAO admin');

        await call('council', 'vetoProposal', { proposalId: 'grant-1', reason: 'Duplicate of grant-0' }, true);
        expect(await proposal()).toMatchObject({ status: 'vetoed', status_reason: 'Duplicate of grant-0' });
        expect((await payouts())[0].status).toBe('cancelled');

        await ts.advanceTime('3h');
        await call('dave', 'execute');
        expect(transfersTo('bob')).toHaveLength(0);
        expect(await balance()).toBe('500.000');

        // A second proposal past its timelock can no longer be vetoed.
        await propose('alice', { ...PROPOSAL, proposalId: 'grant-2' });
        await vote('alice', true, 'grant-2');
        await ts.advanceTime('1h');
        await call('dave', 'tally');
        await ts.advanceTime('2h');
        await expect(contract.actions.vetoProposal.handler({ proposalId: 'grant-2' }, makeContext(ts.streamer, { sender: 'council', time: ts.currentTime })))
            .rejects.toThrow('only be vetoed during its timelock');
    });

    test('retries a failed payout when execute is called again', async () => {
        await setup();
        await deposit('funder', '500.000 HIVE');
        await propose('alice', {
            ...PROPOSAL,
            payouts: [{ to: 'bob', amount: '100.000', asset: 'HIVE' }, { to: 'carol', amount: '50.000', asset: 'HIVE' }]
        });
        await vote('alice', true);
        await ts.advanceTime('1h');
        await call('dave', 'tally');
        await ts.advanceTime('2h');

        const send = jest.spyOn(ts.streamer, 'transferHiveTokens');
        send.mockRejectedValueOnce(new Error('node unavailable'));

        await call('dave', 'execute');
        expect(await payouts()).toEqual([
            expect.objectContaining({ recipient: 'bob', status: 'failed', attempts: 1, last_error: 'node unavailable' }),
            expect.objectContaining({ recipient: 'carol', status: 'paid', attempts: 1 })
        ]);
        expect((await proposal()).status).toBe('executing');
        // The failed attempt is reversed in the ledger.
        expect(await balance()).toBe('450.000');

        // Sweeps never retry a failed payout on their own.
        await call('dave', 'execute');
        expect(transfersTo('bob')).toHaveLength(0);

        await call('dave', 'execute', { proposalId: 'grant-1' });
        expect(await payouts()).toEqual([
            expect.objectContaining({ recipient: 'bob', status: 'paid', attempts: 2, last_error: null }),
            expect.objectContaining({ recipient: 'carol', status: 'paid', attempts: 1 })
        ]);
        expect((await proposal()).status).toBe('executed');
        expect(transfersTo('bob')).toHaveLength(1);
        expect(transfersTo('carol')).toHaveLength(1);
        expect(await balance()).toBe('350.000');
        expect(await eventNames()).toContain('dao_payout_failed');
    });

    test('refunds proposals whose payouts exceed the available treasury balance', async () => {
        await setup();
        await deposit('funder', '150.000 HIVE');

        await propose('alice', { ...PROPOSAL, payouts: [{ to: 'bob', amount: '151.000', asset: 'HIVE' }] });
        expect(await proposal()).toBeUndefined();
        expect(transfersTo('alice')).toEqual([expect.objectContaining({
            amount: '1.000 HIVE',
            memo: '[DAO refund] Payouts of 151.000 HIVE exceed the treasury\'s available 150.000 HIVE'
        })]);

        // Payouts already committed to a passed proposal are not available either.
        await propose('alice');
        await vote('alice', true);
        await ts.advanceTime('1h');
        await call('dave', 'tally');
        await propose('alice', { ...PROPOSAL, proposalId: 'grant-2', payouts: [{ to: 'carol', amount: '60.000', asset: 'HIVE' }] });
        expect(await proposal('grant-2')).toBeUndefined();
        expect(transfersTo('alice').at(-1)?.memo).toContain('available 50.000 HIVE');
    });

    test('refunds wrong deposits, invalid proposals and assets the treasury does not accept', async () => {
        await setup({ allowedAssets: ['HIVE'], proposalDeposit: '5.000' });

        await deposit('funder', '10.000 HBD');
        expect(transfersTo('funder')).toEqual([expect.objectContaining({ amount: '10.000 HBD', memo: '[DAO refund] The treasury does not accept HBD' })]);
        expect(await balance('HBD')).toBe('0.000');

        await propose('alice', PROPOSAL, '1.000 HIVE');
        await propose('alice', { title: 'no id' }, '5.000 HIVE');
        await propose('alice', { ...PROPOSAL, payouts: [{ to: 'bob', amount: '1.000', asset: 'HBD' }] }, '5.000 HIVE');

        expect(transfersTo('alice').map((transfer) => transfer.memo)).toEqual([
            '[DAO refund] The proposal deposit is exactly 5.000 HIVE',
            expect.stringContaining('[DAO refund] Invalid proposal: proposalId'),
            '[DAO refund] The treasury does not pay out HBD'
        ]);
        expect(await query('SELECT * FROM dao_proposals')).toEqual([]);
        expect(errors).toEqual([]);
    });

    test('does not double count a replayed vote, and a later vote replaces the earlier one', async () => {
        await setup();
        await deposit('funder', '500.000 HIVE');
        await propose('alice');

        const ctx = makeContext(ts.streamer, { sender: 'bob', time: ts.currentTime, transactionId: 'vote-trx' });
        const getAccount = jest.spyOn(ts.streamer, 'getAccount');

        await contract.actions.vote.handler({ proposalId: 'grant-1', support: true }, ctx);
        await contract.actions.vote.handler({ proposalId: 'grant-1', support: true }, ctx);
        expect(getAccount).toHaveBeenCalledTimes(1);
        expect(await query('SELECT voter, support, weight FROM dao_votes')).toEqual([{ voter: 'bob', support: 1, weight: '800' }]);

        // bob changes his mind with a new operation.
        await vote('bob', false);
        expect(await query('SELECT voter, support, weight FROM dao_votes')).toEqual([{ voter: 'bob', support: 0, weight: '800' }]);

        await vote('dave', true);
        expect(errors).toContain('dave has no voting power');

        await ts.advanceTime('1h');
        await vote('alice', true);
        expect(errors).toContain('Voting on grant-1 has ended');

        await call('dave', 'tally');
        expect(await proposal()).toMatchObject({ status: 'failed', status_reason: 'quorum_not_reached', for_weight: '0', against_weight: '800' });
    });

    test('weights votes by staked Hive Engine tokens', async () => {
        await setup({ votingPower: 'engine-token', tokenSymbol: 'GOV', quorum: '100' });
        const stakes: Record<string, { balance: string; stake: string }> = {
            alice: { balance: '1000', stake: '60.5' },
            bob: { balance: '0', stake: '40' }
        };
        const findOne = jest.spyOn(ts.streamer['hive'], 'findOne').mockImplementation(async (_contract: string, _table: string, q: any) => {
            const entry = stakes[q.account];
            return entry ? { account: q.account, symbol: q.symbol, ...entry } : null;
        });

        await deposit('funder', '500.000 HIVE');
        await propose('alice');
        await vote('alice', true);
        await vote('bob', false);
        await vote('carol', true);

        expect(findOne).toHaveBeenCalledWith('tokens', 'balances', { account: 'alice', symbol: 'GOV' });
        // Liquid balances never count, only stake.
        expect(await query('SELECT voter, weight FROM dao_votes ORDER BY voter')).toEqual([
            { voter: 'alice', weight: '60.5' },
            { voter: 'bob', weight: '40' }
        ]);
        expect(errors).toContain('carol has no voting power');

        await ts.advanceTime('1h');
        await call('dave', 'tally');
        expect(await proposal()).toMatchObject({ status: 'queued', for_weight: '60.5', against_weight: '40' });
    });

    test('lets the proposer cancel before any vote and admins change parameters for new proposals', async () => {
        await setup();
        await deposit('funder', '500.000 HIVE');
        await propose('alice');

        await call('bob', 'cancelProposal', { proposalId: 'grant-1' });
        expect(errors).toContain('Only the proposer can cancel a proposal');

        await call('alice', 'cancelProposal', { proposalId: 'grant-1' });
        expect(await proposal()).toMatchObject({ status: 'cancelled', deposit_status: 'kept' });
        expect(await balance()).toBe('501.000');

        await propose('alice', { ...PROPOSAL, proposalId: 'grant-2' });
        await vote('bob', true, 'grant-2');
        await call('alice', 'cancelProposal', { proposalId: 'grant-2' });
        expect(errors).toContain('Proposal grant-2 already has votes');

        await call('testaccount', 'setParams', { quorum: '100', passThresholdBps: 6000 });
        expect(rejections).toContain('active_key_required');
        await call('testaccount', 'setParams', { quorum: '100', passThresholdBps: 6000, proposalDeposit: '2.000' }, true);
        await call('testaccount', 'setParams', { passThresholdBps: 10000 }, true);
        expect(errors).toContain('setParams: passThresholdBps must be an integer between 1 and 9999');

        // grant-2 keeps the parameters it was created with.
        expect(await proposal('grant-2')).toMatchObject({ quorum: '1000', pass_threshold_bps: 5000 });

        await propose('alice', { ...PROPOSAL, proposalId: 'grant-3' }, '2.000 HIVE');
        expect(await proposal('grant-3')).toMatchObject({ quorum: '100', pass_threshold_bps: 6000, deposit_amount: '2.000' });
    });

    test('validates options', () => {
        expect(() => createDaoContract({ votingPower: 'engine-token' })).toThrow('requires tokenSymbol');
        expect(() => createDaoContract({ allowedAssets: ['DAO'] })).toThrow('allowedAssets');
        expect(() => createDaoContract({ passThresholdBps: 0 })).toThrow('passThresholdBps');
        expect(() => createDaoContract({ proposalDeposit: '0' })).toThrow('proposalDeposit');
        expect(createDaoContract().name).toBe('dao');
    });
});
