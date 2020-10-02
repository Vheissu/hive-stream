import { TimeAction } from './../actions';
import { TransactionType, ContractPayload } from './../types/hive-stream';
import { SignedBlock } from '@hiveio/dhive';
export class AdapterBase {
    constructor() {
        this['client'] = null;
        this['db'] = null;
    }

    protected async create(): Promise<boolean> {
        return true;
    }

    protected async destroy(): Promise<boolean> {
        return true;
    }

    protected async loadActions(): Promise<TimeAction[]> {
        return [];
    }

    protected async loadState(): Promise<any> {
        throw new Error('Load state method not implemented in adapter');
    }

    protected async saveState(data: any): Promise<boolean | any> {
        throw new Error('Save state method not implemented in adapter');
    }

    protected async processBlock(block: SignedBlock): Promise<any> {
        return true;
    }

    protected async processOperation(op: any, blockNumber: number, blockId: string, prevBlockId: string, trxId: string, blockTime: Date): Promise<any> {
        return true;
    }

    protected async processTransfer(operation, payload: ContractPayload, metadata: { sender: string, amount: string }): Promise<boolean> {
        return true;
    }

    protected async processCustomJson(operation, payload: ContractPayload, metadata: { sender: string, isSignedWithActiveKey: boolean }): Promise<boolean> {
        return true;
    }
}