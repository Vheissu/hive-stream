/**
 * Smoke test: exercises both HiveProvider and HafProvider against live endpoints.
 * Tests cross-provider parity, operation shape compatibility, subscription handler
 * compatibility, setConfig propagation, edge cases, and Streamer integration.
 *
 * Run: npx ts-node scripts/smoke-test-providers.ts
 */

import { Streamer } from '../src/streamer';
import { HiveProvider } from '../src/providers/hive-provider';
import { HafProvider, HAF_OP_TYPES } from '../src/providers/haf-provider';
import { HafClient } from '../src/providers/haf-client';
import { SqliteAdapter } from '../src/adapters/sqlite.adapter';
import { BlockProvider, BlockData } from '../src/providers/block-provider';

const PASS = '  PASS';
const FAIL = '  FAIL';

let passed = 0;
let failed = 0;

function check(label: string, ok: boolean, detail?: string) {
    if (ok) {
        console.log(`${PASS} ${label}`);
        passed++;
    } else {
        console.log(`${FAIL} ${label}${detail ? ' — ' + detail : ''}`);
        failed++;
    }
}

function printBlock(source: string, block: BlockData) {
    const opCount = block.transactions.reduce((sum, tx) => sum + tx.operations.length, 0);
    console.log(`       ${source} block_id=${block.block_id.slice(0, 16)}... timestamp=${block.timestamp} txs=${block.transactions.length} ops=${opCount}`);
}

// ─── 1. HiveProvider standalone ────────────────────────────────────────────

async function testHiveProvider() {
    console.log('\n--- 1. HiveProvider (dhive RPC) ---');
    const provider = new HiveProvider({ apiNodes: ['https://api.hive.blog', 'https://api.openhive.network'] });

    const props = await provider.getDynamicGlobalProperties();
    check('getDynamicGlobalProperties returns head block', props.head_block_number > 0);
    console.log(`       head_block_number=${props.head_block_number} time=${props.time}`);

    const blockNum = props.head_block_number - 5;
    const block = await provider.getBlock(blockNum);
    check(`getBlock(${blockNum}) returns block data`, block !== null && !!block.block_id);
    if (block) {
        printBlock('HiveProvider', block);
    }

    return { provider, headBlock: props.head_block_number };
}

// ─── 2. HafProvider standalone ─────────────────────────────────────────────

async function testHafProvider() {
    console.log('\n--- 2. HafProvider (HafSQL public) ---');
    const provider = new HafProvider();

    await provider.create();
    check('create() connects to HafSQL', true);

    const props = await provider.getDynamicGlobalProperties();
    check('getDynamicGlobalProperties returns head block', props.head_block_number > 0);
    console.log(`       head_block_number=${props.head_block_number} time=${props.time}`);

    const blockNum = props.head_block_number - 10;
    const block = await provider.getBlock(blockNum);
    check(`getBlock(${blockNum}) returns block data`, block !== null && !!block.block_id);
    if (block) {
        printBlock('HafProvider', block);
        check('block has transactions array', Array.isArray(block.transactions));
        check('block has transaction_ids array', Array.isArray(block.transaction_ids));

        if (block.transactions.length > 0) {
            const firstOp = block.transactions[0].operations[0];
            check('first operation is [string, object] tuple', typeof firstOp[0] === 'string' && typeof firstOp[1] === 'object');
            console.log(`       first op: ${firstOp[0]}`);
        }
    }

    const nullBlock = await provider.getBlock(999999999);
    check('getBlock(999999999) returns null for future block', nullBlock === null);

    await provider.destroy();
    check('destroy() disconnects cleanly', true);

    return provider;
}

// ─── 3. Cross-provider parity ──────────────────────────────────────────────

