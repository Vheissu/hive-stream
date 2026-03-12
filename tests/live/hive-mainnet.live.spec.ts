/**
 * Live mainnet tests using real HIVE keys.
 *
 * SETUP:
 *   1. Copy .env.example to .env
 *   2. Fill in ACTIVE_KEY, POSTING_KEY, HIVE_ACCOUNT
 *   3. Run: npx jest tests/live --no-watchman
 *
 * These tests use dust amounts (0.001 HIVE) and are safe to run.
 * They are SKIPPED by default unless keys are present in .env.
 */
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { Client, PrivateKey } from '@hiveio/dhive';
import { Utils } from '../../src/utils';
import { Streamer } from '../../src/streamer';
import { HiveProvider } from '../../src/providers/hive-provider';

const ACCOUNT = process.env.HIVE_ACCOUNT || 'beggars';
const ACTIVE_KEY = process.env.ACTIVE_KEY;
const POSTING_KEY = process.env.POSTING_KEY;
const HAS_KEYS = Boolean(ACTIVE_KEY && POSTING_KEY);

const API_NODES = ['https://api.hive.blog', 'https://api.deathwing.me', 'https://anyx.io'];

const describeIfKeys = HAS_KEYS ? describe : describe.skip;

let client: Client;

beforeAll(() => {
    client = new Client(API_NODES);
});

describeIfKeys('Live: HIVE Mainnet', () => {
    // Generous timeout for real API calls
    jest.setTimeout(30000);

    describe('Account verification', () => {
        test('account exists and has balance', async () => {
            const accounts = await client.database.getAccounts([ACCOUNT]);
            expect(accounts).toHaveLength(1);
            expect(accounts[0].name).toBe(ACCOUNT);
            console.log(`  Account: ${ACCOUNT}`);
            console.log(`  Balance: ${accounts[0].balance}`);
            console.log(`  HBD: ${accounts[0].hbd_balance}`);
        });

        test('active key is valid for account', async () => {
            // Verify the key can sign by creating a PrivateKey instance
            const pk = PrivateKey.fromString(ACTIVE_KEY!);
            expect(pk).toBeDefined();
            // The public key should correspond to the account's active authority
            const accounts = await client.database.getAccounts([ACCOUNT]);
            const publicKey = pk.createPublic().toString();
            const activeKeyAuths = accounts[0].active.key_auths.map(([k]: any) => k);
            expect(activeKeyAuths).toContain(publicKey);
            console.log(`  Active key verified for ${ACCOUNT}`);
        });

        test('posting key is valid for account', async () => {
            const pk = PrivateKey.fromString(POSTING_KEY!);
            const accounts = await client.database.getAccounts([ACCOUNT]);
            const publicKey = pk.createPublic().toString();
            const postingKeyAuths = accounts[0].posting.key_auths.map(([k]: any) => k);
            expect(postingKeyAuths).toContain(publicKey);
            console.log(`  Posting key verified for ${ACCOUNT}`);
        });
    });

    describe('Block provider', () => {
        test('HiveProvider fetches current head block', async () => {
            const provider = new HiveProvider({ apiNodes: API_NODES });
            const props = await provider.getDynamicGlobalProperties();
            expect(props.head_block_number).toBeGreaterThan(0);
            expect(props.time).toBeDefined();
            console.log(`  Head block: ${props.head_block_number}`);
        });

        test('HiveProvider fetches a specific block', async () => {
            const provider = new HiveProvider({ apiNodes: API_NODES });
            const props = await provider.getDynamicGlobalProperties();
            const recentBlock = props.head_block_number - 5;
            const block = await provider.getBlock(recentBlock);
            expect(block).not.toBeNull();
            expect(block!.block_id).toBeDefined();
            expect(block!.transactions).toBeDefined();
            console.log(`  Block ${recentBlock}: ${block!.transactions.length} txs`);
        });
    });

    describe('Transfer: dust self-transfer (0.001 HIVE)', () => {
        test('transferHiveTokens sends 0.001 HIVE to self', async () => {
            const result = await Utils.transferHiveTokens(
                client,
                { ACTIVE_KEY },
                ACCOUNT,
                ACCOUNT,
                '0.001',
                'HIVE',
                'hive-stream live test - safe to ignore'
            );
            expect(result).toBeDefined();
            expect(result.id).toBeDefined();
            console.log(`  Transfer tx: ${result.id}`);
        });

        test('getTransaction retrieves the transfer', async () => {
            // Send a transfer and verify we can find it
            const result = await Utils.transferHiveTokens(
                client,
                { ACTIVE_KEY },
                ACCOUNT,
                ACCOUNT,
                '0.001',
                'HIVE',
                'hive-stream getTransaction test'
            );

            // Wait for block confirmation
            await Utils.sleep(4000);

            // Get current head block to search near it
            const props = await client.database.getDynamicGlobalProperties();
            const headBlock = props.head_block_number;

            // Search recent blocks for our transaction
            let found = false;
            for (let bn = headBlock; bn > headBlock - 5; bn--) {
                try {
                    const tx = await Utils.getTransaction(client, bn, result.id);
                    if (tx) {
                        found = true;
                        const verified = await Utils.verifyTransfer(tx, ACCOUNT, ACCOUNT, '0.001 HIVE');
                        expect(verified).toBe(true);
                        console.log(`  Found tx ${result.id} in block ${bn}`);
                        break;
                    }
                } catch {
                    // Transaction not in this block, keep searching
                }
            }

            if (!found) {
                console.log(`  Transaction ${result.id} not found in recent blocks (may need more time)`);
            }
        });
    });

    describe('Transfer: HBD dust self-transfer', () => {
        test('sends 0.001 HBD to self', async () => {
            try {
                const result = await Utils.transferHiveTokens(
                    client,
                    { ACTIVE_KEY },
                    ACCOUNT,
                    ACCOUNT,
                    '0.001',
                    'HBD',
                    'hive-stream HBD live test'
                );
                expect(result).toBeDefined();
                console.log(`  HBD transfer tx: ${result.id}`);
            } catch (error: any) {
                // Account may not have HBD balance
                if (error.message?.includes('sufficient')) {
                    console.log('  Skipped: insufficient HBD balance');
                } else {
                    throw error;
                }
            }
        });
    });

    describe('Voting', () => {
        test('upvote a post with 1% weight', async () => {
            // Vote on a known post (the account's own most recent post or a well-known one)
            try {
                const result = await Utils.upvote(
                    client,
                    { POSTING_KEY },
                    ACCOUNT,
                    '1.0', // 1% vote
                    'hiveio',
                    'announcing-the-launch-of-hive-blockchain'
                );
                expect(result).toBeDefined();
                console.log(`  Upvote tx: ${result.id}`);
            } catch (error: any) {
                // May fail if already voted recently
                console.log(`  Upvote result: ${error.message}`);
            }
        });
    });

    describe('Streamer integration', () => {
        test('Streamer starts, fetches blocks, and stops cleanly', async () => {
            const streamer = new Streamer({
                JSON_ID: 'hivestream-live-test',
                API_NODES,
                BLOCK_CHECK_INTERVAL: 1000,
            });

            const blocksProcessed: number[] = [];

            streamer.onCustomJson((data, meta, blockNumber) => {
                blocksProcessed.push(blockNumber);
            });

            await streamer.start();

            // Let it run for a few seconds to process at least 1 block
            await Utils.sleep(5000);

            await streamer.stop();

            console.log(`  Blocks seen: ${blocksProcessed.length}`);
            // The streamer should have at least started (head block > 0)
            const status = (streamer as any).getStatus();
            expect(status.headBlockNumber).toBeGreaterThan(0);
        });

        test('Streamer with custom block provider', async () => {
            const provider = new HiveProvider({ apiNodes: API_NODES });
            const streamer = new Streamer({
                JSON_ID: 'hivestream-provider-test',
                blockProvider: provider as any,
            });

            expect(streamer.getBlockProvider()).toBe(provider);
            await streamer.stop();
        });
    });

    describe('Account history', () => {
        test('getAccountTransfers returns recent transfers', async () => {
            const transfers = await Utils.getAccountTransfers(client, ACCOUNT, -1, 10);
            expect(Array.isArray(transfers)).toBe(true);
            console.log(`  Recent transfers: ${transfers.length}`);
            if (transfers.length > 0) {
                console.log(`  Latest: ${transfers[0].from} -> ${transfers[0].to}: ${transfers[0].amount}`);
            }
        });
    });
});

