import { Client, ClientOptions } from '@hiveio/dhive';
import { BlockProvider, BlockData, DynamicGlobalProperties } from './block-provider';

export interface HiveProviderConfig {
    apiNodes: string[];
    /**
     * Per-request timeout in milliseconds. dhive retries across `apiNodes`
     * until this elapses, so a dead node costs at most this long before the
     * next one is tried. Defaults to 10000.
     */
    timeout?: number;
    /**
     * How many full rounds through `apiNodes` dhive attempts before giving up.
     * Defaults to 3.
     */
    failoverThreshold?: number;
}

/**
 * Builds dhive client options that fail over between nodes quickly instead
 * of dhive's default 60 second timeout.
 */
export function createClientOptions(options: { timeout?: number; failoverThreshold?: number } = {}): ClientOptions {
    return {
        timeout: options.timeout ?? 10000,
        failoverThreshold: options.failoverThreshold ?? 3,
    };
}

export class HiveProvider implements BlockProvider {
    private client: Client;
    private readonly clientOptions: ClientOptions;

    constructor(config: HiveProviderConfig) {
        if (!Array.isArray(config?.apiNodes) || config.apiNodes.length === 0) {
            throw new Error('HiveProvider requires at least one API node');
        }

        this.clientOptions = createClientOptions(config);
        this.client = new Client(config.apiNodes, this.clientOptions);
    }

    public async getDynamicGlobalProperties(): Promise<DynamicGlobalProperties> {
        return this.client.database.getDynamicGlobalProperties() as Promise<DynamicGlobalProperties>;
    }

    public async getBlock(blockNumber: number): Promise<BlockData | null> {
        const block = await this.client.database.getBlock(blockNumber);
        return block as unknown as BlockData | null;
    }

    public updateClient(apiNodes: string[]): void {
        this.client = new Client(apiNodes, this.clientOptions);
    }

    public getClient(): Client {
        return this.client;
    }
}
