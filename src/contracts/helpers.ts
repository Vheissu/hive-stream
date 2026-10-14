import BigNumber from '../bignumber';
import { z } from 'zod';
import { getLogger } from '../logger';
import { operationRecordId, type ContractActionDefinition, type ContractContext } from '../types/hive-stream';
import { Utils } from '../utils';
import { action } from './contract';
import type { FairDrawProof, FairnessManager } from '../fairness/manager';

export const amountSchema = z.string().regex(/^\d+(?:\.\d{1,8})?$/, 'Invalid amount');
export const identifierSchema = z.string().min(1).max(80).regex(/^[a-zA-Z0-9:_-]+$/, 'Invalid identifier');
export const assetSchema = z.string().min(3).max(16).regex(/^[A-Z0-9.:-]+$/, 'Invalid asset');

export function createContractState<T extends Record<string, any> = Record<string, never>>(extra: T = {} as T): { adapter: any } & T {
    return {
        adapter: null,
        ...extra
    };
}

export function ensureSqlAdapter(adapter: any): void {
    if (!adapter?.capabilities?.sql) {
        throw new Error('This contract requires a SQL-capable adapter (SQLite or PostgreSQL).');
    }
}

export async function initializeTables(adapter: any, statements: string[]): Promise<void> {
    ensureSqlAdapter(adapter);

    for (const statement of statements) {
        await adapter.query(statement);
    }
}

/**
 * The time a contract should use for anything it records or decides: the
 * block's timestamp, so catch-up and replays behave exactly like live
 * processing (a contribution sent before a deadline is accepted even if it's
 * processed after it). Falls back to the wall clock only when a context has
 * no block time, e.g. a handler called directly from a test.
 */
export function blockTimeOf(ctx: { block?: { time?: Date | string } } | null | undefined): Date {
    const time = ctx?.block?.time;

    if (time instanceof Date && !Number.isNaN(time.getTime())) {
        return time;
    }

    if (typeof time === 'string') {
        const parsed = new Date(time);

        if (!Number.isNaN(parsed.getTime())) {
            return parsed;
        }
    }

    return new Date();
}

export async function emitContractEvent(adapter: any, contract: string, action: string, payload: any, data: any, time?: Date): Promise<void> {
    if (adapter?.addEvent) {
        await adapter.addEvent(time ?? new Date(), contract, action, payload, data);
    }
}

export function requireSender(ctx: ContractContext): string {
    if (!ctx.sender) {
        throw new Error('Sender required');
    }

    return ctx.sender;
}

export function requireTransferContext(ctx: ContractContext) {
    if (!ctx.transfer) {
        throw new Error('Transfer context required');
    }

    return ctx.transfer;
}

export function requireEscrowContext(ctx: ContractContext) {
    if (!ctx.escrow) {
        throw new Error('Escrow context required');
    }

    return ctx.escrow;
}

export function getIncomingPayment(ctx: ContractContext) {
    if (ctx.transfer) {
        return {
            from: ctx.transfer.from,
            to: ctx.transfer.to,
            rawAmount: ctx.transfer.rawAmount,
            amount: ctx.transfer.amount,
            asset: ctx.transfer.asset,
            memo: ctx.transfer.memo,
            source: (ctx.trigger === 'recurrent_transfer' ? 'recurrent_transfer' : 'transfer') as 'transfer' | 'recurrent_transfer'
        };
    }

    const operationAmount = ctx.operation?.data?.amount;
    if (ctx.trigger === 'recurrent_transfer' && typeof operationAmount === 'string') {
        const parsed = parseBlockchainAmount(operationAmount);

        return {
            from: ctx.operation?.data?.from,
            to: ctx.operation?.data?.to,
            rawAmount: parsed.rawAmount,
            amount: parsed.amount,
            asset: parsed.asset,
            memo: ctx.operation?.data?.memo,
            source: 'recurrent_transfer' as const
        };
    }

    throw new Error('Payment context required');
}

export function getEscrowPayment(ctx: ContractContext) {
    const escrow = requireEscrowContext(ctx);
    const candidates = [escrow.hiveAmount, escrow.hbdAmount].filter((value): value is string => Boolean(value));

    for (const candidate of candidates) {
        const parsed = parseBlockchainAmount(candidate);

        if (parsed.value.gt(0)) {
            return {
                rawAmount: parsed.rawAmount,
                amount: parsed.amount,
                asset: parsed.asset
            };
        }
    }

    throw new Error('Escrow payment amount required');
}

