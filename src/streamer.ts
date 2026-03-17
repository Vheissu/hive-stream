import { AdapterBase } from './adapters/base.adapter';
import { Api } from './api';
import { SqliteAdapter } from './adapters/sqlite.adapter';

import { TimeAction } from './actions';
import { Client } from '@hiveio/dhive';
import BigNumber from 'bignumber.js';
import { Utils } from './utils';
import {
    HiveBurnBuilder,
    HiveEscrowTransferBuilder,
    HiveEngineTokenBurnBuilder,
    HiveEngineTokenIssueBuilder,
    HiveEngineTokenTransferBuilder,
    HiveProposalBuilder,
    HiveProposalVotesBuilder,
    HiveRemoveProposalsBuilder,
    HiveRecurrentTransferBuilder,
    HiveTransferBuilder,
    HiveVoteBuilder,
    IncomingTransfersBuilder
} from './builders';
import { ConfigInput, ConfigInterface, createConfig, normalizeConfigInput } from './config';
import { BlockProvider } from './providers/block-provider';
import { HiveProvider } from './providers/hive-provider';
import { 
    AutoBurnIncomingTransfersOptions,
    AutoForwardIncomingTransfersOptions,
    AutoRefundIncomingTransfersOptions,
    AutoRouteIncomingTransfersOptions,
    AutoSplitIncomingTransfersOptions,
    ContractDefinition,
    ContractPayload,
    ContractContext,
    ContractTrigger,
    FlowDedupeStore,
    FlowGroupRecipient,
    FlowRoute,
    FlowRouteMode,
    FlowTransferGroupRoute,
    FlowNamespace,
    FlowSubscriptionHandle,
    OpsNamespace,
    MoneyNamespace,
    PlannedIncomingTransferRoutes,
    PlannedFlowRoute,
    SubscriptionCallback,
    TransferEvent,
    TransferSubscription,
    CustomJsonIdSubscription,
    EscrowSubscription,
    EscrowOperationType,
} from './types/hive-stream';

import hivejs from 'sscjs';


interface ProcessingAction {
    when: number;
    what: string;
    params: any;
    pending: boolean;
}

export class Streamer {
    private customJsonSubscriptions: SubscriptionCallback[] = [];
    private customJsonIdSubscriptions: CustomJsonIdSubscription[] = [];
    private customJsonHiveEngineSubscriptions: SubscriptionCallback[] = [];
    private commentSubscriptions: SubscriptionCallback[] = [];
    private postSubscriptions: SubscriptionCallback[] = [];
    private transferSubscriptions: TransferSubscription[] = [];
    private escrowSubscriptions: EscrowSubscription[] = [];

    private attempts = 0;

    private config: ConfigInterface = createConfig();
    private client: Client;
    private hive: any;

    private username: string;
    private postingKey: string;
    private activeKey: string;

    private blockNumberTimeout: NodeJS.Timeout = null;
    private latestBlockTimer: NodeJS.Timeout = null;
    private lastBlockNumber: number = 0;
    private headBlockNumber: number = 0;
    private isPollingBlock = false;
    private isCatchingUp = false;

    private blockId: string;
    private previousBlockId: string;
    private transactionId: string;
    private blockTime: Date;
    private latestBlockchainTime: Date;
    private disableAllProcessing = false;
    private isStarted = false;

    private contracts: ContractDefinition[] = [];
    private blockProvider: BlockProvider;
    private adapter: AdapterBase;
    private adapterInitializationPromise: Promise<void> | null = null;
    private adapterInitialized = false;
    private initializedContracts = new Set<string>();
    private apiServer: Api | null = null;
    private actions: TimeAction[] = [];

    // Performance optimization properties
    private lastStateSave = Date.now();
    private stateSaveInterval = 5000; // Save state every 5 seconds instead of every block
    private blockProcessingQueue: Array<() => Promise<void>> = [];
    private isProcessingQueue = false;
    
    // Memory management
    private readonly maxSubscriptions = 1000;
    private subscriptionCleanupInterval: NodeJS.Timeout | null = null;
    
    // Action processing optimization
    private actionFrequencyMap = new Map([
        ['3s', 3], ['block', 3], ['10s', 10], ['30s', 30],
        ['1m', 60], ['5m', 300], ['minute', 60], ['15m', 900], ['quarter', 900],
        ['30m', 1800], ['halfhour', 1800], ['hourly', 3600], ['1h', 3600],
        ['12h', 43200], ['halfday', 43200], ['24h', 86400], ['day', 86400], ['daily', 86400],
        ['week', 604800], ['weekly', 604800]
    ]);
    private contractCache = new Map<string, ContractDefinition>();
    
    // Data caching for performance
    private blockCache = new Map<number, any>();
    private transactionCache = new Map<string, any>();
    private accountCache = new Map<string, { data: any, timestamp: number }>();
    private readonly cacheTimeout = 300000; // 5 minutes
    private readonly maxCacheSize = 1000;
    private lastCacheCleanup = Date.now();

    private utils = Utils;
    public readonly money: MoneyNamespace = {
        parseAssetAmount: (rawAmount: string) => Utils.parseAssetAmount(rawAmount),
        formatAmount: (amount: string | number, precision?: number) => Utils.formatAmount(amount, precision),
        formatAssetAmount: (amount: string | number, symbol: string, precision?: number) => Utils.formatAssetAmount(amount, symbol, precision),
        calculatePercentageAmount: (amount: string | number, percentage: string | number, precision?: number) => Utils.calculatePercentageAmount(amount, percentage, precision),
        calculateBasisPointsAmount: (amount: string | number, basisPoints: number, precision?: number) => Utils.calculateBasisPointsAmount(amount, basisPoints, precision),
        splitAmountByBasisPoints: (amount: string | number, basisPoints: number[], precision?: number) => Utils.splitAmountByBasisPoints(amount, basisPoints, precision),
        splitAmountByPercentage: (amount: string | number, percentages: Array<string | number>, precision?: number) => Utils.splitAmountByPercentage(amount, percentages, precision),
        splitAmountByWeights: (amount: string | number, weights: Array<string | number>, precision?: number) => Utils.splitAmountByWeights(amount, weights, precision),
    };
    public readonly flows: FlowNamespace = {
        incomingTransfers: (account?: string) => new IncomingTransfersBuilder(this, account),
        autoBurnIncomingTransfers: (options: AutoBurnIncomingTransfersOptions = {}) => this.autoBurnIncomingTransfers(options),
        autoForwardIncomingTransfers: (options: AutoForwardIncomingTransfersOptions) => this.autoForwardIncomingTransfers(options),
        autoRefundIncomingTransfers: (options: AutoRefundIncomingTransfersOptions = {}) => this.autoRefundIncomingTransfers(options),
        autoSplitIncomingTransfers: (options: AutoSplitIncomingTransfersOptions) => this.autoSplitIncomingTransfers(options),
        autoRouteIncomingTransfers: (options: AutoRouteIncomingTransfersOptions) => this.autoRouteIncomingTransfers(options),
        planIncomingTransferRoutes: (transfer, options) => this.planIncomingTransferRoutes(transfer, options),
    };
    public readonly ops: OpsNamespace = {
        transfer: () => new HiveTransferBuilder(this),
        burn: () => new HiveBurnBuilder(this),
        escrowTransfer: () => new HiveEscrowTransferBuilder(this),
        recurrentTransfer: () => new HiveRecurrentTransferBuilder(this),
        createProposal: () => new HiveProposalBuilder(this),
        transferEngine: () => new HiveEngineTokenTransferBuilder(this),
        burnEngine: () => new HiveEngineTokenBurnBuilder(this),
        issueEngine: () => new HiveEngineTokenIssueBuilder(this),
        voteProposals: () => new HiveProposalVotesBuilder(this),
        removeProposals: () => new HiveRemoveProposalsBuilder(this),
        upvote: () => new HiveVoteBuilder(this, 'upvote'),
        downvote: () => new HiveVoteBuilder(this, 'downvote'),
    };

    constructor(userConfig: ConfigInput = {}) {
        this.config = createConfig(userConfig);

        this.lastBlockNumber = this.config.LAST_BLOCK_NUMBER;

        this.username = this.config.USERNAME;
        this.postingKey = this.config.POSTING_KEY;
        this.activeKey = this.config.ACTIVE_KEY;

        this.hive = new hivejs(this.config.HIVE_ENGINE_API);
        this.client = new Client(this.config.API_NODES);
        this.adapter = new SqliteAdapter();

        if (userConfig.blockProvider) {
            this.blockProvider = userConfig.blockProvider;
        } else {
            this.blockProvider = new HiveProvider({ apiNodes: this.config.API_NODES });
        }
    }

    private async ensureAdapterReady(): Promise<void> {
        if (this.adapterInitialized) {
            return;
        }

        if (!this.adapter) {
            throw new Error('No adapter registered');
        }

        if (!this.adapterInitializationPromise) {
            this.adapterInitializationPromise = Promise.resolve(this.adapter.create?.())
                .then(() => {
                    this.adapterInitialized = true;
                })
                .catch((error) => {
                    this.adapterInitializationPromise = null;
                    this.adapterInitialized = false;
                    throw error;
                });
        }

        await this.adapterInitializationPromise;
    }

    private getLifecycleContext() {
        return {
            streamer: this,
            adapter: this.adapter,
            config: this.config
        };
    }

    private createTransferEvent(
        op: any,
        blockNumber: number,
        blockId: string,
        prevBlockId: string,
        trxId: string,
        blockTime: Date
    ): TransferEvent {
        const rawAmount = String(op?.amount || '');
        let amount = '';
        let asset = '';

        try {
            const parsed = Utils.parseAssetAmount(rawAmount);
            amount = parsed.amount;
            asset = parsed.asset;
        } catch (error) {
            amount = '';
            asset = '';
        }

        return {
            op,
            transfer: {
                from: op?.from || '',
                to: op?.to || '',
                rawAmount,
                amount,
                asset,
                memo: op?.memo
            },
            block: {
                number: blockNumber,
                id: blockId,
                previousId: prevBlockId,
                time: blockTime
            },
            transaction: {
                id: trxId
            }
        };
    }

