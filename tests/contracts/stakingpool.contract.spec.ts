import { SqliteAdapter, Streamer, createStakingPoolContract } from '../../src';
import { makeContext } from '../helpers/contract-context';

describe('staking pool contract', () => {
    let streamer: Streamer;
    let adapter: SqliteAdapter;
    let transfers: jest.SpyInstance;
    let contract: ReturnType<typeof createStakingPoolContract>;

    const T0 = Date.parse('2026-06-01T00:00:00Z');
    const at = (seconds: number) => new Date(T0 + seconds * 1000);

    const createPool = (overrides: Record<string, any> = {}, sender = 'vault') => contract.actions.createPool.handler({
        poolId: 'hive-pool',
        stakeAsset: 'HIVE',
        rewardAsset: 'HIVE',
        rewardRate: '0.01',
        cooldownSeconds: 3600,
        ...overrides
    } as any, makeContext(streamer, { sender, time: at(0), blockNumber: 100 }));

    const fund = (amount: string, seconds = 0, poolId = 'hive-pool', from = 'sponsor') =>
        contract.actions.fundRewards.handler({ poolId }, makeContext(streamer, { sender: from, amount, to: 'vault', time: at(seconds) }));

    const stake = (who: string, amount: string, seconds: number, poolId = 'hive-pool', blockNumber?: number) =>
        contract.actions.stake.handler({ poolId }, makeContext(streamer, { sender: who, amount, to: 'vault', time: at(seconds), blockNumber }));

    const claim = (who: string, seconds: number, poolId = 'hive-pool', blockNumber?: number) =>
        contract.actions.claim.handler({ poolId }, makeContext(streamer, { sender: who, time: at(seconds), blockNumber }));

    const unstake = (who: string, amount: string, seconds: number) =>
        contract.actions.unstake.handler({ poolId: 'hive-pool', amount }, makeContext(streamer, { sender: who, time: at(seconds) }));

    beforeEach(async () => {
        streamer = new Streamer();
        adapter = new SqliteAdapter(':memory:');
        await streamer.registerAdapter(adapter);
        transfers = jest.spyOn(streamer, 'transferHiveTokens').mockResolvedValue(true as any);
        contract = createStakingPoolContract({ account: 'vault' });
        await streamer.registerContract(contract);
    });

    afterEach(async () => {
        await streamer.stop();
        jest.restoreAllMocks();
    });

    test('only admins create pools and change rates', async () => {
        await expect(createPool({}, 'alice')).rejects.toThrow('cannot create');
        await createPool();
        await expect(createPool()).rejects.toThrow('already exists');
        await expect(contract.actions.setRewardRate.handler({ poolId: 'hive-pool', rewardRate: '1' }, makeContext(streamer, { sender: 'alice' })))
            .rejects.toThrow('cannot change');
        expect(contract.actions.createPool.guards).toEqual({ allowedSenders: ['vault'] });
    });

    test('distributes rewards pro rata with reward-per-share accounting', async () => {
        await createPool();
        await fund('100.000 HIVE');
        await stake('alice', '100.000 HIVE', 0);
        await stake('bob', '300.000 HIVE', 100);

        await claim('alice', 200);
        await claim('bob', 200);

        // 0-100s: alice alone earns 1.0; 100-200s: 1.0 split 25/75.
        expect(transfers.mock.calls).toEqual([
            ['vault', 'alice', '1.250', 'HIVE', 'Staking rewards from hive-pool'],
            ['vault', 'bob', '0.750', 'HIVE', 'Staking rewards from hive-pool']
        ]);

        const [pool] = await adapter.query('SELECT total_staked, total_accrued, total_claimed, reward_reserve FROM staking_pools');
        expect(pool).toEqual({ total_staked: '400', total_accrued: '2', total_claimed: '2', reward_reserve: '98' });

        const claims = await adapter.query('SELECT status FROM staking_claims');
        expect(claims).toEqual([{ status: 'paid' }, { status: 'paid' }]);

        await expect(claim('alice', 200)).rejects.toThrow('No rewards');
    });

    test('never accrues more than the funded reserve', async () => {
        await createPool();
        await fund('1.500 HIVE');
        await stake('alice', '10.000 HIVE', 0);
        await claim('alice', 1000);

        expect(transfers.mock.calls[0][2]).toBe('1.500');
        await expect(claim('alice', 2000)).rejects.toThrow('No rewards');

        // Top up later: accrual resumes from the funding point, not retroactively.
        await fund('5.000 HIVE', 3000);
        await claim('alice', 3100);
        expect(transfers.mock.calls[1][2]).toBe('1.000');
    });

    test('nothing accrues while the pool is empty', async () => {
        await createPool();
        await fund('100.000 HIVE');
        await stake('alice', '10.000 HIVE', 500);
        await claim('alice', 600);

        expect(transfers.mock.calls[0][2]).toBe('1.000');
    });

    test('rounds claims down and keeps the remainder pending', async () => {
        await createPool({ rewardRate: '0.0004' });
        await fund('10.000 HIVE');
        await stake('alice', '1.000 HIVE', 0);

        await claim('alice', 10);
        expect(transfers.mock.calls[0][2]).toBe('0.004');

        await claim('alice', 13);
        // 0.0012 accrued -> pays 0.001, keeps 0.0002
        expect(transfers.mock.calls[1][2]).toBe('0.001');

        const [position] = await adapter.query('SELECT pending_rewards FROM staking_positions WHERE account = ?', ['alice']);
        expect(position.pending_rewards).toBe('0.0002');
    });

    test('unstaking waits for the cooldown and releases exactly once', async () => {
        await createPool();
        await stake('alice', '100.000 HIVE', 0);

        await expect(unstake('alice', '150.000', 10)).rejects.toThrow('Cannot unstake');
        await unstake('alice', '40.000', 10);

        await expect(contract.actions.withdraw.handler({ poolId: 'hive-pool' }, makeContext(streamer, { sender: 'alice', time: at(100) })))
            .rejects.toThrow('Nothing is ready');

        await (contract.actions.releaseMatured as any).handler({}, makeContext(streamer, { sender: 'vault', trigger: 'time', time: at(3610) }));
        await (contract.actions.releaseMatured as any).handler({}, makeContext(streamer, { sender: 'vault', trigger: 'time', time: at(3700) }));

        expect(transfers.mock.calls).toEqual([['vault', 'alice', '40.000', 'HIVE', 'Unstaked from hive-pool']]);

        const [position] = await adapter.query('SELECT staked FROM staking_positions WHERE account = ?', ['alice']);
        expect(position.staked).toBe('60');
    });

    test('zero-cooldown pools pay unstakes immediately', async () => {
        await createPool({ cooldownSeconds: 0 });
        await stake('alice', '5.000 HIVE', 0);
        await unstake('alice', '5.000', 1);

        expect(transfers.mock.calls).toEqual([['vault', 'alice', '5.000', 'HIVE', 'Unstaked from hive-pool']]);
    });

    test('refunds stakes and funding that do not fit the pool', async () => {
        await createPool({ minStake: '5.000', endsAt: '2026-06-02T00:00:00Z', rewardAsset: 'HBD' });

        await stake('alice', '10.000 HBD', 0);
        await stake('alice', '1.000 HIVE', 0);
        await stake('alice', '10.000 HIVE', 0, 'nope');
        await stake('alice', '10.000 HIVE', 90000);
        await fund('10.000 HIVE');

        expect(transfers.mock.calls.map((call) => call[4])).toEqual([
            '[Refund] hive-pool accepts HIVE only',
            '[Refund] Minimum stake is 5.000 HIVE',
            '[Refund] Pool nope does not exist',
            '[Refund] hive-pool has ended',
            '[Refund] Rewards for hive-pool are paid in HBD'
        ]);

        await expect(contract.actions.stake.handler({ poolId: 'hive-pool' }, makeContext(streamer, {
            sender: 'alice', amount: '10.000 HIVE', to: 'elsewhere'
        }))).rejects.toThrow('must be sent to vault');
    });

    test('stops accruing at the pool end time', async () => {
        await createPool({ endsAt: '2026-06-01T00:01:40Z' });
        await fund('100.000 HIVE');
        await stake('alice', '1.000 HIVE', 0);
        await claim('alice', 10000);

        expect(transfers.mock.calls[0][2]).toBe('1.000');
    });

    test('rate changes settle accruals at the old rate first', async () => {
        await createPool();
        await fund('100.000 HIVE');
        await stake('alice', '1.000 HIVE', 0);
        await contract.actions.setRewardRate.handler({ poolId: 'hive-pool', rewardRate: '0.1' }, makeContext(streamer, { sender: 'vault', time: at(100) }));
        await claim('alice', 110);

        // 100s at 0.01 + 10s at 0.1
        expect(transfers.mock.calls[0][2]).toBe('2.000');
    });

    test('per-block accrual uses block numbers', async () => {
        const blockPool = createStakingPoolContract({ name: 'blockpool', account: 'vault', accrual: 'block' });
        await streamer.registerContract(blockPool);

        await blockPool.actions.createPool.handler({
            poolId: 'bp', stakeAsset: 'HIVE', rewardAsset: 'HIVE', rewardRate: '0.5', cooldownSeconds: 0
        } as any, makeContext(streamer, { sender: 'vault', blockNumber: 100 }));
        await blockPool.actions.fundRewards.handler({ poolId: 'bp' }, makeContext(streamer, { sender: 'sponsor', amount: '100.000 HIVE', to: 'vault', blockNumber: 100 }));
        await blockPool.actions.stake.handler({ poolId: 'bp' }, makeContext(streamer, { sender: 'alice', amount: '2.000 HIVE', to: 'vault', blockNumber: 100 }));
        await blockPool.actions.claim.handler({ poolId: 'bp' }, makeContext(streamer, { sender: 'alice', blockNumber: 120 }));

        expect(transfers.mock.calls[0]).toEqual(['vault', 'alice', '10.000', 'HIVE', 'Staking rewards from bp']);
    });
});
