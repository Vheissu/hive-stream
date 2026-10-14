import { createBountyBoardContract } from '../../src/contracts/bountyboard.contract';
import { createCrowdfundContract } from '../../src/contracts/crowdfund.contract';
import { createGroupBuyContract } from '../../src/contracts/groupbuy.contract';
import { createTestStreamer, TestStreamer } from '../../src/testing';
import { SqliteAdapter } from '../../src/adapters/sqlite.adapter';
import { Streamer } from '../../src/streamer';

const APP = 'app';

describe('transfer-triggered actions refund rejected payments', () => {
    let ts: TestStreamer;

    const inHours = (hours: number) => new Date(ts.provider.currentTime.getTime() + hours * 3600_000).toISOString();
    const rows = (sql: string, params: any[] = []) => ts.adapter.query(sql, params);
    const eventsNamed = async (action: string) => (await ts.getEvents()).filter((event) => event.data?.action === action);
    const sent = () => ts.outgoingTransfers.map((transfer) => [transfer.from, transfer.to, transfer.amount, transfer.memo]);
    const json = (sender: string, contract: string, action: string, payload: any) => ts.contractJson(sender, { contract, action, payload });
    const pay = (from: string, amount: string, contract: string, action: string, payload: any) =>
        ts.contractTransfer({ from, amount, contract, action, payload });

    beforeEach(async () => {
        ts = await createTestStreamer({ username: APP });
    });

    afterEach(async () => {
        await ts?.stop();
    });

    describe('crowdfund.contribute', () => {
        beforeEach(async () => {
            await ts.streamer.registerContract(createCrowdfundContract());
        });

        const createCampaign = () => json('creator', 'crowdfund', 'createCampaign', {
            campaignId: 'cf1', title: 'Campaign', targetAmount: '100.000', asset: 'HIVE', deadline: inHours(1)
        });

        test('refunds a contribution to a missing campaign', async () => {
            await pay('bob', '5.000 HIVE', 'crowdfund', 'contribute', { campaignId: 'nope' });

            expect(sent()).toEqual([[APP, 'bob', '5.000 HIVE', '[Refund] Campaign nope does not exist']]);
            const refunded = await eventsNamed('crowdfund_refunded');
            expect(refunded).toHaveLength(1);
            expect(refunded[0].data.data).toMatchObject({ campaignId: 'nope', contributor: 'bob', amount: '5.000', asset: 'HIVE' });
            expect(await rows('SELECT id FROM crowdfund_contributions')).toHaveLength(0);
        });

        test('refunds a contribution after the deadline', async () => {
            await createCampaign();
            await ts.advanceTime('2h');
            await pay('bob', '5.000 HIVE', 'crowdfund', 'contribute', { campaignId: 'cf1' });

            expect(sent()).toEqual([[APP, 'bob', '5.000 HIVE', '[Refund] Campaign deadline has passed']]);
            expect((await rows('SELECT current_amount FROM crowdfund_campaigns'))[0].current_amount).toBe('0');
        });

        test('refunds a contribution in the wrong asset', async () => {
            await createCampaign();
            await pay('bob', '5.000 HBD', 'crowdfund', 'contribute', { campaignId: 'cf1' });

            expect(sent()).toEqual([[APP, 'bob', '5.000 HBD', '[Refund] Contributions must be paid in HIVE']]);
        });

        test('accepts a valid contribution without refunding', async () => {
            await createCampaign();
            await pay('bob', '5.000 HIVE', 'crowdfund', 'contribute', { campaignId: 'cf1' });

            expect(sent()).toEqual([]);
            expect((await rows('SELECT current_amount FROM crowdfund_campaigns'))[0].current_amount).toBe('5');
            expect(await eventsNamed('crowdfund_contribution_received')).toHaveLength(1);
        });
    });

    describe('groupbuy.commit', () => {
        beforeEach(async () => {
            await ts.streamer.registerContract(createGroupBuyContract());
            await json('org', 'groupbuy', 'createGroupBuy', {
                groupBuyId: 'gb1', title: 'Bulk order', targetAmount: '10.000', asset: 'HIVE', deadline: inHours(1)
            });
        });

        test('refunds a commitment to a closed group buy', async () => {
            await pay('bob', '10.000 HIVE', 'groupbuy', 'commit', { groupBuyId: 'gb1' });
            await json('org', 'groupbuy', 'finalizeGroupBuy', { groupBuyId: 'gb1' });
            await pay('carol', '3.000 HIVE', 'groupbuy', 'commit', { groupBuyId: 'gb1' });

            expect(sent()).toEqual([[APP, 'carol', '3.000 HIVE', '[Refund] Group buy is not open']]);
            const refunded = await eventsNamed('group_buy_refunded');
            expect(refunded).toHaveLength(1);
            expect(refunded[0].data.data).toMatchObject({ groupBuyId: 'gb1', contributor: 'carol', amount: '3.000', asset: 'HIVE' });
            expect(await rows('SELECT contributor FROM group_buy_commitments')).toEqual([{ contributor: 'bob' }]);
        });

        test('refunds a commitment to a missing group buy or after the deadline', async () => {
            await pay('bob', '1.000 HIVE', 'groupbuy', 'commit', { groupBuyId: 'nope' });
            await ts.advanceTime('2h');
            await pay('bob', '2.000 HIVE', 'groupbuy', 'commit', { groupBuyId: 'gb1' });

            expect(sent()).toEqual([
                [APP, 'bob', '1.000 HIVE', '[Refund] Group buy nope does not exist'],
                [APP, 'bob', '2.000 HIVE', '[Refund] Group buy deadline has passed']
            ]);
            expect(await rows('SELECT id FROM group_buy_commitments')).toHaveLength(0);
        });

        test('accepts a valid commitment without refunding', async () => {
            await pay('bob', '4.000 HIVE', 'groupbuy', 'commit', { groupBuyId: 'gb1' });

            expect(sent()).toEqual([]);
            expect((await rows('SELECT current_amount, participant_count FROM group_buy_campaigns'))[0])
                .toEqual({ current_amount: '4', participant_count: 1 });
        });
    });

    describe('bountyboard.createBounty', () => {
        beforeEach(async () => {
            await ts.streamer.registerContract(createBountyBoardContract());
        });

        test('refunds a bounty whose deadline has passed', async () => {
            await pay('sponsor', '50.000 HIVE', 'bountyboard', 'createBounty', {
                bountyId: 'b1', title: 'Fix the bug', deadline: '2000-01-01T00:00:00.000Z'
            });

            expect(sent()).toEqual([[APP, 'sponsor', '50.000 HIVE', '[Refund] Bounty deadline must be in the future']]);
            const refunded = await eventsNamed('bounty_refunded');
            expect(refunded).toHaveLength(1);
            expect(refunded[0].data.data).toMatchObject({ bountyId: 'b1', sponsor: 'sponsor', amount: '50.000', asset: 'HIVE' });
            expect(await rows('SELECT bounty_id FROM bounty_board_bounties')).toHaveLength(0);
        });

        test('refunds an invalid deadline and a duplicate bounty id', async () => {
            await pay('sponsor', '1.000 HIVE', 'bountyboard', 'createBounty', { bountyId: 'b1', title: 'Fix the bug', deadline: 'not a date' });
            await pay('sponsor', '50.000 HIVE', 'bountyboard', 'createBounty', { bountyId: 'b1', title: 'Fix the bug' });
            await pay('other', '20.000 HBD', 'bountyboard', 'createBounty', { bountyId: 'b1', title: 'Same id' });

            expect(sent()).toEqual([
                [APP, 'sponsor', '1.000 HIVE', '[Refund] Bounty deadline is not a valid date'],
                [APP, 'other', '20.000 HBD', '[Refund] Bounty b1 already exists']
            ]);
            expect(await rows('SELECT sponsor, reward_pool FROM bounty_board_bounties')).toEqual([{ sponsor: 'sponsor', reward_pool: '50.000' }]);
        });

        test('a zero reward creates nothing and sends nothing back', async () => {
            await pay('sponsor', '0.000 HIVE', 'bountyboard', 'createBounty', { bountyId: 'b0', title: 'Free work' });

            expect(sent()).toEqual([]);
            expect(await rows('SELECT bounty_id FROM bounty_board_bounties')).toHaveLength(0);
        });

        test('accepts a valid bounty without refunding', async () => {
            await pay('sponsor', '50.000 HIVE', 'bountyboard', 'createBounty', { bountyId: 'b1', title: 'Fix the bug', deadline: inHours(24) });

            expect(sent()).toEqual([]);
            expect(await eventsNamed('bounty_created')).toHaveLength(1);
        });
    });

    test('a transfer to another account is never refunded by the contract', async () => {
        await ts.streamer.registerContract(createCrowdfundContract({ account: 'treasury' }));
        await pay('bob', '5.000 HIVE', 'crowdfund', 'contribute', { campaignId: 'nope' });

        expect(sent()).toEqual([]);
        expect(await eventsNamed('crowdfund_refunded')).toHaveLength(0);
    });

    test.each([
        ['createGroupBuyContract', () => createGroupBuyContract()],
        ['createBountyBoardContract', () => createBountyBoardContract()]
    ])('%s needs options.account or a streamer username', async (factory, create) => {
        const bare = new Streamer({});
        await bare.registerAdapter(new SqliteAdapter(':memory:'));

        await expect(bare.registerContract(create())).rejects.toThrow(`${factory}: set options.account or the streamer username`);
        await bare.stop();
    });
});