    private normalizeTransferPreviewInput(
        transfer: string | TransferEvent | { amount?: string; from?: string; to?: string; memo?: string }
    ): TransferEvent {
        if (typeof transfer === 'object' && transfer !== null && 'transfer' in transfer && 'transaction' in transfer && 'block' in transfer) {
            return transfer as TransferEvent;
        }

        const op = typeof transfer === 'string'
            ? { amount: transfer }
            : transfer || {};

        return this.createTransferEvent(op, 0, '', '', '', new Date(0));
    }

    private resolveAccount(account?: string): string {
        const resolved = account || this.username || this.config.USERNAME;

        if (!resolved) {
            throw new Error('Account is required');
        }

        return resolved;
    }

    private async dedupeHas(store: FlowDedupeStore, key: string): Promise<boolean> {
        return Boolean(await store.has(key));
    }

    private async dedupeAdd(store: FlowDedupeStore, key: string): Promise<void> {
        await store.add(key);
    }

    private normalizeDedupeStore(dedupeStore?: FlowDedupeStore | Set<string>): FlowDedupeStore {
        const store = dedupeStore || new Set<string>();

        if (store instanceof Set) {
            return {
                has: (key: string) => store.has(key),
                add: (key: string) => {
                    store.add(key);
                    if (store.size > 10000) {
                        const oldest = store.values().next().value;
                        store.delete(oldest);
                    }
                }
            };
        }

        return store;
    }

    private isZeroAmountFlowError(error: unknown): boolean {
        return error instanceof Error
            && (error.message === 'Burn amount must be greater than zero' || error.message === 'Route amount must be greater than zero');
    }

    private resolveFlowBasisPoints(
        options: { percentage?: string | number; percent?: string | number; basisPoints?: number },
        context: string,
        allowUnspecified: boolean = true
    ): number | null {
        const percentage = options.percentage ?? options.percent;
        const basisPoints = options.basisPoints;

        if (percentage !== undefined && basisPoints !== undefined) {
            throw new Error(`${context} accepts either percentage or basisPoints, not both`);
        }

        if (percentage === undefined && basisPoints === undefined) {
            if (allowUnspecified) {
                return null;
            }

            throw new Error(`${context} requires percentage or basisPoints`);
        }

        if (basisPoints !== undefined) {
            if (!Number.isInteger(basisPoints) || basisPoints < 0 || basisPoints > 10000) {
                throw new Error(`${context} basisPoints must be an integer between 0 and 10000`);
            }

            return basisPoints;
        }

        const percentageValue = new BigNumber(percentage);
        if (percentageValue.isNaN() || !percentageValue.isFinite()) {
            throw new Error(`${context} percentage must be a valid number`);
        }

        if (percentageValue.lt(0) || percentageValue.gt(100)) {
            throw new Error(`${context} percentage must be between 0 and 100`);
        }

        const bps = percentageValue.multipliedBy(100);
        if (!bps.isInteger()) {
            throw new Error(`${context} percentage supports up to 2 decimal places; use basisPoints for finer control`);
        }

        return bps.toNumber();
    }

    private resolveFlowMode(route: FlowRoute): FlowRouteMode {
        return route.mode === 'onTop' ? 'onTop' : 'base';
    }

    private normalizeBaseRouteAllocations(routes: FlowRoute[]): number[] {
        const allocations = routes.map((route, index) => this.resolveFlowBasisPoints(route, `Route ${index + 1}`, true));
        const unspecified = allocations.filter((allocation) => allocation === null).length;
        const explicitTotal = allocations.reduce((sum, allocation) => sum + (allocation || 0), 0);

        if (unspecified > 1) {
            throw new Error('Only one flow route can omit percentage or basisPoints');
        }

        if (explicitTotal > 10000) {
            throw new Error('Flow route allocations cannot exceed 10000 basis points');
        }

        if (unspecified === 0 && explicitTotal !== 10000) {
            throw new Error('Flow route allocations must total 100%');
        }

        if (unspecified === 1) {
            const remainder = 10000 - explicitTotal;

            return allocations.map((allocation) => allocation === null ? remainder : allocation);
        }

        return allocations as number[];
    }

    private normalizeOnTopRouteAllocations(routes: FlowRoute[]): number[] {
        const allocations = routes.map((route, index) => this.resolveFlowBasisPoints(route, `On-top route ${index + 1}`, false) as number);
        const explicitTotal = allocations.reduce((sum, allocation) => sum + allocation, 0);

        if (explicitTotal <= 0) {
            throw new Error('On-top flow route allocations must be greater than zero');
        }

        return allocations;
    }

    private resolvePlannedRouteMemo(
        event: TransferEvent,
        route: FlowRoute,
        index: number,
        defaultMemo?: string | ((event: TransferEvent, route: FlowRoute, index: number) => string)
    ): string {
        if (typeof route.memo === 'function') {
            return route.memo(event);
        }

        if (typeof route.memo === 'string') {
            return route.memo;
        }

        if (typeof defaultMemo === 'function') {
            return defaultMemo(event, route, index);
        }

        return defaultMemo || '';
    }

    private resolveGroupSplitStrategy(route: FlowTransferGroupRoute): 'equal' | 'weighted' {
        if (route.split) {
            return route.split;
        }

        return route.group.some((recipient) => recipient.weight !== undefined) ? 'weighted' : 'equal';
    }

    private resolveGroupWeights(route: FlowTransferGroupRoute, routeIndex: number): Array<string | number> {
        if (!Array.isArray(route.group) || route.group.length === 0) {
            throw new Error(`Route ${routeIndex + 1} group must include at least one account`);
        }

        if (this.resolveGroupSplitStrategy(route) === 'equal') {
            return route.group.map(() => 1);
        }

        return route.group.map((recipient, groupIndex) => {
            if (recipient.weight === undefined) {
                return 1;
            }

            const weight = new BigNumber(recipient.weight);
            if (weight.isNaN() || !weight.isFinite() || weight.lte(0)) {
                throw new Error(`Route ${routeIndex + 1} recipient ${groupIndex + 1} weight must be greater than zero`);
            }

            return weight.toString();
        });
    }

    private expandPlannedRoute(
        event: TransferEvent,
        route: FlowRoute,
        routeIndex: number,
        amount: string,
        asset: string,
        memo: string
    ): PlannedFlowRoute[] {
        const mode = this.resolveFlowMode(route);

        if (route.type === 'burn') {
            return [{
                type: 'burn',
                mode,
                amount,
                asset,
                memo,
                routeIndex
            }];
        }

        if ('group' in route) {
            const weights = this.resolveGroupWeights(route, routeIndex);
            const amounts = Utils.splitAmountByWeights(amount, weights);

            return route.group.map((recipient: FlowGroupRecipient, groupIndex: number) => {
                const destination = typeof recipient.account === 'function' ? recipient.account(event) : recipient.account;
                if (typeof destination !== 'string' || destination.trim().length === 0) {
                    throw new Error(`Route ${routeIndex + 1} recipient ${groupIndex + 1} destination account is required`);
                }

                return {
                    type: 'transfer',
                    mode,
                    amount: amounts[groupIndex],
                    asset,
                    memo,
                    to: destination.trim(),
                    routeIndex,
                    groupIndex
                };
            });
        }

        const destination = typeof route.to === 'function' ? route.to(event) : route.to;
        if (typeof destination !== 'string' || destination.trim().length === 0) {
            throw new Error(`Route ${routeIndex + 1} destination account is required`);
        }

        return [{
            type: 'transfer',
            mode,
            amount,
            asset,
            memo,
            to: destination.trim(),
            routeIndex
        }];
    }

    private sumPlannedRouteAmounts(plan: PlannedFlowRoute[]): string {
        return plan.reduce((sum, route) => sum.plus(route.amount), new BigNumber(0)).toFixed(3);
    }

    private buildPlannedIncomingTransferRoutes(
        event: TransferEvent,
        routes: FlowRoute[],
        allowedSymbols: string[],
        defaultMemo?: string | ((event: TransferEvent, route: FlowRoute, index: number) => string)
    ): PlannedIncomingTransferRoutes {
        if (!Array.isArray(routes) || routes.length === 0) {
            throw new Error('At least one flow route is required');
        }

        const parsed = Utils.parseAssetAmount(event.transfer.rawAmount);

        if (Array.isArray(allowedSymbols) && allowedSymbols.length > 0 && !allowedSymbols.includes(parsed.asset)) {
            throw new Error(`Asset '${parsed.asset}' is not allowed for this flow`);
        }

        const baseRoutes = routes.filter((route) => this.resolveFlowMode(route) === 'base');
        const onTopRoutes = routes.filter((route) => this.resolveFlowMode(route) === 'onTop');

        if (baseRoutes.length === 0) {
            throw new Error('At least one base flow route is required');
        }

        const baseAllocations = this.normalizeBaseRouteAllocations(baseRoutes);
        let baseAmount = parsed.amount;
        let onTopRouteAmounts: string[] = [];

        if (onTopRoutes.length > 0) {
            const onTopAllocations = this.normalizeOnTopRouteAllocations(onTopRoutes);
            const pools = Utils.splitAmountByWeights(parsed.value, [10000, ...onTopAllocations]);

            baseAmount = pools[0];
            onTopRouteAmounts = pools.slice(1);
        }

        const baseRouteAmounts = Utils.splitAmountByBasisPoints(baseAmount, baseAllocations);
        const routesPlan = routes.flatMap((route, index) => {
            const memo = this.resolvePlannedRouteMemo(event, route, index, defaultMemo);
            const amount = this.resolveFlowMode(route) === 'base'
                ? baseRouteAmounts.shift()
                : onTopRouteAmounts.shift();

            return this.expandPlannedRoute(event, route, index, amount, parsed.asset, memo);
        });
        const onTopPlannedRoutes = routesPlan.filter((route) => route.mode === 'onTop');

        return {
            incomingAmount: Utils.formatAssetAmount(parsed.value, parsed.asset),
            asset: parsed.asset,
            baseAmount,
            onTopAmount: this.sumPlannedRouteAmounts(onTopPlannedRoutes),
            routes: routesPlan
        };
    }

