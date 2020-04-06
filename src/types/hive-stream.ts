export type TransactionType = 'comment' | 'post' | 'transfer' | 'custom_json';

export interface ContractPayload {
    name: string;
    action: string;
    payload: any;
}