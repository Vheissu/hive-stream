/**
 * Live integration tests against Hive mainnet public API nodes.
 * These tests are READ-ONLY and do not broadcast any operations.
 * They validate that our query namespace and utility functions
 * work correctly against real blockchain data.
 *
 * These tests require network access and may be slow.
 * Skip with: jest --testPathIgnorePatterns=integration
 */

import { Streamer } from '../../src/streamer';
import { Utils } from '../../src/utils';

// Known mainnet accounts that will always exist
const WELL_KNOWN_ACCOUNT = 'hiveio';
const WELL_KNOWN_WITNESS = 'blocktrades';
const WELL_KNOWN_POST_AUTHOR = 'hiveio';
const WELL_KNOWN_POST_PERMLINK = 'announcing-the-launch-of-hive-blockchain';

describe('Live API Integration Tests (Mainnet Read-Only)', () => {
    let streamer: Streamer;

    beforeAll(() => {
        streamer = new Streamer({
            API_NODES: ['https://api.hive.blog', 'https://api.openhive.network'],
            DEBUG_MODE: false
        });
    });

    afterAll(async () => {
        await streamer.stop();
    });

    // ─── Chain State Queries ────────────────────────────────────────────

    describe('chain state', () => {
        test('getDynamicGlobalProperties returns valid data', async () => {
            const props = await streamer.query.getDynamicGlobalProperties();
            expect(props).toBeDefined();
            expect(props.head_block_number).toBeGreaterThan(0);
            expect(props.current_supply).toBeDefined();
            expect(props.current_hbd_supply).toBeDefined();
            expect(typeof props.head_block_id).toBe('string');
            expect(props.total_vesting_fund_hive).toBeDefined();
            expect(props.total_vesting_shares).toBeDefined();
        }, 15000);

        test('getCurrentMedianHistoryPrice returns price data', async () => {
            const price = await streamer.query.getCurrentMedianHistoryPrice();
            expect(price).toBeDefined();
            expect(price.base).toBeDefined();
            expect(price.quote).toBeDefined();
        }, 15000);

        test('getConfig returns chain config', async () => {
            const config = await streamer.query.getConfig();
            expect(config).toBeDefined();
            expect(config.HIVE_CHAIN_ID || config.STEEM_CHAIN_ID).toBeDefined();
        }, 15000);

        test('getRewardFund returns reward pool data', async () => {
            const fund = await streamer.query.getRewardFund();
            expect(fund).toBeDefined();
            expect(fund.reward_balance).toBeDefined();
            expect(fund.recent_claims).toBeDefined();
        }, 15000);
    });

    // ─── Account Queries ────────────────────────────────────────────────

    describe('account queries', () => {
        test('getAccount returns valid account data', async () => {
            const account = await streamer.getAccount(WELL_KNOWN_ACCOUNT);
            expect(account).not.toBeNull();
            expect(account.name).toBe(WELL_KNOWN_ACCOUNT);
            expect(account.balance).toBeDefined();
            expect(account.hbd_balance).toBeDefined();
            expect(account.vesting_shares).toBeDefined();
            expect(account.posting).toBeDefined();
            expect(account.active).toBeDefined();
        }, 15000);

        test('getAccounts returns multiple accounts', async () => {
            const accounts = await streamer.getAccounts([WELL_KNOWN_ACCOUNT, WELL_KNOWN_WITNESS]);
            expect(Array.isArray(accounts)).toBe(true);
            expect(accounts.length).toBe(2);
            expect(accounts[0].name).toBe(WELL_KNOWN_ACCOUNT);
            expect(accounts[1].name).toBe(WELL_KNOWN_WITNESS);
        }, 15000);

        test('getAccount returns null for non-existent account', async () => {
            const account = await streamer.getAccount('zzznotreal1234');
            expect(account).toBeNull();
        }, 15000);

        test('getAccountHistory returns history entries', async () => {
            const history = await streamer.query.getAccountHistory(WELL_KNOWN_ACCOUNT, -1, 5);
            expect(Array.isArray(history)).toBe(true);
            expect(history.length).toBeGreaterThan(0);
        }, 15000);
    });

    // ─── Content Queries ────────────────────────────────────────────────

    describe('content queries', () => {
        test('getTrending returns posts', async () => {
            const posts = await streamer.query.getTrending({ limit: 3 });
            expect(Array.isArray(posts)).toBe(true);
            expect(posts.length).toBeGreaterThan(0);
            expect(posts[0].author).toBeDefined();
            expect(posts[0].permlink).toBeDefined();
            expect(posts[0].title).toBeDefined();
            expect(posts[0].body).toBeDefined();
        }, 15000);

        test('getHot returns posts', async () => {
            const posts = await streamer.query.getHot({ limit: 3 });
            expect(Array.isArray(posts)).toBe(true);
            expect(posts.length).toBeGreaterThan(0);
        }, 15000);

        test('getCreated returns new posts', async () => {
            const posts = await streamer.query.getCreated({ limit: 3 });
            expect(Array.isArray(posts)).toBe(true);
            expect(posts.length).toBeGreaterThan(0);
        }, 15000);

        test('getBlog returns account blog posts', async () => {
            const posts = await streamer.query.getBlog(WELL_KNOWN_ACCOUNT, { limit: 3 });
            expect(Array.isArray(posts)).toBe(true);
        }, 15000);
    });

    // ─── Social Queries ─────────────────────────────────────────────────

    describe('social queries', () => {
        test('getFollowCount returns follower/following counts', async () => {
            const count = await streamer.query.getFollowCount(WELL_KNOWN_ACCOUNT);
            expect(count).toBeDefined();
            expect(typeof count.follower_count).toBe('number');
            expect(typeof count.following_count).toBe('number');
            expect(count.follower_count).toBeGreaterThan(0);
        }, 15000);

        test('getFollowers returns follower list', async () => {
            const followers = await streamer.query.getFollowers(WELL_KNOWN_ACCOUNT, '', 'blog', 5);
            expect(Array.isArray(followers)).toBe(true);
            expect(followers.length).toBeGreaterThan(0);
            expect(followers[0].follower).toBeDefined();
            expect(followers[0].following).toBe(WELL_KNOWN_ACCOUNT);
        }, 15000);

        test('getFollowing returns following list', async () => {
            const following = await streamer.query.getFollowing(WELL_KNOWN_WITNESS, '', 'blog', 5);
            expect(Array.isArray(following)).toBe(true);
        }, 15000);
    });

    // ─── Delegation Queries ─────────────────────────────────────────────

    describe('delegation queries', () => {
        test('getVestingDelegations returns delegation data', async () => {
            const delegations = await streamer.query.getVestingDelegations(WELL_KNOWN_WITNESS, '', 10);
            expect(Array.isArray(delegations)).toBe(true);
            // May be empty if account has no outgoing delegations
        }, 15000);
    });

    // ─── Market Queries ─────────────────────────────────────────────────

    describe('market queries', () => {
        test('getOrderBook returns order book', async () => {
            const orderBook = await streamer.query.getOrderBook(5);
            expect(orderBook).toBeDefined();
            expect(Array.isArray(orderBook.bids)).toBe(true);
            expect(Array.isArray(orderBook.asks)).toBe(true);
        }, 15000);
    });

    // ─── Resource Credits ───────────────────────────────────────────────

    describe('resource credit queries', () => {
        test('getRCMana returns RC data', async () => {
            const rc = await streamer.query.getRCMana(WELL_KNOWN_ACCOUNT);
            expect(rc).toBeDefined();
            expect(rc.current_mana).toBeDefined();
        }, 15000);

        test('getVPMana returns voting power data', async () => {
            const vp = await streamer.query.getVPMana(WELL_KNOWN_ACCOUNT);
            expect(vp).toBeDefined();
            expect(vp.current_mana).toBeDefined();
        }, 15000);

        test('findRCAccounts returns RC account data', async () => {
            const accounts = await streamer.query.findRCAccounts([WELL_KNOWN_ACCOUNT]);
            expect(Array.isArray(accounts)).toBe(true);
            expect(accounts.length).toBe(1);
        }, 15000);
    });

    // ─── Witness Queries ────────────────────────────────────────────────

    describe('witness queries', () => {
        test('getWitnessByAccount returns witness data', async () => {
            const witness = await streamer.query.getWitnessByAccount(WELL_KNOWN_WITNESS);
            expect(witness).toBeDefined();
            expect(witness.owner).toBe(WELL_KNOWN_WITNESS);
        }, 15000);

        test('getWitnessesByVote returns top witnesses', async () => {
            const witnesses = await streamer.query.getWitnessesByVote('', 5);
            expect(Array.isArray(witnesses)).toBe(true);
            expect(witnesses.length).toBe(5);
            expect(witnesses[0].owner).toBeDefined();
        }, 15000);
    });

    // ─── Block Queries ──────────────────────────────────────────────────

    describe('block queries', () => {
        test('getBlock returns block data', async () => {
            const block = await streamer.query.getBlock(1);
            expect(block).toBeDefined();
            expect(block.previous).toBeDefined();
            expect(block.witness).toBeDefined();
        }, 15000);

        test('getBlockHeader returns header', async () => {
            const header = await streamer.query.getBlockHeader(1);
            expect(header).toBeDefined();
            expect(header.previous).toBeDefined();
        }, 15000);
    });

    // ─── Account Lookup ─────────────────────────────────────────────────

    describe('account lookup', () => {
        test('lookupAccounts returns matching accounts', async () => {
            const accounts = await streamer.query.lookupAccounts('hive', 5);
            expect(Array.isArray(accounts)).toBe(true);
            expect(accounts.length).toBeGreaterThan(0);
            expect(accounts.some(a => a.startsWith('hive'))).toBe(true);
        }, 15000);
    });

    // ─── Utility Function Integration ───────────────────────────────────

    describe('utility functions with live data', () => {
        test('calculateReputation works with real account data', async () => {
            const account = await streamer.getAccount(WELL_KNOWN_WITNESS);
            const rep = Utils.calculateReputation(account.reputation);
            expect(typeof rep).toBe('number');
            expect(rep).toBeGreaterThanOrEqual(25);
            expect(rep).toBeLessThan(100);
        }, 15000);

        test('vestToHP works with real global properties', async () => {
            const props = await streamer.query.getDynamicGlobalProperties();
            const hp = Utils.vestToHP(
                '1000000.000000',
                props.total_vesting_fund_hive,
                props.total_vesting_shares
            );
            expect(parseFloat(hp)).toBeGreaterThan(0);
        }, 15000);

        test('calculateVotingMana works with real account', async () => {
            const account = await streamer.getAccount(WELL_KNOWN_WITNESS);
            const mana = Utils.calculateVotingMana(account);
            expect(mana).toBeGreaterThanOrEqual(0);
            expect(mana).toBeLessThanOrEqual(100);
        }, 15000);

        test('calculateAccountValue works with real data', async () => {
            const [account, props, price] = await Promise.all([
                streamer.getAccount(WELL_KNOWN_WITNESS),
                streamer.query.getDynamicGlobalProperties(),
                streamer.query.getCurrentMedianHistoryPrice()
            ]);

            const baseStr = typeof price.base === 'string' ? price.base : String(price.base);
            const quoteStr = typeof price.quote === 'string' ? price.quote : String(price.quote);
            const hivePrice = parseFloat(baseStr.replace(' HBD', '')) / parseFloat(quoteStr.replace(' HIVE', ''));
            const value = Utils.calculateAccountValue(
                account,
                hivePrice,
                1.0,
                props.total_vesting_fund_hive,
                props.total_vesting_shares
            );

            expect(value.hive).toBeGreaterThanOrEqual(0);
            expect(value.hp).toBeGreaterThan(0);
            expect(value.total_usd).toBeGreaterThan(0);
        }, 15000);

        test('parseProfileMetadata works with real account metadata', async () => {
            const account = await streamer.getAccount(WELL_KNOWN_WITNESS);
            const profile = Utils.parseProfileMetadata(
                account.posting_json_metadata || account.json_metadata
            );
            // blocktrades should have profile data
            expect(typeof profile).toBe('object');
        }, 15000);

        test('isValidAccountName validates real account names', async () => {
            expect(Utils.isValidAccountName(WELL_KNOWN_ACCOUNT)).toBe(true);
            expect(Utils.isValidAccountName(WELL_KNOWN_WITNESS)).toBe(true);
        });

        test('accountExists confirms known accounts', async () => {
            const exists = await Utils.accountExists(
                (streamer as any).client,
                WELL_KNOWN_ACCOUNT
            );
            expect(exists).toBe(true);

            const notExists = await Utils.accountExists(
                (streamer as any).client,
                'zzznotreal1234'
            );
            expect(notExists).toBe(false);
        }, 15000);
    });

    // ─── Cross-validated Queries ────────────────────────────────────────

    describe('cross-validation', () => {
        test('getFollowCount matches getFollowers length constraint', async () => {
            const count = await streamer.query.getFollowCount(WELL_KNOWN_ACCOUNT);
            const followers = await streamer.query.getFollowers(WELL_KNOWN_ACCOUNT, '', 'blog', 3);

            expect(count.follower_count).toBeGreaterThanOrEqual(followers.length);
        }, 15000);

        test('getDynamicGlobalProperties head block is recent', async () => {
            const props = await streamer.query.getDynamicGlobalProperties();
            const headTime = new Date(props.time + 'Z');
            const now = new Date();
            const diffMs = now.getTime() - headTime.getTime();

            // Head block should be within 60 seconds of now
            expect(diffMs).toBeLessThan(60000);
            expect(diffMs).toBeGreaterThan(-60000);
        }, 15000);
    });
});