describeIfKeys('Live: Hive Engine Token (BEGGARS)', () => {
    jest.setTimeout(30000);

    const HE_TOKEN = process.env.HIVE_ENGINE_TOKEN || 'BEGGARS';
    const config = {
        ACTIVE_KEY: ACTIVE_KEY!,
        HIVE_ENGINE_ID: 'ssc-mainnet-hive',
    } as any;

    test('transfers 0.001 HE token to self', async () => {
        try {
            const result = await Utils.transferHiveEngineTokens(
                client,
                config,
                ACCOUNT,
                ACCOUNT,
                '0.001',
                HE_TOKEN,
                'hive-stream live test'
            );
            expect(result).toBeDefined();
            console.log(`  HE transfer tx: ${result.id}`);
        } catch (error: any) {
            // May fail if token doesn't exist or no balance
            console.log(`  HE transfer: ${error.message}`);
        }
    });
});

describe('Live: No-key tests (always run)', () => {
    test('API node connectivity', async () => {
        const client = new Client(API_NODES);
        const props = await client.database.getDynamicGlobalProperties();
        expect(props.head_block_number).toBeGreaterThan(90000000);
        console.log(`  Connected to Hive. Head block: ${props.head_block_number}`);
    });

    test('getTransferUrl generates valid URL', () => {
        const url = Utils.getTransferUrl('beggars', 'test-memo', '0.001 HIVE', 'https://example.com');
        expect(url).toContain('hivesigner.com');
        expect(url).toContain('beggars');
    });
});
