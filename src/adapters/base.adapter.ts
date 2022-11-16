import { TimeAction } from './../actions';
import { TransactionType, ContractPayload } from './../types/hive-stream';
import { SignedBlock } from '@hiveio/dhive';
export class AdapterBase {
    constructor() {
        this['client'] = null;
        this['db'] = null;
    }

    public async create(): Promise<boolean> {
        return true;
    }

    public async destroy(): Promise<boolean> {
        return true;
    }

    public async loadActions(): Promise<TimeAction[]> {
        return [];
    }

    public async loadState(): Promise<any> {
        throw new Error('Load state method not implemented in adapter');
    }

    public async saveState(data: any): Promise<boolean | any> {
        throw new Error('Save state method not implemented in adapter');
    }

    public async processBlock(block: SignedBlock): Promise<any> {
        return true;
    }

    public async processOperation(op: any, blockNumber: number, blockId: string, prevBlockId: string, trxId: string, blockTime: Date): Promise<any> {
        return true;
    }

    public async processTransfer(operation, payload: ContractPayload, metadata: { sender: string, amount: string }): Promise<boolean> {
        return true;
    }

    public async processCustomJson(operation, payload: ContractPayload, metadata: { sender: string, isSignedWithActiveKey: boolean }): Promise<boolean> {
        return true;
    }

    public async find(table: string, queryObject: any): Promise<any> {
        return true;
    }

    public async findOne(table: string, queryObject: any): Promise<any> {
        return true;
    }

    public async insert(table: string, data: any): Promise<any> {
        return true;
    }

    public async replace(table: string, queryObject: any, data: any): Promise<any> {
        return true;
    }
}