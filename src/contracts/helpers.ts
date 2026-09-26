import BigNumber from '../bignumber';
import { z } from 'zod';
import type { ContractActionDefinition, ContractContext } from '../types/hive-stream';
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
