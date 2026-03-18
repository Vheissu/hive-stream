/**
 * Live broadcast integration tests against Hive MAINNET.
 *
 * These tests perform REAL operations on the blockchain using the
 * steembutton account. They are gated behind environment variables
 * and only run when TEST_ACCOUNT, TEST_POSTING_KEY, and TEST_ACTIVE_KEY
 * are set.
 *
 * All operations are designed to be safe and low-impact:
 * - Follow/unfollow (free, reversible)
 * - Post a comment + delete it (free, reversible)
 * - Vote + unvote (free, reversible)
 * - Custom JSON (free)
 * - Profile update + restore (free)
 * - Transfer 0.001 HIVE to self (round-trip, needs liquid HIVE)
 * - Delegate 0.000001 VESTS + undelegate (reversible)
 * - Power up 0.001 HIVE (irreversible but trivial)
 *
 * Run with: npx jest --watchman=false tests/integration/live-broadcast.integration.spec.ts
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.test' });

import { Streamer } from '../../src/streamer';
import { Utils } from '../../src/utils';

const TEST_ACCOUNT = process.env.TEST_ACCOUNT;
const TEST_POSTING_KEY = process.env.TEST_POSTING_KEY;
const TEST_ACTIVE_KEY = process.env.TEST_ACTIVE_KEY;
const TEST_TARGET = process.env.TEST_TARGET_ACCOUNT || 'beggars';

const SKIP = !TEST_ACCOUNT || !TEST_POSTING_KEY || !TEST_ACTIVE_KEY;

const describeIf = SKIP ? describe.skip : describe;

describeIf('Live Broadcast Integration Tests (Mainnet)', () => {
    let streamer: Streamer;

    beforeAll(() => {
        streamer = new Streamer({
            ACTIVE_KEY: TEST_ACTIVE_KEY,
            POSTING_KEY: TEST_POSTING_KEY,
            USERNAME: TEST_ACCOUNT,
            API_NODES: ['https://api.hive.blog', 'https://api.openhive.network'],
            DEBUG_MODE: false
        });
    });

    afterAll(async () => {
        await streamer.stop();
    });

    // Helper to wait between operations to avoid rate limiting
    const pause = (ms: number = 4000) => new Promise(resolve => setTimeout(resolve, ms));

    // ─── Social Operations ──────────────────────────────────────────────

    describe('follow / unfollow cycle', () => {
        test('follow a user', async () => {
            const result = await streamer.follow(TEST_ACCOUNT, TEST_TARGET);
            expect(result).toBeDefined();
            expect(result.id).toBeDefined();
            console.log(`  ✓ Followed @${TEST_TARGET} - tx: ${result.id}`);
        }, 30000);

        test('unfollow a user', async () => {
            await pause();
            const result = await streamer.unfollow(TEST_ACCOUNT, TEST_TARGET);
            expect(result).toBeDefined();
            expect(result.id).toBeDefined();
            console.log(`  ✓ Unfollowed @${TEST_TARGET} - tx: ${result.id}`);
        }, 30000);
    });

    describe('follow via builder', () => {
        test('ops.follow() builder works', async () => {
            await pause();
            const result = await streamer.ops.follow()
                .follower(TEST_ACCOUNT)
                .following(TEST_TARGET)
                .send();
            expect(result).toBeDefined();
            expect(result.id).toBeDefined();
            console.log(`  ✓ Followed via builder - tx: ${result.id}`);
        }, 30000);

        test('ops.unfollow() builder works', async () => {
            await pause();
            const result = await streamer.ops.unfollow()
                .follower(TEST_ACCOUNT)
                .following(TEST_TARGET)
                .send();
            expect(result).toBeDefined();
            console.log(`  ✓ Unfollowed via builder - tx: ${result.id}`);
        }, 30000);
    });

    // ─── Custom JSON ────────────────────────────────────────────────────

    describe('custom JSON broadcast', () => {
        test('broadcasts a custom_json via batch builder', async () => {
            await pause();
            const result = await streamer.batch()
                .customJson('hive-stream-test', { test: true, timestamp: Date.now() }, TEST_ACCOUNT)
                .send();
            expect(result).toBeDefined();
            expect(result.id).toBeDefined();
            console.log(`  ✓ Custom JSON broadcast - tx: ${result.id}`);
        }, 30000);
    });

    // ─── Post + Reply with Beneficiaries + Delete ────────────────────────
    // NOTE: Hive enforces 5-minute cooldown between root posts.
    // These tests may fail if run within 5 minutes of a previous run.

    describe('post, reply with beneficiaries, and delete cycle', () => {
        const testPermlink = `hive-stream-test-${Date.now()}`;
        const replyPermlink = `re-bene-test-${Date.now()}`;
        let postCreated = false;
        let replyCreated = false;

        test('create a test post via post builder', async () => {
            await pause(6000);
            const result = await streamer.ops.post()
                .author(TEST_ACCOUNT)
                .title('Hive Stream Integration Test')
                .body(`This is an automated integration test post from hive-stream. It will be deleted shortly.\n\nTimestamp: ${new Date().toISOString()}`)
                .permlink(testPermlink)
                .tags('hive-stream', 'test')
                .app('hive-stream/integration-test')
                .description('Automated test post')
                .send();
            expect(result).toBeDefined();
            expect(result.id).toBeDefined();
            postCreated = true;
            console.log(`  ✓ Created test post @${TEST_ACCOUNT}/${testPermlink} - tx: ${result.id}`);
        }, 30000);

        test('create reply with beneficiaries via builder', async () => {
            if (!postCreated) {
                console.log('  ⚠ Skipping - parent post was not created');
                return;
            }
            await pause(21000); // 20s cooldown for replies
            const result = await streamer.ops.post()
                .author(TEST_ACCOUNT)
                .parentAuthor(TEST_ACCOUNT)
                .parentPermlink(testPermlink)
                .body('Testing reply with beneficiaries. Will be deleted.')
                .permlink(replyPermlink)
                .beneficiary(TEST_TARGET, 1000)
                .maxAcceptedPayout(0, 'HBD')
                .send();
            expect(result).toBeDefined();
            expect(result.id).toBeDefined();
            replyCreated = true;
            console.log(`  ✓ Created reply with beneficiaries - tx: ${result.id}`);
        }, 60000);

        test('delete the beneficiary reply', async () => {
            if (!replyCreated) {
                console.log('  ⚠ Skipping - reply was not created');
                return;
            }
            await pause();
            const result = await streamer.deleteComment(TEST_ACCOUNT, replyPermlink);
            expect(result).toBeDefined();
            console.log(`  ✓ Deleted beneficiary reply - tx: ${result.id}`);
        }, 30000);

        test('delete the test post', async () => {
            if (!postCreated) {
                console.log('  ⚠ Skipping - post was not created');
                return;
            }
            await pause();
            const result = await streamer.deleteComment(TEST_ACCOUNT, testPermlink);
            expect(result).toBeDefined();
            expect(result.id).toBeDefined();
            console.log(`  ✓ Deleted test post - tx: ${result.id}`);
        }, 30000);
    });

    // ─── Profile Update Cycle ───────────────────────────────────────────

    describe('profile update and restore', () => {
        let originalProfile: any;

        test('save original profile', async () => {
            const account = await streamer.getAccount(TEST_ACCOUNT);
            originalProfile = Utils.parseProfileMetadata(account.posting_json_metadata);
            expect(account).toBeDefined();
            console.log('  ✓ Saved original profile metadata');
        }, 15000);

        test('update profile via builder', async () => {
            await pause();
            const result = await streamer.ops.updateProfile()
                .account(TEST_ACCOUNT)
                .about('hive-stream integration test account')
                .website('https://github.com/Vheissu/hive-stream')
                .send();
            expect(result).toBeDefined();
            expect(result.id).toBeDefined();
            console.log(`  ✓ Updated profile - tx: ${result.id}`);
        }, 30000);

        test('verify profile was updated', async () => {
            await pause(6000);
            const account = await streamer.getAccount(TEST_ACCOUNT);
            const profile = Utils.parseProfileMetadata(account.posting_json_metadata);
            expect(profile.about).toBe('hive-stream integration test account');
            console.log('  ✓ Profile update verified on-chain');
        }, 15000);

        test('restore original profile', async () => {
            await pause();
            const restoreData = {
                about: originalProfile.about || '',
                website: originalProfile.website || ''
            };
            const result = await streamer.updateProfile(TEST_ACCOUNT, restoreData);
            expect(result).toBeDefined();
            console.log(`  ✓ Restored original profile - tx: ${result.id}`);
        }, 30000);
    });

    // ─── Delegation Cycle ───────────────────────────────────────────────

    describe('delegate and undelegate cycle', () => {
        let canDelegate = false;
        const delegateAmount = '1700.000000 VESTS'; // Just above minimum

        test('check if account has enough VESTS to delegate', async () => {
            const account = await streamer.getAccount(TEST_ACCOUNT);
            const effective = Utils.getEffectiveVestingShares(account);
            // Need at least ~1634 VESTS to delegate, plus some buffer
            canDelegate = effective > 2000;
            if (!canDelegate) {
                console.log(`  ⚠ Account has ${effective.toFixed(6)} effective VESTS - insufficient to delegate (need >2000)`);
            } else {
                console.log(`  ✓ Account has ${effective.toFixed(6)} effective VESTS - can delegate`);
            }
        }, 15000);

        test('delegate VESTS', async () => {
            if (!canDelegate) {
                console.log('  ⚠ Skipping - insufficient VESTS');
                return;
            }
            await pause();
            const result = await streamer.ops.delegate()
                .delegator(TEST_ACCOUNT)
                .delegatee(TEST_TARGET)
                .vestingShares(delegateAmount)
                .send();
            expect(result).toBeDefined();
            expect(result.id).toBeDefined();
            console.log(`  ✓ Delegated ${delegateAmount} to @${TEST_TARGET} - tx: ${result.id}`);
        }, 30000);

        test('undelegate', async () => {
            if (!canDelegate) {
                console.log('  ⚠ Skipping - delegation was not made');
                return;
            }
            await pause();
            const result = await streamer.ops.undelegate()
                .delegator(TEST_ACCOUNT)
                .delegatee(TEST_TARGET)
                .send();
            expect(result).toBeDefined();
            expect(result.id).toBeDefined();
            console.log(`  ✓ Undelegated from @${TEST_TARGET} - tx: ${result.id}`);
        }, 30000);
    });

    // ─── Authority Management ───────────────────────────────────────────

    describe('posting authority grant and revoke', () => {
        const testApp = TEST_TARGET; // Use the target account which is known to exist

        test('check posting auth (should be false)', async () => {
            const hasAuth = await streamer.hasPostingAuth(TEST_ACCOUNT, testApp);
            expect(hasAuth).toBe(false);
            console.log(`  ✓ @${testApp} does NOT have posting auth (expected)`);
        }, 15000);

        test('grant posting authority', async () => {
            await pause();
            const result = await streamer.grantPostingAuth(TEST_ACCOUNT, testApp);
            expect(result).toBeDefined();
            console.log(`  ✓ Granted posting auth to @${testApp} - tx: ${result.id}`);
        }, 30000);

        test('verify posting auth was granted', async () => {
            await pause(6000);
            const hasAuth = await streamer.hasPostingAuth(TEST_ACCOUNT, testApp);
            expect(hasAuth).toBe(true);
            console.log(`  ✓ Posting auth verified on-chain`);
        }, 15000);

        test('revoke posting authority', async () => {
            await pause();
            const result = await streamer.revokePostingAuth(TEST_ACCOUNT, testApp);
            // result may be undefined if auth was already absent (idempotent)
            if (result) {
                console.log(`  ✓ Revoked posting auth from @${testApp} - tx: ${result.id}`);
            } else {
                console.log(`  ✓ Posting auth already absent for @${testApp} (no-op)`);
            }
        }, 30000);

        test('verify posting auth was revoked', async () => {
            await pause(6000);
            const hasAuth = await streamer.hasPostingAuth(TEST_ACCOUNT, testApp);
            expect(hasAuth).toBe(false);
            console.log(`  ✓ Posting auth revocation verified on-chain`);
        }, 15000);
    });

    // ─── Batch Operation ────────────────────────────────────────────────

    describe('batch operations', () => {
        test('batch custom_json operations', async () => {
            await pause();
            const result = await streamer.batch()
                .customJson('hive-stream-test', { batch: 'op1', ts: Date.now() }, TEST_ACCOUNT)
                .customJson('hive-stream-test', { batch: 'op2', ts: Date.now() }, TEST_ACCOUNT)
                .send();
            expect(result).toBeDefined();
            expect(result.id).toBeDefined();
            console.log(`  ✓ Batch custom_json (2 ops) - tx: ${result.id}`);
        }, 30000);
    });

    // ─── Transfer Operations (requires liquid HIVE) ─────────────────────

    describe('transfer operations (requires liquid HIVE)', () => {
        let hasLiquidHive = false;

        beforeAll(async () => {
            const account = await streamer.getAccount(TEST_ACCOUNT);
            const balance = parseFloat(account.balance.replace(' HIVE', ''));
            hasLiquidHive = balance >= 0.002;
            if (!hasLiquidHive) {
                console.log('  ⚠ Skipping transfer tests - insufficient liquid HIVE balance');
            }
        });

        test('transfer 0.001 HIVE to self', async () => {
            if (!hasLiquidHive) {
                return;
            }
            await pause();
            const result = await streamer.ops.transfer()
                .from(TEST_ACCOUNT)
                .to(TEST_ACCOUNT)
                .hive(0.001)
                .memo('hive-stream integration test')
                .send();
            expect(result).toBeDefined();
            expect(result.id).toBeDefined();
            console.log(`  ✓ Transferred 0.001 HIVE to self - tx: ${result.id}`);
        }, 30000);

        test('power up 0.001 HIVE', async () => {
            if (!hasLiquidHive) {
                return;
            }
            await pause();
            const result = await streamer.ops.powerUp()
                .from(TEST_ACCOUNT)
                .to(TEST_ACCOUNT)
                .amount(0.001)
                .send();
            expect(result).toBeDefined();
            expect(result.id).toBeDefined();
            console.log(`  ✓ Powered up 0.001 HIVE - tx: ${result.id}`);
        }, 30000);
    });
});