export function parseDateValue(value?: string | Date | null): Date | null {
    if (!value) {
        return null;
    }

    if (value instanceof Date) {
        return value;
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        throw new Error(`Invalid date: ${value}`);
    }

    return parsed;
}

export function parseJson<T>(value: any, fallback: T): T {
    if (value === null || typeof value === 'undefined' || value === '') {
        return fallback;
    }

    if (typeof value !== 'string') {
        return value as T;
    }

    try {
        return JSON.parse(value) as T;
    } catch (error) {
        return fallback;
    }
}

export function toBigNumber(value: string | number | BigNumber): BigNumber {
    const bn = new BigNumber(value as any);
    if (bn.isNaN() || !bn.isFinite()) {
        throw new Error(`Invalid numeric value: ${String(value)}`);
    }
    return bn;
}

export function ensurePositiveAmount(value: string, label: string): void {
    const amount = toBigNumber(value);
    if (!amount.isFinite() || amount.lte(0)) {
        throw new Error(`${label} must be greater than zero`);
    }
}

export function assertAssetMatches(actual: string, expected: string, label: string = 'Asset'): void {
    if (actual !== expected) {
        throw new Error(`${label} must be paid in ${expected}`);
    }
}

export function uniqueItems(values: string[]): string[] {
    return [...new Set(values.filter(Boolean))];
}

export function parseBlockchainAmount(rawAmount: string) {
    return Utils.parseAssetAmount(rawAmount);
}

export function formatBlockchainAmount(value: string | number | BigNumber, precision: number = 3): string {
    return Utils.formatAmount(value, precision);
}

/**
 * Resolves the account a contract sends payouts and refunds from: the
 * explicit option, else the streamer's configured username. Throws when
 * neither is set, so a contract can never silently pay out from a default
 * account the app doesn't own. Call it from the contract's create hook.
 */
export function resolveContractAccount(
    factory: string,
    explicit: string | undefined,
    lifecycle: { streamer?: any; config?: { USERNAME?: string } } = {}
): string {
    const account = explicit
        || lifecycle.config?.USERNAME
        || lifecycle.streamer?.getConfig?.()?.USERNAME;

    if (!account) {
        throw new Error(`${factory}: set options.account or the streamer username`);
    }

    return account;
}

/**
 * Shared wiring for games that support provably-fair draws: initialises the
 * manager in the contract's create hook and exposes a `rotateSeed` action the
 * house account can call to reveal the current server seed.
 */
export function createFairnessSupport(contractName: string, houseAccount: string | (() => string), fairness: FairnessManager | null) {
    const resolveHouseAccount = typeof houseAccount === 'function' ? houseAccount : () => houseAccount;

    const initialize = async (adapter: any): Promise<void> => {
        if (fairness) {
            await fairness.init({ adapter, scope: contractName });
        }
    };

    const rotateSeedSchema = z.object({});

    // Typed as a plain record so both branches share one type; a union of
    // `{ rotateSeed }` and `{}` makes the factories' return types
    // unassignable to ContractDefinition under `strict`.
    const actions: Record<string, ContractActionDefinition<any>> = fairness
        ? {
            rotateSeed: action(async (_payload: Record<string, never>, ctx: ContractContext) => {
                const house = resolveHouseAccount();

                if (ctx.trigger !== 'time' && ctx.sender !== house) {
                    throw new Error(`Only ${house} can rotate the server seed`);
                }

                const rotation = await fairness.rotate();

                await emitContractEvent(ctx.adapter, contractName, 'rotateSeed', {}, {
                    action: 'fairness_seed_rotated',
                    data: rotation
                });
            }, {
                schema: rotateSeedSchema,
                trigger: ['custom_json', 'time'],
                requiresActiveKey: true,
                description: 'Reveal the current server seed and commit to a new one (house account only).'
            })
        }
        : {};

    return { fairness, initialize, actions };
}

export function formatFairnessMemo(proof: FairDrawProof | null | undefined): string {
    if (!proof) {
        return '';
    }

    return ` | Fair: seed #${proof.seedIndex} nonce ${proof.nonce} commit ${proof.serverSeedHash}`;
}

