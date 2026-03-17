import { PrivateKey } from '@hiveio/dhive';
import { Streamer } from '../src/streamer';
import { Utils } from '../src/utils';
import { createMockAdapter } from './helpers/mock-adapter';

describe('New Features', () => {
    const activeKey = PrivateKey.fromSeed('test-active').toString();
    const postingKey = PrivateKey.fromSeed('test-posting').toString();
    let streamer: Streamer;

    beforeEach(async () => {
        streamer = new Streamer({
            ACTIVE_KEY: activeKey,
            POSTING_KEY: postingKey,
            USERNAME: 'testuser',
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

    // ─── Utility Functions ──────────────────────────────────────────────

    describe('calculateReputation', () => {
        test('returns 25 for zero reputation', () => {
            expect(Utils.calculateReputation(0)).toBe(25);
        });

        test('converts positive raw reputation to score', () => {
            const score = Utils.calculateReputation('253948692668213');
            expect(score).toBeGreaterThan(25);
            expect(score).toBeLessThan(80);
        });

        test('converts negative raw reputation to score below 25', () => {
            const score = Utils.calculateReputation('-1000000000000000');
            expect(score).toBeLessThan(25);
        });

        test('handles string input', () => {
            const score = Utils.calculateReputation('95832978796820');
            expect(typeof score).toBe('number');
            expect(score).toBeGreaterThan(25);
        });
    });

    describe('vestToHP', () => {
        test('converts VESTS to HP correctly', () => {
            const hp = Utils.vestToHP('1000000', '200000000', '400000000000');
            expect(hp).toBe('500.000');
        });

        test('handles string inputs with units', () => {
            const hp = Utils.vestToHP('1000000 VESTS', '200000000 HIVE', '400000000000 VESTS');
            expect(hp).toBe('500.000');
        });

        test('throws on zero total vesting shares', () => {
            expect(() => Utils.vestToHP('1000', '200000000', '0')).toThrow('Total vesting shares cannot be zero');
        });

        test('throws on invalid input', () => {
            expect(() => Utils.vestToHP('abc', '200000000', '400000000000')).toThrow('Invalid numeric input');
        });
    });

    describe('hpToVest', () => {
        test('converts HP to VESTS correctly', () => {
            const vests = Utils.hpToVest('0.5', '200000000', '400000000000');
            expect(vests).toBe('1000.000000');
        });

        test('handles string inputs with units', () => {
            const vests = Utils.hpToVest('0.5 HIVE', '200000000 HIVE', '400000000000 VESTS');
            expect(vests).toBe('1000.000000');
        });

        test('throws on zero total vesting fund', () => {
            expect(() => Utils.hpToVest('1', '0', '400000000000')).toThrow('Total vesting fund cannot be zero');
        });
    });

    describe('hpToVestString', () => {
        test('returns formatted VESTS string', () => {
            const result = Utils.hpToVestString('0.5', '200000000', '400000000000');
            expect(result).toBe('1000.000000 VESTS');
        });
    });

    describe('parseProfileMetadata', () => {
        test('extracts profile from valid metadata', () => {
            const meta = JSON.stringify({
                profile: {
                    name: 'Alice',
                    about: 'Test user',
                    location: 'Wonderland',
                    website: 'https://example.com',
                    profile_image: 'https://example.com/img.png',
                    cover_image: 'https://example.com/cover.png'
                }
            });

            const result = Utils.parseProfileMetadata(meta);
            expect(result.name).toBe('Alice');
            expect(result.about).toBe('Test user');
            expect(result.location).toBe('Wonderland');
        });

        test('returns empty object for invalid JSON', () => {
            expect(Utils.parseProfileMetadata('not valid json')).toEqual({});
        });

        test('returns empty object for null/undefined', () => {
            expect(Utils.parseProfileMetadata(null as any)).toEqual({});
            expect(Utils.parseProfileMetadata(undefined as any)).toEqual({});
        });

        test('returns empty object for JSON without profile', () => {
            expect(Utils.parseProfileMetadata('{}')).toEqual({});
            expect(Utils.parseProfileMetadata('{"foo":"bar"}')).toEqual({});
        });
    });

    // ─── Event Subscriptions ────────────────────────────────────────────

    describe('onVote subscription', () => {
        test('fires callback on vote operation', async () => {
            const callback = jest.fn();
            streamer.onVote(callback);

            await streamer.processOperation(
                ['vote', { voter: 'alice', author: 'bob', permlink: 'test-post', weight: 10000 }],
                1000, 'blockid', 'prevblockid', 'trxid', new Date()
            );

            expect(callback).toHaveBeenCalledTimes(1);
            expect(callback).toHaveBeenCalledWith(
                expect.objectContaining({ voter: 'alice', author: 'bob', weight: 10000 }),
                1000, 'blockid', 'prevblockid', 'trxid', expect.any(Date)
            );
        });
    });

    describe('onDelegate subscription', () => {
        test('fires callback on delegate_vesting_shares operation', async () => {
            const callback = jest.fn();
            streamer.onDelegate(callback);

            await streamer.processOperation(
                ['delegate_vesting_shares', { delegator: 'alice', delegatee: 'bob', vesting_shares: '1000.000000 VESTS' }],
                1000, 'blockid', 'prevblockid', 'trxid', new Date()
            );

            expect(callback).toHaveBeenCalledTimes(1);
            expect(callback).toHaveBeenCalledWith(
                expect.objectContaining({ delegator: 'alice', delegatee: 'bob' }),
                1000, 'blockid', 'prevblockid', 'trxid', expect.any(Date)
            );
        });
    });

    describe('onPowerUp subscription', () => {
        test('fires callback on transfer_to_vesting operation', async () => {
            const callback = jest.fn();
            streamer.onPowerUp(callback);

            await streamer.processOperation(
                ['transfer_to_vesting', { from: 'alice', to: 'alice', amount: '100.000 HIVE' }],
                1000, 'blockid', 'prevblockid', 'trxid', new Date()
            );

            expect(callback).toHaveBeenCalledTimes(1);
            expect(callback).toHaveBeenCalledWith(
                expect.objectContaining({ from: 'alice', amount: '100.000 HIVE' }),
                1000, 'blockid', 'prevblockid', 'trxid', expect.any(Date)
            );
        });
    });

    describe('onPowerDown subscription', () => {
        test('fires callback on withdraw_vesting operation', async () => {
            const callback = jest.fn();
            streamer.onPowerDown(callback);

            await streamer.processOperation(
                ['withdraw_vesting', { account: 'alice', vesting_shares: '1000.000000 VESTS' }],
                1000, 'blockid', 'prevblockid', 'trxid', new Date()
            );

            expect(callback).toHaveBeenCalledTimes(1);
        });
    });

    describe('onClaimRewards subscription', () => {
        test('fires callback on claim_reward_balance operation', async () => {
            const callback = jest.fn();
            streamer.onClaimRewards(callback);

            await streamer.processOperation(
                ['claim_reward_balance', { account: 'alice', reward_hive: '1.000 HIVE', reward_hbd: '0.500 HBD', reward_vests: '100.000000 VESTS' }],
                1000, 'blockid', 'prevblockid', 'trxid', new Date()
            );

            expect(callback).toHaveBeenCalledTimes(1);
        });
    });

    describe('onAccountWitnessVote subscription', () => {
        test('fires callback on account_witness_vote operation', async () => {
            const callback = jest.fn();
            streamer.onAccountWitnessVote(callback);

            await streamer.processOperation(
                ['account_witness_vote', { account: 'alice', witness: 'someguy', approve: true }],
                1000, 'blockid', 'prevblockid', 'trxid', new Date()
            );

            expect(callback).toHaveBeenCalledTimes(1);
            expect(callback).toHaveBeenCalledWith(
                expect.objectContaining({ account: 'alice', witness: 'someguy', approve: true }),
                1000, 'blockid', 'prevblockid', 'trxid', expect.any(Date)
            );
        });
    });

    describe('multiple subscriptions on same event', () => {
        test('fires all callbacks', async () => {
            const callback1 = jest.fn();
            const callback2 = jest.fn();
            streamer.onVote(callback1);
            streamer.onVote(callback2);

            await streamer.processOperation(
                ['vote', { voter: 'alice', author: 'bob', permlink: 'test', weight: 5000 }],
                1000, 'blockid', 'prevblockid', 'trxid', new Date()
            );

            expect(callback1).toHaveBeenCalledTimes(1);
            expect(callback2).toHaveBeenCalledTimes(1);
        });
    });

    // ─── Builder APIs ───────────────────────────────────────────────────

    describe('ops.follow() builder', () => {
        test('creates a follow builder', () => {
            const builder = streamer.ops.follow();
            expect(builder).toBeDefined();
            expect(typeof builder.follower).toBe('function');
            expect(typeof builder.following).toBe('function');
            expect(typeof builder.send).toBe('function');
        });

        test('throws when follower or following missing', () => {
            expect(() => streamer.ops.follow().follower('alice').send()).toThrow();
            expect(() => streamer.ops.follow().following('bob').send()).toThrow();
        });
    });

    describe('ops.unfollow() builder', () => {
        test('creates an unfollow builder', () => {
            const builder = streamer.ops.unfollow();
            expect(builder).toBeDefined();
        });
    });

    describe('ops.mute() builder', () => {
        test('creates a mute builder', () => {
            const builder = streamer.ops.mute();
            expect(builder).toBeDefined();
        });
    });

    describe('ops.reblog() builder', () => {
        test('creates a reblog builder', () => {
            const builder = streamer.ops.reblog();
            expect(builder).toBeDefined();
            expect(typeof builder.account).toBe('function');
            expect(typeof builder.author).toBe('function');
            expect(typeof builder.permlink).toBe('function');
            expect(typeof builder.send).toBe('function');
        });

        test('throws when fields missing', () => {
            expect(() => streamer.ops.reblog().account('alice').send()).toThrow();
        });
    });

    describe('ops.powerUp() builder', () => {
        test('creates a power up builder', () => {
            const builder = streamer.ops.powerUp();
            expect(builder).toBeDefined();
            expect(typeof builder.from).toBe('function');
            expect(typeof builder.to).toBe('function');
            expect(typeof builder.amount).toBe('function');
            expect(typeof builder.send).toBe('function');
        });

        test('throws when from or amount missing', () => {
            expect(() => streamer.ops.powerUp().from('alice').send()).toThrow();
            expect(() => streamer.ops.powerUp().amount(100).send()).toThrow();
        });
    });

    describe('ops.powerDown() builder', () => {
        test('creates a power down builder', () => {
            const builder = streamer.ops.powerDown();
            expect(builder).toBeDefined();
            expect(typeof builder.account).toBe('function');
            expect(typeof builder.vestingShares).toBe('function');
        });

        test('throws when account or vestingShares missing', () => {
            expect(() => streamer.ops.powerDown().account('alice').send()).toThrow();
            expect(() => streamer.ops.powerDown().vestingShares('1000 VESTS').send()).toThrow();
        });
    });

    describe('ops.cancelPowerDown() builder', () => {
        test('creates a cancel power down builder', () => {
            const builder = streamer.ops.cancelPowerDown();
            expect(builder).toBeDefined();
        });

        test('throws when account missing', () => {
            expect(() => streamer.ops.cancelPowerDown().send()).toThrow();
        });
    });

    describe('ops.delegate() builder', () => {
        test('creates a delegate builder', () => {
            const builder = streamer.ops.delegate();
            expect(builder).toBeDefined();
            expect(typeof builder.delegator).toBe('function');
            expect(typeof builder.delegatee).toBe('function');
            expect(typeof builder.vestingShares).toBe('function');
        });

        test('throws when fields missing', () => {
            expect(() => streamer.ops.delegate().delegator('alice').send()).toThrow();
        });
    });

    describe('ops.undelegate() builder', () => {
        test('creates an undelegate builder', () => {
            const builder = streamer.ops.undelegate();
            expect(builder).toBeDefined();
        });

        test('throws when delegator or delegatee missing', () => {
            expect(() => streamer.ops.undelegate().delegator('alice').send()).toThrow();
        });
    });

    describe('ops.claimRewards() builder', () => {
        test('creates a claim rewards builder', () => {
            const builder = streamer.ops.claimRewards();
            expect(builder).toBeDefined();
            expect(typeof builder.account).toBe('function');
            expect(typeof builder.rewardHive).toBe('function');
            expect(typeof builder.rewardHbd).toBe('function');
            expect(typeof builder.rewardVests).toBe('function');
        });

        test('throws when account missing', () => {
            expect(() => streamer.ops.claimRewards().send()).toThrow();
        });
    });

    describe('ops.witnessVote() builder', () => {
        test('creates a witness vote builder', () => {
            const builder = streamer.ops.witnessVote();
            expect(builder).toBeDefined();
            expect(typeof builder.account).toBe('function');
            expect(typeof builder.witness).toBe('function');
            expect(typeof builder.approve).toBe('function');
            expect(typeof builder.unapprove).toBe('function');
        });

        test('throws when account or witness missing', () => {
            expect(() => streamer.ops.witnessVote().account('alice').send()).toThrow();
            expect(() => streamer.ops.witnessVote().witness('myguy').send()).toThrow();
        });
    });

    describe('ops.setProxy() builder', () => {
        test('creates a set proxy builder', () => {
            const builder = streamer.ops.setProxy();
            expect(builder).toBeDefined();
            expect(typeof builder.account).toBe('function');
            expect(typeof builder.proxy).toBe('function');
        });

        test('throws when account or proxy missing', () => {
            expect(() => streamer.ops.setProxy().account('alice').send()).toThrow();
            expect(() => streamer.ops.setProxy().proxy('bob').send()).toThrow();
        });
    });

    describe('ops.clearProxy() builder', () => {
        test('creates a clear proxy builder', () => {
            const builder = streamer.ops.clearProxy();
            expect(builder).toBeDefined();
        });

        test('throws when account missing', () => {
            expect(() => streamer.ops.clearProxy().send()).toThrow();
        });
    });

    describe('ops.updateProfile() builder', () => {
        test('creates an update profile builder', () => {
            const builder = streamer.ops.updateProfile();
            expect(builder).toBeDefined();
            expect(typeof builder.account).toBe('function');
            expect(typeof builder.name).toBe('function');
            expect(typeof builder.about).toBe('function');
            expect(typeof builder.location).toBe('function');
            expect(typeof builder.website).toBe('function');
            expect(typeof builder.profileImage).toBe('function');
            expect(typeof builder.coverImage).toBe('function');
            expect(typeof builder.set).toBe('function');
        });

        test('throws when account missing', () => {
            expect(() => streamer.ops.updateProfile().name('Test').send()).toThrow();
        });

        test('throws when no profile fields set', () => {
            expect(() => streamer.ops.updateProfile().account('alice').send()).toThrow();
        });
    });

    // ─── Builder Fluent API Chaining ────────────────────────────────────

    describe('builder chaining', () => {
        test('follow builder returns this for chaining', () => {
            const builder = streamer.ops.follow();
            const result = builder.follower('alice').following('bob');
            expect(result).toBe(builder);
        });

        test('powerUp builder returns this for chaining', () => {
            const builder = streamer.ops.powerUp();
            const result = builder.from('alice').to('bob').amount(100);
            expect(result).toBe(builder);
        });

        test('delegate builder returns this for chaining', () => {
            const builder = streamer.ops.delegate();
            const result = builder.delegator('alice').delegatee('bob').vestingShares('1000 VESTS');
            expect(result).toBe(builder);
        });

        test('updateProfile builder supports set() for custom fields', () => {
            const builder = streamer.ops.updateProfile();
            const result = builder.account('alice').name('Alice').set('custom_field', 'value');
            expect(result).toBe(builder);
        });

        test('claimRewards builder returns this for chaining', () => {
            const builder = streamer.ops.claimRewards();
            const result = builder
                .account('alice')
                .rewardHive('1.000 HIVE')
                .rewardHbd('0.500 HBD')
                .rewardVests('100.000000 VESTS');
            expect(result).toBe(builder);
        });

        test('witnessVote builder supports approve/unapprove', () => {
            const builder = streamer.ops.witnessVote();
            const approved = builder.account('alice').witness('mywit').approve();
            expect(approved).toBe(builder);

            const builder2 = streamer.ops.witnessVote();
            const unapproved = builder2.account('alice').witness('mywit').unapprove();
            expect(unapproved).toBe(builder2);
        });
    });

    // ─── Streamer Direct Methods ────────────────────────────────────────

    describe('streamer social methods exist', () => {
        test('follow method exists', () => {
            expect(typeof streamer.follow).toBe('function');
        });

        test('unfollow method exists', () => {
            expect(typeof streamer.unfollow).toBe('function');
        });

        test('mute method exists', () => {
            expect(typeof streamer.mute).toBe('function');
        });

        test('reblog method exists', () => {
            expect(typeof streamer.reblog).toBe('function');
        });
    });

    describe('streamer staking methods exist', () => {
        test('powerUp method exists', () => {
            expect(typeof streamer.powerUp).toBe('function');
        });

        test('powerDown method exists', () => {
            expect(typeof streamer.powerDown).toBe('function');
        });

        test('cancelPowerDown method exists', () => {
            expect(typeof streamer.cancelPowerDown).toBe('function');
        });

        test('delegateVestingShares method exists', () => {
            expect(typeof streamer.delegateVestingShares).toBe('function');
        });

        test('undelegateVestingShares method exists', () => {
            expect(typeof streamer.undelegateVestingShares).toBe('function');
        });
    });

    describe('streamer account methods exist', () => {
        test('claimRewards method exists', () => {
            expect(typeof streamer.claimRewards).toBe('function');
        });

        test('witnessVote method exists', () => {
            expect(typeof streamer.witnessVote).toBe('function');
        });

        test('setProxy method exists', () => {
            expect(typeof streamer.setProxy).toBe('function');
        });

        test('clearProxy method exists', () => {
            expect(typeof streamer.clearProxy).toBe('function');
        });

        test('updateProfile method exists', () => {
            expect(typeof streamer.updateProfile).toBe('function');
        });

        test('getAccount method exists', () => {
            expect(typeof streamer.getAccount).toBe('function');
        });

        test('getAccounts method exists', () => {
            expect(typeof streamer.getAccounts).toBe('function');
        });
    });

    // ─── Utils Validation ───────────────────────────────────────────────

    describe('social operation validation', () => {
        test('follow throws without required params', () => {
            expect(() => Utils.follow(null as any, {}, 'alice', 'bob')).toThrow('Missing required parameters');
        });

        test('unfollow throws without required params', () => {
            expect(() => Utils.unfollow(null as any, {}, 'alice', 'bob')).toThrow('Missing required parameters');
        });

        test('mute throws without required params', () => {
            expect(() => Utils.mute(null as any, {}, 'alice', 'bob')).toThrow('Missing required parameters');
        });

        test('reblog throws without required params', () => {
            expect(() => Utils.reblog(null as any, {}, 'alice', 'bob', 'test')).toThrow('Missing required parameters');
        });
    });

    describe('staking operation validation', () => {
        test('powerUp throws without required params', () => {
            expect(() => Utils.powerUp(null as any, {}, 'alice', 'alice', '100')).toThrow('Missing required parameters');
        });

        test('powerDown throws without required params', () => {
            expect(() => Utils.powerDown(null as any, {}, 'alice', '1000 VESTS')).toThrow('Missing required parameters');
        });

        test('delegateVestingShares throws without required params', () => {
            expect(() => Utils.delegateVestingShares(null as any, {}, 'alice', 'bob', '1000 VESTS')).toThrow('Missing required parameters');
        });
    });

    describe('account operation validation', () => {
        test('claimRewards throws without required params', () => {
            expect(() => Utils.claimRewards(null as any, {}, 'alice', '0 HIVE', '0 HBD', '0 VESTS')).toThrow('Missing required parameters');
        });

        test('witnessVote throws without required params', () => {
            expect(() => Utils.witnessVote(null as any, {}, 'alice', 'mywit', true)).toThrow('Missing required parameters');
        });

        test('setProxy throws without required params', () => {
            expect(() => Utils.setProxy(null as any, {}, 'alice', 'bob')).toThrow('Missing required parameters');
        });

        test('getAccount throws without client or username', async () => {
            await expect(Utils.getAccount(null as any, 'alice')).rejects.toThrow('Client and username are required');
        });

        test('getAccounts throws without valid usernames array', async () => {
            await expect(Utils.getAccounts(null as any, ['alice'])).rejects.toThrow('Client and at least one username are required');
        });
    });
});
