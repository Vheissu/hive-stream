import { PrivateKey } from '@hiveio/dhive';
import { createBridgeContract, createLimboContract, createTournamentContract } from '../../src';
import { verifyOutcome } from '../../src/client';
import { createTestStreamer, TestStreamer } from '../../src/testing';

const ACTIVE_KEY = PrivateKey.fromSeed('hive-stream new contracts').toString();

/**
 * Drives the new contracts through the real streamer pipeline (memo/custom
 * JSON parsing, schema validation, guards, dispatch) with the testing kit.
 */
describe('new contracts through the streamer', () => {
    let ts: TestStreamer;

    afterEach(async () => {
        await ts?.stop();
    });

    test('bridge deposit, operator attestations and a guarded release', async () => {
        ts = await createTestStreamer({ username: 'custody', activeKey: ACTIVE_KEY });
        await ts.streamer.registerContract(createBridgeContract({
            custodyAccount: 'custody',
            operators: ['op1', 'op2', 'op3'],
            threshold: 2,
            chains: ['eth'],
            feeBps: 100
        }));

        const { transactionId } = await ts.contractTransfer({
            from: 'alice',
            amount: '50.000 HIVE',
            contract: 'bridge',
            action: 'deposit',
            payload: { chain: 'eth', address: '0xabc123' }
        });

        const [deposit] = await ts.adapter.query('SELECT deposit_id, status, net_amount FROM bridge_deposits');
        expect(deposit).toEqual({ deposit_id: transactionId, status: 'pending', net_amount: '49.500' });

        // Non-operators are stopped by the declarative guard before the handler runs.
        await ts.contractJson('mallory', {
            contract: 'bridge',
            action: 'attestWithdrawal',
            payload: { sourceChain: 'eth', sourceTxId: '0xburn', recipient: 'mallory', amount: '10.000', asset: 'HIVE' },
            activeKey: true
        });
        expect(await ts.adapter.query('SELECT * FROM bridge_withdrawals')).toEqual([]);

        const release = { sourceChain: 'eth', sourceTxId: '0xburn', recipient: 'bob', amount: '10.000', asset: 'HIVE' };
        await ts.contractJson('op1', { contract: 'bridge', action: 'attestWithdrawal', payload: release, activeKey: true });
        await ts.contractJson('op2', { contract: 'bridge', action: 'attestWithdrawal', payload: release, activeKey: true });

        expect(ts.outgoingTransfers).toEqual([
            expect.objectContaining({ from: 'custody', to: 'bob', amount: '9.900 HIVE' })
        ]);
    });

    test('a malformed deposit memo is refunded instead of stranded', async () => {
        ts = await createTestStreamer({ username: 'custody', activeKey: ACTIVE_KEY });
        await ts.streamer.registerContract(createBridgeContract({ custodyAccount: 'custody', operators: ['op1'] }));

        await ts.contractTransfer({ from: 'alice', amount: '5.000 HBD', contract: 'bridge', action: 'deposit', payload: {} });

        expect(ts.outgoingTransfers).toEqual([
            expect.objectContaining({ from: 'custody', to: 'alice', amount: '5.000 HBD' })
        ]);
    });

    test('bridge publishes deposit receipts on-chain when enabled', async () => {
        ts = await createTestStreamer({ username: 'custody', activeKey: ACTIVE_KEY });
        await ts.streamer.registerContract(createBridgeContract({
            custodyAccount: 'custody',
            operators: ['op1'],
            chains: ['eth'],
            feeBps: 100,
            dailyLimit: '1000.000',
            receipts: true
        }));

        const accepted = await ts.contractTransfer({ from: 'alice', amount: '50.000 HIVE', contract: 'bridge', action: 'deposit', payload: { chain: 'eth', address: '0xabc123' } });
        await ts.contractTransfer({ from: 'alice', amount: '20.000 HIVE', contract: 'bridge', action: 'deposit', payload: { chain: 'eth', address: '0xabc123' } });
        await ts.contractTransfer({ from: 'bob', amount: '5.000 HIVE', contract: 'bridge', action: 'deposit', payload: { chain: 'sol', address: 'abc' } });

        const receipts = ts.client.operations
            .flat()
            .filter(([type, op]: [string, any]) => type === 'custom_json' && op.id === 'bridge-receipts')
            .map(([, op]: [string, any]) => ({ auths: op.required_posting_auths, body: JSON.parse(op.json) }));

        expect(receipts).toHaveLength(3);
        expect(receipts.every((receipt: any) => receipt.auths[0] === 'custody')).toBe(true);
        expect(receipts[0].body).toEqual(expect.objectContaining({
            type: 'deposit',
            depositId: accepted.transactionId,
            depositor: 'alice',
            amount: '50.000',
            fee: '0.500',
            netAmount: '49.500',
            chain: 'eth',
            address: '0xabc123',
            status: 'accepted',
            dailyTotal: '50.000',
            accountDailyTotal: '50.000'
        }));
        expect(receipts[1].body).toEqual(expect.objectContaining({ status: 'accepted', dailyTotal: '70.000', accountDailyTotal: '70.000' }));
        expect(receipts[2].body).toEqual(expect.objectContaining({ depositor: 'bob', status: 'refunded', reason: 'Unsupported chain sol' }));
        expect(receipts[2].body.dailyTotal).toBeUndefined();
    });

    test('bridge receipts are off by default', async () => {
        ts = await createTestStreamer({ username: 'custody', activeKey: ACTIVE_KEY });
        await ts.streamer.registerContract(createBridgeContract({ custodyAccount: 'custody', operators: ['op1'] }));

        await ts.contractTransfer({ from: 'alice', amount: '5.000 HIVE', contract: 'bridge', action: 'deposit', payload: { chain: 'eth', address: '0xabc123' } });

        expect(ts.client.operations.flat().filter(([type]: [string, any]) => type === 'custom_json')).toEqual([]);
    });

    test('limbo bets settle on-chain and verify after the seed is rotated', async () => {
        ts = await createTestStreamer({ username: 'house', activeKey: ACTIVE_KEY });
        ts.client.setAccount('house', { balance: '100000.000 HIVE' });
        await ts.streamer.registerContract(createLimboContract({ account: 'house', notifyLosses: true }));

        for (let i = 0; i < 5; i++) {
            await ts.contractTransfer({ from: 'alice', amount: '2.000 HIVE', contract: 'limbo', action: 'bet', payload: { target: '1.5' } });
        }

        const results = (await ts.getEvents())
            .filter((event: any) => event.action === 'bet')
            .map((event: any) => (typeof event.data === 'string' ? JSON.parse(event.data) : event.data))
            .filter((data: any) => data.action === 'limbo_result')
            .map((data: any) => data.data);

        expect(results).toHaveLength(5);
        expect(ts.outgoingTransfers).toHaveLength(5);

        await ts.contractJson('house', { contract: 'limbo', action: 'rotateSeed', payload: {}, activeKey: true });
        const rotation = (await ts.getEvents())
            .map((event: any) => (typeof event.data === 'string' ? JSON.parse(event.data) : event.data))
            .find((data: any) => data.action === 'fairness_seed_rotated').data;

        for (const result of results) {
            const check = verifyOutcome(
                { ...result.fairness, serverSeed: rotation.revealed.serverSeed },
                result.outcomeSpec,
                { multiplierCents: Math.round(Number(result.result) * 100), multiplier: result.result }
            );
            expect(check.valid).toBe(true);
            expect(result.fairness.entropy).toMatch(/^[0-9a-f]+$/);
        }
    });

    test('tournament entries and prizes flow through transfers and custom JSON', async () => {
        ts = await createTestStreamer({ username: 'host', activeKey: ACTIVE_KEY, startTime: new Date('2026-05-01T00:00:00Z') });
        await ts.streamer.registerContract(createTournamentContract({ account: 'host' }));

        await ts.contractJson('organizer', {
            contract: 'tournaments',
            action: 'createTournament',
            payload: {
                tournamentId: 'weekly',
                title: 'Weekly',
                asset: 'HIVE',
                entryFee: '1.000',
                registrationClosesAt: '2026-05-01T01:00:00Z',
                prizeSplitBps: [10000],
                oracle: 'oracle'
            }
        });

        await ts.contractTransfer({ from: 'alice', amount: '1.000 HIVE', contract: 'tournaments', action: 'enter', payload: { tournamentId: 'weekly' } });
        await ts.contractTransfer({ from: 'bob', amount: '1.000 HIVE', contract: 'tournaments', action: 'enter', payload: { tournamentId: 'weekly' } });
        await ts.advanceTime('2h');

        await ts.contractJson('oracle', {
            contract: 'tournaments',
            action: 'submitScores',
            payload: { tournamentId: 'weekly', scores: [{ player: 'alice', score: 10 }, { player: 'bob', score: 12 }] },
            activeKey: true
        });
        await ts.contractJson('oracle', { contract: 'tournaments', action: 'finalize', payload: { tournamentId: 'weekly' }, activeKey: true });

        expect(ts.outgoingTransfers).toEqual([
            expect.objectContaining({ from: 'host', to: 'bob', amount: '2.000 HIVE' })
        ]);
    });
});