    private async executePlannedFlowRoutes(from: string, plan: PlannedFlowRoute[], ignoreZeroAmount: boolean): Promise<any[]> {
        const results: any[] = [];

        for (const route of plan) {
            if (route.amount === '0.000') {
                if (ignoreZeroAmount) {
                    continue;
                }

                throw new Error('Route amount must be greater than zero');
            }

            if (route.type === 'burn') {
                results.push(await this.burnHiveTokens(from, route.amount, route.asset, route.memo));
                continue;
            }

            results.push(await this.transferHiveTokens(from, route.to, route.amount, route.asset, route.memo));
        }

        return results;
    }

    private calculateSingleFlowAmount(
        transfer: { amount?: string } | string,
        basisPoints: number | null,
        allowedSymbols: string[],
        errorContext: string
    ): { amount: string; asset: string } {
        const rawAmount = typeof transfer === 'string' ? transfer : transfer?.amount || '';
        const parsed = Utils.parseAssetAmount(rawAmount);

        if (Array.isArray(allowedSymbols) && allowedSymbols.length > 0 && !allowedSymbols.includes(parsed.asset)) {
            throw new Error(`Asset '${parsed.asset}' is not allowed for ${errorContext}`);
        }

        const amount = basisPoints === null ? parsed.amount : Utils.calculateBasisPointsAmount(parsed.value, basisPoints);
        if (amount === '0.000') {
            throw new Error('Route amount must be greater than zero');
        }

        return {
            amount,
            asset: parsed.asset
        };
    }

    private async initializeContract(contract: ContractDefinition): Promise<void> {
        if (this.initializedContracts.has(contract.name)) {
            return;
        }

        await this.ensureAdapterReady();

        if (contract.hooks?.create) {
            await contract.hooks.create(this.getLifecycleContext());
        }

        this.initializedContracts.add(contract.name);
    }

    private async initializeContracts(): Promise<void> {
        for (const contract of this.contracts) {
            await this.initializeContract(contract);
        }
    }

    private async destroyContractLifecycle(contract: ContractDefinition): Promise<void> {
        if (!this.initializedContracts.has(contract.name)) {
            return;
        }

        if (contract.hooks?.destroy) {
            await contract.hooks.destroy(this.getLifecycleContext());
        }

        this.initializedContracts.delete(contract.name);
    }

    private async destroyContracts(): Promise<void> {
        for (const contract of [...this.contracts]) {
            await this.destroyContractLifecycle(contract);
        }
    }

    private startSubscriptionCleanupInterval(): void {
        if (this.subscriptionCleanupInterval) {
            return;
        }

        this.subscriptionCleanupInterval = setInterval(() => {
            this.cleanupSubscriptions();
        }, 60000);
    }

    private clearRuntimeTimers(): void {
        if (this.blockNumberTimeout) {
            clearTimeout(this.blockNumberTimeout);
            this.blockNumberTimeout = null;
        }

        if (this.latestBlockTimer) {
            clearInterval(this.latestBlockTimer);
            this.latestBlockTimer = null;
        }

        if (this.subscriptionCleanupInterval) {
            clearInterval(this.subscriptionCleanupInterval);
            this.subscriptionCleanupInterval = null;
        }

        this.isPollingBlock = false;
    }

    public async registerAdapter(adapter: AdapterBase) {
        if (!adapter) {
            throw new Error('Adapter must be provided');
        }

        await this.destroyContracts();

        if (this.adapterInitialized && this.adapter?.destroy) {
            try {
                await this.adapter.destroy();
            } catch (error) {
                console.warn('[Streamer] Error destroying existing adapter:', error);
            }
        }

        this.adapter = adapter;
        this.adapterInitialized = false;
        this.adapterInitializationPromise = null;

        await this.ensureAdapterReady();
        await this.initializeContracts();
    }

    public getAdapter(): AdapterBase {
        return this.adapter;
    }

    /**
     * Register a new action with improved validation and persistence
     */
    public async registerAction(action: TimeAction): Promise<void> {
        if (!action || !(action instanceof TimeAction)) {
            throw new Error('Invalid action: must be an instance of TimeAction');
        }

        await this.ensureAdapterReady();

        const loadedActions: TimeAction[] = await this.adapter.loadActions() as TimeAction[];

        for (const a of loadedActions) {
            const exists = this.actions.find(i => i.id === a.id);

            if (!exists) {
                try {
                    const restoredAction = TimeAction.fromJSON(a);
                    this.actions.push(restoredAction);
                } catch (error) {
                    console.warn(`[Streamer] Failed to restore action ${a.id}:`, error);
                }
            }
        }

        const exists = this.actions.find(a => a.id === action.id);

        if (!exists) {
            this.validateActionContract(action);
            this.actions.push(action);
            
            await this.saveActionsToDisk();
            
            if (this.config.DEBUG_MODE) {
                console.log(`[Streamer] Registered time-based action: ${action.id} (${action.timeValue})`);
            }
        } else {
            if (this.config.DEBUG_MODE) {
                console.warn(`[Streamer] Action with ID ${action.id} already exists, skipping registration`);
            }
        }
    }

    /**
     * Validate that the contract and method exist for the action
     */
    private validateActionContract(action: TimeAction): void {
        const contract = this.contractCache.get(action.contractName) || 
                        this.contracts.find(c => c.name === action.contractName);
        
        if (!contract) {
            throw new Error(`Contract '${action.contractName}' not found for action '${action.id}'`);
        }
        
        const actionDefinition = contract.actions?.[action.contractAction];

        if (!actionDefinition || typeof actionDefinition.handler !== 'function') {
            throw new Error(`Action '${action.contractAction}' not found in contract '${action.contractName}' for action '${action.id}'`);
        }

        if (!this.isActionTriggerAllowed(actionDefinition, 'time')) {
            throw new Error(`Action '${action.contractAction}' does not allow time triggers for action '${action.id}'`);
        }
    }

    private isActionTriggerAllowed(actionDefinition: any, trigger: ContractTrigger): boolean {
        const configured = actionDefinition?.trigger;
        const triggers = configured
            ? (Array.isArray(configured) ? configured : [configured])
            : ['custom_json'];

        return triggers.includes(trigger);
    }

    /**
     * Remove an action by ID
     */
    public async removeAction(actionId: string): Promise<boolean> {
        const index = this.actions.findIndex(a => a.id === actionId);
        
        if (index >= 0) {
            const removedAction = this.actions.splice(index, 1)[0];
            await this.saveActionsToDisk();
            
            if (this.config.DEBUG_MODE) {
                console.log(`[Streamer] Removed time-based action: ${actionId}`);
            }
            
            return true;
        }
        
        return false;
    }

    /**
     * Get all registered actions
     */
    public getActions(): TimeAction[] {
        return [...this.actions];
    }

    /**
     * Get action by ID
     */
    public getAction(actionId: string): TimeAction | undefined {
        return this.actions.find(a => a.id === actionId);
    }

    /**
     * Enable/disable an action
     */
    public async setActionEnabled(actionId: string, enabled: boolean): Promise<boolean> {
        const action = this.actions.find(a => a.id === actionId);
        
        if (action) {
            if (enabled) {
                action.enable();
            } else {
                action.disable();
            }
            
            await this.saveActionsToDisk();
            
            if (this.config.DEBUG_MODE) {
                console.log(`[Streamer] Action ${actionId} ${enabled ? 'enabled' : 'disabled'}`);
            }
            
            return true;
        }
        
        return false;
    }

    /**
     * Save actions to disk asynchronously
     */
    private async saveActionsToDisk(): Promise<void> {
        try {
            if (this.adapterInitialized && this.adapter?.saveState) {
                await this.adapter.saveState({
                    lastBlockNumber: this.lastBlockNumber,
                    actions: this.actions.map(a => a.toJSON())
                });
            }
        } catch (error) {
            if (error?.code !== 'SQLITE_MISUSE') {
                console.error('[Streamer] Failed to save actions to disk:', error);
            }
        }
    }

    /**
     * Resets a specific action time value
     */
    public async resetAction(id: string): Promise<boolean> {
        const action = this.actions.find(i => i.id === id);

        if (action) {
            action.reset();
            await this.saveActionsToDisk();
            
            if (this.config.DEBUG_MODE) {
                console.log(`[Streamer] Reset action: ${id}`);
            }
            
            return true;
        }
        
        return false;
    }

    public async registerContract(contract: ContractDefinition): Promise<void> {
        if (!contract || typeof contract !== 'object') {
            throw new Error('Contract must be a valid definition object');
        }

        if (!contract.name || typeof contract.name !== 'string') {
            throw new Error('Contract name must be a non-empty string');
        }

        if (this.contractCache.has(contract.name)) {
            throw new Error(`Contract '${contract.name}' is already registered`);
        }

        if (!contract.actions || typeof contract.actions !== 'object') {
            throw new Error(`Contract '${contract.name}' must define actions`);
        }

        await this.initializeContract(contract);
        this.contracts.push(contract);
        this.contractCache.set(contract.name, contract);
    }