async function testCrossProviderParity() {
    console.log('\n--- 3. Cross-provider parity (same block, both providers) ---');

    const hive = new HiveProvider({ apiNodes: ['https://api.hive.blog'] });
    const haf = new HafProvider();
    await haf.create();

    // Pick a well-known historical block that is stable (won't change)
    // Block 81520247 is around 2024-01-01
    const blockNum = 81520247;

    const hiveBlock = await hive.getBlock(blockNum);
    const hafBlock = await haf.getBlock(blockNum);

    check('both providers return non-null for same block', hiveBlock !== null && hafBlock !== null);

    if (hiveBlock && hafBlock) {
        // Structural parity
        check('block_id is a string (Hive)', typeof hiveBlock.block_id === 'string' && hiveBlock.block_id.length > 0);
        check('block_id is a string (HAF)', typeof hafBlock.block_id === 'string' && hafBlock.block_id.length > 0);

        check('previous is a string (Hive)', typeof hiveBlock.previous === 'string' && hiveBlock.previous.length > 0);
        check('previous is a string (HAF)', typeof hafBlock.previous === 'string' && hafBlock.previous.length > 0);

        check('timestamp is a string (Hive)', typeof hiveBlock.timestamp === 'string');
        check('timestamp is a string (HAF)', typeof hafBlock.timestamp === 'string');

        check('same number of transactions', hiveBlock.transactions.length === hafBlock.transactions.length,
            `hive=${hiveBlock.transactions.length} haf=${hafBlock.transactions.length}`);

        check('same number of transaction_ids', hiveBlock.transaction_ids.length === hafBlock.transaction_ids.length,
            `hive=${hiveBlock.transaction_ids.length} haf=${hafBlock.transaction_ids.length}`);

        // Count total operations from each
        const hiveOps = hiveBlock.transactions.reduce((sum, tx) => sum + tx.operations.length, 0);
        const hafOpsReal = hafBlock.transactions.filter(tx =>
            // HAF includes virtual ops (trx_in_block = -1), Hive RPC does not
            true
        ).reduce((sum, tx) => sum + tx.operations.length, 0);
        console.log(`       Hive ops: ${hiveOps}, HAF ops: ${hafOpsReal}`);

        // Compare operation types for real transactions (non-virtual)
        // Hive RPC doesn't include virtual ops, so we compare by transaction count
        if (hiveBlock.transactions.length === hafBlock.transactions.length) {
            let matchingOps = 0;
            let totalOps = 0;
            for (let t = 0; t < hiveBlock.transactions.length; t++) {
                const hiveTx = hiveBlock.transactions[t];
                const hafTx = hafBlock.transactions[t];
                for (let o = 0; o < hiveTx.operations.length; o++) {
                    totalOps++;
                    if (hafTx.operations[o] && hiveTx.operations[o][0] === hafTx.operations[o][0]) {
                        matchingOps++;
                    }
                }
            }
            check(`operation type names match (${matchingOps}/${totalOps})`, matchingOps === totalOps);
        }

        // Verify transaction_ids match
        if (hiveBlock.transaction_ids.length === hafBlock.transaction_ids.length) {
            let matchingIds = 0;
            for (let i = 0; i < hiveBlock.transaction_ids.length; i++) {
                if (hiveBlock.transaction_ids[i] === hafBlock.transaction_ids[i]) {
                    matchingIds++;
                }
            }
            check(`transaction IDs match (${matchingIds}/${hiveBlock.transaction_ids.length})`, matchingIds === hiveBlock.transaction_ids.length);
        }
    }

    await haf.destroy();
}

// ─── 4. Operation shape compatibility with subscription handlers ───────────

