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
    /**
     * How many blocks the last irreversible block trails the head. Defaults
     * to 0 (every minted block is immediately irreversible), which keeps
     * tests deterministic. Raise it to exercise irreversible streaming.
     */
    irreversibleLag?: number;
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
    /**
     * Explicit transaction ids, one per transaction. Useful for simulating a
     * fork where the same transaction is re-included in a different block.
     */
    transactionIds?: string[];
}

function toBlockId(blockNumber: number, generation: number = 0): string {
    return blockNumber.toString(16).padStart(8, '0').concat(generation.toString(16).padStart(32, '0'));
}

function toTransactionId(blockNumber: number, index: number, generation: number = 0): string {
    return (generation * 1e12 + blockNumber * 100000 + index).toString(16).padStart(40, '0');
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
    private forkGeneration = 0;
    private readonly startBlockNumber: number;
    public readonly blockIntervalMs: number;
    public irreversibleLag: number;

    constructor(options: MemoryBlockProviderOptions = {}) {
        this.startBlockNumber = options.startBlockNumber ?? 1;
        this.irreversibleLag = Math.max(0, options.irreversibleLag ?? 0);
        this.headBlockNumber = this.startBlockNumber - 1;
        this.headTime = truncateToSeconds(options.startTime ?? new Date());
        this.blockIntervalMs = options.blockIntervalMs ?? 3000;
    }

    public get head(): number {
        return this.headBlockNumber;
    }

    public get lastIrreversibleBlockNumber(): number {
        return Math.max(this.startBlockNumber - 1, this.headBlockNumber - this.irreversibleLag);
    }

    /**
     * Replaces the block at `blockNumber` (and discards every block above
     * it) with a new block built from `operations`, simulating a
     * microfork. The replacement gets a distinct block id.
     */
    public forkAt(blockNumber: number, operations: Array<[string, any]> = [], options: AddBlockOptions = {}): BlockData {
        if (blockNumber < this.startBlockNumber || blockNumber > this.headBlockNumber) {
            throw new Error(`MemoryBlockProvider: cannot fork at ${blockNumber}; head is ${this.headBlockNumber}`);
        }

        const replaced = this.blocks.get(blockNumber) as BlockData;

        for (let number = blockNumber; number <= this.headBlockNumber; number++) {
            this.blocks.delete(number);
        }

        this.headBlockNumber = blockNumber - 1;
        this.headTime = new Date(`${replaced.timestamp}Z`);
        this.forkGeneration++;

        const block = this.addBlock(operations, { ...options, time: options.time ?? this.headTime });

        return block;
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

        const previousBlock = this.blocks.get(blockNumber - 1);
        const block: BlockData = {
            block_id: toBlockId(blockNumber, this.forkGeneration),
            previous: previousBlock ? previousBlock.block_id : '0'.repeat(40),
            timestamp: toHiveTimestamp(time),
            transactions: transactionOperations.map((ops) => ({ operations: ops })),
            transaction_ids: transactionOperations.map((ops, index) => options.transactionIds?.[index] ?? toTransactionId(blockNumber, index, this.forkGeneration))
        };

        this.blocks.set(blockNumber, block);
        this.headBlockNumber = blockNumber;
        this.headTime = time;

        return block;
    }

    public async getDynamicGlobalProperties(): Promise<DynamicGlobalProperties> {
        return {
            head_block_number: this.headBlockNumber,
            last_irreversible_block_num: this.lastIrreversibleBlockNumber,
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