    public async unregisterContract(name: string): Promise<void> {
        const contractIndex = this.contracts.findIndex(c => c.name === name);

        if (contractIndex >= 0) {
            const contract = this.contracts[contractIndex];
            await this.destroyContractLifecycle(contract);
            this.contracts.splice(contractIndex, 1);
            this.contractCache.delete(name);
        }
    }

    /**
     * setConfig
     *
     * Allows specific configuration settings to be overridden
     *
     * @param config
     */
    public setConfig(config: ConfigInput) {
        const normalizedInput = normalizeConfigInput(config);
        const nextConfig = createConfig({
            ...this.config,
            ...normalizedInput,
            env: config.env,
        });
        const shouldRecreateClient = JSON.stringify(this.config.API_NODES) !== JSON.stringify(nextConfig.API_NODES);
        const shouldRecreateHiveEngine = this.config.HIVE_ENGINE_API !== nextConfig.HIVE_ENGINE_API;
        const shouldSyncApiServer = this.config.API_ENABLED !== nextConfig.API_ENABLED || this.config.API_PORT !== nextConfig.API_PORT;

        Object.assign(this.config, nextConfig);

        // Set keys and username incase they have changed
        this.username = this.config.USERNAME;
        this.postingKey = this.config.POSTING_KEY;
        this.activeKey = this.config.ACTIVE_KEY;

        if (shouldRecreateClient) {
            this.client = new Client(this.config.API_NODES);

            if (this.blockProvider instanceof HiveProvider) {
                this.blockProvider.updateClient(this.config.API_NODES);
            }
        }

        if (shouldRecreateHiveEngine) {
            this.hive = new hivejs(this.config.HIVE_ENGINE_API);
        }

        if (shouldSyncApiServer && (this.apiServer || this.isStarted)) {
            const syncApiServer = this.config.API_ENABLED
                ? this.startApiServer(this.config.API_PORT)
                : this.stopApiServer();

            syncApiServer.catch((error) => {
                console.error('[Streamer] Failed to sync API server after config update:', error);
            });
        }

        return this;
    }

    /**
     * Start
     *
     * Starts the streamer bot to get blocks from the Hive API
     *
     */
    public async start(): Promise<Streamer> {
        if (this.isStarted) {
            return this;
        }

        if (this.config.DEBUG_MODE) {
            console.log('Starting to stream the Hive blockchain');
        }

        this.disableAllProcessing = false;
        await this.ensureAdapterReady();
        await this.blockProvider.create?.();
        await this.initializeContracts();
        this.startSubscriptionCleanupInterval();

        const state = await this.adapter.loadState();

        if (this.config.DEBUG_MODE) {
            console.log(`Restoring state from file`);
        }

        if (this.config.RESUME_FROM_STATE && state?.lastBlockNumber) {
            this.lastBlockNumber = state.lastBlockNumber;
        } else if (this.config.LAST_BLOCK_NUMBER) {
            this.lastBlockNumber = this.config.LAST_BLOCK_NUMBER;
        }

        if (this.config.API_ENABLED) {
            await this.startApiServer(this.config.API_PORT);
        }

        // Kicks off the blockchain streaming and operation parsing
        this.getBlock();

        this.latestBlockTimer = setInterval(() => { this.getLatestBlock(); }, this.config.BLOCK_CHECK_INTERVAL);
        this.isStarted = true;

        return this;
    }

    /**
     * Stop
     *
     * Stops the streamer from running
     */
    public async stop(): Promise<void> {
        this.disableAllProcessing = true;
        this.isStarted = false;
        this.clearRuntimeTimers();

        await this.stopApiServer();
        await this.destroyContracts();

        if (this.adapterInitialized && this?.adapter?.destroy) {
            await this.adapter.destroy();
        }

        await this.blockProvider.destroy?.();

        this.adapterInitialized = false;
        this.adapterInitializationPromise = null;

        await Utils.sleep(25);
    }

    public async startApiServer(port: number = this.config.API_PORT): Promise<Api> {
        await this.ensureAdapterReady();

        if (this.apiServer?.server && this.apiServer.port === port) {
            return this.apiServer;
        }

        if (this.apiServer) {
            await this.stopApiServer();
        }

        this.apiServer = new Api(this, { port });
        await this.apiServer.start();
        return this.apiServer;
    }

    public async stopApiServer(): Promise<void> {
        if (!this.apiServer) {
            return;
        }

        const apiServer = this.apiServer;
        this.apiServer = null;
        await apiServer.stop();
    }

    public getApiServer(): Api | null {
        return this.apiServer;
    }

    public async registerBlockProvider(provider: BlockProvider): Promise<void> {
        await this.blockProvider.destroy?.();
        this.blockProvider = provider;
        await this.blockProvider.create?.();
    }

    public getBlockProvider(): BlockProvider {
        return this.blockProvider;
    }

    private async getLatestBlock() {
        try {
            const props = await this.blockProvider.getDynamicGlobalProperties();

            if (props) {
                this.latestBlockchainTime = new Date(`${props.time}Z`);
            }
        } catch (error) {
            console.error('[Streamer] Error getting latest block:', error);
            // Continue with cached time if available
        }
    }

    private async getBlock(): Promise<void> {
        if (this.isPollingBlock) {
            return;
        }

        this.isPollingBlock = true;
        let nextDelay = this.config.BLOCK_CHECK_INTERVAL;

        try {
            // Load global properties from the block provider
            const props = await this.blockProvider.getDynamicGlobalProperties();

            // We have no props, so try loading them again.
            if (!props) {
                return;
            }

            this.headBlockNumber = props.head_block_number;

            // If the block number we've got is zero set it to the latest head block
            if (this.lastBlockNumber === 0) {
                this.lastBlockNumber = props.head_block_number - 1;
            }

            if (this.config.DEBUG_MODE) {
                console.log(`Head block number: `, props.head_block_number);
                console.log(`Last block number: `, this.lastBlockNumber);
            }

            const BLOCKS_BEHIND = this.config.BLOCKS_BEHIND_WARNING;
            const maxBatchSize = Math.max(1, this.config.CATCH_UP_BATCH_SIZE || 1);
            const blocksBehind = Math.max(0, props.head_block_number - this.lastBlockNumber);
            const blocksToProcess = Math.min(blocksBehind, maxBatchSize);

            if (blocksBehind >= BLOCKS_BEHIND && this.config.DEBUG_MODE) {
                console.log(`[Streamer] ${blocksBehind} blocks behind head (${props.head_block_number}). Catching up...`);
            }

            if (!this.disableAllProcessing) {
                for (let i = 0; i < blocksToProcess; i++) {
                    await this.loadBlock(this.lastBlockNumber + 1);
                }
            }

            const remainingBehind = Math.max(0, props.head_block_number - this.lastBlockNumber);
            this.isCatchingUp = remainingBehind > 0;

            if (remainingBehind > 0) {
                nextDelay = Math.max(0, this.config.CATCH_UP_DELAY_MS);
            }
        } catch (e) {
            const error = e instanceof Error ? e : new Error(String(e));
            console.error(`[Streamer] Block processing error: ${error.message}`, {
                stack: error.stack,
                blockNumber: this.lastBlockNumber + 1
            });
            
            // Retry after a longer delay on error
            nextDelay = this.config.BLOCK_CHECK_INTERVAL * 2;
        } finally {
            this.isPollingBlock = false;
            // Storing timeout allows us to clear it, as this just calls itself
            if (!this.disableAllProcessing) {
                this.blockNumberTimeout = setTimeout(() => { this.getBlock(); }, nextDelay);
            }
        }
    }

    // Takes the block from Hive and allows us to work with it
    private async loadBlock(blockNumber: number): Promise<void> {
        // Check cache first
        let block = this.blockCache.get(blockNumber);
        
        if (!block) {
            // Load the block from the active block provider
            block = await this.blockProvider.getBlock(blockNumber);
            
            // Cache the block for potential reuse
            if (block) {
                this.blockCache.set(blockNumber, block);
                
                // Cleanup old cache entries
                if (this.blockCache.size > this.maxCacheSize) {
                    const oldestKey = this.blockCache.keys().next().value;
                    this.blockCache.delete(oldestKey);
                }
            }
        }

        // The block doesn't exist, wait and try again
        if (!block) {
            await Utils.sleep(this.config.BLOCK_CHECK_INTERVAL);
            return;
        }

        // Get the block date and time
        const blockTime = new Date(`${block.timestamp}Z`);

        if (this.lastBlockNumber !== blockNumber) {
            this.processActions().catch(error => {
                console.error('[Streamer] Error processing actions:', error);
            });
        }

        this.blockId = block.block_id;
        this.previousBlockId = block.previous;
        this.transactionId = block.transaction_ids[0];
        this.blockTime = blockTime;

        if (this.adapter?.processBlock) {
            await this.adapter.processBlock(block);
        }

        // Hive operations are order-sensitive, so process them sequentially.
        const transactions = block.transactions as any[];
        const transactionIds = block.transaction_ids;

        for (let i = 0; i < transactions.length; i++) {
            const transaction = transactions[i];
            const operations = transaction.operations;

            for (let opIndex = 0; opIndex < operations.length; opIndex++) {
                const op = operations[opIndex];

                try {
                    await this.processOperation(
                        op as [string, any],
                        blockNumber,
                        block.block_id,
                        block.previous,
                        transactionIds[i],
                        blockTime
                    );
                } catch (error) {
                    console.error('[Streamer] Operation processing error:', error, {
                        blockNumber,
                        transactionIndex: i,
                        operationIndex: opIndex
                    });
                }
            }
        }

        this.lastBlockNumber = blockNumber;
        this.saveStateThrottled();
        this.cleanupCaches();
    }