/**
 * Wraps a payload field so the schema still documents its valid values (the
 * type, enum members and ranges appear in the generated docs, catalog and
 * example payloads) while any value a player sends passes validation. Games
 * use it for fields they check again in the handler, so a bet with an unknown
 * or out-of-range value is refunded with a clear memo instead of failing
 * validation and keeping the stake. The field stays required: a missing field
 * still fails validation (`refundRejectedTransfers` refunds those).
 */
export function refundableField<T extends z.ZodType>(schema: T) {
    const passThrough: z.ZodType<unknown> = schema.catch((ctx) => ctx.input as z.output<T>);
    return passThrough.pipe(z.unknown().refine((value) => value !== undefined, { message: 'Required' }));
}

export interface IncomingTransfer {
    /** The account that sent the transfer (the player). */
    from: string;
    /** The house account the transfer was addressed to. */
    to: string;
    /** The amount as it appeared on chain, e.g. '1.000 HIVE'. */
    rawAmount: string;
    /** The numeric part as sent, e.g. '1.000'. */
    amount: string;
    asset: string;
    value: BigNumber;
}

/**
 * Checks an incoming transfer before a game moves any money for it.
 *
 * The transfer in the context must come from the sender, be addressed to the
 * house `account`, and carry a well-formed amount; then the same operation
 * (by its index in the transaction) is re-read from the chain and must match.
 * Throws when any check fails, so callers never pay out or refund a transfer
 * they did not receive. The streamer already routes only transfers addressed
 * to the app account, but a user can override guards, so games check again.
 */
export async function verifyIncomingTransfer(streamer: any, ctx: ContractContext, account: string): Promise<IncomingTransfer> {
    const transfer = requireTransferContext(ctx);
    const sender = requireSender(ctx);

    if (transfer.to !== account) {
        throw new Error(`Bets must be sent to ${account}`);
    }

    if (transfer.from !== undefined && transfer.from !== sender) {
        throw new Error('Transfer sender does not match the action sender');
    }

    let parsed: ReturnType<typeof parseBlockchainAmount>;

    try {
        parsed = parseBlockchainAmount(transfer.rawAmount);
    } catch (error) {
        throw new Error('Invalid amount format');
    }

    if (parsed.value.isNegative()) {
        throw new Error('Invalid amount value');
    }

    if (transfer.asset && transfer.asset !== parsed.asset) {
        throw new Error('Transfer asset does not match its amount');
    }

    if (transfer.amount && !toBigNumber(transfer.amount).isEqualTo(parsed.value)) {
        throw new Error('Transfer amount does not match its raw amount');
    }

    const transaction = await streamer.getTransaction(ctx.block.number, ctx.transaction.id);
    const verified = await Utils.verifyTransfer(transaction, sender, account, transfer.rawAmount, ctx.transaction.operationIndex ?? 0);

    if (!verified) {
        throw new Error('Transfer could not be verified on chain');
    }

    return {
        from: sender,
        to: account,
        rawAmount: transfer.rawAmount,
        amount: parsed.amount,
        asset: parsed.asset,
        value: parsed.value
    };
}

/**
 * Reads an account's liquid balance in `asset`: `hbd_balance` for HBD,
 * `balance` for HIVE, zero for anything else. Throws when the node call fails.
 */
export async function fetchAccountBalance(streamer: any, account: string, asset: string): Promise<BigNumber> {
    const client = typeof streamer?.getClient === 'function' ? streamer.getClient() : streamer?.client;
    const accounts = await client.database.getAccounts([account]);
    const info = accounts?.[0];

    if (!info) {
        return new BigNumber(0);
    }

    const raw = asset === 'HBD' ? info.hbd_balance : asset === 'HIVE' ? info.balance : undefined;

    if (raw === undefined || raw === null) {
        return new BigNumber(0);
    }

    return toBigNumber(String(raw).trim().split(/\s+/)[0] || '0');
}

/**
 * Per-asset bankroll view for house games: cached balance reads (falling back
 * to the last good value when the node errors), in-flight payout reservations
 * and debits for transfers the house has sent since the last read.
 */
