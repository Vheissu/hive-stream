import type { Streamer } from '../../src/streamer';
import type { ContractContext } from '../../src/types/hive-stream';

let sequence = 0;

export interface ContextOptions {
    sender: string;
    trigger?: ContractContext['trigger'];
    /** e.g. '10.000 HIVE' — builds a transfer context. */
    amount?: string;
    to?: string;
    time?: Date | string;
    blockNumber?: number;
    blockId?: string;
    transactionId?: string;
    activeKey?: boolean;
}

/**
 * Builds a ContractContext for calling contract handlers directly in tests.
 * Transfer contexts are created when `amount` is supplied.
 */
export function makeContext(streamer: Streamer, options: ContextOptions): ContractContext {
    sequence++;
    const trigger = options.trigger ?? (options.amount ? 'transfer' : 'custom_json');
    const blockNumber = options.blockNumber ?? 1000 + sequence;
    const time = options.time ? new Date(options.time) : new Date('2026-01-01T00:00:00Z');
    const ctx: ContractContext = {
        trigger,
        streamer,
        adapter: streamer.getAdapter(),
        config: streamer.getConfig() as any,
        block: {
            number: blockNumber,
            id: options.blockId ?? `block${blockNumber.toString(16).padStart(8, '0')}`,
            previousId: `block${(blockNumber - 1).toString(16).padStart(8, '0')}`,
            time
        },
        transaction: { id: options.transactionId ?? `trx-${sequence}` },
        sender: options.sender
    };

    if (trigger === 'custom_json') {
        ctx.customJson = { id: 'hivestream', json: {}, isSignedWithActiveKey: options.activeKey ?? true };
    }

    if (options.amount) {
        const [amount, asset] = options.amount.split(' ');
        ctx.transfer = {
            from: options.sender,
            to: options.to ?? 'house',
            rawAmount: options.amount,
            amount,
            asset
        };
    }

    return ctx;
}
