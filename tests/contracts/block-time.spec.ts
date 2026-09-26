import { createCrowdfundContract } from '../../src';
import { blockTimeOf } from '../../src/contracts/helpers';
import { createTestStreamer, TestStreamer } from '../../src/testing';

// Contracts decide and record with the block's timestamp, so catching up on
// old blocks (or replaying them) gives the same result as processing them
// live. This chain starts in 2020, long before the wall clock.
describe('contracts use block time, not the wall clock', () => {
    let ts: TestStreamer;

    afterEach(async () => {
        await ts?.stop();
    });

    test('a contribution made before a deadline is accepted even when processed after it', async () => {
        ts = await createTestStreamer({ startTime: new Date('2020-01-01T00:00:00.000Z') });
        await ts.streamer.registerContract(createCrowdfundContract());

        // The deadline is years in the wall-clock past but a day after the block time.
        await ts.contractJson('alice', {
            contract: 'crowdfund',
            action: 'createCampaign',
            payload: {
                campaignId: 'old-campaign',
                title: 'Catch-up campaign',
                targetAmount: '100.000',
                asset: 'HIVE',
                deadline: '2020-01-02T00:00:00.000Z'
            }
        });

        await ts.contractTransfer({ from: 'bob', amount: '5.000 HIVE', contract: 'crowdfund', action: 'contribute', payload: { campaignId: 'old-campaign' } });

        const campaigns = await ts.adapter.query('SELECT campaign_id FROM crowdfund_campaigns');
        expect(campaigns).toEqual([{ campaign_id: 'old-campaign' }]);

        const contributions = await ts.adapter.query('SELECT contributor, created_at FROM crowdfund_contributions');
        expect(contributions).toHaveLength(1);
        expect(contributions[0].contributor).toBe('bob');
        expect(new Date(contributions[0].created_at).getUTCFullYear()).toBe(2020);
    });

    test('blockTimeOf prefers the block time and accepts ISO strings', () => {
        const time = new Date('2021-05-01T00:00:00.000Z');

        expect(blockTimeOf({ block: { time } })).toBe(time);
        expect(blockTimeOf({ block: { time: '2021-05-01T00:00:00.000Z' } }).getTime()).toBe(time.getTime());
        expect(blockTimeOf({ block: { time: 'not a date' } })).toBeInstanceOf(Date);
        expect(blockTimeOf(undefined)).toBeInstanceOf(Date);
    });
});