export function createHouseBankroll(options: { streamer: () => any; account: () => string; logPrefix: string; cacheMs?: number }) {
    const cacheMs = options.cacheMs ?? 30000;
    const cache = new Map<string, { balance: BigNumber; timestamp: number }>();
    const pending = new Map<string, BigNumber>();

    const balance = async (asset: string): Promise<BigNumber> => {
        const now = Date.now();
        const cached = cache.get(asset);

        if (cached && (now - cached.timestamp) < cacheMs) {
            return cached.balance;
        }

        try {
            const value = await fetchAccountBalance(options.streamer(), options.account(), asset);
            cache.set(asset, { balance: value, timestamp: now });
            return value;
        } catch (error) {
            getLogger().error(`${options.logPrefix} Error fetching balance:`, error);
            return cached ? cached.balance : new BigNumber(0);
        }
    };

    return {
        balance,
        async available(asset: string): Promise<BigNumber> {
            return (await balance(asset)).minus(pending.get(asset) ?? 0);
        },
        reserve(asset: string, amount: BigNumber): void {
            pending.set(asset, (pending.get(asset) ?? new BigNumber(0)).plus(amount));
        },
        release(asset: string, amount: BigNumber): void {
            pending.set(asset, BigNumber.maximum(0, (pending.get(asset) ?? new BigNumber(0)).minus(amount)));
        },
        debit(asset: string, amount: BigNumber | string): void {
            const cached = cache.get(asset);

            if (cached) {
                cache.set(asset, { balance: BigNumber.maximum(0, cached.balance.minus(amount)), timestamp: cached.timestamp });
            }
        },
        invalidate(): void {
            cache.clear();
        }
    };
}

/**
 * Tracks the transfers a game sends for one bet so error handling can never
 * pay twice. Before the first outgoing transfer it writes a settlement key to
 * the adapter's idempotency ledger; a re-run of the same operation (e.g. under
 * `errorPolicy: 'retry'`, or a replay after a crash) finds the key and skips
 * the bet instead of drawing again. After a failure, `refundAfterError`
 * refunds the stake only when nothing was sent yet: once a payout or refund
 * broadcast has been attempted it may have landed, so it logs instead.
 */
export function createBetSettlement(options: {
    streamer: any;
    adapter: any;
    contract: string;
    account: string;
    ctx: ContractContext;
    player: string;
    amount: string;
    asset: string;
    logPrefix: string;
    onSent?: (asset: string, amount: string) => void;
}) {
    const { streamer, adapter, contract, account, ctx, player, logPrefix } = options;
    const operationId = operationRecordId(ctx.transaction.id, ctx.transaction.operationIndex);
    const key = `settle:${contract}:${operationId}`;
    const hasLedger = typeof adapter?.hasProcessedOperation === 'function' && typeof adapter?.markOperationProcessed === 'function';
    let attempted = false;

    const claim = async (): Promise<void> => {
        if (!hasLedger) {
            return;
        }

        await adapter.markOperationProcessed({
            key,
            blockNumber: ctx.block.number,
            transactionId: ctx.transaction.id,
            operationIndex: ctx.transaction.operationIndex,
            contract,
            action: 'settle',
            status: 'success'
        });
    };

    const send = async (to: string, amount: string, asset: string, memo: string): Promise<void> => {
        if (!attempted) {
            await claim();
            attempted = true;
        }

        await streamer.transferHiveTokens(account, to, amount, asset, memo);
        options.onSent?.(asset, amount);
    };

    return {
        key,
        get attempted(): boolean {
            return attempted;
        },
        /** True when an earlier run already sent money for this operation. */
        async alreadySettled(): Promise<boolean> {
            if (!hasLedger) {
                return false;
            }

            if (await adapter.hasProcessedOperation(key)) {
                getLogger().warn(`${logPrefix} ${operationId} was already settled; skipping it so the player is not paid twice.`);
                return true;
            }

            return false;
        },
        send,
        refund(memo: string): Promise<void> {
            return send(player, options.amount, options.asset, memo);
        },
        async refundAfterError(error: Error): Promise<void> {
            if (attempted) {
                getLogger().error(`${logPrefix} ${operationId} failed after a transfer to ${player} was attempted; not refunding because it may have landed. Check the account history.`, error.message);
                return;
            }

            try {
                await send(player, options.amount, options.asset, '[Refund] Processing error occurred.');
            } catch (refundError) {
                getLogger().error(`${logPrefix} Failed to refund ${operationId} after error:`, refundError);
            }
        }
    };
}
