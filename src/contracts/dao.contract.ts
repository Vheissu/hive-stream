import BigNumber from '../bignumber';
import { z } from 'zod';
import { getLogger } from '../logger';
import { Utils } from '../utils';
import { validateHiveAccountName } from '../validation/hive-account';
import { action, defineContract } from './contract';
import {
    amountSchema,
    assetSchema,
    blockTimeOf,
    createContractState,
    emitContractEvent,
    identifierSchema,
    initializeTables,
    parseDateValue,
    requireSender,
    requireTransferContext,
    resolveContractAccount,
    toBigNumber
} from './helpers';
import { operationRecordId, type ContractContext } from '../types/hive-stream';

const DEFAULT_NAME = 'dao';
const SUPPORTED_ASSETS = ['HIVE', 'HBD'];
const PRECISION = 3;
const HOUR_MS = 60 * 60 * 1000;
const MAX_HOURS = 24 * 365;
const MAX_PAYOUTS = 20;
const MAX_MEMO = 2000;

export type DaoVotingPower = 'hive-power' | 'engine-token' | 'equal';

export interface DaoContractOptions {
    name?: string;
    /**
     * Treasury account: receives deposits and proposal deposits and sends
     * payouts. Defaults to the streamer username.
     */
    account?: string;
    /**
     * How votes are weighted, snapshotted when the vote is cast:
     * 'hive-power' (the voter's own Hive Power; delegations in or out are
     * ignored), 'engine-token' (the voter's staked `tokenSymbol`) or 'equal'
     * (one per account). Defaults to 'hive-power'.
     */
    votingPower?: 'hive-power' | 'engine-token' | 'equal';
    /** Hive Engine token whose stake weights votes. Required for 'engine-token'. */
    tokenSymbol?: string;
    /**
     * Deposit a proposer sends with createProposal, in `depositAsset`.
     * Refunded when the proposal reaches quorum and kept by the treasury
     * otherwise (spam protection). Defaults to '1.000'.
     */
    proposalDeposit?: string;
    /** Asset of the proposal deposit. Defaults to 'HIVE'. */
    depositAsset?: string;
    /** How long a proposal is open for voting. Defaults to 72. */
    votingPeriodHours?: number;
    /** Delay between a proposal passing and its payouts, during which admins can veto. Defaults to 24. */
    timelockHours?: number;
    /**
     * Absolute quorum: the voting weight (for + against) a proposal needs,
     * in HP for 'hive-power', tokens for 'engine-token' and voters for
     * 'equal'. Total Hive Power can't be summed per app, so quorum is an
     * amount, not a share of supply. Defaults to '1000'.
     */
    quorum?: string;
    /**
     * Share of the votes cast that must support a proposal, in basis points;
     * a proposal passes when its support is strictly above it (1-9999).
     * Defaults to 5000 (simple majority).
     */
    passThresholdBps?: number;
    /** Accounts that can veto during the timelock and change parameters. Defaults to the treasury account. */
    admins?: string[];
    /** Assets the treasury accepts and pays out. Defaults to ['HIVE', 'HBD']. */
    allowedAssets?: string[];
}

interface DaoParams {
    quorum: string;
    passThresholdBps: number;
    votingPeriodHours: number;
    timelockHours: number;
    proposalDeposit: string;
}

const accountSchema = z.string().min(3).max(16).refine((value) => validateHiveAccountName(value) === null, 'Invalid Hive account');

const payoutSchema = z.object({
    to: accountSchema,
    amount: amountSchema,
    asset: assetSchema,
    memo: z.string().max(500).optional()
});

const proposalSchema = z.object({
    proposalId: identifierSchema,
    title: z.string().min(3).max(140),
    description: z.string().max(5000).optional(),
    payouts: z.array(payoutSchema).max(MAX_PAYOUTS).optional(),
    expiresAt: z.string().max(40).optional()
});

const format = (value: BigNumber): string => value.toFixed(PRECISION, BigNumber.ROUND_DOWN);

function sum(values: Array<string | BigNumber>): BigNumber {
    return values.reduce<BigNumber>((total, value) => total.plus(value), new BigNumber(0));
}

function validateParams(params: DaoParams, label: string): void {
    if (!amountSchema.safeParse(params.quorum).success) {
        throw new Error(`${label}: quorum must be a non-negative amount string`);
    }

    if (!Number.isInteger(params.passThresholdBps) || params.passThresholdBps < 1 || params.passThresholdBps > 9999) {
        throw new Error(`${label}: passThresholdBps must be an integer between 1 and 9999`);
    }

    if (!Number.isFinite(params.votingPeriodHours) || params.votingPeriodHours <= 0 || params.votingPeriodHours > MAX_HOURS) {
        throw new Error(`${label}: votingPeriodHours must be greater than 0 and at most ${MAX_HOURS}`);
    }

    if (!Number.isFinite(params.timelockHours) || params.timelockHours < 0 || params.timelockHours > MAX_HOURS) {
        throw new Error(`${label}: timelockHours must be between 0 and ${MAX_HOURS}`);
    }

    if (!amountSchema.safeParse(params.proposalDeposit).success || toBigNumber(params.proposalDeposit).lt('0.001')
        || toBigNumber(params.proposalDeposit).decimalPlaces()! > PRECISION) {
        throw new Error(`${label}: proposalDeposit must be an amount of at least 0.001 with up to ${PRECISION} decimals`);
    }
}

