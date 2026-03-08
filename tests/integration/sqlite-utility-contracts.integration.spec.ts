import fs from 'fs';
import os from 'os';
import path from 'path';
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

describe('SQLite utility contract integration', () => {
    let tempDir: string;
    let dbPath: string;
    let streamer: Streamer;
    let adapter: SqliteAdapter;

    const customJsonOp = (sender: string, contract: string, action: string, payload: Record<string, any>, active = true) => ([
        'custom_json',
        {
            id: 'hivestream',
            json: JSON.stringify({
                hive_stream: {
                    contract,
                    action,
                    payload
                }
            }),
            required_auths: active ? [sender] : [],
            required_posting_auths: active ? [] : [sender]
        }
    ] as [string, any]);

    const transferOp = (sender: string, amount: string, contract: string, action: string, payload: Record<string, any>) => ([
        'transfer',
        {
            from: sender,
            to: 'app.contract',
            amount,
            memo: JSON.stringify({
                hive_stream: {
                    contract,
                    action,
                    payload
                }
            })
        }
    ] as [string, any]);

    const recurrentTransferOp = (sender: string, amount: string, contract: string, action: string, payload: Record<string, any>) => ([
        'recurrent_transfer',
        {
            from: sender,
            to: 'app.contract',
            amount,
            memo: JSON.stringify({
                hive_stream: {
                    contract,
                    action,
                    payload
                }
            }),
            recurrence: 30,
            executions: 12
        }
    ] as [string, any]);

    beforeEach(async () => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-stream-utility-contracts-'));
        dbPath = path.join(tempDir, 'utility-contracts.sqlite');

        streamer = new Streamer({
            JSON_ID: 'hivestream',
            PAYLOAD_IDENTIFIER: 'hive_stream'
        });
        adapter = new SqliteAdapter(dbPath);
        await streamer.registerAdapter(adapter);

        await streamer.registerContract(createInsurancePoolContract({ name: 'insurancepool' }));
        await streamer.registerContract(createOracleBountyContract({ name: 'oraclebounty' }));
        await streamer.registerContract(createGrantRoundsContract({ name: 'grantrounds' }));
        await streamer.registerContract(createPayrollContract({ name: 'payroll' }));
        await streamer.registerContract(createProposalTimelockContract({ name: 'proposaltimelock' }));
        await streamer.registerContract(createBundleMarketplaceContract({ name: 'bundlemarketplace' }));
        await streamer.registerContract(createTicketingContract({ name: 'ticketing' }));
        await streamer.registerContract(createFanClubContract({ name: 'fanclub' }));
    });

    afterEach(async () => {
        await streamer.stop();
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    test('processOperation persists utility contract workflows in a real SQLite database', async () => {
        const now = new Date('2026-03-07T12:00:00.000Z');
        let blockNumber = 1;

        const runOperation = async (op: [string, any]) => {
            await streamer.processOperation(
                op,
                blockNumber,
                `block-${blockNumber}`,
                `block-${blockNumber - 1}`,
                `trx-${blockNumber}`,
                now
            );
            blockNumber += 1;
        };

        const futureClose = new Date(Date.now() + 3600_000).toISOString();
        const futureEvent = new Date(Date.now() + 24 * 3600_000).toISOString();

        await runOperation(customJsonOp('alice', 'insurancepool', 'createPool', {
            poolId: 'pool-live',
            title: 'Live Coverage',
            asset: 'HBD',
            premiumAmount: '10.000',
            coverageCap: '50.000',
            coverageDays: 30
        }));
        await runOperation(transferOp('alice', '100.000 HBD', 'insurancepool', 'fundPool', { poolId: 'pool-live' }));
        await runOperation(transferOp('bob', '10.000 HBD', 'insurancepool', 'buyPolicy', { poolId: 'pool-live' }));
        await runOperation(customJsonOp('bob', 'insurancepool', 'fileClaim', {
            poolId: 'pool-live',
            claimId: 'claim-live',
            amount: '25.000',
            reason: 'equipment damage'
        }));
        await runOperation(customJsonOp('alice', 'insurancepool', 'approveClaim', { claimId: 'claim-live' }));

        await runOperation(customJsonOp('alice', 'oraclebounty', 'createFeed', {
            feedId: 'feed-live',
            title: 'Live Oracle Feed',
            rewardPerReport: '2.000',
            rewardAsset: 'HBD',
            toleranceBps: 1000
        }));
        await runOperation(transferOp('alice', '10.000 HBD', 'oraclebounty', 'fundFeed', { feedId: 'feed-live' }));
        await runOperation(customJsonOp('bob', 'oraclebounty', 'submitReport', {
            feedId: 'feed-live',
            roundId: 'round-live',
            value: 100
        }));
        await runOperation(customJsonOp('carol', 'oraclebounty', 'submitReport', {
            feedId: 'feed-live',
            roundId: 'round-live',
            value: 102
        }));
        await runOperation(customJsonOp('alice', 'oraclebounty', 'finalizeRound', {
            feedId: 'feed-live',
            roundId: 'round-live'
        }));
        await runOperation(customJsonOp('bob', 'oraclebounty', 'withdrawRewards', { feedId: 'feed-live' }));

        await runOperation(customJsonOp('alice', 'grantrounds', 'createRound', {
            roundId: 'grant-live',
            title: 'Utility Grants',
            asset: 'HBD',
            closesAt: futureClose
        }));
        await runOperation(transferOp('alice', '40.000 HBD', 'grantrounds', 'fundRound', { roundId: 'grant-live' }));
        await runOperation(customJsonOp('dave', 'grantrounds', 'submitProject', {
            roundId: 'grant-live',
            projectId: 'project-live',
            title: 'Indexer Upgrade',
            recipient: 'dave'
        }));
        await runOperation(transferOp('erin', '5.000 HBD', 'grantrounds', 'donateToProject', {
            roundId: 'grant-live',
            projectId: 'project-live'
        }));
        await adapter.query('UPDATE grant_rounds SET closes_at = ? WHERE round_id = ?', [new Date(Date.now() - 1000), 'grant-live']);
        await runOperation(customJsonOp('alice', 'grantrounds', 'finalizeRound', { roundId: 'grant-live' }));
        await runOperation(customJsonOp('dave', 'grantrounds', 'withdrawGrant', {
            roundId: 'grant-live',
            projectId: 'project-live'
        }));

        await runOperation(customJsonOp('alice', 'payroll', 'createPayroll', {
            payrollId: 'payroll-live',
            title: 'Ops Payroll',
            asset: 'HBD',
            intervalDays: 30
        }));
        await runOperation(customJsonOp('alice', 'payroll', 'addRecipient', {
            payrollId: 'payroll-live',
            account: 'bob',
            amount: '8.000'
        }));
        await runOperation(customJsonOp('alice', 'payroll', 'addRecipient', {
            payrollId: 'payroll-live',
            account: 'carol',
            amount: '12.000'
        }));
        await runOperation(recurrentTransferOp('alice', '20.000 HBD', 'payroll', 'fundPayroll', { payrollId: 'payroll-live' }));
        await runOperation(customJsonOp('alice', 'payroll', 'runPayroll', { payrollId: 'payroll-live' }));
        await runOperation(customJsonOp('bob', 'payroll', 'withdrawPayroll', { payrollId: 'payroll-live' }));

        await runOperation(customJsonOp('alice', 'proposaltimelock', 'createQueue', {
            queueId: 'queue-live',
            title: 'Ops Queue',
            approvers: ['bob', 'carol'],
            threshold: 2,
            minDelayHours: 1
        }));
        await runOperation(customJsonOp('bob', 'proposaltimelock', 'createProposal', {
            queueId: 'queue-live',
            proposalId: 'proposal-live',
            title: 'Ship Upgrade',
            actionType: 'deploy',
            actionPayload: {
                version: '1.0.1'
            }
        }));
        await runOperation(customJsonOp('bob', 'proposaltimelock', 'approveProposal', { proposalId: 'proposal-live' }));
        await runOperation(customJsonOp('carol', 'proposaltimelock', 'approveProposal', { proposalId: 'proposal-live' }));
        await adapter.query('UPDATE timelock_proposals SET ready_at = ? WHERE proposal_id = ?', [new Date(Date.now() - 1000), 'proposal-live']);
        await runOperation(customJsonOp('alice', 'proposaltimelock', 'executeProposal', {
            proposalId: 'proposal-live',
            executionRef: 'deploy-1'
        }));

        await runOperation(customJsonOp('alice', 'bundlemarketplace', 'createBundle', {
            bundleId: 'bundle-live',
            title: 'Launch Pack',
            price: '9.000',
            asset: 'HIVE',
            items: ['nft:drop-1', 'role:early'],
            inventory: 2
        }));
        await runOperation(transferOp('frank', '9.000 HIVE', 'bundlemarketplace', 'buyBundle', { bundleId: 'bundle-live' }));
        const purchases = await adapter.query('SELECT id FROM bundle_marketplace_purchases WHERE bundle_id = ?', ['bundle-live']);
        await runOperation(customJsonOp('alice', 'bundlemarketplace', 'fulfillPurchase', {
            purchaseId: purchases[0].id,
            notes: 'sent'
        }));

        await runOperation(customJsonOp('alice', 'ticketing', 'createEvent', {
            eventId: 'event-live',
            title: 'Hive Conference',
            venue: 'Auditorium',
            startsAt: futureEvent,
            ticketPrice: '15.000',
            asset: 'HBD',
            capacity: 10
        }));
        await runOperation(transferOp('gina', '15.000 HBD', 'ticketing', 'purchaseTicket', {
            eventId: 'event-live',
            ticketId: 'ticket-live'
        }));
        await runOperation(customJsonOp('alice', 'ticketing', 'checkInTicket', {
            ticketId: 'ticket-live',
            note: 'front desk'
        }));

        await runOperation(customJsonOp('alice', 'fanclub', 'createClub', {
            clubId: 'club-live',
            title: 'Fan Club',
            joinPrice: '3.000',
            asset: 'HIVE',
            perks: [
                { perkId: 'vip', minPoints: 5, title: 'VIP Access' }
            ]
        }));
        await runOperation(recurrentTransferOp('henry', '3.000 HIVE', 'fanclub', 'joinClub', { clubId: 'club-live' }));
        await runOperation(customJsonOp('alice', 'fanclub', 'recordEngagement', {
            clubId: 'club-live',
            account: 'henry',
            points: 6
        }));
        await runOperation(customJsonOp('henry', 'fanclub', 'redeemPerk', {
            clubId: 'club-live',
            perkId: 'vip'
        }));

        const insuranceClaims = await adapter.query(
            'SELECT status, approved_amount FROM insurance_claims WHERE claim_id = ?',
            ['claim-live']
        );
        const oracleRounds = await adapter.query(
            'SELECT median_value, status FROM oracle_rounds WHERE feed_id = ? AND round_id = ?',
            ['feed-live', 'round-live']
        );
        const grantProject = await adapter.query(
            'SELECT matching_award, withdrawn FROM grant_projects WHERE project_id = ?',
            ['project-live']
        );
        const payrollBalances = await adapter.query(
            'SELECT account, balance FROM payroll_balances WHERE payroll_id = ? ORDER BY account ASC',
            ['payroll-live']
        );
        const timelockProposal = await adapter.query(
            'SELECT status, execution_ref FROM timelock_proposals WHERE proposal_id = ?',
            ['proposal-live']
        );
        const fulfilledPurchase = await adapter.query(
            'SELECT status FROM bundle_marketplace_purchases WHERE bundle_id = ?',
            ['bundle-live']
        );
        const checkedTicket = await adapter.query(
            'SELECT status FROM tickets WHERE ticket_id = ?',
            ['ticket-live']
        );
        const fanMembership = await adapter.query(
            'SELECT renewals, points FROM fan_club_members WHERE club_id = ? AND account = ?',
            ['club-live', 'henry']
        );
        const fanRedemptions = await adapter.query(
            'SELECT COUNT(*) AS count FROM fan_club_redemptions WHERE club_id = ? AND account = ?',
            ['club-live', 'henry']
        );
        const persistedTransfers = await adapter.query('SELECT COUNT(*) AS count FROM transfers', []);
        const persistedCustomJson = await adapter.query('SELECT COUNT(*) AS count FROM customJson', []);
        const persistedEvents = await adapter.query('SELECT COUNT(*) AS count FROM events', []);

        expect(insuranceClaims[0].status).toBe('approved');
        expect(insuranceClaims[0].approved_amount).toBe('25.000');
        expect(oracleRounds[0].median_value).toBe(101);
        expect(oracleRounds[0].status).toBe('finalized');
        expect(grantProject[0].matching_award).toBe('40');
        expect(grantProject[0].withdrawn).toBe(1);
        expect(payrollBalances[0].balance).toBe('0');
        expect(payrollBalances[1].balance).toBe('12');
        expect(timelockProposal[0].status).toBe('executed');
        expect(timelockProposal[0].execution_ref).toBe('deploy-1');
        expect(fulfilledPurchase[0].status).toBe('fulfilled');
        expect(checkedTicket[0].status).toBe('checked_in');
        expect(fanMembership[0].renewals).toBe(1);
        expect(fanMembership[0].points).toBe(6);
        expect(Number(fanRedemptions[0].count)).toBe(1);
        expect(Number(persistedTransfers[0].count)).toBeGreaterThanOrEqual(5);
        expect(Number(persistedCustomJson[0].count)).toBeGreaterThanOrEqual(18);
        expect(Number(persistedEvents[0].count)).toBeGreaterThanOrEqual(20);

        await streamer.stop();

        const reopenedAdapter = new SqliteAdapter(dbPath);
        await reopenedAdapter.create();
        const reopenedInsurance = await reopenedAdapter.query(
            'SELECT status, approved_amount FROM insurance_claims WHERE claim_id = ?',
            ['claim-live']
        );
        const reopenedGrant = await reopenedAdapter.query(
            'SELECT matching_award, withdrawn FROM grant_projects WHERE project_id = ?',
            ['project-live']
        );
        const reopenedTimelock = await reopenedAdapter.query(
            'SELECT status, execution_ref FROM timelock_proposals WHERE proposal_id = ?',
            ['proposal-live']
        );
        const reopenedFanClub = await reopenedAdapter.query(
            'SELECT points FROM fan_club_members WHERE club_id = ? AND account = ?',
            ['club-live', 'henry']
        );

        expect(reopenedInsurance[0].status).toBe('approved');
        expect(reopenedInsurance[0].approved_amount).toBe('25.000');
        expect(reopenedGrant[0].matching_award).toBe('40');
        expect(reopenedGrant[0].withdrawn).toBe(1);
        expect(reopenedTimelock[0].status).toBe('executed');
        expect(reopenedTimelock[0].execution_ref).toBe('deploy-1');
        expect(reopenedFanClub[0].points).toBe(6);

        await reopenedAdapter.destroy();
    });
});
