import type { ZodSchema } from 'zod';
import type BigNumber from 'bignumber.js';
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

export interface ParsedAssetAmount {
    rawAmount: string;
    amount: string;
    asset: string;
    value: BigNumber;
}

export interface TransferEvent {
    op: any;
    transfer: {
        from: string;
        to: string;
        rawAmount: string;
        amount: string;
        asset: string;
        memo?: string;
    };
    block: {
        number: number;
        id: string;
        previousId: string;
        time: Date;
    };
    transaction: {
        id: string;
    };
}

export interface FlowDedupeStore {
    has(key: string): boolean | Promise<boolean>;
    add(key: string): void | Promise<void>;
}

export interface AutoBurnIncomingTransfersOptions {
    account?: string;
    percentage?: string | number;
    percent?: string | number;
    basisPoints?: number;
    memo?: string | ((event: TransferEvent) => string);
    allowedSymbols?: string[];
    dedupeStore?: FlowDedupeStore;
    onBurned?: (result: any, event: TransferEvent) => void | Promise<void>;
    onError?: (error: unknown, event: TransferEvent) => void | Promise<void>;
    ignoreZeroAmount?: boolean;
}

export interface FlowRouteBase {
    percentage?: string | number;
    percent?: string | number;
    basisPoints?: number;
    memo?: string | ((event: TransferEvent) => string);
}

export interface FlowBurnRoute extends FlowRouteBase {
    type: 'burn';
}

export interface FlowTransferRoute extends FlowRouteBase {
    type?: 'transfer';
    to: string | ((event: TransferEvent) => string);
}

export type FlowRoute = FlowBurnRoute | FlowTransferRoute;

export interface PlannedFlowRoute {
    type: 'burn' | 'transfer';
    amount: string;
    asset: string;
    memo: string;
    to?: string;
}

export interface AutoRouteIncomingTransfersOptions {
    account?: string;
    routes: FlowRoute[];
    memo?: string | ((event: TransferEvent, route: FlowRoute, index: number) => string);
    allowedSymbols?: string[];
    dedupeStore?: FlowDedupeStore;
    onRouted?: (results: any[], event: TransferEvent, plan: PlannedFlowRoute[]) => void | Promise<void>;
    onError?: (error: unknown, event: TransferEvent) => void | Promise<void>;
    ignoreZeroAmount?: boolean;
}

export interface AutoForwardIncomingTransfersOptions {
    account?: string;
    to: string;
    percentage?: string | number;
    percent?: string | number;
    basisPoints?: number;
    memo?: string | ((event: TransferEvent) => string);
    allowedSymbols?: string[];
    dedupeStore?: FlowDedupeStore;
    onForwarded?: (result: any, event: TransferEvent) => void | Promise<void>;
    onError?: (error: unknown, event: TransferEvent) => void | Promise<void>;
    ignoreZeroAmount?: boolean;
}

export interface AutoRefundIncomingTransfersOptions {
    account?: string;
    percentage?: string | number;
    percent?: string | number;
    basisPoints?: number;
    memo?: string | ((event: TransferEvent) => string);
    allowedSymbols?: string[];
    dedupeStore?: FlowDedupeStore;
    onRefunded?: (result: any, event: TransferEvent) => void | Promise<void>;
    onError?: (error: unknown, event: TransferEvent) => void | Promise<void>;
    ignoreZeroAmount?: boolean;
}

export interface AutoSplitIncomingTransfersOptions {
    account?: string;
    recipients: Array<{
        account: string | ((event: TransferEvent) => string);
        percentage?: string | number;
        percent?: string | number;
        basisPoints?: number;
        memo?: string | ((event: TransferEvent) => string);
    }>;
    memo?: string | ((event: TransferEvent, recipient: { account: string | ((event: TransferEvent) => string) }, index: number) => string);
    allowedSymbols?: string[];
    dedupeStore?: FlowDedupeStore;
    onSplit?: (results: any[], event: TransferEvent, plan: PlannedFlowRoute[]) => void | Promise<void>;
    onError?: (error: unknown, event: TransferEvent) => void | Promise<void>;
    ignoreZeroAmount?: boolean;
}

export interface FlowSubscriptionHandle {
    account: string;
    stop(): void;
}

export interface MoneyNamespace {
    parseAssetAmount(rawAmount: string): ParsedAssetAmount;
    formatAmount(amount: string | number, precision?: number): string;
    formatAssetAmount(amount: string | number, symbol: string, precision?: number): string;
    calculatePercentageAmount(amount: string | number, percentage: string | number, precision?: number): string;
    calculateBasisPointsAmount(amount: string | number, basisPoints: number, precision?: number): string;
    splitAmountByBasisPoints(amount: string | number, basisPoints: number[], precision?: number): string[];
    splitAmountByPercentage(amount: string | number, percentages: Array<string | number>, precision?: number): string[];
}

export interface FlowNamespace {
    autoBurnIncomingTransfers(options?: AutoBurnIncomingTransfersOptions): FlowSubscriptionHandle;
    autoForwardIncomingTransfers(options: AutoForwardIncomingTransfersOptions): FlowSubscriptionHandle;
    autoRefundIncomingTransfers(options?: AutoRefundIncomingTransfersOptions): FlowSubscriptionHandle;
    autoSplitIncomingTransfers(options: AutoSplitIncomingTransfersOptions): FlowSubscriptionHandle;
    autoRouteIncomingTransfers(options: AutoRouteIncomingTransfersOptions): FlowSubscriptionHandle;
}
