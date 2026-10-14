import BigNumber from '../bignumber';
import { z } from 'zod';
import { getLogger } from '../logger';
import { action, defineContract } from './contract';
import {
    amountSchema,
    assetSchema,
    blockTimeOf,
    createContractState,
    emitContractEvent,
    initializeTables,
    requireSender,
    requireTransferContext,
    toBigNumber
} from './helpers';
import { operationRecordId, type ContractContext } from '../types/hive-stream';

const DEFAULT_NAME = 'bridge';
const DEFAULT_ASSETS = ['HIVE', 'HBD'];
const DEFAULT_MIN_AMOUNT = '0.001';
const PRECISION = 3;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_FEE_BPS = 2000;

const chainSchema = z.string().min(2).max(32).regex(/^[a-z0-9_-]+$/, 'Invalid chain identifier');
const externalIdSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9:_.-]+$/, 'Invalid external identifier');
const accountSchema = z.string().min(3).max(16);

export interface BridgeContractOptions {
    name?: string;
    /** Hive account that holds bridged funds. Deposits must be sent here. */
    custodyAccount: string;
    /** Accounts allowed to attest deposits and withdrawals. */
    operators: string[];
    /** Attestations required to act (M of N). Defaults to a strict majority. */
    threshold?: number;
    /** Hive assets the bridge accepts. Defaults to HIVE and HBD. */
    assets?: string[];
    /** Allowed external chain identifiers. When omitted any well-formed id is accepted. */
    chains?: string[];
    /** Validates destination addresses, globally or per chain. */
    addressPattern?: RegExp | Record<string, RegExp>;
    /** Fee charged on both directions, in basis points (max 2000). */
    feeBps?: number;
    minAmount?: string;
    /** Largest single deposit or withdrawal. Larger withdrawals are rejected when requested or attested. */
    maxPerTx?: string;
    /** Rolling 24h cap per asset and direction across all users. */
    dailyLimit?: string;
    /** Rolling 24h cap on deposits per Hive account and asset. */
    accountDailyLimit?: string;
    /** Accounts allowed to pause/unpause and retry failed releases and refunds. Defaults to the custody account. */
    admins?: string[];
    /**
     * Publish the contract's decision on each deposit on-chain. When enabled,
     * the custody account broadcasts a custom_json (posting authority) as soon
     * as a deposit is accepted or refunded, so operators can act on the
     * contract's verdict instead of re-implementing its checks. Accepted
     * receipts include the rolling 24h totals used for the daily limits.
     * `true` uses the custom_json id `<contract name>-receipts`. Off by default.
     */
    receipts?: boolean | { id?: string };
}

/** Body of a deposit receipt broadcast when `receipts` is enabled. */
export interface BridgeDepositReceipt {
    type: 'deposit';
    contract: string;
    depositId: string;
    depositor: string;
    asset: string;
    amount: string;
    fee: string;
    netAmount: string;
    chain: string;
    address: string;
    status: 'accepted' | 'refunded';
    reason?: string;
    blockNumber: number;
    /** Accepted receipts: deposits of this asset in the 24h window ending at this block, including this one. */
    dailyTotal?: string;
    /** Accepted receipts: the depositor's share of dailyTotal. */
    accountDailyTotal?: string;
}

type DepositDecision = 'minted' | 'refund';
type WithdrawalDecision = 'release' | 'reject';

