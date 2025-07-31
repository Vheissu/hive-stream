export type TransactionType = 'comment' | 'post' | 'transfer' | 'custom_json';

export interface ContractPayload {
    name: string;
    action: string;
    payload: Record<string, unknown>;
}

export interface StreamerContract {
    name: string;
    contract: ContractInstance;
}

export interface ContractInstance {
    _instance?: any;
    create?(): void;
    destroy?(): void;
    updateBlockInfo?(blockNumber: number, blockId: string, prevBlockId: string, trxId: string): void;
    [key: string]: any;
}

export interface SubscriptionCallback {
    callback: (...args: any[]) => void;
    [key: string]: any;
}

export interface TransferSubscription extends SubscriptionCallback {
    account: string;
}

export interface CustomJsonIdSubscription extends SubscriptionCallback {
    id: string;
}

export interface TransferMetadata {
    sender: string;
    amount: string;
}

export interface CustomJsonMetadata {
    sender: string;
    isSignedWithActiveKey: boolean;
}