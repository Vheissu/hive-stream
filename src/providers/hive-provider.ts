import { Client } from '@hiveio/dhive';
import { BlockProvider, BlockData, DynamicGlobalProperties } from './block-provider';

export interface HiveProviderConfig {
    apiNodes: string[];
}

export class HiveProvider implements BlockProvider {
    private client: Client;

    constructor(config: HiveProviderConfig) {
        this.client = new Client(config.apiNodes);
    }

    public async getDynamicGlobalProperties(): Promise<DynamicGlobalProperties> {
        return this.client.database.getDynamicGlobalProperties() as Promise<DynamicGlobalProperties>;
    }

    public async getBlock(blockNumber: number): Promise<BlockData | null> {
        const block = await this.client.database.getBlock(blockNumber);
        return block as unknown as BlockData | null;
    }

    public updateClient(apiNodes: string[]): void {
        this.client = new Client(apiNodes);
    }

    public getClient(): Client {
        return this.client;
    }
}
