import { SqliteAdapter, Streamer, createBridgeContract } from '../../src';
import { makeContext } from '../helpers/contract-context';

describe('bridge contract', () => {
    let streamer: Streamer;
    let adapter: SqliteAdapter;
    let transfers: jest.SpyInstance;
    let contract: ReturnType<typeof createBridgeContract>;

    const setup = async (overrides: Partial<Parameters<typeof createBridgeContract>[0]> = {}) => {
        contract = createBridgeContract({
            custodyAccount: 'custody',
            operators: ['op1', 'op2', 'op3'],
            threshold: 2,
            chains: ['eth', 'base'],
            addressPattern: /^0x[0-9a-fA-F]{40}$/,
            feeBps: 50,
            minAmount: '1',
            maxPerTx: '1000',
            dailyLimit: '1500',
            accountDailyLimit: '1200',
            ...overrides
        });
        await streamer.registerContract(contract);
    };

    const address = '0x' + 'ab'.repeat(20);
    const at = (iso: string) => new Date(iso);

    const deposit = (sender: string, amount: string, payload: any = { chain: 'eth', address }, options: any = {}) =>
        contract.actions.deposit.handler(payload, makeContext(streamer, {
            sender, amount, to: 'custody', time: at('2026-03-01T10:00:00Z'), ...options
        }));

    const custom = (action: keyof typeof contract.actions, sender: string, payload: any, time = '2026-03-01T11:00:00Z') =>
        (contract.actions[action] as any).handler(payload, makeContext(streamer, { sender, time: at(time) }));

    const rows = (sql: string, params: any[] = []) => adapter.query(sql, params);

    beforeEach(async () => {
        streamer = new Streamer();
        adapter = new SqliteAdapter(':memory:');
        await streamer.registerAdapter(adapter);
        transfers = jest.spyOn(streamer, 'transferHiveTokens').mockResolvedValue(true as any);
    });

    afterEach(async () => {
        await streamer.stop();
        jest.restoreAllMocks();
    });

    test('validates options', () => {
        expect(() => createBridgeContract({ custodyAccount: '', operators: ['a'] })).toThrow('custodyAccount');
        expect(() => createBridgeContract({ custodyAccount: 'c', operators: [] })).toThrow('operator');
        expect(() => createBridgeContract({ custodyAccount: 'c', operators: ['a', 'b'], threshold: 3 })).toThrow('threshold');
        expect(() => createBridgeContract({ custodyAccount: 'c', operators: ['a'], feeBps: 5000 })).toThrow('feeBps');
        expect(createBridgeContract({ custodyAccount: 'c', operators: ['a', 'b', 'c'] }).name).toBe('bridge');
    });

    test('records a valid deposit with fees and mints at the attestation threshold', async () => {
        await setup();
        const ctx = makeContext(streamer, { sender: 'alice', amount: '100.000 HIVE', to: 'custody', time: at('2026-03-01T10:00:00Z') });
        await contract.actions.deposit.handler({ chain: 'eth', address }, ctx);

        const [record] = await rows('SELECT * FROM bridge_deposits');
        expect(record).toEqual(expect.objectContaining({
            deposit_id: ctx.transaction.id,
            status: 'pending',
            amount: '100.000',
            fee: '0.500',
            net_amount: '99.500',
            destination_chain: 'eth'
        }));

        await custom('attestDeposit', 'op1', { depositId: ctx.transaction.id, decision: 'minted', externalTxId: '0xabc' });
        expect((await rows('SELECT status FROM bridge_deposits'))[0].status).toBe('pending');

        // A different external tx id does not count toward the same decision.
        await custom('attestDeposit', 'op2', { depositId: ctx.transaction.id, decision: 'minted', externalTxId: '0xdef' });
        expect((await rows('SELECT status FROM bridge_deposits'))[0].status).toBe('pending');

        await custom('attestDeposit', 'op3', { depositId: ctx.transaction.id, decision: 'minted', externalTxId: '0xabc' });
        const [minted] = await rows('SELECT * FROM bridge_deposits');
        expect(minted.status).toBe('minted');
        expect(minted.external_tx_id).toBe('0xabc');
        expect(transfers).not.toHaveBeenCalled();

        await expect(custom('attestDeposit', 'op1', { depositId: ctx.transaction.id, decision: 'minted', externalTxId: '0xabc' }))
            .rejects.toThrow('is minted');
    });

    test('refunds invalid deposits instead of stranding them', async () => {
        await setup({ assets: ['HIVE'] });

        await deposit('alice', '10.000 HBD', { chain: 'eth', address }, { transactionId: 'dep-asset' });
        await deposit('alice', '10.000 HIVE', { chain: 'solana', address }, { transactionId: 'dep-chain' });
        await deposit('alice', '10.000 HIVE', { chain: 'eth', address: 'not-an-address' }, { transactionId: 'dep-address' });
        await deposit('alice', '10.000 HIVE', {}, { transactionId: 'dep-missing' });
        await deposit('alice', '0.500 HIVE', { chain: 'eth', address }, { transactionId: 'dep-small' });
        await deposit('alice', '1001.000 HIVE', { chain: 'eth', address }, { transactionId: 'dep-large' });

        const refunds = transfers.mock.calls.map((call) => [call[1], call[2], call[3], call[4]]);
        expect(refunds).toEqual([
            ['alice', '10.000', 'HBD', expect.stringContaining('Unsupported asset')],
            ['alice', '10.000', 'HIVE', expect.stringContaining('Unsupported chain solana')],
            ['alice', '10.000', 'HIVE', expect.stringContaining('Invalid destination address')],
            ['alice', '10.000', 'HIVE', expect.stringContaining('Unsupported chain (missing)')],
            ['alice', '0.500', 'HIVE', expect.stringContaining('Minimum deposit')],
            ['alice', '1001.000', 'HIVE', expect.stringContaining('Maximum deposit')]
        ]);
        transfers.mock.calls.forEach((call) => expect(call[0]).toBe('custody'));

        const statuses = await rows('SELECT DISTINCT status FROM bridge_deposits');
        expect(statuses).toEqual([{ status: 'refunded' }]);
    });

    test('enforces account and global daily limits over a rolling window', async () => {
        await setup();

        await deposit('alice', '1000.000 HIVE', undefined, { transactionId: 'a1' });
        await deposit('alice', '300.000 HIVE', undefined, { transactionId: 'a2' });
        expect(transfers.mock.calls[0][4]).toContain('Account daily deposit limit');

        await deposit('bob', '600.000 HIVE', undefined, { transactionId: 'b1' });
        expect(transfers.mock.calls[1][4]).toContain('Bridge daily deposit limit');

        await deposit('bob', '400.000 HIVE', undefined, { transactionId: 'b2' });
        expect(transfers).toHaveBeenCalledTimes(2);

        // 25 hours later the window has rolled over.
        await deposit('alice', '1000.000 HIVE', undefined, { transactionId: 'a3', time: at('2026-03-02T11:00:00Z') });
        expect(transfers).toHaveBeenCalledTimes(2);
    });

    test('ignores duplicate deposits and transfers to other accounts', async () => {
        await setup();

        await deposit('alice', '10.000 HIVE', undefined, { transactionId: 'dup' });
        await deposit('alice', '10.000 HIVE', undefined, { transactionId: 'dup' });
        expect(await rows('SELECT deposit_id FROM bridge_deposits')).toHaveLength(1);

        await expect(contract.actions.deposit.handler({ chain: 'eth', address }, makeContext(streamer, {
            sender: 'alice', amount: '10.000 HIVE', to: 'someone-else'
        }))).rejects.toThrow('must be sent to custody');
    });

    test('operators can refund a pending deposit at threshold', async () => {
        await setup();
        await deposit('alice', '50.000 HIVE', undefined, { transactionId: 'r1' });

        await custom('attestDeposit', 'op1', { depositId: 'r1', decision: 'refund' });
        await custom('attestDeposit', 'op2', { depositId: 'r1', decision: 'refund' });

        expect(transfers).toHaveBeenCalledWith('custody', 'alice', '50.000', 'HIVE', expect.stringContaining('Operators refunded'));
        expect((await rows('SELECT status FROM bridge_deposits'))[0].status).toBe('refunded');
    });

    test('rejects attestations from non-operators and duplicate votes', async () => {
        await setup();
        await deposit('alice', '50.000 HIVE', undefined, { transactionId: 'v1' });

        await expect(custom('attestDeposit', 'mallory', { depositId: 'v1', decision: 'refund' })).rejects.toThrow('not a bridge operator');
        await custom('attestDeposit', 'op1', { depositId: 'v1', decision: 'refund' });
        await expect(custom('attestDeposit', 'op1', { depositId: 'v1', decision: 'refund' })).rejects.toThrow('already attested');
        await expect(custom('attestDeposit', 'op1', { depositId: 'missing', decision: 'refund' })).rejects.toThrow('does not exist');
        await expect(custom('attestDeposit', 'op2', { depositId: 'v1', decision: 'minted' })).rejects.toThrow('externalTxId');
    });

    test('releases withdrawals at threshold, net of fees, exactly once', async () => {
        await setup();
        const withdrawal = { sourceChain: 'eth', sourceTxId: '0xburn1', recipient: 'alice', amount: '200.000', asset: 'HIVE' };

        await custom('requestWithdrawal', 'alice', { sourceChain: 'eth', sourceTxId: '0xburn1', amount: '200.000', asset: 'HIVE' });
        await expect(custom('requestWithdrawal', 'alice', { sourceChain: 'eth', sourceTxId: '0xburn1', amount: '200.000', asset: 'HIVE' }))
            .rejects.toThrow('already exists');

        await expect(custom('attestWithdrawal', 'op1', { ...withdrawal, amount: '250.000' })).rejects.toThrow('does not match');

        await custom('attestWithdrawal', 'op1', withdrawal);
        expect(transfers).not.toHaveBeenCalled();
        await custom('attestWithdrawal', 'op2', withdrawal);

        expect(transfers).toHaveBeenCalledTimes(1);
        expect(transfers).toHaveBeenCalledWith('custody', 'alice', '199.000', 'HIVE', '[Bridge] eth 0xburn1');

        const [record] = await rows('SELECT * FROM bridge_withdrawals');
        expect(record.status).toBe('released');
        expect(record.fee).toBe('1.000');

        await expect(custom('attestWithdrawal', 'op3', withdrawal)).rejects.toThrow('is released');
        expect(transfers).toHaveBeenCalledTimes(1);

        const audit = await rows('SELECT event FROM bridge_audit WHERE ref_id = ? ORDER BY id', ['eth:0xburn1']);
        expect(audit.map((row: any) => row.event)).toEqual([
            'withdrawal_requested',
            'withdrawal_attested',
            'withdrawal_attested',
            'withdrawal_released'
        ]);
    });

    test('operators can create withdrawals by attesting directly, or reject them', async () => {
        await setup();

        await custom('attestWithdrawal', 'op1', { sourceChain: 'base', sourceTxId: '0x1', recipient: 'bob', amount: '10.000', asset: 'HBD' });
        await custom('attestWithdrawal', 'op2', { sourceChain: 'base', sourceTxId: '0x1', recipient: 'bob', amount: '10.000', asset: 'HBD' });
        expect(transfers).toHaveBeenCalledWith('custody', 'bob', '9.950', 'HBD', expect.any(String));

        await custom('requestWithdrawal', 'eve', { sourceChain: 'eth', sourceTxId: '0xfake', amount: '500.000', asset: 'HIVE' });
        await custom('attestWithdrawal', 'op1', { sourceChain: 'eth', sourceTxId: '0xfake', recipient: 'eve', amount: '500.000', asset: 'HIVE', decision: 'reject' });
        await custom('attestWithdrawal', 'op3', { sourceChain: 'eth', sourceTxId: '0xfake', recipient: 'eve', amount: '500.000', asset: 'HIVE', decision: 'reject' });

        const [rejected] = await rows('SELECT status FROM bridge_withdrawals WHERE withdrawal_id = ?', ['eth:0xfake']);
        expect(rejected.status).toBe('rejected');
        expect(transfers).toHaveBeenCalledTimes(1);
    });

    test('pausing refunds deposits and queues releases until resumed', async () => {
        await setup();

        await expect(custom('setPaused', 'op1', { paused: true })).rejects.toThrow('cannot pause');
        await custom('setPaused', 'custody', { paused: true, reason: 'incident' });

        await deposit('alice', '10.000 HIVE', undefined, { transactionId: 'paused-dep' });
        expect(transfers.mock.calls[0][4]).toContain('Bridge is paused');

        const withdrawal = { sourceChain: 'eth', sourceTxId: '0xq', recipient: 'alice', amount: '20.000', asset: 'HIVE' };
        await custom('attestWithdrawal', 'op1', withdrawal);
        await custom('attestWithdrawal', 'op2', withdrawal);
        expect((await rows('SELECT status, status_reason FROM bridge_withdrawals'))[0]).toEqual({ status: 'queued', status_reason: 'paused' });

        // The scheduler does nothing while paused.
        await (contract.actions.processQueue as any).handler({}, makeContext(streamer, { sender: 'custody', trigger: 'time' }));
        expect(transfers).toHaveBeenCalledTimes(1);

        await custom('setPaused', 'custody', { paused: false });
        await (contract.actions.processQueue as any).handler({}, makeContext(streamer, { sender: 'custody', trigger: 'time', time: '2026-03-01T12:00:00Z' }));

        expect(transfers).toHaveBeenCalledTimes(2);
        expect(transfers.mock.calls[1]).toEqual(['custody', 'alice', '19.900', 'HIVE', '[Bridge] eth 0xq']);
    });

    test('queues withdrawals beyond the daily limit and marks failed broadcasts for reconciliation', async () => {
        await setup({ dailyLimit: '100' });
        const first = { sourceChain: 'eth', sourceTxId: '0xa', recipient: 'alice', amount: '80.000', asset: 'HIVE' };
        const second = { sourceChain: 'eth', sourceTxId: '0xb', recipient: 'bob', amount: '30.000', asset: 'HIVE' };

        await custom('attestWithdrawal', 'op1', first);
        await custom('attestWithdrawal', 'op2', first);
        await custom('attestWithdrawal', 'op1', second);
        await custom('attestWithdrawal', 'op2', second);

        expect(transfers).toHaveBeenCalledTimes(1);
        const [queued] = await rows('SELECT status, status_reason FROM bridge_withdrawals WHERE withdrawal_id = ?', ['eth:0xb']);
        expect(queued).toEqual({ status: 'queued', status_reason: 'daily_limit' });

        transfers.mockRejectedValueOnce(new Error('broadcast timeout'));
        await expect(custom('executeWithdrawal', 'op1', { sourceChain: 'eth', sourceTxId: '0xb' }, '2026-03-02T12:00:00Z'))
            .rejects.toThrow('broadcast timeout');

        const [failed] = await rows('SELECT status FROM bridge_withdrawals WHERE withdrawal_id = ?', ['eth:0xb']);
        expect(failed.status).toBe('release_failed');

        // Operators cannot blindly retry an ambiguous broadcast; an admin must.
        await expect(custom('executeWithdrawal', 'op1', { sourceChain: 'eth', sourceTxId: '0xb' }, '2026-03-02T12:00:00Z')).rejects.toThrow('Only an admin');
        await custom('executeWithdrawal', 'custody', { sourceChain: 'eth', sourceTxId: '0xb' }, '2026-03-02T12:00:00Z');

        const [released] = await rows('SELECT status FROM bridge_withdrawals WHERE withdrawal_id = ?', ['eth:0xb']);
        expect(released.status).toBe('released');
    });
});
