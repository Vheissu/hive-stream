import {
    Streamer,
    SqliteAdapter,
    createRevenueSplitContract,
    createPaywallContract,
    createDomainRegistryContract,
    createRentalContract,
    createLaunchpadContract,
    createPredictionMarketContract,
    createQuestPassContract,
    createCharityMatchContract,
    createReferralContract
} from '../../src';
import type { ContractContext } from '../../src/types/hive-stream';

describe('Second wave contracts', () => {
    let streamer: Streamer;
    let adapter: SqliteAdapter;

    const createContext = (
        trigger: 'custom_json' | 'transfer' | 'time' | 'recurrent_transfer' | 'escrow_transfer',
        sender: string,
        overrides: Record<string, any> = {}
    ): ContractContext => ({
        trigger,
        streamer,
        adapter,
        config: streamer['config'],
        block: { number: 200, id: 'block-200', previousId: 'block-199', time: new Date() },
        transaction: { id: `trx-${trigger}-${sender}-${Math.random()}` },
        sender,
        customJson: trigger === 'custom_json' ? { id: 'hivestream', json: {}, isSignedWithActiveKey: true } : undefined,
        transfer: trigger === 'transfer'
            ? { from: sender, to: 'contract', rawAmount: '0.000 HIVE', amount: '0.000', asset: 'HIVE', memo: '' }
            : undefined,
        operation: trigger === 'recurrent_transfer'
            ? { type: 'recurrent_transfer', data: { from: sender, to: 'contract', amount: '0.000 HIVE', memo: '' } }
            : undefined,
        escrow: trigger === 'escrow_transfer'
            ? {
                type: 'escrow_transfer' as const,
                from: sender,
                to: 'owner',
                agent: 'escrow.agent',
                escrowId: 99,
                hiveAmount: '0.000 HIVE',
                hbdAmount: '0.000 HBD',
                fee: '0.001 HIVE'
            }
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

    test('revenue split distributes balances and withdraws them', async () => {
        const contract = createRevenueSplitContract();
        await streamer.registerContract(contract);

        await contract.actions.createSplit.handler({
            splitId: 'split-1',
            title: 'Creator split',
            recipients: [
                { account: 'alice', bps: 7000 },
                { account: 'bob', bps: 3000 }
            ]
        }, createContext('custom_json', 'alice'));

        const paymentContext = createContext('transfer', 'fan');
        paymentContext.transfer.rawAmount = '10.000 HBD';
        paymentContext.transfer.amount = '10.000';
        paymentContext.transfer.asset = 'HBD';

        await contract.actions.distribute.handler({ splitId: 'split-1' }, paymentContext);
        const balances = await adapter.query(
            'SELECT account, balance FROM revenue_split_balances WHERE split_id = ? ORDER BY account ASC',
            ['split-1']
        );

        expect(balances[0].account).toBe('alice');
        expect(balances[0].balance).toBe('7');
        expect(balances[1].account).toBe('bob');
        expect(balances[1].balance).toBe('3');

        await contract.actions.withdraw.handler({ splitId: 'split-1' }, createContext('custom_json', 'alice'));
        const aliceBalance = await adapter.query(
            'SELECT balance FROM revenue_split_balances WHERE split_id = ? AND account = ?',
            ['split-1', 'alice']
        );
        expect(aliceBalance[0].balance).toBe('0');
    });

    test('paywall grants and revokes access', async () => {
        const contract = createPaywallContract();
        await streamer.registerContract(contract);

        await contract.actions.createResource.handler({
            resourceId: 'resource-1',
            title: 'Premium Article',
            price: '2.000',
            asset: 'HIVE',
            accessDays: 30
        }, createContext('custom_json', 'alice'));

        const recurrentContext = createContext('recurrent_transfer', 'bob');
        recurrentContext.operation.data.amount = '2.000 HIVE';

        await contract.actions.grantAccess.handler({ resourceId: 'resource-1' }, recurrentContext);
        await contract.actions.revokeAccess.handler({ resourceId: 'resource-1', account: 'bob' }, createContext('custom_json', 'alice'));

        const access = await adapter.query('SELECT status, purchases FROM paywall_access WHERE resource_id = ? AND account = ?', ['resource-1', 'bob']);
        expect(access[0].status).toBe('revoked');
        expect(access[0].purchases).toBe(1);
    });

    test('domain registry registers, renews, and transfers names', async () => {
        const contract = createDomainRegistryContract();
        await streamer.registerContract(contract);

        await contract.actions.createNamespace.handler({
            namespace: 'hiveapp',
            title: 'Hive App Names',
            registrationPrice: '5.000',
            asset: 'HBD',
            renewalDays: 365
        }, createContext('custom_json', 'alice'));

        const paymentContext = createContext('transfer', 'bob');
        paymentContext.transfer.rawAmount = '5.000 HBD';
        paymentContext.transfer.amount = '5.000';
        paymentContext.transfer.asset = 'HBD';

        await contract.actions.registerName.handler({
            namespace: 'hiveapp',
            label: 'bobshop',
            target: 'https://example.com/bob'
        }, paymentContext);

        await contract.actions.transferName.handler({
            namespace: 'hiveapp',
            label: 'bobshop',
            to: 'charlie'
        }, createContext('custom_json', 'bob'));

        const rows = await adapter.query('SELECT owner, status FROM domain_records WHERE namespace = ? AND label = ?', ['hiveapp', 'bobshop']);
        expect(rows[0].owner).toBe('charlie');
        expect(rows[0].status).toBe('active');
    });

    test('rentals initiate from escrow and can be closed', async () => {
        const contract = createRentalContract();
        await streamer.registerContract(contract);

        await contract.actions.createListing.handler({
            listingId: 'rental-1',
            assetRef: 'nft:board-1',
            title: 'Surfboard Rental',
            collateralAmount: '25.000',
            collateralAsset: 'HBD',
            dailyRate: '5.000',
            rateAsset: 'HBD',
            maxDurationDays: 7
        }, createContext('custom_json', 'alice'));

        const escrowContext = createContext('escrow_transfer', 'bob');
        escrowContext.escrow.to = 'alice';
        escrowContext.escrow.escrowId = 777;
        escrowContext.escrow.hbdAmount = '25.000 HBD';

        await contract.actions.initiateRental.handler({
            listingId: 'rental-1',
            rentalId: 'agreement-1',
            endsAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString()
        }, escrowContext);

        await contract.actions.confirmReturn.handler({ rentalId: 'agreement-1' }, createContext('custom_json', 'alice'));
        await contract.actions.closeRental.handler({ rentalId: 'agreement-1' }, createContext('custom_json', 'alice'));

        const rows = await adapter.query('SELECT status, escrow_id FROM rental_agreements WHERE rental_id = ?', ['agreement-1']);
        expect(rows[0].status).toBe('closed');
        expect(rows[0].escrow_id).toBe(777);
    });

    test('launchpad handles contributions and claims', async () => {
        const contract = createLaunchpadContract();
        await streamer.registerContract(contract);

        await contract.actions.createSale.handler({
            saleId: 'sale-1',
            title: 'Utility Token Sale',
            tokenSymbol: 'UTIL',
            purchaseAsset: 'HBD',
            unitPrice: '2.000',
            totalUnits: 100,
            closesAt: new Date(Date.now() + 3600_000).toISOString()
        }, createContext('custom_json', 'alice'));

        const paymentContext = createContext('transfer', 'bob');
        paymentContext.transfer.rawAmount = '20.000 HBD';
        paymentContext.transfer.amount = '20.000';
        paymentContext.transfer.asset = 'HBD';

        await contract.actions.contribute.handler({ saleId: 'sale-1' }, paymentContext);
        await adapter.query('UPDATE launchpad_sales SET closes_at = ? WHERE sale_id = ?', [new Date(Date.now() - 1000), 'sale-1']);
        await contract.actions.finalizeSale.handler({ saleId: 'sale-1' }, createContext('time', 'system'));
        await contract.actions.claimAllocation.handler({ saleId: 'sale-1' }, createContext('custom_json', 'bob'));

        const rows = await adapter.query('SELECT units, claimed FROM launchpad_allocations WHERE sale_id = ? AND buyer = ?', ['sale-1', 'bob']);
        expect(rows[0].units).toBe(10);
        expect(rows[0].claimed).toBe(1);
    });

    test('prediction markets resolve and winners claim payouts', async () => {
        const contract = createPredictionMarketContract();
        await streamer.registerContract(contract);

        await contract.actions.createMarket.handler({
            marketId: 'market-1',
            title: 'Will Hive rise?',
            asset: 'HBD',
            options: ['yes', 'no'],
            closesAt: new Date(Date.now() + 3600_000).toISOString()
        }, createContext('custom_json', 'alice'));

        const yesContext = createContext('transfer', 'bob');
        yesContext.transfer.rawAmount = '10.000 HBD';
        yesContext.transfer.amount = '10.000';
        yesContext.transfer.asset = 'HBD';
        await contract.actions.buyPosition.handler({ marketId: 'market-1', option: 0 }, yesContext);

        const noContext = createContext('transfer', 'charlie');
        noContext.transfer.rawAmount = '5.000 HBD';
        noContext.transfer.amount = '5.000';
        noContext.transfer.asset = 'HBD';
        await contract.actions.buyPosition.handler({ marketId: 'market-1', option: 1 }, noContext);

        await adapter.query('UPDATE prediction_markets SET closes_at = ? WHERE market_id = ?', [new Date(Date.now() - 1000), 'market-1']);
        await contract.actions.resolveMarket.handler({ marketId: 'market-1', winningOption: 0 }, createContext('time', 'system'));
        await contract.actions.claimWinnings.handler({ marketId: 'market-1' }, createContext('custom_json', 'bob'));

        const rows = await adapter.query('SELECT claimed FROM prediction_positions WHERE market_id = ? AND account = ? AND option_index = ?', ['market-1', 'bob', 0]);
        expect(rows[0].claimed).toBe(1);
    });

    test('quest pass seasons award and claim rewards', async () => {
        const contract = createQuestPassContract();
        await streamer.registerContract(contract);

        await contract.actions.createSeason.handler({
            seasonId: 'season-1',
            title: 'Season One',
            passPrice: '3.000',
            asset: 'HIVE',
            tiers: [
                { tierId: 'bronze', minPoints: 10, rewardType: 'badge', rewardValue: 'bronze-badge' }
            ]
        }, createContext('custom_json', 'alice'));

        const paymentContext = createContext('transfer', 'bob');
        paymentContext.transfer.rawAmount = '3.000 HIVE';
        paymentContext.transfer.amount = '3.000';
        paymentContext.transfer.asset = 'HIVE';
        await contract.actions.buyPass.handler({ seasonId: 'season-1' }, paymentContext);

        await contract.actions.recordProgress.handler({
            seasonId: 'season-1',
            account: 'bob',
            points: 15,
            sourceId: 'quest-1'
        }, createContext('custom_json', 'alice'));

        await contract.actions.claimReward.handler({ seasonId: 'season-1', tierId: 'bronze' }, createContext('custom_json', 'bob'));

        const claims = await adapter.query('SELECT tier_id FROM quest_pass_claims WHERE season_id = ? AND account = ?', ['season-1', 'bob']);
        expect(claims[0].tier_id).toBe('bronze');
    });

    test('charity match campaigns calculate matched totals', async () => {
        const contract = createCharityMatchContract();
        await streamer.registerContract(contract);

        await contract.actions.createCampaign.handler({
            campaignId: 'charity-1',
            title: 'Save the Reef',
            beneficiary: 'reef-fund',
            asset: 'HBD',
            matchCap: '100.000',
            matchBps: 5000,
            closesAt: new Date(Date.now() + 3600_000).toISOString()
        }, createContext('custom_json', 'alice'));

        const paymentContext = createContext('transfer', 'bob');
        paymentContext.transfer.rawAmount = '20.000 HBD';
        paymentContext.transfer.amount = '20.000';
        paymentContext.transfer.asset = 'HBD';

        await contract.actions.donate.handler({ campaignId: 'charity-1' }, paymentContext);
        await adapter.query('UPDATE charity_match_campaigns SET closes_at = ? WHERE campaign_id = ?', [new Date(Date.now() - 1000), 'charity-1']);
        await contract.actions.closeCampaign.handler({ campaignId: 'charity-1' }, createContext('time', 'system'));

        const rows = await adapter.query('SELECT total_donations, matched_total, status FROM charity_match_campaigns WHERE campaign_id = ?', ['charity-1']);
        expect(rows[0].total_donations).toBe('20');
        expect(rows[0].matched_total).toBe('10');
        expect(rows[0].status).toBe('closed');
    });

    test('referral programs fund conversions and track withdrawals', async () => {
        const contract = createReferralContract();
        await streamer.registerContract(contract);

        await contract.actions.createProgram.handler({
            programId: 'program-1',
            title: 'Affiliate Program',
            payoutAsset: 'HBD',
            rewardBps: 1000
        }, createContext('custom_json', 'alice'));

        const fundContext = createContext('transfer', 'alice');
        fundContext.transfer.rawAmount = '50.000 HBD';
        fundContext.transfer.amount = '50.000';
        fundContext.transfer.asset = 'HBD';
        await contract.actions.fundProgram.handler({ programId: 'program-1' }, fundContext);

        await contract.actions.registerCode.handler({ programId: 'program-1', code: 'BOB10' }, createContext('custom_json', 'bob'));
        await contract.actions.recordConversion.handler({
            programId: 'program-1',
            code: 'BOB10',
            buyer: 'carol',
            grossAmount: '20.000',
            asset: 'HBD',
            externalRef: 'order-1'
        }, createContext('custom_json', 'alice'));
        await contract.actions.withdrawAffiliate.handler({ programId: 'program-1' }, createContext('custom_json', 'bob'));

        const balances = await adapter.query('SELECT balance FROM referral_balances WHERE program_id = ? AND account = ?', ['program-1', 'bob']);
        expect(balances[0].balance).toBe('0');
    });
});
