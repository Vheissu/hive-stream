import { TimeAction } from './../actions';
import { ContractPayload, TransferMetadata, CustomJsonMetadata, EscrowOperationType, OperationMetadata } from './../types/hive-stream';
import { SignedBlock } from '@hiveio/dhive';
export class AdapterBase {
    protected client: any = null;
    protected db: any = null;
    public readonly capabilities = {
        sql: false
    };

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

    public async processEscrow(operationType: EscrowOperationType, operation: any, metadata: OperationMetadata): Promise<boolean> {
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

    public async runInTransaction<T>(work: (adapter: AdapterBase) => Promise<T>): Promise<T> {
        return work(this);
    }

    public async query(sql: string, params?: any[]): Promise<any[]> {
        throw new Error('Query method not implemented in adapter');
    }

    public async addEvent(date: string | Date, contract: string, action: string, payload: any, data: any): Promise<boolean> {
        return true;
    }

    public async getEvents(): Promise<any[]> {
        return [];
    }

    public async getEventsByContract(contract: string): Promise<any[]> {
        return [];
    }

    public async getEventsByAccount(account: string): Promise<any[]> {
        return [];
    }

    // Exchange helpers (SQL adapters implement these)
    public async getExchangeBalances(account?: string): Promise<any[]> {
        return [];
    }

    public async getExchangeOrders(filters: { account?: string; base?: string; quote?: string; status?: string } = {}): Promise<any[]> {
        return [];
    }

    public async getExchangeTrades(filters: { account?: string; base?: string; quote?: string } = {}): Promise<any[]> {
        return [];
    }

    public async getExchangeOrderBookSnapshots(filters: { base?: string; quote?: string; limit?: number } = {}): Promise<any[]> {
        return [];
    }
}