    private cleanupCaches(): void {
        const now = Date.now();
        if (now - this.lastCacheCleanup < 60000) {
            return;
        }
        this.lastCacheCleanup = now;

        if (this.blockCache.size > 100) {
            const entriesToRemove = this.blockCache.size - 100;
            const iterator = this.blockCache.keys();
            for (let i = 0; i < entriesToRemove; i++) {
                const key = iterator.next().value;
                this.blockCache.delete(key);
            }
        }

        for (const [key, value] of this.accountCache) {
            if (now - value.timestamp > this.cacheTimeout) {
                this.accountCache.delete(key);
            }
        }

        if (this.transactionCache.size > this.maxCacheSize) {
            this.transactionCache.clear();
        }
    }

    public async processOperation(op: [string, any], blockNumber: number, blockId: string, prevBlockId: string, trxId: string, blockTime: Date): Promise<void> {
        const operationType = op[0];
        const operationData = op[1];
        const operationMetadata = {
            blockNumber,
            blockId,
            previousBlockId: prevBlockId,
            transactionId: trxId,
            blockTime
        };

        if (this.adapter?.processOperation) {
            await this.adapter.processOperation(op, blockNumber, blockId, prevBlockId, trxId, blockTime);
        }

        // Operation is a "comment" which could either be a post or comment
        if (operationType === 'comment') {
            // This is a post
            if (operationData.parent_author === '') {
                this.postSubscriptions.forEach(sub => {
                    sub.callback(
                        operationData,
                        blockNumber,
                        blockId,
                        prevBlockId,
                        trxId,
                        blockTime
                    );
                });
                // This is a comment
            } else {
                this.commentSubscriptions.forEach(sub => {
                    sub.callback(
                        operationData,
                        blockNumber,
                        blockId,
                        prevBlockId,
                        trxId,
                        blockTime
                    );
                });
            }
        }

        // This is a transfer
        if (operationType === 'transfer') {
            const sender = operationData?.from;
            const rawAmount = operationData?.amount;
            let amount = '';
            let asset = '';

            try {
                const parsedAmount = Utils.parseAssetAmount(String(rawAmount || ''));
                amount = parsedAmount.amount;
                asset = parsedAmount.asset;
            } catch (error) {
                amount = '';
                asset = '';
            }

            const transferInfo = {
                from: sender,
                to: operationData?.to,
                rawAmount: rawAmount || '',
                amount,
                asset,
                memo: operationData?.memo
            };

            const json = Utils.jsonParse(operationData.memo);
            const payload = this.normalizeContractPayload(json?.[this.config.PAYLOAD_IDENTIFIER]);

            if (payload) {
                if (this?.adapter?.processTransfer) {
                    await this.adapter.processTransfer(operationData, payload, {
                        sender: sender || '',
                        amount: rawAmount || '',
                        ...operationMetadata
                    });
                }

                const context = this.buildContractContext('transfer', blockNumber, blockId, prevBlockId, trxId, blockTime, {
                    sender,
                    transfer: transferInfo,
                    operation: {
                        type: operationType,
                        data: operationData
                    }
                });

                await this.dispatchContractAction(payload, context);
            }

            await Promise.all(this.transferSubscriptions
                .filter((sub) => sub.account === operationData.to)
                .map((sub) => Promise.resolve(sub.callback(
                    operationData,
                    blockNumber,
                    blockId,
                    prevBlockId,
                    trxId,
                    blockTime
                ))));
        }

        // This is a custom JSON operation
        if (operationType === 'custom_json') {
            let isSignedWithActiveKey = false;
            let sender;

            const id = operationData?.id;

            if (operationData?.required_auths?.length > 0) {
                sender = operationData.required_auths[0];
                isSignedWithActiveKey = true;
            } else if (operationData?.required_posting_auths?.length > 0) {
                sender = operationData.required_posting_auths[0];
                isSignedWithActiveKey = false;
            }

            const json = Utils.jsonParse(operationData.json);
            const payload = id === this.config.JSON_ID
                ? this.normalizeContractPayload(json?.[this.config.PAYLOAD_IDENTIFIER])
                : null;

            if (payload) {
                if (this?.adapter?.processCustomJson) {
                    await this.adapter.processCustomJson(operationData, payload, {
                        sender: sender || '',
                        isSignedWithActiveKey,
                        ...operationMetadata
                    });
                }

                const context = this.buildContractContext('custom_json', blockNumber, blockId, prevBlockId, trxId, blockTime, {
                    sender,
                    customJson: {
                        id,
                        json,
                        isSignedWithActiveKey
                    },
                    operation: {
                        type: operationType,
                        data: operationData
                    }
                });

                await this.dispatchContractAction(payload, context);
            }

            this.customJsonSubscriptions.forEach(sub => {
                sub.callback(
                    operationData,
                    { sender, isSignedWithActiveKey },
                    blockNumber,
                    blockId,
                    prevBlockId,
                    trxId,
                    blockTime
                );
            });

            this.customJsonIdSubscriptions.forEach(sub => {
                if (sub.id === operationData.id) {
                    sub.callback(
                        operationData,
                        { sender, isSignedWithActiveKey },
                        blockNumber,
                        blockId,
                        prevBlockId,
                        trxId,
                        blockTime
                    ); 
                }
            });

            if (id === this.config.HIVE_ENGINE_ID && this.customJsonHiveEngineSubscriptions.length > 0) {
                const enginePayload = json || {};
                const { contractName, contractAction, contractPayload } = enginePayload;
                let hasVerificationErrors = false;

                try {
                    const txInfo = await this.hive.getTransactionInfo(trxId);
                    const logs = txInfo && txInfo.logs ? Utils.jsonParse(txInfo.logs) : null;
                    hasVerificationErrors = Boolean(txInfo && logs && typeof logs.errors !== 'undefined');
                } catch (e) {
                    console.error(e);
                }

                if (!hasVerificationErrors) {
                    await Promise.all(this.customJsonHiveEngineSubscriptions.map(async (sub: any) => {
                        sub.callback(
                            contractName,
                            contractAction,
                            contractPayload,
                            sender,
                            operationData,
                            blockNumber,
                            blockId,
                            prevBlockId,
                            trxId,
                            blockTime
                        );
                    }));
                }
            }
        }

        // Recurrent transfers carry payloads in memo, similar to transfer.
        if (operationType === 'recurrent_transfer') {
            const sender = operationData?.from;
            const json = Utils.jsonParse(operationData?.memo);
            const payload = this.normalizeContractPayload(json?.[this.config.PAYLOAD_IDENTIFIER]);

            if (payload) {
                const context = this.buildContractContext('recurrent_transfer', blockNumber, blockId, prevBlockId, trxId, blockTime, {
                    sender,
                    operation: {
                        type: operationType,
                        data: operationData
                    }
                });

                await this.dispatchContractAction(payload, context);
            }
        }

        if (this.isEscrowOperationType(operationType)) {
            const escrow = this.buildEscrowDetails(operationType, operationData);
            const sender = operationData?.from;

            if (this.adapter?.processEscrow) {
                await this.adapter.processEscrow(operationType, operationData, operationMetadata);
            }

            if (operationType === 'escrow_transfer') {
                const jsonMeta = Utils.jsonParse(operationData?.json_meta);
                const payload = this.normalizeContractPayload(jsonMeta?.[this.config.PAYLOAD_IDENTIFIER]);

                if (payload) {
                    const context = this.buildContractContext('escrow_transfer', blockNumber, blockId, prevBlockId, trxId, blockTime, {
                        sender,
                        escrow,
                        operation: {
                            type: operationType,
                            data: operationData
                        }
                    });

                    await this.dispatchContractAction(payload, context);
                }
            }

            this.escrowSubscriptions.forEach(sub => {
                if (sub.type === operationType) {
                    sub.callback(
                        operationData,
                        blockNumber,
                        blockId,
                        prevBlockId,
                        trxId,
                        blockTime
                    );
                }
            });
        }
    }

    private normalizeContractPayload(payload: any): ContractPayload | null {
        if (!payload || typeof payload !== 'object') {
            return null;
        }

        const contract = typeof payload.contract === 'string'
            ? payload.contract
            : (typeof payload.name === 'string' ? payload.name : null);
        const action = typeof payload.action === 'string' ? payload.action : null;

        if (!contract || !action) {
            return null;
        }

        if (!payload.contract && payload.name && this.config.DEBUG_MODE) {
            console.warn('[Streamer] Legacy contract payload detected (name/action). Please migrate to { contract, action, payload }.');
        }

        return {
            contract,
            action,
            payload: payload.payload ?? {},
            meta: payload.meta ?? payload.metadata
        };
    }

    private isEscrowOperationType(operationType: string): operationType is EscrowOperationType {
        return operationType === 'escrow_transfer'
            || operationType === 'escrow_approve'
            || operationType === 'escrow_dispute'
            || operationType === 'escrow_release';
    }

    private buildEscrowDetails(operationType: EscrowOperationType, operation: any): ContractContext['escrow'] {
        return {
            type: operationType,
            from: operation?.from,
            to: operation?.to,
            agent: operation?.agent,
            escrowId: operation?.escrow_id,
            who: operation?.who,
            receiver: operation?.receiver,
            hiveAmount: operation?.hive_amount,
            hbdAmount: operation?.hbd_amount,
            fee: operation?.fee,
            ratificationDeadline: operation?.ratification_deadline,
            expiration: operation?.escrow_expiration,
            approved: typeof operation?.approve === 'boolean' ? operation.approve : undefined
        };
    }

    private buildContractContext(
        trigger: ContractTrigger,
        blockNumber: number,
        blockId: string,
        previousBlockId: string,
        transactionId: string,
        blockTime: Date,
        details: {
            sender?: string;
            transfer?: ContractContext['transfer'];
            customJson?: ContractContext['customJson'];
            escrow?: ContractContext['escrow'];
            operation?: ContractContext['operation'];
        }
    ): ContractContext {
        return {
            trigger,
            streamer: this,
            adapter: this.adapter,
            config: this.config,
            block: {
                number: blockNumber,
                id: blockId,
                previousId: previousBlockId,
                time: blockTime
            },
            transaction: {
                id: transactionId
            },
            sender: details.sender,
            transfer: details.transfer,
            customJson: details.customJson,
            escrow: details.escrow,
            operation: details.operation
        };
    }