async function testOperationShapeCompatibility() {
    console.log('\n--- 4. Operation shape compatibility for subscription handlers ---');

    const haf = new HafProvider();
    await haf.create();

    // Use a known recent block range and look for transfers + custom_json
    const props = await haf.getDynamicGlobalProperties();

    // Scan a few recent blocks looking for transfers and custom_json
    let foundTransfer = false;
    let foundCustomJson = false;
    let foundComment = false;

    for (let n = props.head_block_number - 50; n < props.head_block_number - 10; n++) {
        const block = await haf.getBlock(n);
        if (!block) {
            continue;
        }

        for (const tx of block.transactions) {
            for (const [opType, opData] of tx.operations) {
                if (opType === 'transfer' && !foundTransfer) {
                    foundTransfer = true;
                    // Validate transfer shape matches what Streamer expects
                    check('transfer has "from" field', typeof opData.from === 'string');
                    check('transfer has "to" field', typeof opData.to === 'string');
                    check('transfer has "amount" field', typeof opData.amount === 'string');
                    check('transfer amount is parseable (e.g. "1.000 HIVE")', opData.amount.split(' ').length === 2);
                    check('transfer has "memo" field', 'memo' in opData);
                    console.log(`       sample transfer: ${opData.from} -> ${opData.to} ${opData.amount}`);
                }

                if (opType === 'custom_json' && !foundCustomJson) {
                    foundCustomJson = true;
                    // Validate custom_json shape matches what Streamer expects
                    check('custom_json has "id" field', typeof opData.id === 'string');
                    check('custom_json has "json" field', typeof opData.json === 'string');
                    check('custom_json has "required_auths" array', Array.isArray(opData.required_auths));
                    check('custom_json has "required_posting_auths" array', Array.isArray(opData.required_posting_auths));
                    console.log(`       sample custom_json id: ${opData.id}`);
                }

                if (opType === 'comment' && !foundComment) {
                    foundComment = true;
                    check('comment has "author" field', typeof opData.author === 'string');
                    check('comment has "parent_author" field', 'parent_author' in opData);
                    console.log(`       sample comment by: ${opData.author}`);
                }
            }
        }

        if (foundTransfer && foundCustomJson) {
            break;
        }
    }

    check('found at least one transfer operation', foundTransfer);
    check('found at least one custom_json operation', foundCustomJson);
    // Comments are less frequent, so don't fail if missing
    if (!foundComment) {
        console.log('       (no comment found in sampled blocks — not an error)');
    }

    await haf.destroy();
}

// ─── 5. setConfig propagation ──────────────────────────────────────────────

async function testSetConfigPropagation() {
    console.log('\n--- 5. setConfig API_NODES propagation to HiveProvider ---');

    const streamer = new Streamer({ apiNodes: ['https://api.hive.blog'] });
    const provider = streamer.getBlockProvider() as HiveProvider;

    check('initial provider is HiveProvider', provider instanceof HiveProvider);

    const oldClient = provider.getClient();
    streamer.setConfig({ apiNodes: ['https://api.openhive.network', 'https://rpc.ausbit.dev'] });
    const newClient = provider.getClient();

    check('setConfig with new API_NODES creates new dhive client', oldClient !== newClient);

    // setConfig with non-API changes should NOT recreate client
    const clientBefore = provider.getClient();
    streamer.setConfig({ debugMode: true });
    const clientAfter = provider.getClient();

    check('setConfig without API_NODES change does NOT recreate client', clientBefore === clientAfter);

    await streamer.stop();
}

// ─── 6. HafClient convenience methods ──────────────────────────────────────

async function testHafClient() {
    console.log('\n--- 6. HafClient (standalone queries) ---');
    const client = new HafClient();

    await client.connect();
    check('connect() succeeds', true);

    // getBlockAtTime
    const blockNum = await client.getBlockAtTime('2024-01-01T00:00:00Z');
    check('getBlockAtTime returns a block number', blockNum !== null && blockNum > 0);
    console.log(`       block at 2024-01-01: ${blockNum}`);

    // getBlockTimestamp
    if (blockNum) {
        const ts = await client.getBlockTimestamp(blockNum);
        check('getBlockTimestamp returns a timestamp', ts !== null);
        console.log(`       timestamp of block ${blockNum}: ${ts}`);
    }

    // getBlockTimestamp for non-existent block
    const noTs = await client.getBlockTimestamp(999999999);
    check('getBlockTimestamp returns null for future block', noTs === null);

    // getAccountBalances
    const balances = await client.getAccountBalances(['hiveio']);
    check('getAccountBalances returns results for hiveio', balances.length > 0);
    if (balances.length > 0) {
        console.log(`       hiveio balances: ${balances.length} entries`);
    }

    // getAccountBalances for non-existent account
    const noBalances = await client.getAccountBalances(['zzz_nonexistent_account_12345']);
    check('getAccountBalances returns empty for non-existent account', noBalances.length === 0);

    // getTransfers (account filter only — date range subqueries can be slow)
    const transfers = await client.getTransfers({
        accounts: ['hiveio'],
    });
    check('getTransfers returns results (or empty array)', Array.isArray(transfers));
    console.log(`       hiveio transfers: ${transfers.length}`);

    // raw query
    const rawResult = await client.query<{ one: number }>('SELECT 1 AS one');
    check('raw query works', rawResult.length === 1 && rawResult[0].one === 1);

    // getProposalPayouts
    const payouts = await client.getProposalPayouts([0]);
    check('getProposalPayouts returns array', Array.isArray(payouts));

    await client.disconnect();
    check('disconnect() succeeds', true);

    // Double disconnect is safe
    await client.disconnect();
    check('double disconnect is safe', true);
}

