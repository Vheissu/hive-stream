import { TimeAction } from './../actions';
import { TransactionType, ContractPayload, TransferMetadata, CustomJsonMetadata } from './../types/hive-stream';
import { SignedBlock } from '@hiveio/dhive';
export class AdapterBase {
    protected client: any = null;
    protected db: any = null;

    constructor() {
        this.client = null;
        this.db = null;
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

    public async processTransfer(operation: any, payload: ContractPayload, metadata: TransferMetadata): Promise<boolean> {
        return true;
    }

    public async processCustomJson(operation: any, payload: ContractPayload, metadata: CustomJsonMetadata): Promise<boolean> {
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

    public async query(sql: string, params?: any[]): Promise<any[]> {
        throw new Error('Query method not implemented in adapter');
    }
}