import { PrivateKey } from '@hiveio/dhive';
import { Streamer } from '../src/streamer';
import { Utils } from '../src/utils';
import { createMockAdapter } from './helpers/mock-adapter';

describe('Wave 2 Features', () => {
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

    // ─── Query Namespace ────────────────────────────────────────────────

    describe('query namespace existence', () => {
        test('query namespace is defined', () => {
            expect(streamer.query).toBeDefined();
        });

        const methods = [
            'getDynamicGlobalProperties', 'getChainProperties', 'getCurrentMedianHistoryPrice',
            'getRewardFund', 'getFollowers', 'getFollowing', 'getFollowCount',
            'getContent', 'getContentReplies', 'getDiscussions',
            'getBlog', 'getFeed', 'getTrending', 'getHot', 'getCreated',
            'getActiveVotes', 'getVestingDelegations', 'getAccountHistory',
            'getOrderBook', 'getOpenOrders', 'getRCMana', 'getVPMana', 'findRCAccounts',
            'getCommunity', 'listCommunities', 'getAccountNotifications', 'listAllSubscriptions',
            'findTransaction', 'getWitnessByAccount', 'getWitnesses', 'getWitnessesByVote',
            'getBlock', 'getBlockHeader', 'getOperations', 'getConfig',
            'lookupAccounts', 'lookupWitnessAccounts',
            'getConversionRequests', 'getCollateralizedConversionRequests',
            'getSavingsWithdrawFrom', 'getProposals'
        ];

        methods.forEach(method => {
            test(`query.${method} is a function`, () => {
                expect(typeof (streamer.query as any)[method]).toBe('function');
            });
        });
    });

    // ─── New Event Subscriptions ────────────────────────────────────────

    describe('onFollow subscription', () => {
        test('fires callback on follow custom_json', async () => {
            const callback = jest.fn();
            streamer.onFollow(callback);

            await streamer.processOperation(
                ['custom_json', {
                    id: 'follow',
                    required_posting_auths: ['alice'],
                    required_auths: [],
                    json: JSON.stringify(['follow', { follower: 'alice', following: 'bob', what: ['blog'] }])
                }],
                1000, 'blockid', 'prevblockid', 'trxid', new Date()
            );

            expect(callback).toHaveBeenCalledTimes(1);
            expect(callback).toHaveBeenCalledWith(
                expect.objectContaining({ follower: 'alice', following: 'bob' }),
                1000, 'blockid', 'prevblockid', 'trxid', expect.any(Date)
            );
        });
    });

    describe('onReblog subscription', () => {
        test('fires callback on reblog custom_json', async () => {
            const callback = jest.fn();
            streamer.onReblog(callback);

            await streamer.processOperation(
                ['custom_json', {
                    id: 'follow',
                    required_posting_auths: ['alice'],
                    required_auths: [],
                    json: JSON.stringify(['reblog', { account: 'alice', author: 'bob', permlink: 'great-post' }])
                }],
                1000, 'blockid', 'prevblockid', 'trxid', new Date()
            );

            expect(callback).toHaveBeenCalledTimes(1);
            expect(callback).toHaveBeenCalledWith(
                expect.objectContaining({ account: 'alice', author: 'bob', permlink: 'great-post' }),
                1000, 'blockid', 'prevblockid', 'trxid', expect.any(Date)
            );
        });
    });

    describe('onAccountUpdate subscription', () => {
        test('fires callback on account_update operation', async () => {
            const callback = jest.fn();
            streamer.onAccountUpdate(callback);

            await streamer.processOperation(
                ['account_update', { account: 'alice', json_metadata: '{}' }],
                1000, 'blockid', 'prevblockid', 'trxid', new Date()
            );

            expect(callback).toHaveBeenCalledTimes(1);
        });

        test('fires callback on account_update2 operation', async () => {
            const callback = jest.fn();
            streamer.onAccountUpdate(callback);

            await streamer.processOperation(
                ['account_update2', { account: 'alice', posting_json_metadata: '{}' }],
                1000, 'blockid', 'prevblockid', 'trxid', new Date()
            );

            expect(callback).toHaveBeenCalledTimes(1);
        });
    });

    describe('onDeleteComment subscription', () => {
        test('fires callback on delete_comment operation', async () => {
            const callback = jest.fn();
            streamer.onDeleteComment(callback);

            await streamer.processOperation(
                ['delete_comment', { author: 'alice', permlink: 'bad-post' }],
                1000, 'blockid', 'prevblockid', 'trxid', new Date()
            );

            expect(callback).toHaveBeenCalledTimes(1);
        });
    });

    describe('onLimitOrder subscription', () => {
        test('fires callback on limit_order_create', async () => {
            const callback = jest.fn();
            streamer.onLimitOrder(callback);

            await streamer.processOperation(
                ['limit_order_create', { owner: 'alice', orderid: 1 }],
                1000, 'blockid', 'prevblockid', 'trxid', new Date()
            );

            expect(callback).toHaveBeenCalledTimes(1);
        });

        test('fires callback on limit_order_cancel', async () => {
            const callback = jest.fn();
            streamer.onLimitOrder(callback);

            await streamer.processOperation(
                ['limit_order_cancel', { owner: 'alice', orderid: 1 }],
                1000, 'blockid', 'prevblockid', 'trxid', new Date()
            );

            expect(callback).toHaveBeenCalledTimes(1);
        });
    });

    describe('onSavingsTransfer subscription', () => {
        test('fires callback on transfer_to_savings', async () => {
            const callback = jest.fn();
            streamer.onSavingsTransfer(callback);

            await streamer.processOperation(
                ['transfer_to_savings', { from: 'alice', to: 'alice', amount: '100.000 HIVE' }],
                1000, 'blockid', 'prevblockid', 'trxid', new Date()
            );

            expect(callback).toHaveBeenCalledTimes(1);
        });

        test('fires callback on transfer_from_savings', async () => {
            const callback = jest.fn();
            streamer.onSavingsTransfer(callback);

            await streamer.processOperation(
                ['transfer_from_savings', { from: 'alice', to: 'alice', amount: '50.000 HIVE', request_id: 1 }],
                1000, 'blockid', 'prevblockid', 'trxid', new Date()
            );

            expect(callback).toHaveBeenCalledTimes(1);
        });
    });

    describe('onConvert subscription', () => {
        test('fires callback on convert operation', async () => {
            const callback = jest.fn();
            streamer.onConvert(callback);

            await streamer.processOperation(
                ['convert', { owner: 'alice', amount: '10.000 HBD', requestid: 1 }],
                1000, 'blockid', 'prevblockid', 'trxid', new Date()
            );

            expect(callback).toHaveBeenCalledTimes(1);
        });

        test('fires callback on collateralized_convert', async () => {
            const callback = jest.fn();
            streamer.onConvert(callback);

            await streamer.processOperation(
                ['collateralized_convert', { owner: 'alice', amount: '10.000 HIVE', requestid: 1 }],
                1000, 'blockid', 'prevblockid', 'trxid', new Date()
            );

            expect(callback).toHaveBeenCalledTimes(1);
        });
    });

    // ─── New Builder APIs ───────────────────────────────────────────────

    describe('ops.transferToSavings() builder', () => {
        test('creates builder with correct methods', () => {
            const builder = streamer.ops.transferToSavings();
            expect(typeof builder.from).toBe('function');
            expect(typeof builder.to).toBe('function');
            expect(typeof builder.amount).toBe('function');
            expect(typeof builder.hive).toBe('function');
            expect(typeof builder.hbd).toBe('function');
            expect(typeof builder.memo).toBe('function');
            expect(typeof builder.send).toBe('function');
        });

        test('throws when from or amount missing', () => {
            expect(() => streamer.ops.transferToSavings().from('alice').send()).toThrow();
        });
    });

    describe('ops.transferFromSavings() builder', () => {
        test('creates builder', () => {
            const builder = streamer.ops.transferFromSavings();
            expect(builder).toBeDefined();
            expect(typeof builder.requestId).toBe('function');
        });
    });

    describe('ops.convert() builder', () => {
        test('creates builder with correct methods', () => {
            const builder = streamer.ops.convert();
            expect(typeof builder.from).toBe('function');
            expect(typeof builder.amount).toBe('function');
            expect(typeof builder.hbd).toBe('function');
            expect(typeof builder.requestId).toBe('function');
        });

        test('throws when from or amount missing', () => {
            expect(() => streamer.ops.convert().from('alice').send()).toThrow();
        });
    });

    describe('ops.collateralizedConvert() builder', () => {
        test('creates builder with correct methods', () => {
            const builder = streamer.ops.collateralizedConvert();
            expect(typeof builder.from).toBe('function');
            expect(typeof builder.hive).toBe('function');
        });
    });

    describe('ops.deleteComment() builder', () => {
        test('creates builder', () => {
            const builder = streamer.ops.deleteComment();
            expect(typeof builder.author).toBe('function');
            expect(typeof builder.permlink).toBe('function');
        });

        test('throws when fields missing', () => {
            expect(() => streamer.ops.deleteComment().author('alice').send()).toThrow();
        });
    });

    describe('ops.limitOrder() builder', () => {
        test('creates builder', () => {
            const builder = streamer.ops.limitOrder();
            expect(typeof builder.owner).toBe('function');
            expect(typeof builder.orderId).toBe('function');
            expect(typeof builder.amountToSell).toBe('function');
            expect(typeof builder.minToReceive).toBe('function');
            expect(typeof builder.fillOrKill).toBe('function');
            expect(typeof builder.expiration).toBe('function');
        });

        test('throws when fields missing', () => {
            expect(() => streamer.ops.limitOrder().owner('alice').send()).toThrow();
        });
    });

    describe('ops.cancelOrder() builder', () => {
        test('creates builder', () => {
            const builder = streamer.ops.cancelOrder();
            expect(typeof builder.owner).toBe('function');
            expect(typeof builder.orderId).toBe('function');
        });

        test('throws when fields missing', () => {
            expect(() => streamer.ops.cancelOrder().owner('alice').send()).toThrow();
        });
    });

    describe('ops.withdrawRoute() builder', () => {
        test('creates builder', () => {
            const builder = streamer.ops.withdrawRoute();
            expect(typeof builder.from).toBe('function');
            expect(typeof builder.to).toBe('function');
            expect(typeof builder.percent).toBe('function');
            expect(typeof builder.autoVest).toBe('function');
        });

        test('throws when fields missing', () => {
            expect(() => streamer.ops.withdrawRoute().from('alice').send()).toThrow();
        });
    });

    describe('ops.commentOptions() builder', () => {
        test('creates builder', () => {
            const builder = streamer.ops.commentOptions();
            expect(typeof builder.author).toBe('function');
            expect(typeof builder.permlink).toBe('function');
            expect(typeof builder.maxAcceptedPayout).toBe('function');
            expect(typeof builder.percentHbd).toBe('function');
            expect(typeof builder.allowVotes).toBe('function');
            expect(typeof builder.allowCurationRewards).toBe('function');
            expect(typeof builder.beneficiary).toBe('function');
        });

        test('throws when fields missing', () => {
            expect(() => streamer.ops.commentOptions().author('alice').send()).toThrow();
        });

        test('supports chaining beneficiaries', () => {
            const builder = streamer.ops.commentOptions();
            const result = builder
                .author('alice')
                .permlink('test')
                .beneficiary('bob', 2500)
                .beneficiary('carol', 2500);
            expect(result).toBe(builder);
        });
    });

    // ─── Streamer Write Methods ─────────────────────────────────────────

    describe('streamer savings methods exist', () => {
        test('transferToSavings', () => expect(typeof streamer.transferToSavings).toBe('function'));
        test('transferFromSavings', () => expect(typeof streamer.transferFromSavings).toBe('function'));
        test('cancelTransferFromSavings', () => expect(typeof streamer.cancelTransferFromSavings).toBe('function'));
    });

    describe('streamer convert methods exist', () => {
        test('convert', () => expect(typeof streamer.convert).toBe('function'));
        test('collateralizedConvert', () => expect(typeof streamer.collateralizedConvert).toBe('function'));
    });

    describe('streamer content methods exist', () => {
        test('deleteComment', () => expect(typeof streamer.deleteComment).toBe('function'));
        test('commentOptions', () => expect(typeof streamer.commentOptions).toBe('function'));
    });

    describe('streamer market methods exist', () => {
        test('limitOrderCreate', () => expect(typeof streamer.limitOrderCreate).toBe('function'));
        test('limitOrderCancel', () => expect(typeof streamer.limitOrderCancel).toBe('function'));
    });

    describe('streamer other methods exist', () => {
        test('setWithdrawVestingRoute', () => expect(typeof streamer.setWithdrawVestingRoute).toBe('function'));
        test('claimAccount', () => expect(typeof streamer.claimAccount).toBe('function'));
        test('feedPublish', () => expect(typeof streamer.feedPublish).toBe('function'));
    });

    // ─── Utility Functions ──────────────────────────────────────────────

    describe('generatePermlink', () => {
        test('generates URL-safe permlink from title', () => {
            expect(Utils.generatePermlink('Hello World!')).toBe('hello-world');
        });

        test('handles special characters', () => {
            expect(Utils.generatePermlink('My Post: A "Great" Journey')).toBe('my-post-a-great-journey');
        });

        test('collapses multiple hyphens', () => {
            expect(Utils.generatePermlink('foo---bar')).toBe('foo-bar');
        });

        test('throws on empty title', () => {
            expect(() => Utils.generatePermlink('')).toThrow();
        });

        test('truncates to 255 characters', () => {
            const longTitle = 'a'.repeat(300);
            expect(Utils.generatePermlink(longTitle).length).toBeLessThanOrEqual(255);
        });
    });

    describe('validateAccountName', () => {
        test('accepts valid names', () => {
            expect(Utils.validateAccountName('alice')).toBeNull();
            expect(Utils.validateAccountName('bob-smith')).toBeNull();
            expect(Utils.validateAccountName('myaccount123')).toBeNull();
        });

        test('rejects too short', () => {
            expect(Utils.validateAccountName('ab')).not.toBeNull();
        });

        test('rejects too long', () => {
            expect(Utils.validateAccountName('a'.repeat(17))).not.toBeNull();
        });

        test('rejects uppercase', () => {
            expect(Utils.validateAccountName('Alice')).not.toBeNull();
        });

        test('rejects starting with number', () => {
            expect(Utils.validateAccountName('1alice')).not.toBeNull();
        });

        test('rejects consecutive dots', () => {
            expect(Utils.validateAccountName('alice..bob')).not.toBeNull();
        });

        test('rejects ending with dot', () => {
            expect(Utils.validateAccountName('alice.')).not.toBeNull();
        });
    });

    describe('isValidAccountName', () => {
        test('returns true for valid names', () => {
            expect(Utils.isValidAccountName('alice')).toBe(true);
        });

        test('returns false for invalid names', () => {
            expect(Utils.isValidAccountName('ab')).toBe(false);
        });
    });

    describe('parseHiveUrl', () => {
        test('parses @author/permlink format', () => {
            const result = Utils.parseHiveUrl('@alice/my-great-post');
            expect(result).toEqual({ author: 'alice', permlink: 'my-great-post' });
        });

        test('parses full URL with category', () => {
            const result = Utils.parseHiveUrl('https://hive.blog/hive-12345/@alice/my-great-post');
            expect(result).toEqual({ author: 'alice', permlink: 'my-great-post', category: 'hive-12345' });
        });

        test('parses URL without category', () => {
            const result = Utils.parseHiveUrl('https://peakd.com/@alice/my-post');
            expect(result).toEqual({ author: 'alice', permlink: 'my-post' });
        });

        test('returns null for invalid input', () => {
            expect(Utils.parseHiveUrl('not a url')).toBeNull();
            expect(Utils.parseHiveUrl('')).toBeNull();
            expect(Utils.parseHiveUrl(null as any)).toBeNull();
        });
    });

    describe('generateReplyPermlink', () => {
        test('generates unique permlink', () => {
            const p1 = Utils.generateReplyPermlink('parent-post');
            const p2 = Utils.generateReplyPermlink('parent-post');
            expect(p1.startsWith('re-parent-post-')).toBe(true);
            expect(typeof p1).toBe('string');
        });

        test('works without parent', () => {
            const p = Utils.generateReplyPermlink();
            expect(p.startsWith('re-')).toBe(true);
        });
    });

    describe('createPostMetadata', () => {
        test('creates default metadata', () => {
            const meta = Utils.createPostMetadata();
            const parsed = JSON.parse(meta);
            expect(parsed.app).toBe('hive-stream');
            expect(parsed.format).toBe('markdown');
            expect(Array.isArray(parsed.tags)).toBe(true);
        });

        test('includes custom tags and images', () => {
            const meta = Utils.createPostMetadata({
                tags: ['hive', 'dev'],
                image: ['https://example.com/img.png'],
                description: 'A test post'
            });
            const parsed = JSON.parse(meta);
            expect(parsed.tags).toEqual(['hive', 'dev']);
            expect(parsed.image).toEqual(['https://example.com/img.png']);
            expect(parsed.description).toBe('A test post');
        });

        test('includes custom fields', () => {
            const meta = Utils.createPostMetadata({ custom_key: 'custom_value' });
            const parsed = JSON.parse(meta);
            expect(parsed.custom_key).toBe('custom_value');
        });
    });

    describe('calculateVotingMana', () => {
        test('returns voting mana percentage', () => {
            const account = {
                voting_manabar: {
                    current_mana: '1000000000000',
                    last_update_time: String(Math.floor(Date.now() / 1000) - 100)
                },
                vesting_shares: '2000000.000000 VESTS',
                received_vesting_shares: '0.000000 VESTS',
                delegated_vesting_shares: '0.000000 VESTS'
            };

            const mana = Utils.calculateVotingMana(account);
            expect(typeof mana).toBe('number');
            expect(mana).toBeGreaterThanOrEqual(0);
            expect(mana).toBeLessThanOrEqual(100);
        });

        test('throws on invalid account', () => {
            expect(() => Utils.calculateVotingMana(null)).toThrow();
            expect(() => Utils.calculateVotingMana({})).toThrow();
        });
    });

    describe('getEffectiveVestingShares', () => {
        test('calculates effective vests correctly', () => {
            const account = {
                vesting_shares: '1000.000000 VESTS',
                received_vesting_shares: '200.000000 VESTS',
                delegated_vesting_shares: '100.000000 VESTS'
            };

            expect(Utils.getEffectiveVestingShares(account)).toBe(1100);
        });
    });

    describe('estimateVoteValue', () => {
        test('estimates vote value', () => {
            const value = Utils.estimateVoteValue(
                100,
                100,
                1000000,
                { reward_balance: '800000.000 HIVE', recent_claims: '1000000000000000' },
                { base: '0.400 HBD', quote: '1.000 HIVE' }
            );

            expect(typeof value).toBe('number');
            expect(value).toBeGreaterThanOrEqual(0);
        });

        test('throws without required params', () => {
            expect(() => Utils.estimateVoteValue(100, 100, 1000, null as any, null as any)).toThrow();
        });
    });

    // ─── Utils validation ───────────────────────────────────────────────

    describe('savings operation validation', () => {
        test('transferToSavings throws without params', () => {
            expect(() => Utils.transferToSavings(null as any, {}, 'a', 'b', '1', 'HIVE')).toThrow();
        });

        test('transferFromSavings throws without params', () => {
            expect(() => Utils.transferFromSavings(null as any, {}, 'a', 'b', '1', 'HIVE', 0)).toThrow();
        });

        test('cancelTransferFromSavings throws without params', () => {
            expect(() => Utils.cancelTransferFromSavings(null as any, {}, 'a', 0)).toThrow();
        });
    });

    describe('convert operation validation', () => {
        test('convert throws without params', () => {
            expect(() => Utils.convert(null as any, {}, 'a', '10 HBD')).toThrow();
        });

        test('collateralizedConvert throws without params', () => {
            expect(() => Utils.collateralizedConvert(null as any, {}, 'a', '10 HIVE')).toThrow();
        });
    });

    describe('content operation validation', () => {
        test('deleteComment throws without params', () => {
            expect(() => Utils.deleteComment(null as any, {}, 'a', 'p')).toThrow();
        });

        test('commentOptions throws without params', () => {
            expect(() => Utils.commentOptions(null as any, {}, 'a', 'p', {})).toThrow();
        });
    });

    describe('market operation validation', () => {
        test('limitOrderCreate throws without params', () => {
            expect(() => Utils.limitOrderCreate(null as any, {}, 'a', 1, '1 HIVE', '0.5 HBD')).toThrow();
        });

        test('limitOrderCancel throws without params', () => {
            expect(() => Utils.limitOrderCancel(null as any, {}, 'a', 1)).toThrow();
        });
    });

    describe('setWithdrawVestingRoute validation', () => {
        test('throws without params', () => {
            expect(() => Utils.setWithdrawVestingRoute(null as any, {}, 'a', 'b', 50)).toThrow();
        });

        test('throws for invalid percent', () => {
            const client = { broadcast: {} } as any;
            expect(() => Utils.setWithdrawVestingRoute(client, { ACTIVE_KEY: 'x' }, 'a', 'b', -1)).toThrow();
            expect(() => Utils.setWithdrawVestingRoute(client, { ACTIVE_KEY: 'x' }, 'a', 'b', 10001)).toThrow();
        });
    });

    describe('claimAccount validation', () => {
        test('throws without params', () => {
            expect(() => Utils.claimAccount(null as any, {}, 'a')).toThrow();
        });
    });

    describe('feedPublish validation', () => {
        test('throws without params', () => {
            expect(() => Utils.feedPublish(null as any, {}, 'a', '0.400 HBD')).toThrow();
        });
    });
});