export function createDaoContract(options: DaoContractOptions = {}) {
    const name = options.name || DEFAULT_NAME;
    const votingPower: DaoVotingPower = options.votingPower ?? 'hive-power';
    const tokenSymbol = options.tokenSymbol;
    const depositAsset = options.depositAsset ?? 'HIVE';
    const allowedAssets = options.allowedAssets ?? [...SUPPORTED_ASSETS];
    const defaults: DaoParams = {
        quorum: options.quorum ?? '1000',
        passThresholdBps: options.passThresholdBps ?? 5000,
        votingPeriodHours: options.votingPeriodHours ?? 72,
        timelockHours: options.timelockHours ?? 24,
        proposalDeposit: options.proposalDeposit ?? '1.000'
    };

    if (!['hive-power', 'engine-token', 'equal'].includes(votingPower)) {
        throw new Error(`createDaoContract: unknown votingPower '${votingPower}'`);
    }

    if (votingPower === 'engine-token' && !tokenSymbol) {
        throw new Error('createDaoContract: votingPower \'engine-token\' requires tokenSymbol');
    }

    if (!SUPPORTED_ASSETS.includes(depositAsset)) {
        throw new Error(`createDaoContract: depositAsset must be one of ${SUPPORTED_ASSETS.join(', ')}`);
    }

    if (allowedAssets.length === 0 || allowedAssets.some((asset) => !SUPPORTED_ASSETS.includes(asset))) {
        throw new Error(`createDaoContract: allowedAssets must be a non-empty subset of ${SUPPORTED_ASSETS.join(', ')}`);
    }

    validateParams(defaults, 'createDaoContract');

    const state = createContractState({ streamer: null as any, account: '', admins: [] as string[] });

    // Transfer actions are deliberately lenient: a malformed memo must still
    // reach the handler so the transfer is refunded instead of stranded.
    const depositSchema = z.object({});

    const createProposalSchema = z.object({
        proposalId: z.unknown().optional(),
        title: z.unknown().optional(),
        description: z.unknown().optional(),
        payouts: z.unknown().optional(),
        expiresAt: z.unknown().optional()
    });

    const voteSchema = z.object({
        proposalId: identifierSchema,
        support: z.boolean()
    });

    const sweepSchema = z.object({
        proposalId: identifierSchema.optional()
    });

    const proposalIdSchema = z.object({
        proposalId: identifierSchema
    });

    const vetoSchema = z.object({
        proposalId: identifierSchema,
        reason: z.string().max(280).optional()
    });

    const setParamsSchema = z.object({
        quorum: amountSchema.optional(),
        passThresholdBps: z.number().int().optional(),
        votingPeriodHours: z.number().optional(),
        timelockHours: z.number().optional(),
        proposalDeposit: amountSchema.optional()
    });

    const initialize = async () => {
        await initializeTables(state.adapter, [
            `
                CREATE TABLE IF NOT EXISTS dao_proposals (
                    proposal_id TEXT PRIMARY KEY,
                    proposer TEXT NOT NULL,
                    title TEXT NOT NULL,
                    description TEXT NOT NULL,
                    status TEXT NOT NULL,
                    status_reason TEXT,
                    deposit_amount TEXT NOT NULL,
                    deposit_asset TEXT NOT NULL,
                    deposit_status TEXT NOT NULL,
                    quorum TEXT NOT NULL,
                    pass_threshold_bps INTEGER NOT NULL,
                    timelock_hours REAL NOT NULL,
                    voting_ends_at TEXT NOT NULL,
                    executable_at TEXT,
                    expires_at TEXT,
                    for_weight TEXT NOT NULL,
                    against_weight TEXT NOT NULL,
                    voter_count INTEGER NOT NULL,
                    created_op TEXT NOT NULL,
                    created_block INTEGER NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    tallied_at TEXT,
                    executed_at TEXT
                )
            `,
            `
                CREATE TABLE IF NOT EXISTS dao_votes (
                    proposal_id TEXT NOT NULL,
                    voter TEXT NOT NULL,
                    support INTEGER NOT NULL,
                    weight TEXT NOT NULL,
                    op_id TEXT NOT NULL,
                    block_number INTEGER NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY (proposal_id, voter)
                )
            `,
            `
                CREATE TABLE IF NOT EXISTS dao_payouts (
                    proposal_id TEXT NOT NULL,
                    payout_index INTEGER NOT NULL,
                    recipient TEXT NOT NULL,
                    amount TEXT NOT NULL,
                    asset TEXT NOT NULL,
                    memo TEXT NOT NULL,
                    status TEXT NOT NULL,
                    attempts INTEGER NOT NULL,
                    last_error TEXT,
                    paid_at TEXT,
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY (proposal_id, payout_index)
                )
            `,
            `
                CREATE TABLE IF NOT EXISTS dao_ledger (
                    entry_id TEXT PRIMARY KEY,
                    kind TEXT NOT NULL,
                    direction TEXT NOT NULL,
                    account TEXT NOT NULL,
                    asset TEXT NOT NULL,
                    amount TEXT NOT NULL,
                    proposal_id TEXT,
                    block_number INTEGER NOT NULL,
                    transaction_id TEXT NOT NULL,
                    created_at TEXT NOT NULL
                )
            `,
            `
                CREATE TABLE IF NOT EXISTS dao_settings (
                    setting_key TEXT PRIMARY KEY,
                    setting_value TEXT NOT NULL
                )
            `
        ]);
    };

    const now = (ctx: ContractContext): Date => blockTimeOf(ctx);
    const iso = (ctx: ContractContext): string => now(ctx).toISOString();

    const emit = async (ctx: ContractContext, actionName: string, event: string, data: Record<string, any>) => {
        await emitContractEvent(state.adapter, name, actionName, data, {
            action: `dao_${event}`,
            data
        }, now(ctx));
    };

    const getParams = async (): Promise<DaoParams> => {
        const rows = await state.adapter.query('SELECT setting_value FROM dao_settings WHERE setting_key = ?', ['params']);

        if (rows.length === 0) {
            return { ...defaults };
        }

        return { ...defaults, ...JSON.parse(rows[0].setting_value) };
    };

    const getProposal = async (proposalId: string): Promise<any | null> => {
        const rows = await state.adapter.query('SELECT * FROM dao_proposals WHERE proposal_id = ?', [proposalId]);
        return rows[0] ?? null;
    };

    const ledgerEntryExists = async (entryId: string): Promise<boolean> => {
        const rows = await state.adapter.query('SELECT entry_id FROM dao_ledger WHERE entry_id = ?', [entryId]);
        return rows.length > 0;
    };

    const addLedgerEntry = async (
        ctx: ContractContext,
        entry: { entryId: string; kind: string; direction: 'in' | 'out' | 'none'; account: string; asset: string; amount: string; proposalId?: string | null }
    ) => {
        await state.adapter.query(
            `INSERT INTO dao_ledger (
                entry_id, kind, direction, account, asset, amount, proposal_id, block_number, transaction_id, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                entry.entryId, entry.kind, entry.direction, entry.account, entry.asset, entry.amount,
                entry.proposalId ?? null, ctx.block?.number ?? 0, ctx.transaction?.id ?? '', iso(ctx)
            ]
        );
    };

    /** Treasury balance in `asset`, derived from the ledger rather than the chain. */
    const treasuryBalance = async (asset: string): Promise<BigNumber> => {
        const rows = await state.adapter.query(
            'SELECT direction, amount FROM dao_ledger WHERE asset = ? AND direction IN (?, ?)',
            [asset, 'in', 'out']
        );

        return rows.reduce((total: BigNumber, row: any) => row.direction === 'in' ? total.plus(row.amount) : total.minus(row.amount), new BigNumber(0));
    };

    /** Unpaid payouts of passed proposals, which new proposals can't spend. */
    const committedPayouts = async (asset: string): Promise<BigNumber> => {
        const rows = await state.adapter.query(
            `SELECT dao_payouts.amount AS amount FROM dao_payouts
             JOIN dao_proposals ON dao_proposals.proposal_id = dao_payouts.proposal_id
             WHERE dao_payouts.asset = ? AND dao_payouts.status IN (?, ?) AND dao_proposals.status IN (?, ?)`,
            [asset, 'pending', 'failed', 'queued', 'executing']
        );

        return sum(rows.map((row: any) => row.amount));
    };

    const send = async (to: string, amount: string, asset: string, memo: string) => {
        if (!state.streamer) {
            throw new Error('DAO contract is not attached to a streamer');
        }

        await state.streamer.transferHiveTokens(state.account, to, amount, asset, memo.slice(0, MAX_MEMO));
    };

    const refundTransfer = async (ctx: ContractContext, entryId: string, to: string, amount: string, asset: string, reason: string, actionName: string) => {
        try {
            await send(to, amount, asset, `[DAO refund] ${reason}`);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            await state.adapter.query('UPDATE dao_ledger SET kind = ? WHERE entry_id = ?', ['refund_failed', entryId]);
            await emit(ctx, actionName, 'refund_failed', { entryId, to, amount, asset, reason, error: message });
            throw error;
        }

        await emit(ctx, actionName, 'transfer_refunded', { entryId, to, amount, asset, reason });
    };

    const requireAdmin = (ctx: ContractContext): string => {
        const sender = requireSender(ctx);

        if (!state.admins.includes(sender)) {
            throw new Error(`${sender} is not a DAO admin`);
        }

        return sender;
    };

    const cancelPayouts = async (ctx: ContractContext, proposalId: string) => {
        await state.adapter.query(
            'UPDATE dao_payouts SET status = ?, updated_at = ? WHERE proposal_id = ? AND status IN (?, ?)',
            ['cancelled', iso(ctx), proposalId, 'pending', 'failed']
        );
    };

    const keepDeposit = async (ctx: ContractContext, proposal: any) => {
        const entryId = `deposit-kept:${proposal.proposal_id}`;

        if (await ledgerEntryExists(entryId)) {
            return;
        }

        await state.adapter.query(
            'UPDATE dao_proposals SET deposit_status = ?, updated_at = ? WHERE proposal_id = ?',
            ['kept', iso(ctx), proposal.proposal_id]
        );
        await addLedgerEntry(ctx, {
            entryId,
            kind: 'proposal_deposit_kept',
            direction: 'in',
            account: proposal.proposer,
            asset: proposal.deposit_asset,
            amount: proposal.deposit_amount,
            proposalId: proposal.proposal_id
        });
    };

    /**
     * Returns a proposal deposit to its proposer. The row moves to
     * 'refunding' before the transfer; a failed broadcast leaves it
     * 'refund_failed', which the next tally retries.
     */
    const refundDeposit = async (ctx: ContractContext, proposal: any) => {
        await state.adapter.query(
            'UPDATE dao_proposals SET deposit_status = ?, updated_at = ? WHERE proposal_id = ?',
            ['refunding', iso(ctx), proposal.proposal_id]
        );

        try {
            await send(proposal.proposer, proposal.deposit_amount, proposal.deposit_asset, `[DAO] Proposal deposit refund (${proposal.proposal_id})`);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            await state.adapter.query(
                'UPDATE dao_proposals SET deposit_status = ?, updated_at = ? WHERE proposal_id = ?',
                ['refund_failed', iso(ctx), proposal.proposal_id]
            );
            await emit(ctx, 'tally', 'deposit_refund_failed', { proposalId: proposal.proposal_id, proposer: proposal.proposer, error: message });
            getLogger().warn(`[DaoContract] Deposit refund for ${proposal.proposal_id} failed; the next tally retries it`, error);
            return;
        }

        await state.adapter.query(
            'UPDATE dao_proposals SET deposit_status = ?, updated_at = ? WHERE proposal_id = ?',
            ['refunded', iso(ctx), proposal.proposal_id]
        );
        await emit(ctx, 'tally', 'deposit_refunded', {
            proposalId: proposal.proposal_id,
            proposer: proposal.proposer,
            amount: proposal.deposit_amount,
            asset: proposal.deposit_asset
        });
    };

    const votingWeight = async (voter: string, ctx: ContractContext): Promise<BigNumber> => {
        if (votingPower === 'equal') {
            return new BigNumber(1);
        }

        const streamer: any = ctx.streamer ?? state.streamer;

        if (votingPower === 'engine-token') {
            const balance = await streamer.engine.getTokenBalance(voter, tokenSymbol);
            return toBigNumber(balance?.stake ?? '0');
        }

        const account = await streamer.getAccount(voter);

        if (!account) {
            return new BigNumber(0);
        }

        const props = await streamer.query.getDynamicGlobalProperties();
        return toBigNumber(Utils.vestToHP(String(account.vesting_shares), String(props.total_vesting_fund_hive), String(props.total_vesting_shares)));
    };

    const deposit = async (_payload: z.infer<typeof depositSchema>, ctx: ContractContext) => {
        const transfer = requireTransferContext(ctx);
        const sender = requireSender(ctx);

        if (transfer.to !== state.account) {
            throw new Error(`Treasury deposits must be sent to ${state.account}`);
        }

        const entryId = operationRecordId(ctx.transaction.id, ctx.transaction.operationIndex);

        if (await ledgerEntryExists(entryId)) {
            getLogger().warn(`[DaoContract] Duplicate deposit ${entryId} ignored`);
            return;
        }

        const amount = format(toBigNumber(transfer.amount));
        const asset = transfer.asset;

        if (!allowedAssets.includes(asset)) {
            await addLedgerEntry(ctx, { entryId, kind: 'deposit_refunded', direction: 'none', account: sender, asset, amount });
            await refundTransfer(ctx, entryId, sender, amount, asset, `The treasury does not accept ${asset}`, 'deposit');
            return;
        }

        await addLedgerEntry(ctx, { entryId, kind: 'deposit', direction: 'in', account: sender, asset, amount });
        await emit(ctx, 'deposit', 'deposit', { entryId, from: sender, amount, asset });
    };

    const createProposal = async (payload: z.infer<typeof createProposalSchema>, ctx: ContractContext) => {
        const transfer = requireTransferContext(ctx);
        const proposer = requireSender(ctx);

        if (transfer.to !== state.account) {
            throw new Error(`Proposals must be sent to ${state.account}`);
        }

        const entryId = operationRecordId(ctx.transaction.id, ctx.transaction.operationIndex);

        if (await ledgerEntryExists(entryId)) {
            getLogger().warn(`[DaoContract] Duplicate proposal transfer ${entryId} ignored`);
            return;
        }

        const amount = format(toBigNumber(transfer.amount));
        const asset = transfer.asset;
        const params = await getParams();
        const createdAt = now(ctx);
        const votingEndsAt = new Date(createdAt.getTime() + params.votingPeriodHours * HOUR_MS);
        const parsed = proposalSchema.safeParse(payload);
        let rejection: string | null = null;
        let expiresAt: Date | null = null;

        if (!parsed.success) {
            const issue = parsed.error.issues[0];
            rejection = `Invalid proposal: ${issue?.path?.join('.') || 'payload'} ${issue?.message ?? ''}`.trim();
        } else if (asset !== depositAsset || !toBigNumber(amount).isEqualTo(params.proposalDeposit)) {
            rejection = `The proposal deposit is exactly ${format(toBigNumber(params.proposalDeposit))} ${depositAsset}`;
        } else if (await getProposal(parsed.data.proposalId)) {
            rejection = `Proposal ${parsed.data.proposalId} already exists`;
        }

        const proposal = parsed.success ? parsed.data : null;
        const payouts = proposal?.payouts ?? [];

        if (!rejection && proposal) {
            for (const payout of payouts) {
                const value = toBigNumber(payout.amount);

                if (!allowedAssets.includes(payout.asset)) {
                    rejection = `The treasury does not pay out ${payout.asset}`;
                } else if (value.lte(0) || value.decimalPlaces()! > PRECISION) {
                    rejection = `Payout amounts must be positive with up to ${PRECISION} decimals`;
                } else if (payout.to === state.account) {
                    rejection = 'The treasury cannot pay itself';
                }

                if (rejection) {
                    break;
                }
            }
        }

        if (!rejection && proposal) {
            for (const payoutAsset of [...new Set(payouts.map((payout) => payout.asset))]) {
                const requested = sum(payouts.filter((payout) => payout.asset === payoutAsset).map((payout) => payout.amount));
                const available = (await treasuryBalance(payoutAsset)).minus(await committedPayouts(payoutAsset));

                if (requested.gt(available)) {
                    rejection = `Payouts of ${format(requested)} ${payoutAsset} exceed the treasury's available ${format(BigNumber.maximum(available, 0))} ${payoutAsset}`;
                    break;
                }
            }
        }

        if (!rejection && proposal?.expiresAt) {
            try {
                expiresAt = parseDateValue(proposal.expiresAt);
            } catch (error) {
                rejection = 'Invalid expiresAt';
            }

            const earliestExecution = votingEndsAt.getTime() + params.timelockHours * HOUR_MS;

            if (!rejection && expiresAt && expiresAt.getTime() <= earliestExecution) {
                rejection = 'expiresAt must be after the voting period and timelock';
            }
        }

        if (rejection || !proposal) {
            const reason = rejection ?? 'Invalid proposal';
            await addLedgerEntry(ctx, { entryId, kind: 'proposal_rejected', direction: 'none', account: proposer, asset, amount });
            await emit(ctx, 'createProposal', 'proposal_rejected', { entryId, proposer, reason });
            await refundTransfer(ctx, entryId, proposer, amount, asset, reason, 'createProposal');
            return;
        }

        await addLedgerEntry(ctx, {
            entryId,
            kind: 'proposal_deposit',
            direction: 'none',
            account: proposer,
            asset,
            amount,
            proposalId: proposal.proposalId
        });

        await state.adapter.query(
            `INSERT INTO dao_proposals (
                proposal_id, proposer, title, description, status, status_reason, deposit_amount, deposit_asset, deposit_status,
                quorum, pass_threshold_bps, timelock_hours, voting_ends_at, executable_at, expires_at,
                for_weight, against_weight, voter_count, created_op, created_block, created_at, updated_at, tallied_at, executed_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                proposal.proposalId, proposer, proposal.title, proposal.description ?? '', 'active', null, amount, asset, 'held',
                params.quorum, params.passThresholdBps, params.timelockHours, votingEndsAt.toISOString(), null, expiresAt ? expiresAt.toISOString() : null,
                '0', '0', 0, entryId, ctx.block.number, createdAt.toISOString(), createdAt.toISOString(), null, null
            ]
        );

        for (const [index, payout] of payouts.entries()) {
            await state.adapter.query(
                `INSERT INTO dao_payouts (
                    proposal_id, payout_index, recipient, amount, asset, memo, status, attempts, last_error, paid_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    proposal.proposalId, index, payout.to, format(toBigNumber(payout.amount)), payout.asset,
                    payout.memo ?? `[DAO] ${proposal.title} (${proposal.proposalId})`, 'pending', 0, null, null, createdAt.toISOString()
                ]
            );
        }

        await emit(ctx, 'createProposal', 'proposal_created', {
            proposalId: proposal.proposalId,
            proposer,
            title: proposal.title,
            payouts: payouts.map((payout) => ({ to: payout.to, amount: format(toBigNumber(payout.amount)), asset: payout.asset })),
            votingEndsAt: votingEndsAt.toISOString(),
            quorum: params.quorum,
            passThresholdBps: params.passThresholdBps
        });
    };

    const vote = async (payload: z.infer<typeof voteSchema>, ctx: ContractContext) => {
        const voter = requireSender(ctx);
        const proposal = await getProposal(payload.proposalId);

        if (!proposal) {
            throw new Error(`Proposal ${payload.proposalId} does not exist`);
        }

        if (proposal.status !== 'active') {
            throw new Error(`Proposal ${payload.proposalId} is ${proposal.status}`);
        }

        if (now(ctx).getTime() >= new Date(proposal.voting_ends_at).getTime()) {
            throw new Error(`Voting on ${payload.proposalId} has ended`);
        }

        const opId = operationRecordId(ctx.transaction.id, ctx.transaction.operationIndex);
        const existing = (await state.adapter.query(
            'SELECT op_id FROM dao_votes WHERE proposal_id = ? AND voter = ?',
            [payload.proposalId, voter]
        ))[0];

        if (existing?.op_id === opId) {
            // The same operation processed again: already counted.
            return;
        }

        const weight = await votingWeight(voter, ctx);

        if (weight.lte(0)) {
            throw new Error(`${voter} has no voting power`);
        }

        const support = payload.support ? 1 : 0;

        if (existing) {
            await state.adapter.query(
                'UPDATE dao_votes SET support = ?, weight = ?, op_id = ?, block_number = ?, updated_at = ? WHERE proposal_id = ? AND voter = ?',
                [support, weight.toString(), opId, ctx.block.number, iso(ctx), payload.proposalId, voter]
            );
        } else {
            await state.adapter.query(
                `INSERT INTO dao_votes (
                    proposal_id, voter, support, weight, op_id, block_number, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [payload.proposalId, voter, support, weight.toString(), opId, ctx.block.number, iso(ctx), iso(ctx)]
            );
        }

        await emit(ctx, 'vote', 'vote_cast', {
            proposalId: payload.proposalId,
            voter,
            support: payload.support,
            weight: weight.toString(),
            replaced: Boolean(existing)
        });
    };

    const closeProposal = async (proposal: any, ctx: ContractContext) => {
        const current = await getProposal(proposal.proposal_id);

        if (!current || current.status !== 'active') {
            return;
        }

        const votes = await state.adapter.query('SELECT support, weight FROM dao_votes WHERE proposal_id = ?', [current.proposal_id]);
        const forWeight = sum(votes.filter((row: any) => Number(row.support) === 1).map((row: any) => row.weight));
        const againstWeight = sum(votes.filter((row: any) => Number(row.support) !== 1).map((row: any) => row.weight));
        const total = forWeight.plus(againstWeight);
        const quorumReached = total.gt(0) && total.gte(current.quorum);
        const passed = quorumReached && forWeight.multipliedBy(10000).gt(total.multipliedBy(Number(current.pass_threshold_bps)));
        const talliedAt = now(ctx);
        const executableAt = passed ? new Date(talliedAt.getTime() + Number(current.timelock_hours) * HOUR_MS) : null;
        const reason = passed ? null : quorumReached ? 'rejected' : 'quorum_not_reached';

        await state.adapter.query(
            `UPDATE dao_proposals SET status = ?, status_reason = ?, for_weight = ?, against_weight = ?, voter_count = ?,
                tallied_at = ?, executable_at = ?, updated_at = ? WHERE proposal_id = ? AND status = ?`,
            [
                passed ? 'queued' : 'failed', reason, forWeight.toString(), againstWeight.toString(), votes.length,
                talliedAt.toISOString(), executableAt ? executableAt.toISOString() : null, talliedAt.toISOString(),
                current.proposal_id, 'active'
            ]
        );

        if (!passed) {
            await cancelPayouts(ctx, current.proposal_id);
        }

        await emit(ctx, 'tally', passed ? 'proposal_passed' : 'proposal_failed', {
            proposalId: current.proposal_id,
            forWeight: forWeight.toString(),
            againstWeight: againstWeight.toString(),
            quorum: current.quorum,
            quorumReached,
            reason,
            executableAt: executableAt ? executableAt.toISOString() : null
        });

        if (quorumReached) {
            await refundDeposit(ctx, current);
        } else {
            await keepDeposit(ctx, current);
            await emit(ctx, 'tally', 'deposit_kept', {
                proposalId: current.proposal_id,
                amount: current.deposit_amount,
                asset: current.deposit_asset
            });
        }
    };

    const tally = async (payload: z.infer<typeof sweepSchema>, ctx: ContractContext) => {
        const scheduled = ctx.trigger === 'time';
        const at = iso(ctx);
        let due: any[];
        let retries: any[];

        if (payload.proposalId) {
            const proposal = await getProposal(payload.proposalId);

            if (!proposal) {
                throw new Error(`Proposal ${payload.proposalId} does not exist`);
            }

            if (proposal.status === 'active' && proposal.voting_ends_at > at) {
                throw new Error(`Voting on ${payload.proposalId} is open until ${proposal.voting_ends_at}`);
            }

            due = proposal.status === 'active' ? [proposal] : [];
            retries = proposal.deposit_status === 'refund_failed' ? [proposal] : [];
        } else {
            due = await state.adapter.query(
                'SELECT * FROM dao_proposals WHERE status = ? AND voting_ends_at <= ? ORDER BY voting_ends_at ASC',
                ['active', at]
            );
            retries = await state.adapter.query('SELECT * FROM dao_proposals WHERE deposit_status = ?', ['refund_failed']);
        }

        for (const proposal of due) {
            try {
                await closeProposal(proposal, ctx);
            } catch (error) {
                if (!scheduled && payload.proposalId) {
                    throw error;
                }

                getLogger().error(`[DaoContract] Could not tally ${proposal.proposal_id}`, error);
            }
        }

        for (const proposal of retries) {
            await refundDeposit(ctx, proposal);
        }
    };

    const executeOne = async (proposal: any, ctx: ContractContext) => {
        const at = now(ctx);

        if (proposal.status === 'queued') {
            if (proposal.expires_at && at.getTime() > new Date(proposal.expires_at).getTime()) {
                await state.adapter.query(
                    'UPDATE dao_proposals SET status = ?, status_reason = ?, updated_at = ? WHERE proposal_id = ? AND status = ?',
                    ['expired', 'expired_before_execution', at.toISOString(), proposal.proposal_id, 'queued']
                );
                await cancelPayouts(ctx, proposal.proposal_id);
                await emit(ctx, 'execute', 'proposal_expired', { proposalId: proposal.proposal_id, expiresAt: proposal.expires_at });
                return;
            }

            await state.adapter.query(
                'UPDATE dao_proposals SET status = ?, updated_at = ? WHERE proposal_id = ? AND status = ?',
                ['executing', at.toISOString(), proposal.proposal_id, 'queued']
            );
            await emit(ctx, 'execute', 'proposal_executing', { proposalId: proposal.proposal_id });
        }

        const payouts = await state.adapter.query(
            'SELECT * FROM dao_payouts WHERE proposal_id = ? AND status IN (?, ?) ORDER BY payout_index ASC',
            [proposal.proposal_id, 'pending', 'failed']
        );

        for (const payout of payouts) {
            const ref = { proposalId: proposal.proposal_id, payoutIndex: Number(payout.payout_index), to: payout.recipient, amount: payout.amount, asset: payout.asset };

            if ((await treasuryBalance(payout.asset)).lt(payout.amount)) {
                await state.adapter.query(
                    'UPDATE dao_payouts SET status = ?, last_error = ?, updated_at = ? WHERE proposal_id = ? AND payout_index = ?',
                    ['failed', 'Insufficient treasury balance', at.toISOString(), payout.proposal_id, payout.payout_index]
                );
                await emit(ctx, 'execute', 'payout_failed', { ...ref, error: 'Insufficient treasury balance' });
                continue;
            }

            const attempt = Number(payout.attempts) + 1;

            // Debit first, so a crash mid-broadcast never overstates the balance.
            await state.adapter.query(
                'UPDATE dao_payouts SET status = ?, attempts = ?, updated_at = ? WHERE proposal_id = ? AND payout_index = ?',
                ['sending', attempt, at.toISOString(), payout.proposal_id, payout.payout_index]
            );
            await addLedgerEntry(ctx, {
                entryId: `payout:${payout.proposal_id}:${payout.payout_index}:${attempt}`,
                kind: 'payout',
                direction: 'out',
                account: payout.recipient,
                asset: payout.asset,
                amount: payout.amount,
                proposalId: payout.proposal_id
            });

            try {
                await send(payout.recipient, payout.amount, payout.asset, payout.memo);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);

                await state.adapter.query(
                    'UPDATE dao_payouts SET status = ?, last_error = ?, updated_at = ? WHERE proposal_id = ? AND payout_index = ?',
                    ['failed', message.slice(0, 500), at.toISOString(), payout.proposal_id, payout.payout_index]
                );
                await addLedgerEntry(ctx, {
                    entryId: `payout-reversal:${payout.proposal_id}:${payout.payout_index}:${attempt}`,
                    kind: 'payout_reversal',
                    direction: 'in',
                    account: payout.recipient,
                    asset: payout.asset,
                    amount: payout.amount,
                    proposalId: payout.proposal_id
                });
                await emit(ctx, 'execute', 'payout_failed', { ...ref, attempt, error: message });
                getLogger().warn(`[DaoContract] Payout ${payout.payout_index} of ${payout.proposal_id} failed; call execute again to retry`, error);
                continue;
            }

            await state.adapter.query(
                'UPDATE dao_payouts SET status = ?, last_error = ?, paid_at = ?, updated_at = ? WHERE proposal_id = ? AND payout_index = ?',
                ['paid', null, at.toISOString(), at.toISOString(), payout.proposal_id, payout.payout_index]
            );
            await emit(ctx, 'execute', 'payout_paid', { ...ref, attempt });
        }

        const unpaid = await state.adapter.query(
            'SELECT COUNT(*) AS count FROM dao_payouts WHERE proposal_id = ? AND status <> ?',
            [proposal.proposal_id, 'paid']
        );

        if (Number(unpaid[0]?.count ?? 0) === 0) {
            await state.adapter.query(
                'UPDATE dao_proposals SET status = ?, executed_at = ?, updated_at = ? WHERE proposal_id = ? AND status = ?',
                ['executed', at.toISOString(), at.toISOString(), proposal.proposal_id, 'executing']
            );
            await emit(ctx, 'execute', 'proposal_executed', { proposalId: proposal.proposal_id });
        }
    };

    const execute = async (payload: z.infer<typeof sweepSchema>, ctx: ContractContext) => {
        const at = iso(ctx);

        if (payload.proposalId) {
            const proposal = await getProposal(payload.proposalId);

            if (!proposal) {
                throw new Error(`Proposal ${payload.proposalId} does not exist`);
            }

            if (proposal.status === 'executed') {
                return;
            }

            if (proposal.status !== 'queued' && proposal.status !== 'executing') {
                throw new Error(`Proposal ${payload.proposalId} is ${proposal.status}`);
            }

            if (proposal.status === 'queued' && proposal.executable_at > at) {
                throw new Error(`Proposal ${payload.proposalId} is timelocked until ${proposal.executable_at}`);
            }

            await executeOne(proposal, ctx);
            return;
        }

        // A sweep runs first attempts only; retrying a failed payout is an
        // explicit execute call for that proposal.
        const due = await state.adapter.query(
            'SELECT * FROM dao_proposals WHERE status = ? AND executable_at <= ? ORDER BY executable_at ASC',
            ['queued', at]
        );

        for (const proposal of due) {
            try {
                await executeOne(proposal, ctx);
            } catch (error) {
                getLogger().error(`[DaoContract] Could not execute ${proposal.proposal_id}`, error);
            }
        }
    };

    const vetoProposal = async (payload: z.infer<typeof vetoSchema>, ctx: ContractContext) => {
        const admin = requireAdmin(ctx);
        const proposal = await getProposal(payload.proposalId);

        if (!proposal) {
            throw new Error(`Proposal ${payload.proposalId} does not exist`);
        }

        if (proposal.status !== 'queued' || proposal.executable_at <= iso(ctx)) {
            throw new Error(`Proposal ${payload.proposalId} can only be vetoed during its timelock`);
        }

        await state.adapter.query(
            'UPDATE dao_proposals SET status = ?, status_reason = ?, updated_at = ? WHERE proposal_id = ? AND status = ?',
            ['vetoed', payload.reason ?? 'vetoed', iso(ctx), payload.proposalId, 'queued']
        );
        await cancelPayouts(ctx, payload.proposalId);
        await emit(ctx, 'vetoProposal', 'proposal_vetoed', { proposalId: payload.proposalId, admin, reason: payload.reason ?? null });
    };

    const cancelProposal = async (payload: z.infer<typeof proposalIdSchema>, ctx: ContractContext) => {
        const sender = requireSender(ctx);
        const proposal = await getProposal(payload.proposalId);

        if (!proposal) {
            throw new Error(`Proposal ${payload.proposalId} does not exist`);
        }

        if (proposal.proposer !== sender) {
            throw new Error('Only the proposer can cancel a proposal');
        }

        if (proposal.status !== 'active') {
            throw new Error(`Proposal ${payload.proposalId} is ${proposal.status}`);
        }

        const votes = await state.adapter.query('SELECT COUNT(*) AS count FROM dao_votes WHERE proposal_id = ?', [payload.proposalId]);

        if (Number(votes[0]?.count ?? 0) > 0) {
            throw new Error(`Proposal ${payload.proposalId} already has votes`);
        }

        await state.adapter.query(
            'UPDATE dao_proposals SET status = ?, status_reason = ?, updated_at = ? WHERE proposal_id = ? AND status = ?',
            ['cancelled', 'cancelled_by_proposer', iso(ctx), payload.proposalId, 'active']
        );
        await cancelPayouts(ctx, payload.proposalId);
        // A withdrawn proposal never reached quorum, so its deposit stays with the treasury.
        await keepDeposit(ctx, proposal);
        await emit(ctx, 'cancelProposal', 'proposal_cancelled', { proposalId: payload.proposalId, proposer: sender });
    };

    const setParams = async (payload: z.infer<typeof setParamsSchema>, ctx: ContractContext) => {
        const admin = requireAdmin(ctx);
        const changes = Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined));

        if (Object.keys(changes).length === 0) {
            throw new Error('setParams needs at least one parameter');
        }

        const next: DaoParams = { ...(await getParams()), ...changes };
        validateParams(next, 'setParams');

        await state.adapter.query(
            `INSERT INTO dao_settings (setting_key, setting_value) VALUES (?, ?)
             ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value`,
            ['params', JSON.stringify(next)]
        );
        await emit(ctx, 'setParams', 'params_updated', { admin, changes, params: next });
    };

    return defineContract({
        name,
        hooks: {
            create: async (lifecycle) => {
                state.account = resolveContractAccount('createDaoContract', options.account, lifecycle);
                state.admins = options.admins && options.admins.length > 0 ? [...options.admins] : [state.account];
                state.adapter = lifecycle.adapter;
                state.streamer = lifecycle.streamer;
                await initialize();
            }
        },
        actions: {
            deposit: action(deposit, {
                schema: depositSchema,
                trigger: 'transfer',
                ...(options.account ? { guards: { allowedRecipients: [options.account] } } : {}),
                description: 'Fund the treasury with a transfer to the treasury account. Assets the treasury does not accept are refunded.'
            }),
            createProposal: action(createProposal, {
                schema: createProposalSchema,
                trigger: 'transfer',
                ...(options.account ? { guards: { allowedRecipients: [options.account] } } : {}),
                description: 'Open a proposal by sending the proposal deposit. Wrong deposits, invalid payloads and payouts above the available treasury balance are refunded.'
            }),
            vote: action(vote, {
                schema: voteSchema,
                trigger: 'custom_json',
                description: 'Vote for or against an open proposal. Weight is snapshotted when the vote is cast; a later vote by the same account replaces it.'
            }),
            tally: action(tally, {
                schema: sweepSchema,
                trigger: ['custom_json', 'time'],
                description: 'Close proposals whose voting period has ended (anyone, or a scheduled time action): mark them passed or failed, refund or keep deposits and start the timelock.'
            }),
            execute: action(execute, {
                schema: sweepSchema,
                trigger: ['custom_json', 'time'],
                description: 'Pay out passed proposals whose timelock has elapsed (anyone, or a scheduled time action). Call it with a proposalId to retry failed payouts.'
            }),
            vetoProposal: action(vetoProposal, {
                schema: vetoSchema,
                trigger: 'custom_json',
                requiresActiveKey: true,
                description: 'Admin-only: veto a passed proposal during its timelock.'
            }),
            cancelProposal: action(cancelProposal, {
                schema: proposalIdSchema,
                trigger: 'custom_json',
                description: 'Proposer-only: withdraw a proposal before anyone votes. The deposit stays with the treasury.'
            }),
            setParams: action(setParams, {
                schema: setParamsSchema,
                trigger: 'custom_json',
                requiresActiveKey: true,
                description: 'Admin-only: change quorum, pass threshold, voting period, timelock or proposal deposit for new proposals.'
            })
        }
    });
}
