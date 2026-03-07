import {
    Streamer,
    SqliteAdapter,
    createAuctionHouseContract,
    createSubscriptionContract,
    createCrowdfundContract,
    createGiftCardContract,
    createDcaBotContract,
    createMultisigTreasuryContract,
    createBountyBoardContract,
    createInvoiceContract,
    createSavingsContract,
    createBookingContract,
    createGroupBuyContract,
    createSweepstakesContract
} from '../../src';

describe('Expanded contract suite', () => {
    let streamer: Streamer;
    let adapter: SqliteAdapter;

    const createContext = (
        trigger: 'custom_json' | 'transfer' | 'time' | 'recurrent_transfer',
        sender: string,
        overrides: Record<string, any> = {}
    ) => ({
        trigger,
        streamer,
        adapter,
        config: streamer['config'],
        block: { number: 100, id: 'block-100', previousId: 'block-99', time: new Date() },
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

    test('auction house creates, bids, and settles auctions', async () => {
        const contract = createAuctionHouseContract();
        await streamer.registerContract(contract);

        await contract.actions.createAuction.handler({
            auctionId: 'auction-1',
            title: 'Rare Collectible',
            assetRef: 'nft:rare-1',
            paymentAsset: 'HBD',
            reservePrice: '10.000',
            buyNowPrice: '20.000',
            endsAt: new Date(Date.now() + 3600_000).toISOString()
        }, createContext('custom_json', 'alice'));

        const bidContext = createContext('transfer', 'bob');
        bidContext.transfer.rawAmount = '12.000 HBD';
        bidContext.transfer.amount = '12.000';
        bidContext.transfer.asset = 'HBD';

        await contract.actions.placeBid.handler({ auctionId: 'auction-1' }, bidContext);
        await contract.actions.settleAuction.handler({ auctionId: 'auction-1' }, createContext('time', 'system'));

        const rows = await adapter.query('SELECT status, highest_bidder, highest_bid FROM auction_house_auctions WHERE auction_id = ?', ['auction-1']);
        expect(rows[0].status).toBe('settled');
        expect(rows[0].highest_bidder).toBe('bob');
        expect(rows[0].highest_bid).toBe('12.000');
    });

    test('subscriptions renew from recurrent transfers', async () => {
        const contract = createSubscriptionContract();
        await streamer.registerContract(contract);

        await contract.actions.createPlan.handler({
            planId: 'pro',
            title: 'Pro Plan',
            price: '5.000',
            asset: 'HBD',
            intervalDays: 30,
            graceDays: 2
        }, createContext('custom_json', 'alice'));

        const recurrentContext = createContext('recurrent_transfer', 'bob');
        recurrentContext.operation.data.amount = '5.000 HBD';

        await contract.actions.subscribe.handler({ planId: 'pro' }, recurrentContext);

        const membership = await adapter.query(
            'SELECT status, renewals, last_source, last_asset FROM subscription_memberships WHERE plan_id = ? AND subscriber = ?',
            ['pro', 'bob']
        );

        expect(membership[0].status).toBe('active');
        expect(membership[0].renewals).toBe(1);
        expect(membership[0].last_source).toBe('recurrent_transfer');
        expect(membership[0].last_asset).toBe('HBD');
    });

    test('crowdfund campaign finalizes and releases milestones', async () => {
        const contract = createCrowdfundContract();
        await streamer.registerContract(contract);

        await contract.actions.createCampaign.handler({
            campaignId: 'campaign-1',
            title: 'Launch the product',
            targetAmount: '100.000',
            asset: 'HBD',
            deadline: new Date(Date.now() + 3600_000).toISOString(),
            milestones: [{ title: 'Prototype', targetPercent: 50 }]
        }, createContext('custom_json', 'alice'));

        const contributionContext = createContext('transfer', 'bob');
        contributionContext.transfer.rawAmount = '100.000 HBD';
        contributionContext.transfer.amount = '100.000';
        contributionContext.transfer.asset = 'HBD';

        await contract.actions.contribute.handler({ campaignId: 'campaign-1' }, contributionContext);
        await contract.actions.finalizeCampaign.handler({ campaignId: 'campaign-1' }, createContext('time', 'system'));
        await contract.actions.releaseMilestone.handler({ campaignId: 'campaign-1', milestoneIndex: 0 }, createContext('custom_json', 'alice'));

        const campaign = await adapter.query('SELECT status, current_amount FROM crowdfund_campaigns WHERE campaign_id = ?', ['campaign-1']);
        const milestone = await adapter.query(
            'SELECT status, released_amount FROM crowdfund_milestones WHERE campaign_id = ? AND milestone_index = ?',
            ['campaign-1', 0]
        );

        expect(campaign[0].status).toBe('funded');
        expect(campaign[0].current_amount).toBe('100');
        expect(milestone[0].status).toBe('released');
        expect(milestone[0].released_amount).toBe('50');
    });

    test('gift cards issue and redeem partially', async () => {
        const contract = createGiftCardContract();
        await streamer.registerContract(contract);

        const issueContext = createContext('transfer', 'alice');
        issueContext.transfer.rawAmount = '25.000 HIVE';
        issueContext.transfer.amount = '25.000';
        issueContext.transfer.asset = 'HIVE';

        await contract.actions.issueGiftCard.handler({
            code: 'gift-1',
            recipient: 'bob',
            message: 'Enjoy'
        }, issueContext);

        await contract.actions.redeemGiftCard.handler({ code: 'gift-1', amount: '10.000' }, createContext('custom_json', 'bob'));

        const card = await adapter.query('SELECT remaining_amount, status FROM gift_cards WHERE code = ?', ['gift-1']);
        expect(card[0].remaining_amount).toBe('15');
        expect(card[0].status).toBe('active');

        await expect(contract.actions.cancelGiftCard.handler({ code: 'gift-1' }, createContext('custom_json', 'alice')))
            .rejects
            .toThrow('Gift cards with redemptions cannot be cancelled');
    });

    test('dca bots queue executions and acknowledge them', async () => {
        const contract = createDcaBotContract();
        await streamer.registerContract(contract);

        await contract.actions.createBot.handler({
            botId: 'bot-1',
            baseAsset: 'HIVE',
            quoteAsset: 'HBD',
            amountPerInterval: '10.000',
            intervalHours: 24
        }, createContext('custom_json', 'alice'));

        await contract.actions.executeDueBots.handler({}, createContext('time', 'system'));

        const executionRows = await adapter.query('SELECT id, status FROM dca_executions WHERE bot_id = ?', ['bot-1']);
        expect(executionRows.length).toBe(1);
        expect(executionRows[0].status).toBe('queued');

        await contract.actions.acknowledgeExecution.handler({
            botId: 'bot-1',
            executionId: executionRows[0].id,
            status: 'filled',
            externalRef: 'order-1'
        }, createContext('custom_json', 'alice'));

        const updatedRows = await adapter.query('SELECT status, external_ref FROM dca_executions WHERE id = ?', [executionRows[0].id]);
        expect(updatedRows[0].status).toBe('filled');
        expect(updatedRows[0].external_ref).toBe('order-1');
    });

    test('multisig treasury proposals move to ready after threshold approvals', async () => {
        const contract = createMultisigTreasuryContract();
        await streamer.registerContract(contract);

        await contract.actions.createVault.handler({
            vaultId: 'vault-1',
            title: 'Ops Treasury',
            signers: ['bob', 'carol'],
            threshold: 2
        }, createContext('custom_json', 'alice'));

        await contract.actions.proposeTransfer.handler({
            vaultId: 'vault-1',
            proposalId: 'proposal-1',
            title: 'Pay vendor',
            to: 'vendor',
            amount: '50.000',
            asset: 'HBD',
            memo: 'invoice #123'
        }, createContext('custom_json', 'bob'));

        await contract.actions.approveProposal.handler({ proposalId: 'proposal-1' }, createContext('custom_json', 'bob'));
        await contract.actions.approveProposal.handler({ proposalId: 'proposal-1' }, createContext('custom_json', 'carol'));

        const proposals = await adapter.query('SELECT status, approvals_count FROM treasury_proposals WHERE proposal_id = ?', ['proposal-1']);
        expect(proposals[0].status).toBe('ready');
        expect(proposals[0].approvals_count).toBe(2);

        await contract.actions.markExecuted.handler({ proposalId: 'proposal-1', txId: 'tx-1' }, createContext('custom_json', 'alice'));
        const executed = await adapter.query('SELECT status FROM treasury_proposals WHERE proposal_id = ?', ['proposal-1']);
        expect(executed[0].status).toBe('executed');
    });

    test('remaining new factories register through the public export surface', async () => {
        const contracts = [
            createBountyBoardContract(),
            createInvoiceContract(),
            createSavingsContract(),
            createBookingContract(),
            createGroupBuyContract(),
            createSweepstakesContract()
        ];

        for (const contract of contracts) {
            await streamer.registerContract(contract);
            expect(contract.name).toBeTruthy();
            expect(Object.keys(contract.actions).length).toBeGreaterThan(0);
        }
    });
});
