import type { ZodSchema } from 'zod';
import type { Streamer } from '../streamer';
import type { AdapterBase } from '../adapters/base.adapter';
import type { ConfigInterface } from '../config';

export type EscrowOperationType = 'escrow_transfer' | 'escrow_approve' | 'escrow_dispute' | 'escrow_release';

export type TransactionType =
    | 'comment'
    | 'post'
    | 'transfer'
    | 'custom_json'
    | EscrowOperationType
    | 'recurrent_transfer'
    | 'account_update'
    | 'account_update2';

export type ContractTrigger =
    | 'custom_json'
    | 'transfer'
    | 'time'
    | EscrowOperationType
    | 'recurrent_transfer';

export interface ContractPayload {
    contract: string;
    action: string;
    payload?: Record<string, unknown>;
    meta?: Record<string, unknown>;
}

export interface ContractLifecycleContext {
    streamer: Streamer;
    adapter: AdapterBase;
    config: ConfigInterface;
}

export interface ContractContext extends ContractLifecycleContext {
    trigger: ContractTrigger;
    block: {
        number: number;
        id: string;
        previousId: string;
        time: Date;
    };
    transaction: {
        id: string;
    };
    sender?: string;
    transfer?: {
        from: string;
        to: string;
        rawAmount: string;
        amount: string;
        asset: string;
        memo?: string;
    };
    customJson?: {
        id: string;
        json: any;
        isSignedWithActiveKey: boolean;
    };
    escrow?: {
        type: EscrowOperationType;
        from: string;
        to: string;
        agent: string;
        escrowId: number;
        who?: string;
        receiver?: string;
        hiveAmount?: string;
        hbdAmount?: string;
        fee?: string;
        ratificationDeadline?: string;
        expiration?: string;
        approved?: boolean;
    };
    operation?: {
        type: string;
        data: any;
    };
}

export interface ContractActionDefinition<Payload = any> {
    handler: (payload: Payload, ctx: ContractContext) => void | Promise<void>;
    schema?: ZodSchema<Payload>;
    trigger?: ContractTrigger | ContractTrigger[];
    requiresActiveKey?: boolean;
    description?: string;
}

export interface ContractDefinition {
    name: string;
    actions: Record<string, ContractActionDefinition<any>>;
    hooks?: {
        create?: (ctx: ContractLifecycleContext) => void | Promise<void>;
        destroy?: (ctx: ContractLifecycleContext) => void | Promise<void>;
    };
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

export interface EscrowSubscription extends SubscriptionCallback {
    type: EscrowOperationType;
}

export interface OperationMetadata {
    blockNumber?: number;
    blockId?: string;
    previousBlockId?: string;
    transactionId?: string;
    blockTime?: Date;
}

export interface TransferMetadata extends OperationMetadata {
    sender: string;
    amount: string;
}

export interface CustomJsonMetadata extends OperationMetadata {
    sender: string;
    isSignedWithActiveKey: boolean;
}