    private async dispatchContractAction(payload: ContractPayload, context: ContractContext): Promise<void> {
        const contract = this.contractCache.get(payload.contract) ||
            this.contracts.find(c => c.name === payload.contract);

        if (!contract) {
            console.warn(`[Streamer] Contract '${payload.contract}' not found for action '${payload.action}'`);
            return;
        }

        if (contract && !this.contractCache.has(payload.contract)) {
            this.contractCache.set(payload.contract, contract);
        }

        const actionDefinition = contract.actions?.[payload.action];

        if (!actionDefinition || typeof actionDefinition.handler !== 'function') {
            console.warn(`[Streamer] Action '${payload.action}' not found in contract '${payload.contract}'`);
            return;
        }

        if (!this.isActionTriggerAllowed(actionDefinition, context.trigger)) {
            console.warn(`[Streamer] Action '${payload.action}' does not allow trigger '${context.trigger}'`);
            return;
        }

        if (actionDefinition.requiresActiveKey &&
            context.trigger === 'custom_json' &&
            !context.customJson?.isSignedWithActiveKey) {
            console.warn(`[Streamer] Action '${payload.action}' requires active key signature`);
            return;
        }

        let actionPayload: any = payload.payload ?? {};
        if (actionDefinition.schema) {
            const result = actionDefinition.schema.safeParse(actionPayload);
            if (!result.success) {
                console.warn(`[Streamer] Invalid payload for ${payload.contract}.${payload.action}`, {
                    errors: result.error?.errors
                });
                return;
            }
            actionPayload = result.data;
        }

        try {
            await actionDefinition.handler(actionPayload, context);
        } catch (error) {
            console.error(`[Streamer] Contract action error for ${payload.contract}.${payload.action}:`, error);
            if (context.trigger === 'time') {
                throw error;
            }
        }
    }

    private async processActions(): Promise<void> {
        if (!this.latestBlockchainTime || this.actions.length === 0) {
            return;
        }
        
        const currentTime = this.latestBlockchainTime.getTime();
        const executedActions: string[] = [];
        
        // Process actions in batch with optimized time calculations
        for (let i = 0; i < this.actions.length; i++) {
            const action = this.actions[i];
            
            // Skip disabled actions or actions that have reached max executions
            if (!action.enabled || action.hasReachedMaxExecutions()) {
                continue;
            }
            
            // Get contract from cache or find and cache it
            let contract = this.contractCache.get(action.contractName);
            if (!contract) {
                contract = this.contracts.find(c => c.name === action.contractName);
                if (contract) {
                    this.contractCache.set(action.contractName, contract);
                }
            }

            // Contract doesn't exist or method doesn't exist, log warning and skip
            if (!contract) {
                console.warn(`[Streamer] Contract '${action.contractName}' not found for action '${action.id}'`);
                continue;
            }
            
            const actionDefinition = contract.actions?.[action.contractAction];
            if (!actionDefinition || typeof actionDefinition.handler !== 'function') {
                console.warn(`[Streamer] Action '${action.contractAction}' not found in contract '${action.contractName}' for action '${action.id}'`);
                continue;
            }

            if (!this.isActionTriggerAllowed(actionDefinition, 'time')) {
                console.warn(`[Streamer] Action '${action.contractAction}' does not allow time triggers for action '${action.id}'`);
                continue;
            }

            // Get frequency in seconds from optimized map
            const frequencySeconds = this.actionFrequencyMap.get(action.timeValue);
            if (!frequencySeconds) {
                console.warn(`[Streamer] Invalid time value '${action.timeValue}' for action '${action.id}'`);
                continue;
            }

            // Optimized time difference calculation using timestamps
            const actionTime = action.date.getTime();
            const differenceSeconds = (currentTime - actionTime) / 1000;

            // Check if enough time has passed
            if (differenceSeconds >= frequencySeconds) {
                try {
                    // Execute the action with error isolation
                    const context = this.buildContractContext(
                        'time',
                        this.lastBlockNumber,
                        this.blockId,
                        this.previousBlockId,
                        action.id,
                        this.latestBlockchainTime || new Date(),
                        {}
                    );

                    await this.dispatchContractAction({
                        contract: action.contractName,
                        action: action.contractAction,
                        payload: action.payload || {}
                    }, context);
                    
                    // Reset the action timer and increment execution count
                    action.reset();
                    action.incrementExecutionCount();
                    executedActions.push(action.id);
                    
                    if (this.config.DEBUG_MODE) {
                        console.log(`[Streamer] Executed action: ${action.id} (execution #${action.executionCount})`);
                    }
                } catch (error) {
                    const err = error instanceof Error ? error : new Error(String(error));
                    console.error(`[Streamer] Action execution error for ${action.contractName}.${action.contractAction}:`, {
                        actionId: action.id,
                        error: err.message,
                        stack: err.stack,
                        payload: action.payload
                    });
                    
                    // Optionally disable action after repeated failures
                    // This could be configurable in the future
                }
            }
        }
        
        // Save state if any actions were executed
        if (executedActions.length > 0) {
            await this.saveActionsToDisk();
        }
        
        // Clean up disabled or completed actions periodically
        this.cleanupActions();
    }
    
    /**
     * Clean up completed or disabled actions to prevent memory leaks
     */
    private cleanupActions(): void {
        const beforeCount = this.actions.length;
        
        // Remove actions that have reached their max executions
        this.actions = this.actions.filter(action => {
            if (action.hasReachedMaxExecutions()) {
                if (this.config.DEBUG_MODE) {
                    console.log(`[Streamer] Removing completed action: ${action.id} (${action.executionCount}/${action.maxExecutions} executions)`);
                }
                return false;
            }
            return true;
        });
        
        const afterCount = this.actions.length;
        
        if (beforeCount !== afterCount) {
            // Save state if we removed any actions
            this.saveActionsToDisk().catch(error => {
                console.error('[Streamer] Failed to save state after action cleanup:', error);
            });
        }
    }

    public async saveStateToDisk(): Promise<void> {
        if (this.adapterInitialized && this.adapter?.saveState) {
            await this.adapter.saveState({
                lastBlockNumber: this.lastBlockNumber,
                actions: this.actions.map(action => action.toJSON())
            });
        }
    }

    // Throttled state saving for performance
    private saveStateThrottled(): void {
        const now = Date.now();
        if (now - this.lastStateSave > this.stateSaveInterval) {
            this.lastStateSave = now;
            // Save state asynchronously without blocking block processing
            this.saveStateToDisk().catch(error => {
                console.error('[Streamer] State save error:', error);
            });
        }
    }

    public saveToHiveApi(from: string, data: string) {
        return Utils.transferHiveTokens(
            this.client,
            this.config,
            from,
            'hiveapi',
            '0.001',
            'HIVE',
            data);
        }
            
    public getAccountTransfers(account: string, from = -1, limit = 100) {
        return Utils.getAccountTransfers(this.client, account, from, limit);
    }

    public transferHiveTokens(from: string, to: string, amount: string, symbol: string, memo: string = '') {
        return Utils.transferHiveTokens(
            this.client,
            this.config,
            from,
            to,
            amount,
            symbol,
            memo
        );
    }

    public burnHiveTokens(from: string, amount: string, symbol: string, memo: string = '') {
        return Utils.burnHiveTokens(
            this.client,
            this.config,
            from,
            amount,
            symbol,
            memo
        );
    }

    public burnTransferPortion(
        from: string,
        transfer: { amount?: string } | string,
        basisPoints: number,
        memo: string = '',
        allowedSymbols: string[] = ['HIVE', 'HBD']
    ) {
        const rawAmount = typeof transfer === 'string' ? transfer : transfer?.amount || '';
        const parsed = Utils.parseAssetAmount(rawAmount);

        if (Array.isArray(allowedSymbols) && allowedSymbols.length > 0 && !allowedSymbols.includes(parsed.asset)) {
            throw new Error(`Asset '${parsed.asset}' is not allowed for burn`);
        }

        const burnAmount = Utils.calculateBasisPointsAmount(parsed.value, basisPoints);
        if (burnAmount === '0.000') {
            throw new Error('Burn amount must be greater than zero');
        }

        return this.burnHiveTokens(from, burnAmount, parsed.asset, memo);
    }

    public burnTransferPercentage(
        from: string,
        transfer: { amount?: string } | string,
        percentage: string | number,
        memo: string = '',
        allowedSymbols: string[] = ['HIVE', 'HBD']
    ) {
        const rawAmount = typeof transfer === 'string' ? transfer : transfer?.amount || '';
        const parsed = Utils.parseAssetAmount(rawAmount);

        if (Array.isArray(allowedSymbols) && allowedSymbols.length > 0 && !allowedSymbols.includes(parsed.asset)) {
            throw new Error(`Asset '${parsed.asset}' is not allowed for burn`);
        }

        const burnAmount = Utils.calculatePercentageAmount(parsed.value, percentage);
        if (burnAmount === '0.000') {
            throw new Error('Burn amount must be greater than zero');
        }

        return this.burnHiveTokens(from, burnAmount, parsed.asset, memo);
    }