export function createBridgeContract(options: BridgeContractOptions) {
    if (!options || typeof options !== 'object') {
        throw new Error('Bridge contract options are required');
    }

    const name = options.name || DEFAULT_NAME;
    const custodyAccount = options.custodyAccount;
    const operators = [...new Set(options.operators || [])];
    const threshold = options.threshold ?? Math.floor(operators.length / 2) + 1;
    const assets = options.assets || DEFAULT_ASSETS;
    const chains = options.chains;
    const feeBps = options.feeBps ?? 0;
    const minAmount = toBigNumber(options.minAmount ?? DEFAULT_MIN_AMOUNT);
    const maxPerTx = options.maxPerTx !== undefined ? toBigNumber(options.maxPerTx) : null;
    const dailyLimit = options.dailyLimit !== undefined ? toBigNumber(options.dailyLimit) : null;
    const accountDailyLimit = options.accountDailyLimit !== undefined ? toBigNumber(options.accountDailyLimit) : null;
    const admins = options.admins && options.admins.length > 0 ? options.admins : [custodyAccount];
    const receiptId = options.receipts
        ? (typeof options.receipts === 'object' && options.receipts.id) || `${name}-receipts`
        : null;

    if (!custodyAccount) {
        throw new Error('Bridge contract requires a custodyAccount');
    }

    if (operators.length === 0) {
        throw new Error('Bridge contract requires at least one operator');
    }

    if (!Number.isInteger(threshold) || threshold < 1 || threshold > operators.length) {
        throw new Error(`Bridge threshold must be between 1 and ${operators.length}`);
    }

    if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > MAX_FEE_BPS) {
        throw new Error(`Bridge feeBps must be an integer between 0 and ${MAX_FEE_BPS}`);
    }

    const state = createContractState({ streamer: null as any });

    // Deliberately lenient: a malformed memo must still reach the handler so
    // the deposit is refunded instead of silently stranded in custody.
    const depositSchema = z.object({
        chain: z.string().max(64).optional(),
        address: z.string().max(256).optional()
    });

    const attestDepositSchema = z.object({
        depositId: externalIdSchema,
        decision: z.enum(['minted', 'refund']),
        externalTxId: externalIdSchema.optional()
    });

    const withdrawalRefSchema = z.object({
        sourceChain: chainSchema,
        sourceTxId: externalIdSchema
    });

    const requestWithdrawalSchema = withdrawalRefSchema.extend({
        amount: amountSchema,
        asset: assetSchema,
        recipient: accountSchema.optional()
    });

    const attestWithdrawalSchema = withdrawalRefSchema.extend({
        recipient: accountSchema,
        amount: amountSchema,
        asset: assetSchema,
        decision: z.enum(['release', 'reject']).optional()
    });

    const depositIdSchema = z.object({
        depositId: externalIdSchema
    });

    const setPausedSchema = z.object({
        paused: z.boolean(),
        reason: z.string().max(280).optional()
    });

    const initialize = async () => {
        await initializeTables(state.adapter, [
            `
                CREATE TABLE IF NOT EXISTS bridge_deposits (
                    deposit_id TEXT PRIMARY KEY,
                    sender TEXT NOT NULL,
                    asset TEXT NOT NULL,
                    amount TEXT NOT NULL,
                    fee TEXT NOT NULL,
                    net_amount TEXT NOT NULL,
                    destination_chain TEXT NOT NULL,
                    destination_address TEXT NOT NULL,
                    status TEXT NOT NULL,
                    status_reason TEXT,
                    external_tx_id TEXT,
                    block_number INTEGER NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
            `,
            `
                CREATE TABLE IF NOT EXISTS bridge_withdrawals (
                    withdrawal_id TEXT PRIMARY KEY,
                    source_chain TEXT NOT NULL,
                    source_tx_id TEXT NOT NULL,
                    recipient TEXT NOT NULL,
                    asset TEXT NOT NULL,
                    amount TEXT NOT NULL,
                    fee TEXT NOT NULL,
                    net_amount TEXT NOT NULL,
                    requested_by TEXT NOT NULL,
                    status TEXT NOT NULL,
                    status_reason TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    released_at TEXT
                )
            `,
            `
                CREATE TABLE IF NOT EXISTS bridge_attestations (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    ref_type TEXT NOT NULL,
                    ref_id TEXT NOT NULL,
                    operator TEXT NOT NULL,
                    decision TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    UNIQUE(ref_type, ref_id, operator)
                )
            `,
            `
                CREATE TABLE IF NOT EXISTS bridge_audit (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    ref_type TEXT NOT NULL,
                    ref_id TEXT NOT NULL,
                    event TEXT NOT NULL,
                    actor TEXT NOT NULL,
                    details TEXT NOT NULL,
                    block_number INTEGER NOT NULL,
                    transaction_id TEXT NOT NULL,
                    created_at TEXT NOT NULL
                )
            `,
            `
                CREATE TABLE IF NOT EXISTS bridge_settings (
                    setting_key TEXT PRIMARY KEY,
                    setting_value TEXT NOT NULL
                )
            `
        ]);
    };

    const nowOf = (ctx: ContractContext): Date => ctx.block?.time instanceof Date && !Number.isNaN(ctx.block.time.getTime())
        ? ctx.block.time
        : new Date();

    const audit = async (ctx: ContractContext, refType: string, refId: string, event: string, actor: string, details: Record<string, any>) => {
        await state.adapter.query(
            'INSERT INTO bridge_audit (ref_type, ref_id, event, actor, details, block_number, transaction_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [refType, refId, event, actor, JSON.stringify(details), ctx.block?.number ?? 0, ctx.transaction?.id ?? '', nowOf(ctx).toISOString()]
        );

        await emitContractEvent(state.adapter, name, event, { refType, refId }, {
            action: `bridge_${event}`,
            data: { refType, refId, actor, ...details }
        }, blockTimeOf(ctx));
    };

    const isPaused = async (): Promise<boolean> => {
        const rows = await state.adapter.query('SELECT setting_value FROM bridge_settings WHERE setting_key = ?', ['paused']);
        return rows.length > 0 && rows[0].setting_value === 'true';
    };

    const computeFee = (amount: BigNumber): { fee: BigNumber; net: BigNumber } => {
        // Round the fee down so users are never charged more than feeBps.
        const fee = amount.multipliedBy(feeBps).dividedBy(10000).decimalPlaces(PRECISION, BigNumber.ROUND_DOWN);
        return { fee, net: amount.minus(fee) };
    };

    const format = (value: BigNumber): string => value.toFixed(PRECISION, BigNumber.ROUND_DOWN);

    const sumRows = (rows: any[], column: string): BigNumber => rows.reduce(
        (sum: BigNumber, row: any) => sum.plus(row[column] || '0'),
        new BigNumber(0)
    );

    const depositedInWindow = async (asset: string, since: Date, excludeId: string, sender?: string): Promise<BigNumber> => {
        const params: any[] = [asset, since.toISOString(), 'refunded', 'refunding', 'refund_failed', excludeId];
        let sql = 'SELECT amount FROM bridge_deposits WHERE asset = ? AND created_at >= ? AND status NOT IN (?, ?, ?) AND deposit_id <> ?';

        if (sender) {
            sql += ' AND sender = ?';
            params.push(sender);
        }

        return sumRows(await state.adapter.query(sql, params), 'amount');
    };

    const releasedInWindow = async (asset: string, since: Date): Promise<BigNumber> => {
        const rows = await state.adapter.query(
            'SELECT amount FROM bridge_withdrawals WHERE asset = ? AND status IN (?, ?) AND released_at >= ?',
            [asset, 'released', 'releasing', since.toISOString()]
        );
        return sumRows(rows, 'amount');
    };

    const validateChain = (chain: string): string | null => {
        if (!chainSchema.safeParse(chain).success) {
            return 'invalid_chain';
        }

        if (chains && !chains.includes(chain)) {
            return 'unsupported_chain';
        }

        return null;
    };

    const validateAddress = (chain: string, address: string): boolean => {
        if (!address || address.trim() !== address) {
            return false;
        }

        const pattern = options.addressPattern instanceof RegExp
            ? options.addressPattern
            : options.addressPattern?.[chain];

        return pattern ? pattern.test(address) : address.length >= 3;
    };

    const transfer = async (to: string, amount: string, asset: string, memo: string) => {
        if (!state.streamer) {
            throw new Error('Bridge contract is not attached to a streamer');
        }

        await state.streamer.transferHiveTokens(custodyAccount, to, amount, asset, memo);
    };

    const requireOperator = (ctx: ContractContext): string => {
        const sender = requireSender(ctx);

        if (!operators.includes(sender)) {
            throw new Error(`${sender} is not a bridge operator`);
        }

        return sender;
    };

    const recordAttestation = async (refType: string, refId: string, operator: string, decision: string, ctx: ContractContext): Promise<number> => {
        const existing = await state.adapter.query(
            'SELECT decision FROM bridge_attestations WHERE ref_type = ? AND ref_id = ? AND operator = ?',
            [refType, refId, operator]
        );

        if (existing.length > 0) {
            throw new Error(`${operator} already attested ${refType} ${refId}`);
        }

        await state.adapter.query(
            'INSERT INTO bridge_attestations (ref_type, ref_id, operator, decision, created_at) VALUES (?, ?, ?, ?, ?)',
            [refType, refId, operator, decision, nowOf(ctx).toISOString()]
        );

        const matching = await state.adapter.query(
            'SELECT operator FROM bridge_attestations WHERE ref_type = ? AND ref_id = ? AND decision = ?',
            [refType, refId, decision]
        );

        // Count only current operators so a removed operator's vote never counts.
        return matching.filter((row: any) => operators.includes(row.operator)).length;
    };

    /**
     * Broadcasts a deposit receipt when receipts are enabled. A failed
     * broadcast is audited and logged but never undoes the deposit decision,
     * which is already recorded.
     */
    const publishReceipt = async (ctx: ContractContext, depositId: string, status: BridgeDepositReceipt['status'], reason?: string) => {
        if (!receiptId) {
            return;
        }

        const rows = await state.adapter.query('SELECT * FROM bridge_deposits WHERE deposit_id = ?', [depositId]);
        const record = rows[0];

        if (!record) {
            return;
        }

        const receipt: BridgeDepositReceipt = {
            type: 'deposit',
            contract: name,
            depositId,
            depositor: record.sender,
            asset: record.asset,
            amount: record.amount,
            fee: record.fee,
            netAmount: record.net_amount,
            chain: record.destination_chain,
            address: record.destination_address,
            status,
            blockNumber: ctx.block.number
        };

        if (reason) {
            receipt.reason = reason;
        }

        if (status === 'accepted') {
            const since = new Date(nowOf(ctx).getTime() - DAY_MS);
            receipt.dailyTotal = format(await depositedInWindow(record.asset, since, ''));
            receipt.accountDailyTotal = format(await depositedInWindow(record.asset, since, '', record.sender));
        }

        try {
            await state.streamer.broadcastOperations([[
                'custom_json',
                {
                    required_auths: [],
                    required_posting_auths: [custodyAccount],
                    id: receiptId,
                    json: JSON.stringify(receipt)
                }
            ]]);
            await audit(ctx, 'deposit', depositId, 'deposit_receipt_published', custodyAccount, { status, id: receiptId });
        } catch (error) {
            getLogger().warn(`[BridgeContract] Could not publish receipt for deposit ${depositId}`, error);
            await audit(ctx, 'deposit', depositId, 'deposit_receipt_failed', custodyAccount, {
                status,
                error: error instanceof Error ? error.message : String(error)
            });
        }
    };

    /**
     * Refunds a deposit. The row moves to 'refunding' before the transfer and
     * to 'refunded' after; a failed broadcast moves it to 'refund_failed',
     * which an admin can retry with retryRefund after reconciling it.
     */
    const refundDeposit = async (ctx: ContractContext, depositId: string, sender: string, amount: string, asset: string, reason: string) => {
        await state.adapter.query(
            'UPDATE bridge_deposits SET status = ?, status_reason = ?, updated_at = ? WHERE deposit_id = ?',
            ['refunding', reason, nowOf(ctx).toISOString(), depositId]
        );

        try {
            await transfer(sender, amount, asset, `[Bridge refund] ${reason} (${depositId})`);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            // status_reason keeps the refund reason so a retry can reuse it.
            await state.adapter.query(
                'UPDATE bridge_deposits SET status = ?, updated_at = ? WHERE deposit_id = ?',
                ['refund_failed', nowOf(ctx).toISOString(), depositId]
            );
            await audit(ctx, 'deposit', depositId, 'deposit_refund_failed', custodyAccount, { reason, amount, asset, to: sender, error: message });
            throw error;
        }

        await state.adapter.query(
            'UPDATE bridge_deposits SET status = ?, updated_at = ? WHERE deposit_id = ?',
            ['refunded', nowOf(ctx).toISOString(), depositId]
        );

        await audit(ctx, 'deposit', depositId, 'deposit_refunded', custodyAccount, { reason, amount, asset, to: sender });
        await publishReceipt(ctx, depositId, 'refunded', reason);
    };

    const deposit = async (payload: z.infer<typeof depositSchema>, ctx: ContractContext) => {
        const transferCtx = requireTransferContext(ctx);
        const sender = requireSender(ctx);

        if (transferCtx.to !== custodyAccount) {
            // Memo-wrapped transfers to other accounts also reach contracts; they are not deposits.
            throw new Error(`Bridge deposits must be sent to ${custodyAccount}`);
        }

        // One transaction can carry several transfers; key deposits per operation.
        const depositId = operationRecordId(ctx.transaction.id, ctx.transaction.operationIndex);
        const existing = await state.adapter.query('SELECT deposit_id FROM bridge_deposits WHERE deposit_id = ?', [depositId]);

        if (existing.length > 0) {
            getLogger().warn(`[BridgeContract] Duplicate deposit ${depositId} ignored`);
            return;
        }

        const amount = toBigNumber(transferCtx.amount);
        const asset = transferCtx.asset;
        const now = nowOf(ctx);
        const { fee, net } = computeFee(amount);

        await state.adapter.query(
            `INSERT INTO bridge_deposits (
                deposit_id, sender, asset, amount, fee, net_amount, destination_chain, destination_address,
                status, status_reason, external_tx_id, block_number, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                depositId, sender, asset, format(amount), format(fee), format(net),
                String(payload.chain ?? ''), String(payload.address ?? ''),
                'validating', null, null, ctx.block.number, now.toISOString(), now.toISOString()
            ]
        );

        await audit(ctx, 'deposit', depositId, 'deposit_received', sender, {
            amount: format(amount), asset, chain: payload.chain, address: payload.address
        });

        let rejection: string | null = null;
        const since = new Date(now.getTime() - DAY_MS);

        if (await isPaused()) {
            rejection = 'Bridge is paused';
        } else if (!assets.includes(asset)) {
            rejection = `Unsupported asset ${asset}`;
        } else if (validateChain(payload.chain ?? '')) {
            rejection = `Unsupported chain ${payload.chain ?? '(missing)'}`;
        } else if (!validateAddress(payload.chain ?? '', payload.address ?? '')) {
            rejection = 'Invalid destination address';
        } else if (amount.lt(minAmount)) {
            rejection = `Minimum deposit is ${format(minAmount)} ${asset}`;
        } else if (maxPerTx && amount.gt(maxPerTx)) {
            rejection = `Maximum deposit is ${format(maxPerTx)} ${asset}`;
        } else if (net.lte(0)) {
            rejection = 'Deposit does not cover the bridge fee';
        } else if (dailyLimit && (await depositedInWindow(asset, since, depositId)).plus(amount).gt(dailyLimit)) {
            rejection = 'Bridge daily deposit limit reached';
        } else if (accountDailyLimit && (await depositedInWindow(asset, since, depositId, sender)).plus(amount).gt(accountDailyLimit)) {
            rejection = 'Account daily deposit limit reached';
        }

        if (rejection) {
            await refundDeposit(ctx, depositId, sender, format(amount), asset, rejection);
            return;
        }

        await state.adapter.query(
            'UPDATE bridge_deposits SET status = ?, updated_at = ? WHERE deposit_id = ?',
            ['pending', now.toISOString(), depositId]
        );

        await audit(ctx, 'deposit', depositId, 'deposit_pending', sender, {
            amount: format(amount), fee: format(fee), netAmount: format(net), asset, chain: payload.chain, address: payload.address
        });

        await publishReceipt(ctx, depositId, 'accepted');
    };

    const attestDeposit = async (payload: z.infer<typeof attestDepositSchema>, ctx: ContractContext) => {
        const operator = requireOperator(ctx);
        const rows = await state.adapter.query('SELECT * FROM bridge_deposits WHERE deposit_id = ?', [payload.depositId]);

        if (rows.length === 0) {
            throw new Error(`Deposit ${payload.depositId} does not exist`);
        }

        const record = rows[0];

        if (record.status !== 'pending') {
            throw new Error(`Deposit ${payload.depositId} is ${record.status}`);
        }

        if (payload.decision === 'minted' && !payload.externalTxId) {
            throw new Error('externalTxId is required when attesting a mint');
        }

        // Operators must agree on the exact external transaction, not just "minted".
        const decisionKey = payload.decision === 'minted' ? `minted:${payload.externalTxId}` : 'refund';
        const count = await recordAttestation('deposit', payload.depositId, operator, decisionKey, ctx);

        await audit(ctx, 'deposit', payload.depositId, 'deposit_attested', operator, {
            decision: payload.decision as DepositDecision,
            externalTxId: payload.externalTxId ?? null,
            attestations: count,
            threshold
        });

        if (count < threshold) {
            return;
        }

        if (payload.decision === 'refund') {
            await refundDeposit(ctx, payload.depositId, record.sender, record.amount, record.asset, 'Operators refunded the deposit');
            return;
        }

        await state.adapter.query(
            'UPDATE bridge_deposits SET status = ?, external_tx_id = ?, updated_at = ? WHERE deposit_id = ?',
            ['minted', payload.externalTxId, nowOf(ctx).toISOString(), payload.depositId]
        );

        await audit(ctx, 'deposit', payload.depositId, 'deposit_minted', operator, {
            externalTxId: payload.externalTxId,
            netAmount: record.net_amount,
            asset: record.asset,
            chain: record.destination_chain,
            address: record.destination_address
        });
    };

    const withdrawalId = (sourceChain: string, sourceTxId: string) => `${sourceChain}:${sourceTxId}`;

    const insertWithdrawal = async (
        ctx: ContractContext,
        id: string,
        data: { sourceChain: string; sourceTxId: string; recipient: string; amount: BigNumber; asset: string; requestedBy: string }
    ) => {
        const { fee, net } = computeFee(data.amount);
        const now = nowOf(ctx).toISOString();

        await state.adapter.query(
            `INSERT INTO bridge_withdrawals (
                withdrawal_id, source_chain, source_tx_id, recipient, asset, amount, fee, net_amount,
                requested_by, status, status_reason, created_at, updated_at, released_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                id, data.sourceChain, data.sourceTxId, data.recipient, data.asset,
                format(data.amount), format(fee), format(net), data.requestedBy,
                'requested', null, now, now, null
            ]
        );

        await audit(ctx, 'withdrawal', id, 'withdrawal_requested', data.requestedBy, {
            recipient: data.recipient,
            amount: format(data.amount),
            fee: format(fee),
            netAmount: format(net),
            asset: data.asset
        });
    };

    const validateWithdrawalShape = (sourceChain: string, amount: BigNumber, asset: string) => {
        const chainError = validateChain(sourceChain);

        if (chainError) {
            throw new Error(`Unsupported chain ${sourceChain}`);
        }

        if (!assets.includes(asset)) {
            throw new Error(`Unsupported asset ${asset}`);
        }

        if (amount.lt(minAmount)) {
            throw new Error(`Minimum withdrawal is ${format(minAmount)} ${asset}`);
        }

        if (amount.decimalPlaces() > PRECISION) {
            throw new Error(`Amounts support at most ${PRECISION} decimal places`);
        }

        // A withdrawal that can never fit the limits would sit in the queue
        // forever (and block everything behind it), so refuse it up front.
        if (maxPerTx && amount.gt(maxPerTx)) {
            throw new Error(`Maximum withdrawal is ${format(maxPerTx)} ${asset}`);
        }

        if (dailyLimit && amount.gt(dailyLimit)) {
            throw new Error(`Withdrawal exceeds the daily limit of ${format(dailyLimit)} ${asset}`);
        }
    };

    const requestWithdrawal = async (payload: z.infer<typeof requestWithdrawalSchema>, ctx: ContractContext) => {
        const sender = requireSender(ctx);
        const id = withdrawalId(payload.sourceChain, payload.sourceTxId);
        const amount = toBigNumber(payload.amount);

        validateWithdrawalShape(payload.sourceChain, amount, payload.asset);

        const existing = await state.adapter.query('SELECT withdrawal_id FROM bridge_withdrawals WHERE withdrawal_id = ?', [id]);

        if (existing.length > 0) {
            throw new Error(`Withdrawal ${id} already exists`);
        }

        await insertWithdrawal(ctx, id, {
            sourceChain: payload.sourceChain,
            sourceTxId: payload.sourceTxId,
            recipient: payload.recipient || sender,
            amount,
            asset: payload.asset,
            requestedBy: sender
        });
    };

    const setWithdrawalStatus = async (ctx: ContractContext, id: string, status: string, reason: string | null, releasedAt: string | null = null) => {
        await state.adapter.query(
            'UPDATE bridge_withdrawals SET status = ?, status_reason = ?, updated_at = ?, released_at = COALESCE(?, released_at) WHERE withdrawal_id = ?',
            [status, reason, nowOf(ctx).toISOString(), releasedAt, id]
        );
    };

    /**
     * Releases an approved withdrawal. The row moves to 'releasing' before the
     * transfer is broadcast and to 'released' after, so a crash or broadcast
     * failure never results in an automatic second payment.
     */
    const releaseWithdrawal = async (ctx: ContractContext, record: any, actor: string): Promise<string> => {
        const id = record.withdrawal_id;
        const amount = toBigNumber(record.amount);

        if (await isPaused()) {
            await setWithdrawalStatus(ctx, id, 'queued', 'paused');
            await audit(ctx, 'withdrawal', id, 'withdrawal_queued', actor, { reason: 'paused' });
            return 'queued';
        }

        if (maxPerTx && amount.gt(maxPerTx)) {
            await setWithdrawalStatus(ctx, id, 'queued', 'exceeds_per_tx_limit');
            await audit(ctx, 'withdrawal', id, 'withdrawal_queued', actor, { reason: 'exceeds_per_tx_limit' });
            return 'queued';
        }

        const now = nowOf(ctx);

        if (dailyLimit && (await releasedInWindow(record.asset, new Date(now.getTime() - DAY_MS))).plus(amount).gt(dailyLimit)) {
            await setWithdrawalStatus(ctx, id, 'queued', 'daily_limit');
            await audit(ctx, 'withdrawal', id, 'withdrawal_queued', actor, { reason: 'daily_limit' });
            return 'queued';
        }

        await setWithdrawalStatus(ctx, id, 'releasing', null, now.toISOString());

        try {
            await transfer(record.recipient, record.net_amount, record.asset, `[Bridge] ${record.source_chain} ${record.source_tx_id}`);
        } catch (error) {
            await setWithdrawalStatus(ctx, id, 'release_failed', error instanceof Error ? error.message : String(error));
            await audit(ctx, 'withdrawal', id, 'withdrawal_release_failed', actor, {
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }

        await setWithdrawalStatus(ctx, id, 'released', null, now.toISOString());
        await audit(ctx, 'withdrawal', id, 'withdrawal_released', actor, {
            recipient: record.recipient,
            netAmount: record.net_amount,
            fee: record.fee,
            asset: record.asset
        });

        return 'released';
    };

    const replaceWithdrawalRequest = async (
        ctx: ContractContext,
        record: any,
        data: { recipient: string; amount: BigNumber; asset: string; requestedBy: string }
    ) => {
        const { fee, net } = computeFee(data.amount);

        await state.adapter.query(
            `UPDATE bridge_withdrawals SET recipient = ?, asset = ?, amount = ?, fee = ?, net_amount = ?, requested_by = ?, updated_at = ?
             WHERE withdrawal_id = ?`,
            [
                data.recipient, data.asset, format(data.amount), format(fee), format(net), data.requestedBy,
                nowOf(ctx).toISOString(), record.withdrawal_id
            ]
        );

        await audit(ctx, 'withdrawal', record.withdrawal_id, 'withdrawal_request_replaced', data.requestedBy, {
            previous: {
                recipient: record.recipient,
                amount: record.amount,
                asset: record.asset,
                requestedBy: record.requested_by
            },
            recipient: data.recipient,
            amount: format(data.amount),
            fee: format(fee),
            netAmount: format(net),
            asset: data.asset
        });
    };

    const attestWithdrawal = async (payload: z.infer<typeof attestWithdrawalSchema>, ctx: ContractContext) => {
        const operator = requireOperator(ctx);
        const id = withdrawalId(payload.sourceChain, payload.sourceTxId);
        const amount = toBigNumber(payload.amount);
        const decision: WithdrawalDecision = payload.decision ?? 'release';

        validateWithdrawalShape(payload.sourceChain, amount, payload.asset);

        let rows = await state.adapter.query('SELECT * FROM bridge_withdrawals WHERE withdrawal_id = ?', [id]);

        if (rows.length === 0) {
            if (decision === 'reject') {
                throw new Error(`Withdrawal ${id} does not exist`);
            }

            await insertWithdrawal(ctx, id, {
                sourceChain: payload.sourceChain,
                sourceTxId: payload.sourceTxId,
                recipient: payload.recipient,
                amount,
                asset: payload.asset,
                requestedBy: operator
            });
            rows = await state.adapter.query('SELECT * FROM bridge_withdrawals WHERE withdrawal_id = ?', [id]);
        }

        let record = rows[0];

        if (record.status !== 'requested') {
            throw new Error(`Withdrawal ${id} is ${record.status}`);
        }

        const mismatch = record.recipient !== payload.recipient ||
            record.asset !== payload.asset ||
            !toBigNumber(record.amount).eq(amount);

        if (decision === 'release' && mismatch) {
            const attestations = await state.adapter.query(
                'SELECT operator FROM bridge_attestations WHERE ref_type = ? AND ref_id = ?',
                ['withdrawal', id]
            );

            if (attestations.length > 0) {
                throw new Error(`Attestation does not match withdrawal ${id}`);
            }

            // Anyone can request a withdrawal, so an unattested request is only
            // a claim: the first operator attestation states what the source
            // chain actually shows and replaces it. This stops a front-running
            // request from fixing someone else's recipient or amount.
            await replaceWithdrawalRequest(ctx, record, {
                recipient: payload.recipient,
                amount,
                asset: payload.asset,
                requestedBy: operator
            });
            rows = await state.adapter.query('SELECT * FROM bridge_withdrawals WHERE withdrawal_id = ?', [id]);
            record = rows[0];
        }

        const count = await recordAttestation('withdrawal', id, operator, decision, ctx);

        await audit(ctx, 'withdrawal', id, 'withdrawal_attested', operator, { decision, attestations: count, threshold });

        if (count < threshold) {
            return;
        }

        if (decision === 'reject') {
            await setWithdrawalStatus(ctx, id, 'rejected', 'Rejected by operators');
            await audit(ctx, 'withdrawal', id, 'withdrawal_rejected', operator, {});
            return;
        }

        await releaseWithdrawal(ctx, record, operator);
    };

    const executeWithdrawal = async (payload: z.infer<typeof withdrawalRefSchema>, ctx: ContractContext) => {
        const sender = requireSender(ctx);

        if (!admins.includes(sender) && !operators.includes(sender)) {
            throw new Error(`${sender} cannot execute withdrawals`);
        }

        const id = withdrawalId(payload.sourceChain, payload.sourceTxId);
        const rows = await state.adapter.query('SELECT * FROM bridge_withdrawals WHERE withdrawal_id = ?', [id]);

        if (rows.length === 0) {
            throw new Error(`Withdrawal ${id} does not exist`);
        }

        const record = rows[0];

        if (record.status === 'release_failed' && !admins.includes(sender)) {
            throw new Error('Only an admin can retry a failed release after reconciling it');
        }

        if (record.status !== 'queued' && record.status !== 'release_failed') {
            throw new Error(`Withdrawal ${id} is ${record.status}`);
        }

        await releaseWithdrawal(ctx, record, sender);
    };

    const retryRefund = async (payload: z.infer<typeof depositIdSchema>, ctx: ContractContext) => {
        const sender = requireSender(ctx);

        if (!admins.includes(sender)) {
            throw new Error(`${sender} cannot retry refunds`);
        }

        const rows = await state.adapter.query('SELECT * FROM bridge_deposits WHERE deposit_id = ?', [payload.depositId]);

        if (rows.length === 0) {
            throw new Error(`Deposit ${payload.depositId} does not exist`);
        }

        const record = rows[0];

        if (record.status !== 'refund_failed') {
            throw new Error(`Deposit ${payload.depositId} is ${record.status}`);
        }

        await refundDeposit(ctx, record.deposit_id, record.sender, record.amount, record.asset, record.status_reason || 'Refund retried by admin');
    };

    const processQueue = async (_payload: Record<string, never>, ctx: ContractContext) => {
        if (await isPaused()) {
            return;
        }

        const queued = await state.adapter.query(
            'SELECT * FROM bridge_withdrawals WHERE status = ? AND status_reason IN (?, ?) ORDER BY created_at ASC',
            ['queued', 'paused', 'daily_limit']
        );

        for (const record of queued) {
            const result = await releaseWithdrawal(ctx, record, 'scheduler');

            if (result === 'queued') {
                // Limits are shared, so stop at the first withdrawal that no longer fits.
                break;
            }
        }
    };

    const setPaused = async (payload: z.infer<typeof setPausedSchema>, ctx: ContractContext) => {
        const sender = requireSender(ctx);

        if (!admins.includes(sender)) {
            throw new Error(`${sender} cannot pause the bridge`);
        }

        await state.adapter.query(
            `INSERT INTO bridge_settings (setting_key, setting_value) VALUES (?, ?)
             ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value`,
            ['paused', payload.paused ? 'true' : 'false']
        );

        await audit(ctx, 'bridge', name, payload.paused ? 'bridge_paused' : 'bridge_resumed', sender, {
            reason: payload.reason ?? null
        });
    };

    return defineContract({
        name,
        hooks: {
            create: async ({ adapter, streamer }) => {
                state.adapter = adapter;
                state.streamer = streamer;
                await initialize();
            }
        },
        actions: {
            deposit: action(deposit, {
                schema: depositSchema,
                trigger: 'transfer',
                description: 'Deposit HIVE/HBD to the custody account with the destination chain and address; invalid deposits are refunded automatically.'
            }),
            attestDeposit: action(attestDeposit, {
                schema: attestDepositSchema,
                trigger: 'custom_json',
                requiresActiveKey: true,
                guards: { allowedSenders: operators },
                description: 'Operator attestation that a deposit was minted on the destination chain (or should be refunded). Acts at the M-of-N threshold.'
            }),
            requestWithdrawal: action(requestWithdrawal, {
                schema: requestWithdrawalSchema,
                trigger: 'custom_json',
                guards: { rateLimit: { max: 20, windowSeconds: 3600 } },
                description: 'Register a withdrawal back to Hive for funds locked or burned on another chain. Until an operator attests it, the request is only a claim: the first operator attestation replaces a mismatched recipient, amount or asset.'
            }),
            attestWithdrawal: action(attestWithdrawal, {
                schema: attestWithdrawalSchema,
                trigger: 'custom_json',
                requiresActiveKey: true,
                guards: { allowedSenders: operators },
                description: 'Operator attestation that a withdrawal is valid (release) or invalid (reject). Releases at the M-of-N threshold within limits.'
            }),
            executeWithdrawal: action(executeWithdrawal, {
                schema: withdrawalRefSchema,
                trigger: 'custom_json',
                requiresActiveKey: true,
                guards: { allowedSenders: [...new Set([...admins, ...operators])] },
                description: 'Retry a queued withdrawal, or (admins only) a failed release after manual reconciliation.'
            }),
            retryRefund: action(retryRefund, {
                schema: depositIdSchema,
                trigger: 'custom_json',
                requiresActiveKey: true,
                guards: { allowedSenders: admins },
                description: 'Admin-only: re-send a deposit refund whose broadcast failed, after reconciling it.'
            }),
            processQueue: action(processQueue, {
                schema: z.object({}),
                trigger: 'time',
                description: 'Scheduled release of withdrawals queued by a pause or the daily limit.'
            }),
            setPaused: action(setPaused, {
                schema: setPausedSchema,
                trigger: 'custom_json',
                requiresActiveKey: true,
                guards: { allowedSenders: admins },
                description: 'Pause or resume the bridge (admins only). Paused deposits are refunded and releases are queued.'
            })
        }
    });
}