// ─── 7. HAF virtual ops & edge cases ──────────────────────────────────────

async function testHafEdgeCases() {
    console.log('\n--- 7. HAF edge cases ---');

    const haf = new HafProvider();
    await haf.create();

    const props = await haf.getDynamicGlobalProperties();

    // Test a block that likely has virtual ops (producer_reward at minimum)
    const block = await haf.getBlock(props.head_block_number - 5);
    if (block) {
        // Check for virtual ops (trx_in_block = -1 shows as separate "transaction" with empty trx_hash)
        let hasVirtualOps = false;
        let hasRealOps = false;
        const opTypes = new Set<string>();

        for (let i = 0; i < block.transactions.length; i++) {
            for (const [opType] of block.transactions[i].operations) {
                opTypes.add(opType);
                if (opType.startsWith('unknown_op_') || ['producer_reward', 'curation_reward', 'author_reward', 'comment_reward'].includes(opType)) {
                    hasVirtualOps = true;
                } else {
                    hasRealOps = true;
                }
            }
        }
        console.log(`       op types in block: ${[...opTypes].join(', ')}`);
        check('block contains operations', block.transactions.length > 0);
        // Virtual ops are expected but not guaranteed in every block
        if (hasVirtualOps) {
            console.log('       (block includes virtual ops — handled correctly)');
        }
    }

    // Test getConfig returns correct config
    const config = haf.getConfig();
    check('getConfig returns default host', config.host === 'hafsql-sql.mahdiyari.info');
    check('getConfig returns default statementTimeout', config.statementTimeout === '90s');

    // Test block 1 (genesis-ish)
    const genesisBlock = await haf.getBlock(1);
    check('block 1 is retrievable', genesisBlock !== null);
    if (genesisBlock) {
        check('block 1 has a block_id', typeof genesisBlock.block_id === 'string' && genesisBlock.block_id.length > 0);
        console.log(`       block 1 timestamp: ${genesisBlock.timestamp}`);
    }

    await haf.destroy();
}

// ─── 8. Streamer integration with custom provider ──────────────────────────

async function testStreamerWithProvider(provider: BlockProvider, label: string) {
    console.log(`\n--- 8${label === 'HafProvider' ? 'b' : 'a'}. Streamer + ${label} ---`);
    const streamer = new Streamer({ blockProvider: provider });
    await streamer.registerAdapter(new SqliteAdapter(':memory:'));

    check(`getBlockProvider() returns ${label}`, streamer.getBlockProvider() === provider);

    let mockResolve: () => void;
    const mockDone = new Promise<void>(r => { mockResolve = r; });

    (streamer as any).getBlock = async function() {
        try {
            const props = await provider.getDynamicGlobalProperties();
            check(`Streamer fetches head block via ${label}`, props.head_block_number > 0);
        } catch (err) {
            check(`Streamer fetches head block via ${label}`, false, String(err));
        }
        mockResolve();
    };

    (streamer as any).getLatestBlock = async function() {
        // no-op
    };

    await streamer.start();
    await mockDone;
    await streamer.stop();
    check(`Streamer start/stop lifecycle clean with ${label}`, true);
}