    public autoBurnIncomingTransfers(options: AutoBurnIncomingTransfersOptions = {}): FlowSubscriptionHandle {
        const basisPoints = this.resolveFlowBasisPoints(options, 'autoBurnIncomingTransfers', false);
        const account = this.resolveAccount(options.account);
        const normalizedStore = this.normalizeDedupeStore(options.dedupeStore);
        const allowedSymbols = options.allowedSymbols || ['HIVE', 'HBD'];
        const ignoreZeroAmount = options.ignoreZeroAmount !== false;

        const callback = async (op: any, blockNumber: number, blockId: string, prevBlockId: string, trxId: string, blockTime: Date) => {
            const event = this.createTransferEvent(op, blockNumber, blockId, prevBlockId, trxId, blockTime);

            try {
                if (await this.dedupeHas(normalizedStore, trxId)) {
                    return;
                }

                const memo = typeof options.memo === 'function' ? options.memo(event) : options.memo || '';
                const amount = this.calculateSingleFlowAmount(op, basisPoints, allowedSymbols, 'burn');
                const result = await this.burnHiveTokens(account, amount.amount, amount.asset, memo);

                await this.dedupeAdd(normalizedStore, trxId);

                if (options.onBurned) {
                    await options.onBurned(result, event);
                }
            } catch (error) {
                if (ignoreZeroAmount && this.isZeroAmountFlowError(error)) {
                    return;
                }

                if (options.onError) {
                    await options.onError(error, event);
                    return;
                }

                throw error;
            }
        };

        this.onTransfer(account, callback);

        return {
            account,
            stop: () => {
                this.removeTransferSubscription(account, callback);
            }
        };
    }

    public autoForwardIncomingTransfers(options: AutoForwardIncomingTransfersOptions): FlowSubscriptionHandle {
        if (!options || typeof options.to !== 'string' || options.to.trim().length === 0) {
            throw new Error('autoForwardIncomingTransfers requires a destination account');
        }

        const account = this.resolveAccount(options.account);
        const normalizedStore = this.normalizeDedupeStore(options.dedupeStore);
        const allowedSymbols = options.allowedSymbols || ['HIVE', 'HBD'];
        const ignoreZeroAmount = options.ignoreZeroAmount !== false;
        const basisPoints = this.resolveFlowBasisPoints(options, 'autoForwardIncomingTransfers', true);
        const destination = options.to.trim();

        const callback = async (op: any, blockNumber: number, blockId: string, prevBlockId: string, trxId: string, blockTime: Date) => {
            const event = this.createTransferEvent(op, blockNumber, blockId, prevBlockId, trxId, blockTime);

            try {
                if (await this.dedupeHas(normalizedStore, trxId)) {
                    return;
                }

                const memo = typeof options.memo === 'function' ? options.memo(event) : options.memo || '';
                const amount = this.calculateSingleFlowAmount(op, basisPoints, allowedSymbols, 'forward');
                const result = await this.transferHiveTokens(account, destination, amount.amount, amount.asset, memo);

                await this.dedupeAdd(normalizedStore, trxId);

                if (options.onForwarded) {
                    await options.onForwarded(result, event);
                }
            } catch (error) {
                if (ignoreZeroAmount && this.isZeroAmountFlowError(error)) {
                    return;
                }

                if (options.onError) {
                    await options.onError(error, event);
                    return;
                }

                throw error;
            }
        };

        this.onTransfer(account, callback);

        return {
            account,
            stop: () => {
                this.removeTransferSubscription(account, callback);
            }
        };
    }

    public autoRefundIncomingTransfers(options: AutoRefundIncomingTransfersOptions = {}): FlowSubscriptionHandle {
        const account = this.resolveAccount(options.account);
        const normalizedStore = this.normalizeDedupeStore(options.dedupeStore);
        const allowedSymbols = options.allowedSymbols || ['HIVE', 'HBD'];
        const ignoreZeroAmount = options.ignoreZeroAmount !== false;
        const basisPoints = this.resolveFlowBasisPoints(options, 'autoRefundIncomingTransfers', true);

        const callback = async (op: any, blockNumber: number, blockId: string, prevBlockId: string, trxId: string, blockTime: Date) => {
            const event = this.createTransferEvent(op, blockNumber, blockId, prevBlockId, trxId, blockTime);

            try {
                if (await this.dedupeHas(normalizedStore, trxId)) {
                    return;
                }

                const memo = typeof options.memo === 'function' ? options.memo(event) : options.memo || '';
                const amount = this.calculateSingleFlowAmount(op, basisPoints, allowedSymbols, 'refund');
                const result = await this.transferHiveTokens(account, event.transfer.from, amount.amount, amount.asset, memo);

                await this.dedupeAdd(normalizedStore, trxId);

                if (options.onRefunded) {
                    await options.onRefunded(result, event);
                }
            } catch (error) {
                if (ignoreZeroAmount && this.isZeroAmountFlowError(error)) {
                    return;
                }

                if (options.onError) {
                    await options.onError(error, event);
                    return;
                }

                throw error;
            }
        };

        this.onTransfer(account, callback);

        return {
            account,
            stop: () => {
                this.removeTransferSubscription(account, callback);
            }
        };
    }

    public autoSplitIncomingTransfers(options: AutoSplitIncomingTransfersOptions): FlowSubscriptionHandle {
        if (!options || !Array.isArray(options.recipients) || options.recipients.length === 0) {
            throw new Error('autoSplitIncomingTransfers requires at least one recipient');
        }

        const defaultMemo = options.memo;

        return this.autoRouteIncomingTransfers({
            account: options.account,
            routes: options.recipients.map((recipient, index) => ({
                to: recipient.account,
                percentage: recipient.percentage,
                percent: recipient.percent,
                basisPoints: recipient.basisPoints,
                memo: recipient.memo || (typeof defaultMemo === 'function'
                    ? (event: TransferEvent) => defaultMemo(event, { account: recipient.account }, index)
                    : defaultMemo)
            })),
            allowedSymbols: options.allowedSymbols,
            dedupeStore: options.dedupeStore,
            ignoreZeroAmount: options.ignoreZeroAmount,
            onRouted: async (results, event, plan) => {
                if (options.onSplit) {
                    await options.onSplit(results, event, plan);
                }
            },
            onError: options.onError
        });
    }

    public planIncomingTransferRoutes(
        transfer: string | TransferEvent | { amount?: string; from?: string; to?: string; memo?: string },
        options: Pick<AutoRouteIncomingTransfersOptions, 'routes' | 'memo' | 'allowedSymbols'>
    ): PlannedIncomingTransferRoutes {
        if (!options || !Array.isArray(options.routes) || options.routes.length === 0) {
            throw new Error('planIncomingTransferRoutes requires at least one route');
        }

        const event = this.normalizeTransferPreviewInput(transfer);
        const allowedSymbols = options.allowedSymbols || ['HIVE', 'HBD'];

        return this.buildPlannedIncomingTransferRoutes(event, options.routes, allowedSymbols, options.memo);
    }

    public autoRouteIncomingTransfers(options: AutoRouteIncomingTransfersOptions): FlowSubscriptionHandle {
        if (!options || !Array.isArray(options.routes) || options.routes.length === 0) {
            throw new Error('autoRouteIncomingTransfers requires at least one route');
        }

        const account = this.resolveAccount(options.account);
        const normalizedStore = this.normalizeDedupeStore(options.dedupeStore);
        const allowedSymbols = options.allowedSymbols || ['HIVE', 'HBD'];
        const ignoreZeroAmount = options.ignoreZeroAmount !== false;

        const callback = async (op: any, blockNumber: number, blockId: string, prevBlockId: string, trxId: string, blockTime: Date) => {
            const event = this.createTransferEvent(op, blockNumber, blockId, prevBlockId, trxId, blockTime);

            try {
                if (await this.dedupeHas(normalizedStore, trxId)) {
                    return;
                }

                const plan = this.buildPlannedIncomingTransferRoutes(event, options.routes, allowedSymbols, options.memo);
                const results = await this.executePlannedFlowRoutes(account, plan.routes, ignoreZeroAmount);

                await this.dedupeAdd(normalizedStore, trxId);

                if (options.onRouted) {
                    await options.onRouted(results, event, plan.routes);
                }
            } catch (error) {
                if (ignoreZeroAmount && this.isZeroAmountFlowError(error)) {
                    return;
                }

                if (options.onError) {
                    await options.onError(error, event);
                    return;
                }

                throw error;
            }
        };

        this.onTransfer(account, callback);

        return {
            account,
            stop: () => {
                this.removeTransferSubscription(account, callback);
            }
        };
    }

    public transferHiveTokensMultiple(from: string, accounts: string[] = [], amount: string = '0', symbol: string, memo: string = '') {
        return Utils.transferHiveTokensMultiple(this.client, this.config, from, accounts, amount, symbol, memo);
    }

    public broadcastOperations(operations: Array<[string, any]>, signingKeys?: string | string[]) {
        return Utils.broadcastOperations(this.client, operations, signingKeys || this.config.ACTIVE_KEY);
    }

    public broadcastMultiSigOperations(operations: Array<[string, any]>, signingKeys: string[]) {
        return Utils.broadcastMultiSigOperations(this.client, operations, signingKeys);
    }

    public createAuthority(keyAuths: Array<[string, number]> = [], accountAuths: Array<[string, number]> = [], weightThreshold: number = 1): any {
        return Utils.createAuthority(keyAuths, accountAuths, weightThreshold);
    }

    public updateAccountAuthorities(
        account: string,
        authorityUpdate: {
            owner?: any;
            active?: any;
            posting?: any;
            memo_key?: string;
            json_metadata?: string;
            posting_json_metadata?: string;
            useAccountUpdate2?: boolean;
        },
        signingKeys?: string | string[]
    ) {
        return Utils.updateAccountAuthorities(this.client, this.config, account, authorityUpdate, signingKeys);
    }

    public escrowTransfer(options: {
        from: string;
        to: string;
        agent: string;
        escrow_id: number;
        hive_amount?: string;
        hbd_amount?: string;
        fee: string;
        ratification_deadline: string | Date;
        escrow_expiration: string | Date;
        json_meta?: string | Record<string, any>;
    }, signingKeys?: string | string[]) {
        return Utils.escrowTransfer(this.client, this.config, options, signingKeys);
    }

