import { TransactionType, ContractPayload } from './../types/hive-stream';
export class AdapterBase {
    protected async create(): Promise<boolean> {
        return true;
    }

    protected async destroy(): Promise<boolean> {
        return true;
    }

    protected async loadState(): Promise<any> {
        throw new Error('Load state method not implemented in adapter');
    }

    protected async saveState(data: any): Promise<boolean | any> {
        throw new Error('Save state method not implemented in adapter');
    }

    protected async processOperation(op: any, blockNumber: number, blockId: string, prevBlockId: string, trxId: string, blockTime: Date) {

    }

    protected async processTransfer(operation, payload: ContractPayload, metadata: { sender: string, amount: string }): Promise<boolean> {
        return true;
    }

    protected async processCustomJson(operation, payload: ContractPayload, metadata: { sender: string, isSignedWithActiveKey: boolean }): Promise<boolean> {
        return true;
    }
}