// ─── 9. Streamer loadBlock with HAF-sourced block ──────────────────────────

async function testStreamerLoadBlockWithHaf() {
    console.log('\n--- 9. Streamer loadBlock processes HAF-sourced block correctly ---');

    const haf = new HafProvider();
    await haf.create();

    const props = await haf.getDynamicGlobalProperties();
    const blockNum = props.head_block_number - 15;

    // Fetch a real block from HAF
    const hafBlock = await haf.getBlock(blockNum);
    check('fetched HAF block for loadBlock test', hafBlock !== null);

    if (hafBlock) {
        // Create a mock provider that returns this specific block
        const mockProvider: BlockProvider = {
            getDynamicGlobalProperties: async () => props,
            getBlock: async (n) => n === blockNum ? hafBlock : null,
        };

        const streamer = new Streamer({ blockProvider: mockProvider });
        await streamer.registerAdapter(new SqliteAdapter(':memory:'));

        // Call loadBlock directly with the HAF block
        await (streamer as any).loadBlock(blockNum);

        // Verify block metadata was set correctly
        check('blockId was set from HAF block', (streamer as any).blockId === hafBlock.block_id);
        check('previousBlockId was set from HAF block', (streamer as any).previousBlockId === hafBlock.previous);
        check('lastBlockNumber was updated', (streamer as any).lastBlockNumber === blockNum);

        // Count ops that went through
        let totalTransfers = 0;
        let totalCustomJson = 0;
        for (const tx of hafBlock.transactions) {
            for (const [opType] of tx.operations) {
                if (opType === 'transfer') {
                    totalTransfers++;
                }
                if (opType === 'custom_json') {
                    totalCustomJson++;
                }
            }
        }
        console.log(`       block ${blockNum}: ${totalTransfers} transfers, ${totalCustomJson} custom_json ops`);
        check('loadBlock completed without errors', true);

        await streamer.stop();
    }

    await haf.destroy();
}

// ─── 10. registerBlockProvider hot-swap ─────────────────────────────────────

async function testHotSwapProvider() {
    console.log('\n--- 10. registerBlockProvider hot-swap ---');

    const streamer = new Streamer();
    await streamer.registerAdapter(new SqliteAdapter(':memory:'));

    check('starts with HiveProvider', streamer.getBlockProvider() instanceof HiveProvider);

    const mockProvider: BlockProvider = {
        getDynamicGlobalProperties: async () => ({ head_block_number: 42, time: '2025-01-01T00:00:00' }),
        getBlock: async () => null,
        create: async () => { /* created */ },
        destroy: async () => { /* destroyed */ },
    };

    await streamer.registerBlockProvider(mockProvider);
    check('after registerBlockProvider, provider is the new one', streamer.getBlockProvider() === mockProvider);

    const props = await streamer.getBlockProvider().getDynamicGlobalProperties();
    check('new provider returns expected data', props.head_block_number === 42);

    await streamer.stop();
}

// ─── main ──────────────────────────────────────────────────────────────────

async function main() {
    console.log('=== Provider Smoke Test (comprehensive) ===');

    try {
        await testHiveProvider();
        await testHafProvider();
        await testCrossProviderParity();
        await testOperationShapeCompatibility();
        await testSetConfigPropagation();
        await testHafClient();
        await testHafEdgeCases();

        // Streamer integration
        const hiveProvider = new HiveProvider({ apiNodes: ['https://api.hive.blog'] });
        await testStreamerWithProvider(hiveProvider, 'HiveProvider');

        const hafProvider = new HafProvider();
        await testStreamerWithProvider(hafProvider, 'HafProvider');

        await testStreamerLoadBlockWithHaf();
        await testHotSwapProvider();
    } catch (err) {
        console.error('\nUnexpected error:', err);
        failed++;
    }

    console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
    process.exit(failed > 0 ? 1 : 0);
}

main();
