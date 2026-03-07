import BigNumber from 'bignumber.js';
import { z } from 'zod';
import type { ContractContext } from '../types/hive-stream';

export const amountSchema = z.string().regex(/^\d+(?:\.\d{1,8})?$/, 'Invalid amount');
export const identifierSchema = z.string().min(1).max(80).regex(/^[a-zA-Z0-9:_-]+$/, 'Invalid identifier');
export const assetSchema = z.string().min(3).max(16).regex(/^[A-Z0-9.:-]+$/, 'Invalid asset');

export function createContractState<T extends Record<string, any> = Record<string, never>>(extra: T = {} as T): { adapter: any } & T {
    return {
        adapter: null,
        ...extra
    };
}

export async function initializeTables(adapter: any, statements: string[]): Promise<void> {
    for (const statement of statements) {
        await adapter.query(statement);
    }
}

export async function emitContractEvent(adapter: any, contract: string, action: string, payload: any, data: any): Promise<void> {
    if (adapter?.addEvent) {
        await adapter.addEvent(new Date(), contract, action, payload, data);
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

export function getIncomingPayment(ctx: ContractContext) {
    if (ctx.transfer) {
        return {
            from: ctx.transfer.from,
            to: ctx.transfer.to,
            rawAmount: ctx.transfer.rawAmount,
            amount: ctx.transfer.amount,
            asset: ctx.transfer.asset,
            memo: ctx.transfer.memo,
            source: 'transfer' as const
        };
    }

    const operationAmount = ctx.operation?.data?.amount;
    if (ctx.trigger === 'recurrent_transfer' && typeof operationAmount === 'string') {
        const parts = operationAmount.split(' ');

        return {
            from: ctx.operation?.data?.from,
            to: ctx.operation?.data?.to,
            rawAmount: operationAmount,
            amount: parts[0] || '',
            asset: parts[1] || '',
            memo: ctx.operation?.data?.memo,
            source: 'recurrent_transfer' as const
        };
    }

    throw new Error('Payment context required');
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
    return new BigNumber(value);
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