    public escrowApprove(options: {
        from: string;
        to: string;
        agent: string;
        who: string;
        escrow_id: number;
        approve: boolean;
    }, signingKeys?: string | string[]) {
        return Utils.escrowApprove(this.client, this.config, options, signingKeys);
    }

    public escrowDispute(options: {
        from: string;
        to: string;
        agent: string;
        who: string;
        escrow_id: number;
    }, signingKeys?: string | string[]) {
        return Utils.escrowDispute(this.client, this.config, options, signingKeys);
    }

    public escrowRelease(options: {
        from: string;
        to: string;
        agent: string;
        who: string;
        receiver: string;
        escrow_id: number;
        hive_amount?: string;
        hbd_amount?: string;
    }, signingKeys?: string | string[]) {
        return Utils.escrowRelease(this.client, this.config, options, signingKeys);
    }

    public recurrentTransfer(options: {
        from: string;
        to: string;
        amount: string;
        memo?: string;
        recurrence: number;
        executions: number;
    }, signingKeys?: string | string[]) {
        return Utils.recurrentTransfer(this.client, this.config, options, signingKeys);
    }

    public createProposal(options: {
        creator: string;
        receiver: string;
        start_date: string | Date;
        end_date: string | Date;
        daily_pay: string;
        subject: string;
        permlink: string;
    }, signingKeys?: string | string[]) {
        return Utils.createProposal(this.client, this.config, options, signingKeys);
    }

    public updateProposalVotes(options: {
        voter: string;
        proposal_ids: number[];
        approve: boolean;
    }, signingKeys?: string | string[]) {
        return Utils.updateProposalVotes(this.client, this.config, options, signingKeys);
    }

    public removeProposals(options: {
        proposal_owner: string;
        proposal_ids: number[];
    }, signingKeys?: string | string[]) {
        return Utils.removeProposals(this.client, this.config, options, signingKeys);
    }

    public transferHiveEngineTokens(from: string, to: string, symbol: string, quantity: string, memo: string = '') {
        return Utils.transferHiveEngineTokens(this.client, this.config, from, to, quantity, symbol, memo);
    }

    public burnHiveEngineTokens(from: string, symbol: string, quantity: string, memo: string = '') {
        return Utils.burnHiveEngineTokens(this.client, this.config, from, symbol, quantity, memo);
    }

    public transferHiveEngineTokensMultiple(from: string, accounts: any[] = [], symbol: string, memo: string = '', amount: string = '0') {
        return Utils.transferHiveEngineTokensMultiple(this.client, this.config, from, accounts, symbol, memo, amount);
    }

    public issueHiveEngineTokens(from: string, to: string, symbol: string, quantity: string, memo: string = '') {
        return Utils.issueHiveEngineTokens(this.client, this.config, from, to, symbol, quantity, memo);
    }

    public issueHiveEngineTokensMultiple(from: string, accounts: any[] = [], symbol: string, memo: string = '', amount: string = '0') {
        return Utils.issueHiveEngineTokensMultiple(this.client, this.config, from, accounts, symbol, memo, amount);
    }

    public upvote(votePercentage: string = '100.0', username: string, permlink: string) {
        return Utils.upvote(
            this.client,
            this.config,
            this.username,
            votePercentage,
            username,
            permlink
        );
    }

    public downvote(votePercentage: string = '100.0', username: string, permlink: string) {
        return Utils.downvote(
            this.client,
            this.config,
            this.username,
            votePercentage,
            username,
            permlink
        );
    }

    public getTransaction(blockNumber: number, transactionId: string) {
        return Utils.getTransaction(this.client, blockNumber, transactionId);
    }

    public getStatus() {
        return {
            lastBlockNumber: this.lastBlockNumber,
            headBlockNumber: this.headBlockNumber,
            blocksBehind: this.headBlockNumber
                ? Math.max(0, this.headBlockNumber - this.lastBlockNumber)
                : 0,
            latestBlockchainTime: this.latestBlockchainTime,
            isCatchingUp: this.isCatchingUp
        };
    }

    public verifyTransfer(transaction, from: string, to: string, amount: string) {
        return Utils.verifyTransfer(transaction, from, to, amount);
    }

    public onComment(callback: (data: any, blockNumber: number, blockId: string, prevBlockId: string, trxId: string, blockTime: Date) => void): void {
        this.commentSubscriptions.push({
            callback
        });
    }

    public onPost(callback: (data: any, blockNumber: number, blockId: string, prevBlockId: string, trxId: string, blockTime: Date) => void): void {
        this.postSubscriptions.push({
            callback
        });
    }

    public onTransfer(account: string, callback: (...args: any[]) => void | Promise<void>): void {
        this.transferSubscriptions.push({
            account,
            callback
        });
    }

    public onCustomJson(callback: (data: any, info: { sender: string; isSignedWithActiveKey: boolean }, blockNumber: number, blockId: string, prevBlockId: string, trxId: string, blockTime: Date) => void): void {
        this.customJsonSubscriptions.push({ callback });
    }

    public onCustomJsonId(id: string, callback: (data: any, info: { sender: string; isSignedWithActiveKey: boolean }, blockNumber: number, blockId: string, prevBlockId: string, trxId: string, blockTime: Date) => void): void {
        this.customJsonIdSubscriptions.push({ callback, id });
    }

    public onHiveEngine(callback: (contractName: string, contractAction: string, contractPayload: any, sender: string, data: any, blockNumber: number, blockId: string, prevBlockId: string, trxId: string, blockTime: Date) => void): void {
        this.customJsonHiveEngineSubscriptions.push({ callback });
    }

    public onEscrowTransfer(callback: (data: any, blockNumber: number, blockId: string, prevBlockId: string, trxId: string, blockTime: Date) => void): void {
        this.escrowSubscriptions.push({ type: 'escrow_transfer', callback });
    }

    public onEscrowApprove(callback: (data: any, blockNumber: number, blockId: string, prevBlockId: string, trxId: string, blockTime: Date) => void): void {
        this.escrowSubscriptions.push({ type: 'escrow_approve', callback });
    }

    public onEscrowDispute(callback: (data: any, blockNumber: number, blockId: string, prevBlockId: string, trxId: string, blockTime: Date) => void): void {
        this.escrowSubscriptions.push({ type: 'escrow_dispute', callback });
    }

    public onEscrowRelease(callback: (data: any, blockNumber: number, blockId: string, prevBlockId: string, trxId: string, blockTime: Date) => void): void {
        this.escrowSubscriptions.push({ type: 'escrow_release', callback });
    }
    
    // Memory management: cleanup subscriptions
    private cleanupSubscriptions(): void {
        // Limit subscription arrays to prevent memory leaks
        if (this.customJsonSubscriptions.length > this.maxSubscriptions) {
            this.customJsonSubscriptions = this.customJsonSubscriptions.slice(-this.maxSubscriptions);
            console.warn(`[Streamer] Trimmed customJsonSubscriptions to ${this.maxSubscriptions} items`);
        }
        
        if (this.customJsonIdSubscriptions.length > this.maxSubscriptions) {
            this.customJsonIdSubscriptions = this.customJsonIdSubscriptions.slice(-this.maxSubscriptions);
            console.warn(`[Streamer] Trimmed customJsonIdSubscriptions to ${this.maxSubscriptions} items`);
        }
        
        if (this.customJsonHiveEngineSubscriptions.length > this.maxSubscriptions) {
            this.customJsonHiveEngineSubscriptions = this.customJsonHiveEngineSubscriptions.slice(-this.maxSubscriptions);
            console.warn(`[Streamer] Trimmed customJsonHiveEngineSubscriptions to ${this.maxSubscriptions} items`);
        }
        
        if (this.commentSubscriptions.length > this.maxSubscriptions) {
            this.commentSubscriptions = this.commentSubscriptions.slice(-this.maxSubscriptions);
            console.warn(`[Streamer] Trimmed commentSubscriptions to ${this.maxSubscriptions} items`);
        }
        
        if (this.postSubscriptions.length > this.maxSubscriptions) {
            this.postSubscriptions = this.postSubscriptions.slice(-this.maxSubscriptions);
            console.warn(`[Streamer] Trimmed postSubscriptions to ${this.maxSubscriptions} items`);
        }
        
        if (this.transferSubscriptions.length > this.maxSubscriptions) {
            this.transferSubscriptions = this.transferSubscriptions.slice(-this.maxSubscriptions);
            console.warn(`[Streamer] Trimmed transferSubscriptions to ${this.maxSubscriptions} items`);
        }

        if (this.escrowSubscriptions.length > this.maxSubscriptions) {
            this.escrowSubscriptions = this.escrowSubscriptions.slice(-this.maxSubscriptions);
            console.warn(`[Streamer] Trimmed escrowSubscriptions to ${this.maxSubscriptions} items`);
        }
    }
    
    // Add method to remove specific subscriptions
    public removeTransferSubscription(account: string, callback?: (...args: any[]) => void): void {
        this.transferSubscriptions = this.transferSubscriptions.filter((sub) => {
            if (sub.account !== account) {
                return true;
            }

            if (!callback) {
                return false;
            }

            return sub.callback !== callback;
        });
    }
    
    public removeCustomJsonIdSubscription(id: string): void {
        this.customJsonIdSubscriptions = this.customJsonIdSubscriptions.filter(sub => sub.id !== id);
    }

    public removeEscrowSubscriptions(type?: EscrowOperationType): void {
        if (!type) {
            this.escrowSubscriptions = [];
            return;
        }

        this.escrowSubscriptions = this.escrowSubscriptions.filter(sub => sub.type !== type);
    }
}
