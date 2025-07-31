import { AdapterBase } from '../../src/adapters/base.adapter';

export class MockAdapter extends AdapterBase {
    public async create(): Promise<boolean> {
        return true;
    }

    public async destroy(): Promise<boolean> {
        return true;
    }

    public async loadActions() {
        return [];
    }

    public async loadState() {
        return { lastBlockNumber: 0, actions: [] };
    }

    public async saveState(data: any): Promise<boolean> {
        return true;
    }

    public async processBlock(block: any): Promise<any> {
        return true;
    }

    public async processOperation(op: any, blockNumber: number, blockId: string, prevBlockId: string, trxId: string, blockTime: Date): Promise<any> {
        return true;
    }

    public async processTransfer(operation: any, payload: any, metadata: any): Promise<boolean> {
        return true;
    }

    public async processCustomJson(operation: any, payload: any, metadata: any): Promise<boolean> {
        return true;
    }

    public async find(table: string, queryObject: Record<string, any>): Promise<any> {
        return [];
    }

    public async findOne(table: string, queryObject: Record<string, any>): Promise<any> {
        return null;
    }

    public async insert(table: string, data: any): Promise<any> {
        return true;
    }

    public async replace(table: string, queryObject: Record<string, any>, data: any): Promise<any> {
        return data;
    }

    public async addEvent(date: string | Date, contract: string, action: string, payload: any, data: any): Promise<boolean> {
        return true;
    }

    public async getTransfers() {
        return [];
    }

    public async getEvents() {
        return [];
    }

    public async getJson() {
        return [];
    }

    public async getTransfersByContract(contract: string) {
        return [];
    }

    public async getTransfersByAccount(account: string) {
        return [];
    }

    public async getTransfersByBlockid(blockId: any) {
        return [];
    }

    public async getJsonByContract(contract: string) {
        return [];
    }

    public async getJsonByAccount(account: string) {
        return [];
    }

    public async getJsonByBlockid(blockId: any) {
        return [];
    }
}

export const createMockAdapter = () => new MockAdapter();