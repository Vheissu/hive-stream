import {
    Streamer,
    SqliteAdapter,
    createInsurancePoolContract,
    createOracleBountyContract,
    createGrantRoundsContract,
    createPayrollContract,
    createProposalTimelockContract,
    createBundleMarketplaceContract,
    createTicketingContract,
    createFanClubContract
} from '../../src';
import type { ContractContext } from '../../src/types/hive-stream';

describe('Third wave contract suite', () => {
    let streamer: Streamer;
    let adapter: SqliteAdapter;

    const createContext = (
        trigger: 'custom_json' | 'transfer' | 'time' | 'recurrent_transfer',
        sender: string,
        overrides: Record<string, any> = {}
    ): ContractContext => ({
        trigger,
        streamer,
        adapter,
        config: streamer['config'],
        block: { number: 300, id: 'block-300', previousId: 'block-299', time: new Date() },
        transaction: { id: `trx-${trigger}-${sender}-${Math.random()}` },
        sender,
        customJson: trigger === 'custom_json' ? { id: 'hivestream', json: {}, isSignedWithActiveKey: true } : undefined,
        transfer: trigger === 'transfer'
            ? { from: sender, to: 'contract', rawAmount: '0.000 HIVE', amount: '0.000', asset: 'HIVE', memo: '' }
            : undefined,
        operation: trigger === 'recurrent_transfer'
            ? { type: 'recurrent_transfer', data: { from: sender, to: 'contract', amount: '0.000 HIVE', memo: '' } }
            : undefined,
        ...overrides
    });

    beforeEach(async () => {
        streamer = new Streamer({
            JSON_ID: 'hivestream',
            PAYLOAD_IDENTIFIER: 'hive_stream'
        });
        adapter = new SqliteAdapter(':memory:');
        await streamer.registerAdapter(adapter);
    });

    afterEach(async () => {
        await streamer.stop();
    });

    test('insurance pools manage reserves, claims, and expiries', async () => {
        const contract = createInsurancePoolContract();
        await streamer.registerContract(contract);

        await contract.actions.createPool.handler({
            poolId: 'pool-1',
            title: 'Creator Coverage',
            asset: 'HBD',
            premiumAmount: '10.000',
            coverageCap: '50.000',
            coverageDays: 30
        }, createContext('custom_json', 'alice'));

        const fundContext = createContext('transfer', 'alice');
        fundContext.transfer.rawAmount = '100.000 HBD';
        fundContext.transfer.amount = '100.000';
        fundContext.transfer.asset = 'HBD';
        await contract.actions.fundPool.handler({ poolId: 'pool-1' }, fundContext);

        const buyContext = createContext('transfer', 'bob');
        buyContext.transfer.rawAmount = '10.000 HBD';
        buyContext.transfer.amount = '10.000';
        buyContext.transfer.asset = 'HBD';
        await contract.actions.buyPolicy.handler({ poolId: 'pool-1' }, buyContext);

        await contract.actions.fileClaim.handler({
            poolId: 'pool-1',
            claimId: 'claim-1',
            amount: '25.000',
            reason: 'storm damage'
        }, createContext('custom_json', 'bob'));
        await contract.actions.approveClaim.handler({
            claimId: 'claim-1',
            note: 'approved'
        }, createContext('custom_json', 'alice'));

        await adapter.query(
            'UPDATE insurance_policies SET expires_at = ? WHERE pool_id = ? AND holder = ?',
            [new Date(Date.now() - 1000), 'pool-1', 'bob']
        );
        await contract.actions.expirePolicies.handler({ poolId: 'pool-1' }, createContext('time', 'system'));

        const pools = await adapter.query('SELECT reserve_balance FROM insurance_pools WHERE pool_id = ?', ['pool-1']);
        const claims = await adapter.query('SELECT status, approved_amount FROM insurance_claims WHERE claim_id = ?', ['claim-1']);
        const policies = await adapter.query(
            'SELECT status FROM insurance_policies WHERE pool_id = ? AND holder = ?',
            ['pool-1', 'bob']
        );

        expect(pools[0].reserve_balance).toBe('85');
        expect(claims[0].status).toBe('approved');
        expect(claims[0].approved_amount).toBe('25.000');
        expect(policies[0].status).toBe('expired');
    });

    test('oracle bounty rounds reward in-range reporters and support withdrawals', async () => {
        const contract = createOracleBountyContract();
        await streamer.registerContract(contract);

        await contract.actions.createFeed.handler({
            feedId: 'feed-1',
            title: 'Hive Price Feed',
            rewardPerReport: '2.000',
            rewardAsset: 'HBD',
            toleranceBps: 1000
        }, createContext('custom_json', 'alice'));

        const fundContext = createContext('transfer', 'alice');
        fundContext.transfer.rawAmount = '10.000 HBD';
        fundContext.transfer.amount = '10.000';
        fundContext.transfer.asset = 'HBD';
        await contract.actions.fundFeed.handler({ feedId: 'feed-1' }, fundContext);

        await contract.actions.submitReport.handler({ feedId: 'feed-1', roundId: 'round-1', value: 100 }, createContext('custom_json', 'bob'));
        await contract.actions.submitReport.handler({ feedId: 'feed-1', roundId: 'round-1', value: 102 }, createContext('custom_json', 'carol'));
        await contract.actions.submitReport.handler({ feedId: 'feed-1', roundId: 'round-1', value: 130 }, createContext('custom_json', 'dave'));
        await contract.actions.finalizeRound.handler({ feedId: 'feed-1', roundId: 'round-1' }, createContext('custom_json', 'alice'));
        await contract.actions.withdrawRewards.handler({ feedId: 'feed-1' }, createContext('custom_json', 'bob'));

        const rounds = await adapter.query(
            'SELECT median_value, status FROM oracle_rounds WHERE feed_id = ? AND round_id = ?',
            ['feed-1', 'round-1']
        );
        const rewarded = await adapter.query(
            'SELECT reporter, rewarded FROM oracle_reports WHERE feed_id = ? AND round_id = ? ORDER BY reporter ASC',
            ['feed-1', 'round-1']
        );
        const bobBalance = await adapter.query(
            'SELECT balance FROM oracle_reward_balances WHERE feed_id = ? AND account = ?',
            ['feed-1', 'bob']
        );
        const carolBalance = await adapter.query(
            'SELECT balance FROM oracle_reward_balances WHERE feed_id = ? AND account = ?',
            ['feed-1', 'carol']
        );

        expect(rounds[0].median_value).toBe(102);
        expect(rounds[0].status).toBe('finalized');
        expect(rewarded.filter((row: any) => row.rewarded === 1)).toHaveLength(2);
        expect(bobBalance[0].balance).toBe('0');
        expect(carolBalance[0].balance).toBe('2');
    });

    test('grant rounds allocate matching pools and recipients withdraw them', async () => {
        const contract = createGrantRoundsContract();
        await streamer.registerContract(contract);

        await contract.actions.createRound.handler({
            roundId: 'round-1',
            title: 'Public Goods Round',
            asset: 'HBD',
            closesAt: new Date(Date.now() + 3600_000).toISOString()
        }, createContext('custom_json', 'alice'));

        const fundContext = createContext('transfer', 'alice');
        fundContext.transfer.rawAmount = '90.000 HBD';
        fundContext.transfer.amount = '90.000';
        fundContext.transfer.asset = 'HBD';
        await contract.actions.fundRound.handler({ roundId: 'round-1' }, fundContext);

        await contract.actions.submitProject.handler({
            roundId: 'round-1',
            projectId: 'project-1',
            title: 'Docs Refresh',
            recipient: 'bob'
        }, createContext('custom_json', 'bob'));
        await contract.actions.submitProject.handler({
            roundId: 'round-1',
            projectId: 'project-2',
            title: 'Indexer Upgrade',
            recipient: 'dave'
        }, createContext('custom_json', 'dave'));

        const p1Donation = createContext('transfer', 'eve');
        p1Donation.transfer.rawAmount = '5.000 HBD';
        p1Donation.transfer.amount = '5.000';
        p1Donation.transfer.asset = 'HBD';
        await contract.actions.donateToProject.handler({ roundId: 'round-1', projectId: 'project-1' }, p1Donation);

        const p2DonationOne = createContext('transfer', 'eve');
        p2DonationOne.transfer.rawAmount = '5.000 HBD';
        p2DonationOne.transfer.amount = '5.000';
        p2DonationOne.transfer.asset = 'HBD';
        await contract.actions.donateToProject.handler({ roundId: 'round-1', projectId: 'project-2' }, p2DonationOne);

        const p2DonationTwo = createContext('transfer', 'frank');
        p2DonationTwo.transfer.rawAmount = '5.000 HBD';
        p2DonationTwo.transfer.amount = '5.000';
        p2DonationTwo.transfer.asset = 'HBD';
        await contract.actions.donateToProject.handler({ roundId: 'round-1', projectId: 'project-2' }, p2DonationTwo);

        await adapter.query('UPDATE grant_rounds SET closes_at = ? WHERE round_id = ?', [new Date(Date.now() - 1000), 'round-1']);
        await contract.actions.finalizeRound.handler({ roundId: 'round-1' }, createContext('time', 'system'));
        await contract.actions.withdrawGrant.handler({
            roundId: 'round-1',
            projectId: 'project-2'
        }, createContext('custom_json', 'dave'));

        const projects = await adapter.query(
            'SELECT project_id, matching_award, withdrawn FROM grant_projects WHERE round_id = ? ORDER BY project_id ASC',
            ['round-1']
        );

        expect(projects[0].matching_award).toBe('30');
        expect(projects[1].matching_award).toBe('60');
        expect(projects[1].withdrawn).toBe(1);
    });

    test('payroll runs allocate balances from funded budgets', async () => {
        const contract = createPayrollContract();
        await streamer.registerContract(contract);

        await contract.actions.createPayroll.handler({
            payrollId: 'payroll-1',
            title: 'Contributors',
            asset: 'HBD',
            intervalDays: 14
        }, createContext('custom_json', 'alice'));
        await contract.actions.addRecipient.handler({
            payrollId: 'payroll-1',
            account: 'bob',
            amount: '10.000'
        }, createContext('custom_json', 'alice'));
        await contract.actions.addRecipient.handler({
            payrollId: 'payroll-1',
            account: 'carol',
            amount: '20.000'
        }, createContext('custom_json', 'alice'));

        const fundContext = createContext('transfer', 'alice');
        fundContext.transfer.rawAmount = '50.000 HBD';
        fundContext.transfer.amount = '50.000';
        fundContext.transfer.asset = 'HBD';
        await contract.actions.fundPayroll.handler({ payrollId: 'payroll-1' }, fundContext);

        await contract.actions.runPayroll.handler({ payrollId: 'payroll-1' }, createContext('time', 'system'));
        await contract.actions.withdrawPayroll.handler({ payrollId: 'payroll-1' }, createContext('custom_json', 'bob'));

        const payroll = await adapter.query(
            'SELECT budget_balance FROM payroll_runs WHERE payroll_id = ?',
            ['payroll-1']
        );
        const balances = await adapter.query(
            'SELECT account, balance FROM payroll_balances WHERE payroll_id = ? ORDER BY account ASC',
            ['payroll-1']
        );
        const executions = await adapter.query(
            'SELECT run_amount, recipient_count FROM payroll_executions WHERE payroll_id = ?',
            ['payroll-1']
        );

        expect(payroll[0].budget_balance).toBe('20');
        expect(balances[0].balance).toBe('0');
        expect(balances[1].balance).toBe('20');
        expect(executions[0].run_amount).toBe('30');
        expect(executions[0].recipient_count).toBe(2);
    });

    test('proposal timelocks move approved proposals into executed state after the delay', async () => {
        const contract = createProposalTimelockContract();
        await streamer.registerContract(contract);

        await contract.actions.createQueue.handler({
            queueId: 'queue-1',
            title: 'Governance Queue',
            approvers: ['bob', 'carol'],
            threshold: 2,
            minDelayHours: 24
        }, createContext('custom_json', 'alice'));
        await contract.actions.createProposal.handler({
            queueId: 'queue-1',
            proposalId: 'proposal-1',
            title: 'Rotate Treasury Key',
            actionType: 'updateAuthority',
            actionPayload: { account: 'treasury', key: 'STM...' }
        }, createContext('custom_json', 'bob'));
        await contract.actions.approveProposal.handler({ proposalId: 'proposal-1' }, createContext('custom_json', 'bob'));
        await contract.actions.approveProposal.handler({ proposalId: 'proposal-1' }, createContext('custom_json', 'carol'));

        await adapter.query(
            'UPDATE timelock_proposals SET ready_at = ? WHERE proposal_id = ?',
            [new Date(Date.now() - 1000), 'proposal-1']
        );
        await contract.actions.executeProposal.handler({
            proposalId: 'proposal-1',
            executionRef: 'exec-1'
        }, createContext('custom_json', 'alice'));

        const proposals = await adapter.query(
            'SELECT status, approvals_count, execution_ref FROM timelock_proposals WHERE proposal_id = ?',
            ['proposal-1']
        );

        expect(proposals[0].status).toBe('executed');
        expect(proposals[0].approvals_count).toBe(2);
        expect(proposals[0].execution_ref).toBe('exec-1');
    });

    test('bundle marketplace updates inventory, records purchases, and fulfills them', async () => {
        const contract = createBundleMarketplaceContract();
        await streamer.registerContract(contract);

        await contract.actions.createBundle.handler({
            bundleId: 'bundle-1',
            title: 'Starter Pack',
            price: '12.000',
            asset: 'HIVE',
            items: ['nft:pack-1', 'role:vip'],
            inventory: 4
        }, createContext('custom_json', 'alice'));
        await contract.actions.updateBundle.handler({
            bundleId: 'bundle-1',
            title: 'Starter Pack Plus',
            price: '15.000'
        }, createContext('custom_json', 'alice'));

        const purchaseContext = createContext('transfer', 'bob');
        purchaseContext.transfer.rawAmount = '15.000 HIVE';
        purchaseContext.transfer.amount = '15.000';
        purchaseContext.transfer.asset = 'HIVE';
        await contract.actions.buyBundle.handler({ bundleId: 'bundle-1' }, purchaseContext);

        const purchases = await adapter.query(
            'SELECT id FROM bundle_marketplace_purchases WHERE bundle_id = ?',
            ['bundle-1']
        );
        await contract.actions.fulfillPurchase.handler({
            purchaseId: purchases[0].id,
            notes: 'sent'
        }, createContext('custom_json', 'alice'));

        const bundles = await adapter.query(
            'SELECT title, sold_count, inventory FROM bundle_marketplace_bundles WHERE bundle_id = ?',
            ['bundle-1']
        );
        const fulfilled = await adapter.query(
            'SELECT status, notes FROM bundle_marketplace_purchases WHERE id = ?',
            [purchases[0].id]
        );

        expect(bundles[0].title).toBe('Starter Pack Plus');
        expect(bundles[0].sold_count).toBe(1);
        expect(bundles[0].inventory).toBe(3);
        expect(fulfilled[0].status).toBe('fulfilled');
        expect(fulfilled[0].notes).toBe('sent');
    });

    test('ticketing supports purchase, check-in, and refunds', async () => {
        const contract = createTicketingContract();
        await streamer.registerContract(contract);

        await contract.actions.createEvent.handler({
            eventId: 'event-1',
            title: 'Hive Summit',
            venue: 'Main Hall',
            startsAt: new Date(Date.now() + 24 * 3600_000).toISOString(),
            ticketPrice: '25.000',
            asset: 'HBD',
            capacity: 3
        }, createContext('custom_json', 'alice'));

        const bobPurchase = createContext('transfer', 'bob');
        bobPurchase.transfer.rawAmount = '25.000 HBD';
        bobPurchase.transfer.amount = '25.000';
        bobPurchase.transfer.asset = 'HBD';
        await contract.actions.purchaseTicket.handler({ eventId: 'event-1', ticketId: 'ticket-1' }, bobPurchase);

        const carolPurchase = createContext('transfer', 'carol');
        carolPurchase.transfer.rawAmount = '25.000 HBD';
        carolPurchase.transfer.amount = '25.000';
        carolPurchase.transfer.asset = 'HBD';
        await contract.actions.purchaseTicket.handler({ eventId: 'event-1', ticketId: 'ticket-2' }, carolPurchase);

        await contract.actions.checkInTicket.handler({
            ticketId: 'ticket-1',
            note: 'checked'
        }, createContext('custom_json', 'alice'));
        await contract.actions.refundTicket.handler({
            ticketId: 'ticket-2',
            note: 'requested'
        }, createContext('custom_json', 'carol'));

        const eventRows = await adapter.query(
            'SELECT sold_count FROM ticket_events WHERE event_id = ?',
            ['event-1']
        );
        const tickets = await adapter.query(
            'SELECT ticket_id, status FROM tickets WHERE event_id = ? ORDER BY ticket_id ASC',
            ['event-1']
        );

        expect(eventRows[0].sold_count).toBe(2);
        expect(tickets[0].status).toBe('checked_in');
        expect(tickets[1].status).toBe('refunded');
    });

    test('fan clubs renew memberships, award points, and redeem perks', async () => {
        const contract = createFanClubContract();
        await streamer.registerContract(contract);

        await contract.actions.createClub.handler({
            clubId: 'club-1',
            title: 'Hive Legends',
            joinPrice: '3.000',
            asset: 'HIVE',
            perks: [
                { perkId: 'vip', minPoints: 10, title: 'VIP Chat' }
            ]
        }, createContext('custom_json', 'alice'));

        const joinContext = createContext('transfer', 'bob');
        joinContext.transfer.rawAmount = '3.000 HIVE';
        joinContext.transfer.amount = '3.000';
        joinContext.transfer.asset = 'HIVE';
        await contract.actions.joinClub.handler({ clubId: 'club-1' }, joinContext);

        const renewContext = createContext('recurrent_transfer', 'bob');
        renewContext.operation.data.amount = '3.000 HIVE';
        await contract.actions.joinClub.handler({ clubId: 'club-1' }, renewContext);

        await contract.actions.recordEngagement.handler({
            clubId: 'club-1',
            account: 'bob',
            points: 12
        }, createContext('custom_json', 'alice'));
        await contract.actions.redeemPerk.handler({
            clubId: 'club-1',
            perkId: 'vip'
        }, createContext('custom_json', 'bob'));

        const members = await adapter.query(
            'SELECT renewals, points, status FROM fan_club_members WHERE club_id = ? AND account = ?',
            ['club-1', 'bob']
        );
        const redemptions = await adapter.query(
            'SELECT perk_id FROM fan_club_redemptions WHERE club_id = ? AND account = ?',
            ['club-1', 'bob']
        );

        expect(members[0].renewals).toBe(2);
        expect(members[0].points).toBe(12);
        expect(members[0].status).toBe('active');
        expect(redemptions[0].perk_id).toBe('vip');
    });
});
