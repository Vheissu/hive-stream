import { PrivateKey } from '@hiveio/dhive';
import { Streamer } from '../src/streamer';
import { Utils } from '../src/utils';
import { createMockAdapter } from './helpers/mock-adapter';

describe('Wave 3 Features', () => {
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

    // ─── Post Builder ───────────────────────────────────────────────────

    describe('ops.post() builder', () => {
        test('creates a post builder with all methods', () => {
            const builder = streamer.ops.post();
            expect(typeof builder.author).toBe('function');
            expect(typeof builder.title).toBe('function');
            expect(typeof builder.body).toBe('function');
            expect(typeof builder.permlink).toBe('function');
            expect(typeof builder.tags).toBe('function');
            expect(typeof builder.community).toBe('function');
            expect(typeof builder.beneficiary).toBe('function');
            expect(typeof builder.maxAcceptedPayout).toBe('function');
            expect(typeof builder.percentHbd).toBe('function');
            expect(typeof builder.allowVotes).toBe('function');
            expect(typeof builder.allowCurationRewards).toBe('function');
            expect(typeof builder.app).toBe('function');
            expect(typeof builder.format).toBe('function');
            expect(typeof builder.description).toBe('function');
            expect(typeof builder.image).toBe('function');
            expect(typeof builder.metadata).toBe('function');
            expect(typeof builder.send).toBe('function');
        });

        test('throws without author', () => {
            expect(() => streamer.ops.post().body('hello').send()).toThrow('requires author');
        });

        test('throws without body', () => {
            expect(() => streamer.ops.post().author('alice').send()).toThrow('requires body');
        });

        test('supports full chaining', () => {
            const builder = streamer.ops.post();
            const result = builder
                .author('alice')
                .title('My Post')
                .body('Hello world')
                .tags('hive', 'dev')
                .community('hive-12345')
                .beneficiary('devfund', 500)
                .beneficiary('curator', 1000)
                .maxAcceptedPayout(100, 'HBD')
                .percentHbd(5000)
                .allowVotes()
                .allowCurationRewards()
                .app('my-app/1.0')
                .format('markdown')
                .description('A test post')
                .image('https://example.com/img.png')
                .metadata('custom_key', 'custom_value');
            expect(result).toBe(builder);
        });

        test('supports reply builder (parentAuthor/parentPermlink)', () => {
            const builder = streamer.ops.post();
            const result = builder
                .author('alice')
                .parentAuthor('bob')
                .parentPermlink('original-post')
                .body('Great post!');
            expect(result).toBe(builder);
        });
    });

    // ─── Batch Builder ──────────────────────────────────────────────────

    describe('batch() builder', () => {
        test('creates a batch builder', () => {
            const builder = streamer.batch();
            expect(typeof builder.add).toBe('function');
            expect(typeof builder.transfer).toBe('function');
            expect(typeof builder.vote).toBe('function');
            expect(typeof builder.customJson).toBe('function');
            expect(typeof builder.comment).toBe('function');
            expect(typeof builder.send).toBe('function');
        });

        test('throws when no operations added', () => {
            expect(() => streamer.batch().send()).toThrow('requires at least one operation');
        });

        test('supports chaining multiple operations', () => {
            const builder = streamer.batch();
            const result = builder
                .transfer('alice', 'bob', '1.000 HIVE', 'thanks')
                .vote('alice', 'bob', 'great-post', 10000)
                .customJson('myapp', { action: 'test' }, 'alice');
            expect(result).toBe(builder);
        });

        test('supports raw operations via add()', () => {
            const builder = streamer.batch();
            const result = builder
                .add(['transfer', { from: 'alice', to: 'bob', amount: '1.000 HIVE', memo: '' }])
                .add(['vote', { voter: 'alice', author: 'bob', permlink: 'test', weight: 10000 }]);
            expect(result).toBe(builder);
        });
    });

    // ─── Authority Management ───────────────────────────────────────────

    describe('authority management methods exist', () => {
        test('hasPostingAuth exists', () => {
            expect(typeof streamer.hasPostingAuth).toBe('function');
        });

        test('grantPostingAuth exists', () => {
            expect(typeof streamer.grantPostingAuth).toBe('function');
        });

        test('revokePostingAuth exists', () => {
            expect(typeof streamer.revokePostingAuth).toBe('function');
        });
    });

    // ─── Power Down Schedule ────────────────────────────────────────────

    describe('calculatePowerDownSchedule', () => {
        test('returns empty array when not powering down', () => {
            const account = {
                vesting_withdraw_rate: '0.000000 VESTS',
                next_vesting_withdrawal: '1969-12-31T23:59:59',
                to_withdraw: '0',
                withdrawn: '0'
            };

            expect(Utils.calculatePowerDownSchedule(account)).toEqual([]);
        });

        test('returns schedule when powering down', () => {
            const now = new Date();
            const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

            const account = {
                vesting_withdraw_rate: '100.000000 VESTS',
                next_vesting_withdrawal: nextWeek.toISOString().replace('Z', ''),
                to_withdraw: (1300 * 1e6).toString(),
                withdrawn: '0'
            };

            const schedule = Utils.calculatePowerDownSchedule(account);
            expect(schedule.length).toBeGreaterThan(0);
            expect(schedule.length).toBeLessThanOrEqual(13);
            expect(schedule[0].week).toBe(1);
            expect(schedule[0].date).toBeInstanceOf(Date);
            expect(typeof schedule[0].amount).toBe('string');
            expect(typeof schedule[0].vestingShares).toBe('string');
        });
    });

    // ─── HBD Interest ───────────────────────────────────────────────────

    describe('calculateHbdInterest', () => {
        test('returns 0 for zero balance', () => {
            expect(Utils.calculateHbdInterest('0.000 HBD', new Date().toISOString())).toBe('0.000');
        });

        test('calculates interest over time', () => {
            const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
            const interest = Utils.calculateHbdInterest('1000.000', thirtyDaysAgo, 15);
            const value = parseFloat(interest);
            expect(value).toBeGreaterThan(0);
            // ~1000 * 0.15 / 365 * 30 = ~12.33
            expect(value).toBeGreaterThan(10);
            expect(value).toBeLessThan(15);
        });

        test('returns 0 for future payment date', () => {
            const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
            expect(Utils.calculateHbdInterest('1000', tomorrow)).toBe('0.000');
        });
    });

    // ─── Payout Helpers ─────────────────────────────────────────────────

    describe('isInPayoutWindow', () => {
        test('returns true for active post', () => {
            const futureDate = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
            const post = { cashout_time: futureDate.toISOString().replace('Z', '') };
            expect(Utils.isInPayoutWindow(post)).toBe(true);
        });

        test('returns false for paid out post', () => {
            const post = { cashout_time: '1969-12-31T23:59:59' };
            expect(Utils.isInPayoutWindow(post)).toBe(false);
        });

        test('returns false for null post', () => {
            expect(Utils.isInPayoutWindow(null)).toBe(false);
        });
    });

    describe('timeUntilPayout', () => {
        test('returns positive value for active post', () => {
            const futureDate = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
            const post = { cashout_time: futureDate.toISOString().replace('Z', '') };
            const time = Utils.timeUntilPayout(post);
            expect(time).toBeGreaterThan(0);
        });

        test('returns 0 for paid out post', () => {
            const post = { cashout_time: '1969-12-31T23:59:59' };
            expect(Utils.timeUntilPayout(post)).toBe(0);
        });
    });

    describe('getPendingPayout', () => {
        test('returns pending payout value', () => {
            const post = { pending_payout_value: '10.500 HBD' };
            expect(Utils.getPendingPayout(post)).toBe('10.500');
        });

        test('returns total + curator for paid posts', () => {
            const post = {
                pending_payout_value: '0.000 HBD',
                total_payout_value: '5.000 HBD',
                curator_payout_value: '3.000 HBD'
            };
            expect(Utils.getPendingPayout(post)).toBe('8.000');
        });

        test('returns 0 for null', () => {
            expect(Utils.getPendingPayout(null)).toBe('0.000');
        });
    });

    // ─── Account Value Calculator ───────────────────────────────────────

    describe('calculateAccountValue', () => {
        test('calculates value breakdown', () => {
            const account = {
                balance: '100.000 HIVE',
                hbd_balance: '50.000 HBD',
                savings_balance: '200.000 HIVE',
                savings_hbd_balance: '100.000 HBD',
                vesting_shares: '1000000.000000 VESTS',
                received_vesting_shares: '0.000000 VESTS',
                delegated_vesting_shares: '0.000000 VESTS'
            };

            const result = Utils.calculateAccountValue(account, 0.40, 1.0, '200000000', '400000000000');
            expect(result.hive).toBe(100);
            expect(result.hbd).toBe(50);
            expect(result.savings_hive).toBe(200);
            expect(result.savings_hbd).toBe(100);
            expect(result.hp).toBeGreaterThan(0);
            expect(result.total_usd).toBeGreaterThan(0);
        });
    });

    // ─── Content Helpers ────────────────────────────────────────────────

    describe('extractImagesFromBody', () => {
        test('extracts markdown images', () => {
            const body = 'text ![alt](https://example.com/img.png) more text ![](https://example.com/img2.jpg)';
            const images = Utils.extractImagesFromBody(body);
            expect(images).toEqual(['https://example.com/img.png', 'https://example.com/img2.jpg']);
        });

        test('extracts HTML images', () => {
            const body = '<img src="https://example.com/photo.png" alt="photo">';
            const images = Utils.extractImagesFromBody(body);
            expect(images).toEqual(['https://example.com/photo.png']);
        });

        test('deduplicates images', () => {
            const body = '![](https://example.com/img.png) ![](https://example.com/img.png)';
            const images = Utils.extractImagesFromBody(body);
            expect(images).toEqual(['https://example.com/img.png']);
        });

        test('returns empty array for no images', () => {
            expect(Utils.extractImagesFromBody('no images here')).toEqual([]);
            expect(Utils.extractImagesFromBody('')).toEqual([]);
            expect(Utils.extractImagesFromBody(null as any)).toEqual([]);
        });
    });

    describe('extractLinksFromBody', () => {
        test('extracts markdown links but not images', () => {
            const body = '[click here](https://example.com) and ![img](https://example.com/img.png)';
            const links = Utils.extractLinksFromBody(body);
            expect(links).toEqual(['https://example.com']);
        });

        test('extracts HTML links', () => {
            const body = '<a href="https://example.com">link</a>';
            const links = Utils.extractLinksFromBody(body);
            expect(links).toEqual(['https://example.com']);
        });
    });

    describe('generatePostSummary', () => {
        test('strips markdown and truncates', () => {
            const body = '# Hello World\n\nThis is a **bold** statement with [a link](https://example.com).';
            const summary = Utils.generatePostSummary(body, 50);
            expect(summary).not.toContain('#');
            expect(summary).not.toContain('**');
            expect(summary).not.toContain('[');
            expect(summary.length).toBeLessThanOrEqual(55); // 50 + ellipsis
        });

        test('returns empty for null', () => {
            expect(Utils.generatePostSummary(null as any)).toBe('');
        });

        test('removes code blocks', () => {
            const body = 'before ```code block``` after';
            const summary = Utils.generatePostSummary(body);
            expect(summary).not.toContain('```');
        });

        test('removes images', () => {
            const body = 'text ![alt](https://example.com/img.png) more text';
            const summary = Utils.generatePostSummary(body);
            expect(summary).not.toContain('![');
            expect(summary).toContain('text');
            expect(summary).toContain('more text');
        });
    });

    // ─── Hivesigner URL Generators ──────────────────────────────────────

    describe('getHivesignerSignUrl', () => {
        test('generates a valid signing URL', () => {
            const url = Utils.getHivesignerSignUrl('transfer', {
                from: 'alice', to: 'bob', amount: '1.000 HIVE', memo: 'test'
            });
            expect(url).toContain('https://hivesigner.com/sign/transfer');
            expect(url).toContain('from=alice');
            expect(url).toContain('to=bob');
        });

        test('includes redirect URI when provided', () => {
            const url = Utils.getHivesignerSignUrl('vote', { voter: 'alice' }, 'https://myapp.com/callback');
            expect(url).toContain('redirect_uri=');
        });
    });

    describe('getVoteUrl', () => {
        test('generates vote URL', () => {
            const url = Utils.getVoteUrl('alice', 'bob', 'test-post', 10000);
            expect(url).toContain('hivesigner.com/sign/vote');
            expect(url).toContain('voter=alice');
            expect(url).toContain('author=bob');
        });
    });

    describe('getDelegateUrl', () => {
        test('generates delegation URL', () => {
            const url = Utils.getDelegateUrl('alice', 'bob', '1000.000000 VESTS');
            expect(url).toContain('delegate-vesting-shares');
            expect(url).toContain('delegator=alice');
        });
    });

    describe('getFollowUrl', () => {
        test('generates follow URL', () => {
            const url = Utils.getFollowUrl('alice', 'bob');
            expect(url).toContain('hivesigner.com/sign/follow');
        });
    });

    // ─── Transfer Memo Helpers ──────────────────────────────────────────

    describe('isEncryptedMemo', () => {
        test('detects encrypted memos', () => {
            expect(Utils.isEncryptedMemo('#encrypted-content-here')).toBe(true);
            expect(Utils.isEncryptedMemo('regular memo')).toBe(false);
            expect(Utils.isEncryptedMemo('')).toBe(false);
        });
    });

    describe('createJsonMemo', () => {
        test('creates JSON string from object', () => {
            const memo = Utils.createJsonMemo({ action: 'deposit', amount: 100 });
            const parsed = JSON.parse(memo);
            expect(parsed.action).toBe('deposit');
            expect(parsed.amount).toBe(100);
        });
    });

    describe('parseJsonMemo', () => {
        test('parses valid JSON memos', () => {
            const result = Utils.parseJsonMemo('{"action":"deposit","amount":100}');
            expect(result).toEqual({ action: 'deposit', amount: 100 });
        });

        test('returns null for non-JSON memos', () => {
            expect(Utils.parseJsonMemo('regular memo')).toBeNull();
            expect(Utils.parseJsonMemo('')).toBeNull();
            expect(Utils.parseJsonMemo(null as any)).toBeNull();
        });

        test('returns null for invalid JSON', () => {
            expect(Utils.parseJsonMemo('{invalid json}')).toBeNull();
        });

        test('parses array memos', () => {
            const result = Utils.parseJsonMemo('[1,2,3]');
            expect(result).toEqual([1, 2, 3]);
        });
    });
});
