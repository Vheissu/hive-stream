export interface BlockData {
    block_id: string;
    previous: string;
    timestamp: string;
    transactions: Array<{ operations: Array<[string, any]>; [key: string]: any }>;
    transaction_ids: string[];
    [key: string]: any;
}

export interface DynamicGlobalProperties {
    head_block_number: number;
    /**
     * Highest block that can no longer be reverted. Providers that omit it
     * are treated as if every block they serve is irreversible.
     */
    last_irreversible_block_num?: number;
    time: string;
    [key: string]: any;
}

export interface BlockProvider {
    getDynamicGlobalProperties(): Promise<DynamicGlobalProperties>;
    getBlock(blockNumber: number): Promise<BlockData | null>;
    create?(): Promise<void>;
    destroy?(): Promise<void>;
}
