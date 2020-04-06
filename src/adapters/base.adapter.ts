import { TransactionType, ContractPayload } from './../types/hive-stream';
export class AdapterBase {
    protected async create() {
        
    }

    protected async destroy() {
        
    }

    protected async loadState() {
        throw new Error('Load state method not implemented in adapter');
    }

    protected async saveState(data: any) {
        throw new Error('Save state method not implemented in adapter');
    }

    protected async processOperation(op: any, blockNumber: number, blockId: string, prevBlockId: string, trxId: string, blockTime: Date) {

    }

    protected async processTransfer(operation, payload: ContractPayload, metadata: { sender: string, amount: string }) {
        
    }

    protected processCustomJson(operation, payload: ContractPayload, metadata: { sender: string, isSignedWithActiveKey: boolean }) {

    }
}