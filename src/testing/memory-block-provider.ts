import { BlockData, BlockProvider, DynamicGlobalProperties } from '../providers/block-provider';

export interface MemoryBlockProviderOptions {
    /**
     * Block number of the first block the provider will mint. Defaults to 1.
     */
    startBlockNumber?: number;
    /**
     * Timestamp of the first block. Defaults to the current time so that
     * TimeActions created with default dates line up with simulated time.
     */
    startTime?: Date;
    /**
     * Milliseconds between consecutive blocks when no explicit time is
     * provided. Defaults to 3000 (Hive's block interval).
     */
    blockIntervalMs?: number;
}

export interface AddBlockOptions {
    /**
     * Explicit timestamp for the block. Must not be earlier than the head
     * block's timestamp.
     */
    time?: Date;
    /**
     * Group operations into multiple transactions. When provided, the
     * `operations` argument to `addBlock` is ignored.
     */
    transactions?: Array<Array<[string, any]>>;
}

function toBlockId(blockNumber: number): string {
    return blockNumber.toString(16).padStart(8, '0').concat('0'.repeat(32));
}

function toTransactionId(blockNumber: number, index: number): string {
    return (blockNumber * 100000 + index).toString(16).padStart(40, '0');
}

function toHiveTimestamp(date: Date): string {
    return date.toISOString().slice(0, 19);
}

// Hive timestamps have one-second resolution, so all provider time is
// truncated to whole seconds. Without this, `currentTime` would sit
// fractionally ahead of block timestamps and TimeActions anchored to it
// would fire one block later than expected.
function truncateToSeconds(date: Date): Date {
    return new Date(Math.floor(date.getTime() / 1000) * 1000);
}

/**
 * An in-memory BlockProvider for tests and simulations. Blocks are minted
 * on demand with `addBlock` and served back to the streamer without any
 * network access.
 */
export class MemoryBlockProvider implements BlockProvider {
    private blocks = new Map<number, BlockData>();
    private headBlockNumber: number;
    private headTime: Date;
    private readonly startBlockNumber: number;
    public readonly blockIntervalMs: number;

    constructor(options: MemoryBlockProviderOptions = {}) {
        this.startBlockNumber = options.startBlockNumber ?? 1;
        this.headBlockNumber = this.startBlockNumber - 1;
        this.headTime = truncateToSeconds(options.startTime ?? new Date());
        this.blockIntervalMs = options.blockIntervalMs ?? 3000;
    }

    public get head(): number {
        return this.headBlockNumber;
    }

    public get currentTime(): Date {
        return new Date(this.headTime.getTime());
    }

    /**
     * Mints a new block containing the given operations and advances the
     * chain head. By default all operations share a single transaction and
     * the block timestamp advances by `blockIntervalMs`.
     */
    public addBlock(operations: Array<[string, any]> = [], options: AddBlockOptions = {}): BlockData {
        const blockNumber = this.headBlockNumber + 1;
        const isFirstBlock = this.blocks.size === 0;
        const defaultTime = isFirstBlock
            ? this.headTime
            : new Date(this.headTime.getTime() + this.blockIntervalMs);
        const time = truncateToSeconds(options.time ?? defaultTime);

        if (time.getTime() < this.headTime.getTime()) {
            throw new Error(
                `MemoryBlockProvider: block time ${time.toISOString()} is earlier than head time ${this.headTime.toISOString()}`
            );
        }

        const transactionOperations = options.transactions ?? (operations.length > 0 ? [operations] : []);

        const block: BlockData = {
            block_id: toBlockId(blockNumber),
            previous: blockNumber > this.startBlockNumber ? toBlockId(blockNumber - 1) : '0'.repeat(40),
            timestamp: toHiveTimestamp(time),
            transactions: transactionOperations.map((ops) => ({ operations: ops })),
            transaction_ids: transactionOperations.map((ops, index) => toTransactionId(blockNumber, index))
        };

        this.blocks.set(blockNumber, block);
        this.headBlockNumber = blockNumber;
        this.headTime = time;

        return block;
    }

    public async getDynamicGlobalProperties(): Promise<DynamicGlobalProperties> {
        return {
            head_block_number: this.headBlockNumber,
            time: toHiveTimestamp(this.headTime)
        };
    }

    public async getBlock(blockNumber: number): Promise<BlockData | null> {
        return this.blocks.get(blockNumber) ?? null;
    }

    public reset(): void {
        this.blocks.clear();
        this.headBlockNumber = this.startBlockNumber - 1;
    }
}
