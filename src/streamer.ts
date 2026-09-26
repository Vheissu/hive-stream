import { getLogger, setLogger } from './logger';
import { AdapterBase } from './adapters/base.adapter';
import { Api } from './api';
import { SqliteAdapter } from './adapters/sqlite.adapter';
import { validateContractDefinition } from './contracts/contract';

import { TimeAction } from './actions';
import { Client } from '@hiveio/dhive';
import BigNumber from './bignumber';
import { Utils } from './utils';
import {
    HiveBurnBuilder,
    HiveCancelOrderBuilder,
    HiveClaimRewardsBuilder,
    HiveCollateralizedConvertBuilder,
    HiveCommentOptionsBuilder,
    HiveConvertBuilder,
    HiveDelegateBuilder,
    HiveDeleteCommentBuilder,
    HiveEscrowTransferBuilder,
    HiveEngineTokenBurnBuilder,
    HiveEngineTokenIssueBuilder,
    HiveEngineTokenTransferBuilder,
    HiveFollowBuilder,
    HiveLimitOrderBuilder,
    HivePowerDownBuilder,
    HivePowerUpBuilder,
    HiveProposalBuilder,
    HiveProposalVotesBuilder,
    HiveReblogBuilder,
    HiveRemoveProposalsBuilder,
    HiveRecurrentTransferBuilder,
    HiveSavingsTransferBuilder,
    HiveSetProxyBuilder,
    HiveTransferBuilder,
    HiveUpdateProfileBuilder,
    HiveVoteBuilder,
    HiveWitnessVoteBuilder,
    HiveWithdrawRouteBuilder,
    HivePostBuilder,
    HiveBatchBuilder,
    HiveEngineStakeBuilder,
    HiveEngineUnstakeBuilder,
    HiveEngineMarketOrderBuilder,
    HiveEngineCancelOrderBuilder,
    HiveEngineDelegateBuilder,
    HiveCommunityOperationBuilder,
    IncomingTransfersBuilder
} from './builders';
import { ConfigInput, ConfigInterface, createConfig, normalizeConfigInput } from './config';
import { BlockData, BlockProvider } from './providers/block-provider';
import { HiveEngineClient } from './providers/hive-engine-client';
import { HiveProvider, createClientOptions } from './providers/hive-provider';
import {
    ActionRejectionReason,
    BlockHookContext,
    ContractActionHookContext,
    ErrorPhase,
    HookRegistry,
    OperationHookContext,
    StreamerHookHandler,
    StreamerHookName,
    StreamerHooks,
    StreamerPlugin,
} from './hooks';
import { 
    AutoBurnIncomingTransfersOptions,
    AutoForwardIncomingTransfersOptions,
    AutoRefundIncomingTransfersOptions,
    AutoRouteIncomingTransfersOptions,
    AutoSplitIncomingTransfersOptions,
    ContractActionDefinition,
    ContractActionGuards,
    ContractDefinition,
    ContractPayload,
    ContractContext,
    ContractTrigger,
    FlowDedupeStore,
    FlowGroupRecipient,
    FlowRoute,
    FlowRouteMode,
    FlowTransferGroupRoute,
    BatchBuilder,
    EngineQueryNamespace,
    FlowNamespace,
    FlowSubscriptionHandle,
    OpsNamespace,
    MoneyNamespace,
    QueryNamespace,
    PlannedIncomingTransferRoutes,
    PlannedFlowRoute,
    SubscriptionCallback,
    TransferEvent,
    TransferSubscription,
    CustomJsonIdSubscription,
    EscrowSubscription,
    EscrowOperationType,
} from './types/hive-stream';

/**
 * Thrown when the error policy halts the streamer. The block that failed is
 * not checkpointed, so it is reprocessed when the streamer resumes.
 */
export class StreamHaltError extends Error {
    public readonly cause: Error;
    public readonly phase: ErrorPhase;
    public readonly blockNumber?: number;

    constructor(cause: Error, phase: ErrorPhase, blockNumber?: number) {
        super(`Streamer halted during ${phase}${blockNumber ? ` at block ${blockNumber}` : ''}: ${cause.message}`);
        this.name = 'StreamHaltError';
        this.cause = cause;
        this.phase = phase;
        this.blockNumber = blockNumber;
    }
}

export type ContractDispatchResult = 'executed' | 'rejected' | 'failed' | 'duplicate';

type LoadBlockResult = 'processed' | 'missing' | 'rewound';

interface ErrorMeta {
    blockNumber?: number;
    transactionId?: string;
    operationIndex?: number;
}

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
    private voteSubscriptions: SubscriptionCallback[] = [];
    private delegateSubscriptions: SubscriptionCallback[] = [];
    private powerUpSubscriptions: SubscriptionCallback[] = [];
    private powerDownSubscriptions: SubscriptionCallback[] = [];
    private claimRewardsSubscriptions: SubscriptionCallback[] = [];
    private witnessVoteSubscriptions: SubscriptionCallback[] = [];
    private followSubscriptions: SubscriptionCallback[] = [];
    private reblogSubscriptions: SubscriptionCallback[] = [];
    private accountUpdateSubscriptions: SubscriptionCallback[] = [];
    private deleteCommentSubscriptions: SubscriptionCallback[] = [];
    private limitOrderSubscriptions: SubscriptionCallback[] = [];
    private savingsSubscriptions: SubscriptionCallback[] = [];
    private convertSubscriptions: SubscriptionCallback[] = [];
    private blockSubscriptions: SubscriptionCallback[] = [];
    private anyOperationSubscriptions: SubscriptionCallback[] = [];

    private attempts = 0;

    private config: ConfigInterface = createConfig();
    private client: Client;
    private hive: HiveEngineClient;

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
    private irreversibleBlockNumber = 0;
    private lastBlockId: string | null = null;
    private recentBlockIds = new Map<number, string>();
    private halted = false;
    private lastError: { message: string; phase: ErrorPhase; blockNumber?: number; at: Date } | null = null;
    private isCaughtUp = false;
    private currentProcessing: Promise<void> | null = null;
    private readonly hookRegistry = new HookRegistry();
    private pausedContracts = new Set<string>();
    private rateLimitHits = new Map<string, number[]>();
    private lastLedgerPruneBlock = 0;
    private bypassLedger = false;
    private disableAllProcessing = false;
    private isStarted = false;
    private isInitialized = false;
    private hasInjectedClient = false;
    private startedAt: number | null = null;
    private lastProcessedAt: number | null = null;

    private contracts: ContractDefinition[] = [];
    private blockProvider: BlockProvider;
    private adapter: AdapterBase;
    private adapterInitializationPromise: Promise<void> | null = null;
    private adapterInitialized = false;
    private initializedContracts = new Set<string>();
    private apiServer: Api | null = null;
    private actions: TimeAction[] = [];

    // Checkpoint bookkeeping for CHECKPOINT_MODE 'interval'
    private lastStateSave = 0;
    private blockProcessingQueue: Array<() => Promise<void>> = [];
    private isProcessingQueue = false;
    
    // Memory management
    private readonly maxSubscriptions = 1000;
    private subscriptionWarnings = new Set<string>();
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
        follow: () => new HiveFollowBuilder(this, 'follow'),
        unfollow: () => new HiveFollowBuilder(this, 'unfollow'),
        mute: () => new HiveFollowBuilder(this, 'mute'),
        reblog: () => new HiveReblogBuilder(this),
        powerUp: () => new HivePowerUpBuilder(this),
        powerDown: () => new HivePowerDownBuilder(this),
        cancelPowerDown: () => new HivePowerDownBuilder(this, true),
        delegate: () => new HiveDelegateBuilder(this),
        undelegate: () => new HiveDelegateBuilder(this, true),
        claimRewards: () => new HiveClaimRewardsBuilder(this),
        witnessVote: () => new HiveWitnessVoteBuilder(this),
        setProxy: () => new HiveSetProxyBuilder(this),
        clearProxy: () => new HiveSetProxyBuilder(this, true),
        updateProfile: () => new HiveUpdateProfileBuilder(this),
        transferToSavings: () => new HiveSavingsTransferBuilder(this, 'to'),
        transferFromSavings: () => new HiveSavingsTransferBuilder(this, 'from'),
        convert: () => new HiveConvertBuilder(this),
        collateralizedConvert: () => new HiveCollateralizedConvertBuilder(this),
        deleteComment: () => new HiveDeleteCommentBuilder(this),
        limitOrder: () => new HiveLimitOrderBuilder(this),
        cancelOrder: () => new HiveCancelOrderBuilder(this),
        withdrawRoute: () => new HiveWithdrawRouteBuilder(this),
        commentOptions: () => new HiveCommentOptionsBuilder(this),
        post: () => new HivePostBuilder(this),
        stakeEngine: () => new HiveEngineStakeBuilder(this),
        unstakeEngine: () => new HiveEngineUnstakeBuilder(this),
        buyEngine: () => new HiveEngineMarketOrderBuilder(this, 'buy'),
        sellEngine: () => new HiveEngineMarketOrderBuilder(this, 'sell'),
        cancelEngineOrder: () => new HiveEngineCancelOrderBuilder(this),
        delegateEngine: () => new HiveEngineDelegateBuilder(this),
        undelegateEngine: () => new HiveEngineDelegateBuilder(this, true),
        subscribeCommunity: () => new HiveCommunityOperationBuilder(this, 'subscribe'),
        unsubscribeCommunity: () => new HiveCommunityOperationBuilder(this, 'unsubscribe'),
        cancelRecurrentTransfer: () => new HiveRecurrentTransferBuilder(this),
    };
    public readonly query: QueryNamespace = {
        getDynamicGlobalProperties: () => this.client.database.getDynamicGlobalProperties(),
        getChainProperties: () => this.client.database.getChainProperties(),
        getCurrentMedianHistoryPrice: () => this.client.database.getCurrentMedianHistoryPrice(),
        getRewardFund: (name = 'post') => this.client.database.call('get_reward_fund', [name]),
        getFollowers: (account, start = '', type = 'blog', limit = 1000) =>
            this.client.call('condenser_api', 'get_followers', [account, start, type, limit]),
        getFollowing: (account, start = '', type = 'blog', limit = 1000) =>
            this.client.call('condenser_api', 'get_following', [account, start, type, limit]),
        getFollowCount: (account) =>
            this.client.call('condenser_api', 'get_follow_count', [account]),
        getContent: (author, permlink) =>
            this.client.call('condenser_api', 'get_content', [author, permlink]),
        getContentReplies: (author, permlink) =>
            this.client.call('condenser_api', 'get_content_replies', [author, permlink]),
        getDiscussions: (by, query) => this.client.database.getDiscussions(by as any, query as any),
        getBlog: (account, options = {}) =>
            this.client.database.getDiscussions('blog', { tag: account, limit: 20, ...options } as any),
        getFeed: (account, options = {}) =>
            this.client.database.getDiscussions('feed', { tag: account, limit: 20, ...options } as any),
        getTrending: (options = {}) =>
            this.client.database.getDiscussions('trending', { limit: 20, ...options } as any),
        getHot: (options = {}) =>
            this.client.database.getDiscussions('hot', { limit: 20, ...options } as any),
        getCreated: (options = {}) =>
            this.client.database.getDiscussions('created', { limit: 20, ...options } as any),
        getActiveVotes: (author, permlink) =>
            this.client.call('condenser_api', 'get_active_votes', [author, permlink]),
        getVestingDelegations: (account, from = '', limit = 100) =>
            this.client.database.getVestingDelegations(account, from, limit),
        getAccountHistory: (account, from = -1, limit = 100) =>
            this.client.database.getAccountHistory(account, from, limit),
        getOrderBook: (limit = 50) =>
            this.client.call('condenser_api', 'get_order_book', [limit]),
        getOpenOrders: (account) =>
            this.client.call('condenser_api', 'get_open_orders', [account]),
        getRCMana: (account) => this.client.rc.getRCMana(account),
        getVPMana: (account) => this.client.rc.getVPMana(account),
        findRCAccounts: (accounts) => this.client.rc.findRCAccounts(accounts),
        getCommunity: (name) =>
            this.client.call('bridge', 'get_community', { name }),
        listCommunities: (options = {}) =>
            this.client.call('bridge', 'list_communities', { limit: 100, ...options }),
        getAccountNotifications: (account, options = {}) =>
            this.client.call('bridge', 'account_notifications', { account, limit: 50, ...options }),
        listAllSubscriptions: (account) =>
            this.client.call('bridge', 'list_all_subscriptions', { account }),
        findTransaction: (transactionId) =>
            this.client.transaction.findTransaction(transactionId),
        getWitnessByAccount: (account) =>
            this.client.call('condenser_api', 'get_witness_by_account', [account]),
        getWitnesses: (ids) =>
            this.client.call('condenser_api', 'get_witnesses', [ids]),
        getWitnessesByVote: (from, limit) =>
            this.client.call('condenser_api', 'get_witnesses_by_vote', [from, limit]),
        getBlock: (blockNumber) => this.client.database.getBlock(blockNumber),
        getBlockHeader: (blockNumber) => this.client.database.getBlockHeader(blockNumber),
        getOperations: (blockNumber, onlyVirtual = false) =>
            this.client.database.getOperations(blockNumber, onlyVirtual),
        getConfig: () => this.client.database.getConfig(),
        lookupAccounts: (lowerBound, limit) =>
            this.client.call('condenser_api', 'lookup_accounts', [lowerBound, limit]),
        lookupWitnessAccounts: (lowerBound, limit) =>
            this.client.call('condenser_api', 'lookup_witness_accounts', [lowerBound, limit]),
        getConversionRequests: (account) =>
            this.client.call('condenser_api', 'get_conversion_requests', [account]),
        getCollateralizedConversionRequests: (account) =>
            this.client.call('condenser_api', 'get_collateralized_conversion_requests', [account]),
        getSavingsWithdrawFrom: (account) =>
            this.client.call('condenser_api', 'get_savings_withdraw_from', [account]),
        getProposals: (options = {}) =>
            this.client.call('condenser_api', 'list_proposals', [
                options.start || '',
                options.limit || 100,
                options.order || 'by_total_votes',
                options.order_direction || 'descending',
                options.status || 'votable'
            ]),
    };
    public readonly engine: EngineQueryNamespace = {
        getTokenBalances: (account) =>
            this.hive.find('tokens', 'balances', { account }),
        getTokenBalance: (account, symbol) =>
            this.hive.findOne('tokens', 'balances', { account, symbol }),
        getToken: (symbol) =>
            this.hive.findOne('tokens', 'tokens', { symbol }),
        getTokens: (query = {}, limit = 1000, offset = 0) =>
            this.hive.find('tokens', 'tokens', query, limit, offset),
        getMarketBuyBook: (symbol, limit = 100, offset = 0) =>
            this.hive.find('market', 'buyBook', { symbol }, limit, offset, [{ index: 'priceDec', descending: true }]),
        getMarketSellBook: (symbol, limit = 100, offset = 0) =>
            this.hive.find('market', 'sellBook', { symbol }, limit, offset, [{ index: 'priceDec', descending: false }]),
        getMarketHistory: (symbol, limit = 100, offset = 0) =>
            this.hive.find('market', 'tradesHistory', { symbol }, limit, offset, [{ index: '_id', descending: true }]),
        getMarketMetrics: (query = {}) =>
            this.hive.find('market', 'metrics', query),
        getNFT: (symbol) =>
            this.hive.findOne('nft', 'nfts', { symbol }),
        getNFTInstances: (symbol, query = {}, limit = 100, offset = 0) =>
            this.hive.find('nft', `${symbol}instances`, query, limit, offset),
        getNFTBalance: (account, symbol) =>
            this.hive.find('nft', `${symbol}instances`, { account }),
        getNFTSellBook: (symbol, limit = 100, offset = 0) =>
            this.hive.find('nftmarket', `${symbol}sellBook`, {}, limit, offset),
        getPendingUnstakes: (account, symbol) => {
            const query: any = { account };
            if (symbol) { query.symbol = symbol; }
            return this.hive.find('tokens', 'pendingUnstakes', query);
        },
        getDelegations: (from, symbol) =>
            this.hive.find('tokens', 'delegations', { from, symbol }),
        getContractInfo: (name) =>
            this.hive.getContractInfo(name),
        find: (contract, table, query, limit = 1000, offset = 0) =>
            this.hive.find(contract, table, query, limit, offset),
        findOne: (contract, table, query) =>
            this.hive.findOne(contract, table, query),
    };

    constructor(userConfig: ConfigInput = {}) {
        this.config = createConfig(userConfig);

        if (userConfig.logger) {
            setLogger(userConfig.logger);
        }

        this.lastBlockNumber = this.config.LAST_BLOCK_NUMBER;

        this.username = this.config.USERNAME;
        this.postingKey = this.config.POSTING_KEY;
        this.activeKey = this.config.ACTIVE_KEY;

        this.hive = new HiveEngineClient(this.config.HIVE_ENGINE_API);
        this.hasInjectedClient = Boolean(userConfig.client);
        this.client = userConfig.client ?? this.createHiveClient();
        this.adapter = new SqliteAdapter();

        if (userConfig.blockProvider) {
            this.blockProvider = userConfig.blockProvider;
        } else {
            this.blockProvider = new HiveProvider({
                apiNodes: this.config.API_NODES,
                timeout: this.config.API_TIMEOUT_MS
            });
        }

        if (userConfig.hooks) {
            this.hookRegistry.addAll(userConfig.hooks);
        }
    }

    private createHiveClient(): Client {
        return new Client(this.config.API_NODES, createClientOptions({ timeout: this.config.API_TIMEOUT_MS }));
    }

    // ─── Hooks ───────────────────────────────────────────────────────────

    /**
     * Registers a single hook handler. Returns a function that removes it.
     *
     * ```ts
     * const off = streamer.hook('afterContractAction', ({ contract, action, durationMs }) => {
     *     metrics.timing(`${contract}.${action}`, durationMs);
     * });
     * ```
     */
    public hook<K extends StreamerHookName>(name: K, handler: StreamerHookHandler<K>): () => void {
        return this.hookRegistry.add(name, handler);
    }

    /**
     * Registers a plugin: a hooks object, or a function that receives the
     * streamer and optionally returns hooks. Returns a disposer that removes
     * every hook the plugin added.
     */
    public use(plugin: StreamerPlugin): () => void {
        if (typeof plugin === 'function') {
            const hooks = plugin(this);
            return hooks ? this.hookRegistry.addAll(hooks) : () => undefined;
        }

        return this.hookRegistry.addAll(plugin);
    }

    private async runHook<K extends StreamerHookName>(name: K, ctx: Parameters<StreamerHookHandler<K>>[0]): Promise<void> {
        if (!this.hookRegistry.has(name)) {
            return;
        }

        for (const handler of this.hookRegistry.get(name)) {
            try {
                await (handler as (context: any) => unknown)(ctx);
            } catch (error) {
                if (name === 'onError') {
                    getLogger().error('[Streamer] onError hook threw:', error);
                } else {
                    await this.reportError(error, 'hook', {});
                }
            }
        }
    }

    private toError(error: unknown): Error {
        return error instanceof Error ? error : new Error(String(error));
    }

    /**
     * Logs a non-fatal error and notifies `onError` hooks.
     */
    private async reportError(error: unknown, phase: ErrorPhase, meta: ErrorMeta, fatal: boolean = false): Promise<void> {
        const err = this.toError(error);

        getLogger().error(`[Streamer] ${fatal ? 'Fatal ' : ''}${phase} error: ${err.message}`, {
            stack: err.stack,
            ...meta
        });

        await this.runHook('onError', {
            streamer: this,
            error: err,
            phase,
            fatal,
            ...meta
        });
    }

    /**
     * Stops processing without tearing down the adapter or contracts, so
     * an operator can inspect state and restart. The failed block is not
     * checkpointed and will be processed again on restart.
     */
    private async haltStream(error: unknown, phase: ErrorPhase, meta: ErrorMeta): Promise<never> {
        const err = this.toError(error);

        if (err instanceof StreamHaltError) {
            throw err;
        }

        this.halted = true;
        this.disableAllProcessing = true;
        this.lastError = { message: err.message, phase, blockNumber: meta.blockNumber, at: new Date() };
        this.clearRuntimeTimers();

        await this.reportError(err, phase, meta, true);

        throw new StreamHaltError(err, phase, meta.blockNumber);
    }

    private retryDelay(attempt: number): number {
        const base = this.config.ERROR_RETRY_DELAY_MS;
        return Math.min(base * Math.pow(2, Math.max(0, attempt - 1)), this.config.RETRY_MAX_DELAY_MS);
    }

    /**
     * Applies ERROR_POLICY to an infrastructure failure (adapter writes and
     * similar). `work` is retried in place under the `retry` policy.
     */
    private async runWithErrorPolicy(work: () => Promise<unknown>, phase: ErrorPhase, meta: ErrorMeta): Promise<void> {
        const policy = this.config.ERROR_POLICY;
        const maxAttempts = policy === 'retry' ? 1 + this.config.ERROR_MAX_RETRIES : 1;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                await work();
                return;
            } catch (error) {
                if (error instanceof StreamHaltError) {
                    throw error;
                }

                if (attempt < maxAttempts) {
                    getLogger().warn(`[Streamer] ${phase} failed (attempt ${attempt}/${maxAttempts}), retrying`, { ...meta, error: this.toError(error).message });
                    await Utils.sleep(this.retryDelay(attempt));
                    continue;
                }

                if (policy === 'skip') {
                    await this.reportError(error, phase, meta);
                    return;
                }

                await this.haltStream(error, phase, meta);
            }
        }
    }

    /**
     * Invokes subscription callbacks one at a time, in registration order,
     * awaiting each. A throwing callback is logged and reported to
     * `onError` (phase `subscription`) without affecting the others.
     */
    private async notify<T extends SubscriptionCallback>(subscriptions: T[], invoke: (subscription: T) => unknown, meta: ErrorMeta): Promise<void> {
        if (subscriptions.length === 0) {
            return;
        }

        for (const subscription of [...subscriptions]) {
            try {
                await invoke(subscription);
            } catch (error) {
                await this.reportError(error, 'subscription', meta);
            }
        }
    }

    // ─── Contract pausing ────────────────────────────────────────────────

    /**
     * Rejects every call to a contract (or one action) until resumed.
     * Rejections are reported through the `onActionRejected` hook.
     */
    public pauseContract(name: string, action?: string): void {
        this.pausedContracts.add(action ? `${name}.${action}` : name);
    }

    public resumeContract(name: string, action?: string): void {
        this.pausedContracts.delete(action ? `${name}.${action}` : name);
    }

    public isContractPaused(name: string, action?: string): boolean {
        if (this.pausedContracts.has(name)) {
            return true;
        }

        return action ? this.pausedContracts.has(`${name}.${action}`) : false;
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
                getLogger().warn('[Streamer] Error destroying existing adapter:', error);
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

    public getClient(): Client {
        return this.client;
    }

    public getConfig(): Readonly<ConfigInterface> {
        return this.config;
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
                    getLogger().warn(`[Streamer] Failed to restore action ${a.id}:`, error);
                }
            }
        }

        const exists = this.actions.find(a => a.id === action.id);

        if (!exists) {
            this.validateActionContract(action);
            this.actions.push(action);
            
            await this.saveActionsToDisk();
            
            if (this.config.DEBUG_MODE) {
                getLogger().debug(`[Streamer] Registered time-based action: ${action.id} (${action.timeValue})`);
            }
        } else {
            if (this.config.DEBUG_MODE) {
                getLogger().warn(`[Streamer] Action with ID ${action.id} already exists, skipping registration`);
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
                getLogger().debug(`[Streamer] Removed time-based action: ${actionId}`);
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
                getLogger().debug(`[Streamer] Action ${actionId} ${enabled ? 'enabled' : 'disabled'}`);
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
                    lastBlockId: this.lastBlockId,
                    actions: this.actions.map(a => a.toJSON())
                });
            }
        } catch (error) {
            if (error?.code !== 'SQLITE_MISUSE') {
                getLogger().error('[Streamer] Failed to save actions to disk:', error);
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
                getLogger().debug(`[Streamer] Reset action: ${id}`);
            }
            
            return true;
        }
        
        return false;
    }

    public async registerContract(contract: ContractDefinition): Promise<void> {
        if (!contract || typeof contract !== 'object' || Array.isArray(contract)) {
            throw new Error('Contract must be a valid definition');
        }

        if (typeof contract.name !== 'string' || !contract.name.trim()) {
            throw new Error('Contract name must be a non-empty string');
        }

        validateContractDefinition(contract);

        if (this.contractCache.has(contract.name)) {
            throw new Error(`Contract '${contract.name}' is already registered`);
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
        const shouldRecreateClient = !this.hasInjectedClient &&
            JSON.stringify(this.config.API_NODES) !== JSON.stringify(nextConfig.API_NODES);
        const shouldRecreateHiveEngine = this.config.HIVE_ENGINE_API !== nextConfig.HIVE_ENGINE_API;
        const shouldSyncApiServer = this.config.API_ENABLED !== nextConfig.API_ENABLED || this.config.API_PORT !== nextConfig.API_PORT;

        Object.assign(this.config, nextConfig);

        // Set keys and username incase they have changed
        this.username = this.config.USERNAME;
        this.postingKey = this.config.POSTING_KEY;
        this.activeKey = this.config.ACTIVE_KEY;

        if (shouldRecreateClient) {
            this.client = this.createHiveClient();

            if (this.blockProvider instanceof HiveProvider) {
                this.blockProvider.updateClient(this.config.API_NODES);
            }
        }

        if (shouldRecreateHiveEngine) {
            this.hive = new HiveEngineClient(this.config.HIVE_ENGINE_API);
        }

        if (shouldSyncApiServer && (this.apiServer || this.isStarted)) {
            const syncApiServer = this.config.API_ENABLED
                ? this.startApiServer(this.config.API_PORT)
                : this.stopApiServer();

            syncApiServer.catch((error) => {
                getLogger().error('[Streamer] Failed to sync API server after config update:', error);
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
    /**
     * Init
     *
     * Prepares the streamer for processing without starting any timers or
     * polling loops: initializes the adapter, block provider, and contracts,
     * then restores persisted state. `start()` calls this automatically, but
     * it can also be used standalone with `processPendingBlocks()` for
     * timer-free block processing (tests, replays, serverless environments).
     */
    public async init(): Promise<Streamer> {
        if (this.isInitialized) {
            return this;
        }

        await this.ensureAdapterReady();
        await this.blockProvider.create?.();
        await this.initializeContracts();

        const state = await this.adapter.loadState();

        if (this.config.DEBUG_MODE) {
            getLogger().debug(`Restoring state from file`);
        }

        const restoredBlockNumber = Number(state?.lastBlockNumber);

        if (this.config.RESUME_FROM_STATE && Number.isFinite(restoredBlockNumber) && restoredBlockNumber > 0) {
            this.lastBlockNumber = restoredBlockNumber;
            this.lastBlockId = typeof state?.lastBlockId === 'string' && state.lastBlockId ? state.lastBlockId : null;

            if (this.lastBlockId) {
                this.recentBlockIds.set(this.lastBlockNumber, this.lastBlockId);
            }
        } else if (this.config.LAST_BLOCK_NUMBER) {
            this.lastBlockNumber = this.config.LAST_BLOCK_NUMBER;
        }

        await this.restorePersistedActions();

        this.isInitialized = true;

        return this;
    }

    /**
     * Restores time actions persisted by a previous run, so scheduled work
     * survives restarts without the app having to re-register it first.
     */
    private async restorePersistedActions(): Promise<void> {
        let persisted: TimeAction[] = [];

        try {
            persisted = await this.adapter.loadActions() as TimeAction[];
        } catch (error) {
            getLogger().warn('[Streamer] Failed to load persisted time actions:', error);
            return;
        }

        for (const entry of persisted ?? []) {
            if (!entry || this.actions.some((existing) => existing.id === entry.id)) {
                continue;
            }

            try {
                this.actions.push(entry instanceof TimeAction ? entry : TimeAction.fromJSON(entry));
            } catch (error) {
                getLogger().warn(`[Streamer] Failed to restore action ${(entry as any)?.id}:`, error);
            }
        }
    }

    public async start(): Promise<Streamer> {
        if (this.isStarted) {
            return this;
        }

        if (this.config.DEBUG_MODE) {
            getLogger().debug('Starting to stream the Hive blockchain');
        }

        this.disableAllProcessing = false;
        this.halted = false;
        this.attempts = 0;
        await this.init();
        this.startSubscriptionCleanupInterval();

        if (this.config.API_ENABLED) {
            await this.startApiServer(this.config.API_PORT);
        }

        this.isStarted = true;
        this.startedAt = Date.now();
        this.lastProcessedAt = Date.now();

        await this.runHook('onStart', { streamer: this });

        // Kicks off the blockchain streaming and operation parsing
        this.getBlock();

        this.latestBlockTimer = setInterval(() => { this.getLatestBlock(); }, this.config.BLOCK_CHECK_INTERVAL);

        return this;
    }

    /**
     * Stop
     *
     * Stops the streamer from running. Waits for the block currently being
     * processed to finish, writes a final checkpoint, then tears down the
     * API server, contracts, adapter, and block provider.
     */
    public async stop(): Promise<void> {
        const wasRunning = this.isStarted || this.isInitialized;

        this.disableAllProcessing = true;
        this.isStarted = false;
        this.clearRuntimeTimers();

        if (this.currentProcessing) {
            await this.currentProcessing.catch(() => undefined);
        }

        if (this.isInitialized && this.adapterInitialized && this.lastBlockNumber > 0) {
            await this.checkpoint(true);
        }

        await this.stopApiServer();
        await this.destroyContracts();

        if (this.adapterInitialized && this?.adapter?.destroy) {
            await this.adapter.destroy();
        }

        await this.blockProvider.destroy?.();

        this.adapterInitialized = false;
        this.adapterInitializationPromise = null;
        this.isInitialized = false;

        if (wasRunning) {
            await this.runHook('onStop', { streamer: this });
        }

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
        this.blockCache.clear();
        await this.blockProvider.create?.();
    }

    public getBlockProvider(): BlockProvider {
        return this.blockProvider;
    }

    /**
     * The highest block the streamer is allowed to process: the last
     * irreversible block in `irreversible` mode (falling back to head when
     * the provider doesn't report one), or the head block in `head` mode.
     */
    private resolveTargetBlock(props: { head_block_number: number; last_irreversible_block_num?: number }): number {
        const head = Number(props.head_block_number);
        const reported = props.last_irreversible_block_num;
        const irreversible = reported === undefined || reported === null ? NaN : Number(reported);

        this.headBlockNumber = head;
        this.irreversibleBlockNumber = Number.isFinite(irreversible) && irreversible >= 0 ? Math.min(irreversible, head) : head;

        return this.config.STREAM_MODE === 'head' ? head : this.irreversibleBlockNumber;
    }

    /**
     * Processes blocks sequentially up to `target`, following fork rewinds.
     * Stops early when a block is unavailable or processing is disabled.
     */
    private async processRange(target: number, maxBlocks: number): Promise<number> {
        let processed = 0;
        let rewinds = 0;

        while (
            this.lastBlockNumber < target &&
            processed < maxBlocks &&
            !this.disableAllProcessing
        ) {
            const result = await this.loadBlock(this.lastBlockNumber + 1);

            if (result === 'missing') {
                break;
            }

            if (result === 'rewound') {
                rewinds++;

                if (rewinds > this.config.MAX_FORK_DEPTH) {
                    getLogger().warn('[Streamer] Repeated fork rewinds in one pass; waiting for the chain to settle');
                    break;
                }

                continue;
            }

            processed++;
        }

        return processed;
    }

    private async updateCatchUpState(target: number): Promise<void> {
        const remainingBehind = Math.max(0, target - this.lastBlockNumber);
        this.isCatchingUp = remainingBehind > 0;

        if (remainingBehind === 0 && !this.isCaughtUp) {
            this.isCaughtUp = true;
            await this.runHook('onCaughtUp', {
                streamer: this,
                blockNumber: this.lastBlockNumber,
                headBlockNumber: this.headBlockNumber,
                targetBlockNumber: target
            });
        } else if (remainingBehind > 0) {
            this.isCaughtUp = false;
        }
    }

    /**
     * Process Pending Blocks
     *
     * Processes blocks from the last processed block up to the provider's
     * current target (last irreversible block, or head in `head` mode),
     * without scheduling any timers. Useful for tests, block replays, and
     * environments where polling is driven externally.
     *
     * Calling this after the streamer halted retries the failed block.
     * Throws StreamHaltError if the error policy halts processing.
     *
     * Returns the number of blocks processed.
     */
    public async processPendingBlocks(maxBlocks: number = Infinity): Promise<number> {
        if (this.isPollingBlock) {
            return 0;
        }

        await this.init();

        if (this.halted) {
            this.halted = false;
            this.disableAllProcessing = false;
        }

        this.isPollingBlock = true;

        const work = (async () => {
            const props = await this.blockProvider.getDynamicGlobalProperties();

            if (!props) {
                return 0;
            }

            const target = this.resolveTargetBlock(props);
            this.latestBlockchainTime = new Date(`${props.time}Z`);

            if (this.lastBlockNumber === 0 && target > 0) {
                this.lastBlockNumber = target - 1;
            }

            const processed = await this.processRange(target, maxBlocks);
            await this.updateCatchUpState(target);

            return processed;
        })();

        this.currentProcessing = work.then(() => undefined, () => undefined);

        try {
            return await work;
        } finally {
            this.currentProcessing = null;
            this.isPollingBlock = false;
        }
    }

    private async getLatestBlock() {
        try {
            const props = await this.blockProvider.getDynamicGlobalProperties();

            if (props) {
                this.latestBlockchainTime = new Date(`${props.time}Z`);
            }
        } catch (error) {
            getLogger().error('[Streamer] Error getting latest block:', error);
            // Continue with cached time if available
        }
    }

    private async getBlock(): Promise<void> {
        if (this.isPollingBlock) {
            return;
        }

        this.isPollingBlock = true;
        let nextDelay = this.config.BLOCK_CHECK_INTERVAL;
        let resolveProcessing: () => void = () => undefined;
        this.currentProcessing = new Promise<void>((resolve) => { resolveProcessing = resolve; });

        try {
            // Load global properties from the block provider
            const props = await this.blockProvider.getDynamicGlobalProperties();

            // We have no props, so try loading them again.
            if (!props) {
                return;
            }

            const target = this.resolveTargetBlock(props);

            // If the block number we've got is zero, start from the current target
            if (this.lastBlockNumber === 0 && target > 0) {
                this.lastBlockNumber = target - 1;
            }

            if (this.config.DEBUG_MODE) {
                getLogger().debug(`Head block number: `, props.head_block_number);
                getLogger().debug(`Target block number: `, target);
                getLogger().debug(`Last block number: `, this.lastBlockNumber);
            }

            const BLOCKS_BEHIND = this.config.BLOCKS_BEHIND_WARNING;
            const maxBatchSize = Math.max(1, this.config.CATCH_UP_BATCH_SIZE || 1);
            const blocksBehind = Math.max(0, target - this.lastBlockNumber);

            if (blocksBehind >= BLOCKS_BEHIND && this.config.DEBUG_MODE) {
                getLogger().debug(`[Streamer] ${blocksBehind} blocks behind target (${target}). Catching up...`);
            }

            if (!this.disableAllProcessing) {
                await this.processRange(target, maxBatchSize);
            }

            this.attempts = 0;
            await this.updateCatchUpState(target);

            if (this.isCatchingUp) {
                nextDelay = Math.max(0, this.config.CATCH_UP_DELAY_MS);
            }
        } catch (e) {
            if (e instanceof StreamHaltError) {
                // haltStream already reported the error and cleared timers.
                return;
            }

            // Exponential backoff so a failing node or provider isn't hammered.
            this.attempts++;
            nextDelay = Math.min(
                this.config.BLOCK_CHECK_INTERVAL * Math.pow(2, this.attempts),
                this.config.RETRY_MAX_DELAY_MS
            );

            await this.reportError(e, 'block', { blockNumber: this.lastBlockNumber + 1 });
        } finally {
            this.isPollingBlock = false;
            this.currentProcessing = null;
            resolveProcessing();

            // Storing timeout allows us to clear it, as this just calls itself
            if (!this.disableAllProcessing) {
                this.blockNumberTimeout = setTimeout(() => { this.getBlock(); }, nextDelay);
            }
        }
    }

    private async fetchBlock(blockNumber: number, useCache: boolean = true): Promise<BlockData | null> {
        let block = useCache ? this.blockCache.get(blockNumber) : undefined;

        if (!block) {
            block = await this.blockProvider.getBlock(blockNumber);

            if (block) {
                this.blockCache.set(blockNumber, block);

                if (this.blockCache.size > this.maxCacheSize) {
                    const oldestKey = this.blockCache.keys().next().value;
                    this.blockCache.delete(oldestKey);
                }
            }
        }

        return block ?? null;
    }

    private rememberBlockId(blockNumber: number, blockId: string): void {
        this.recentBlockIds.set(blockNumber, blockId);

        const keep = this.config.MAX_FORK_DEPTH + 1;

        if (this.recentBlockIds.size > keep) {
            for (const key of this.recentBlockIds.keys()) {
                if (this.recentBlockIds.size <= keep) {
                    break;
                }

                if (key <= blockNumber - keep) {
                    this.recentBlockIds.delete(key);
                } else {
                    break;
                }
            }
        }
    }

    /**
     * Handles a block whose `previous` doesn't match the block we processed
     * at that height: walks back until the provider's chain agrees with
     * ours, rewinds the cursor to that common ancestor, and notifies
     * `onFork`. Blocks after the ancestor are re-fetched and processed
     * again; the idempotency ledger (keyed by transaction id and operation
     * index) keeps transactions present on both branches from executing
     * contract actions twice. Transactions that only existed on the
     * orphaned branch have already run and cannot be undone — `onFork`
     * lists those blocks so the app can reconcile.
     */
    private async handleFork(blockNumber: number, expectedPreviousId: string, actualPreviousId: string): Promise<LoadBlockResult> {
        const orphanedBlocks: Array<{ blockNumber: number; blockId: string }> = [];
        const floor = Math.max(0, blockNumber - 1 - this.config.MAX_FORK_DEPTH);
        let commonAncestor: number | null = null;
        let historyExhausted = false;

        for (let height = blockNumber - 1; height > floor; height--) {
            const knownId = this.recentBlockIds.get(height);

            if (!knownId) {
                historyExhausted = true;
                break;
            }

            this.blockCache.delete(height);
            const canonical = await this.blockProvider.getBlock(height);

            if (canonical && canonical.block_id === knownId) {
                commonAncestor = height;
                break;
            }

            orphanedBlocks.push({ blockNumber: height, blockId: knownId });
        }

        if (commonAncestor === null && historyExhausted && orphanedBlocks.length > 0) {
            // We don't remember older block ids (e.g. right after a restart),
            // so assume the chain agrees below the oldest orphaned block.
            commonAncestor = orphanedBlocks[orphanedBlocks.length - 1].blockNumber - 1;
        }

        if (commonAncestor === blockNumber - 1 && orphanedBlocks.length === 0) {
            // The block we processed is still canonical, so the block we were
            // handed belongs to a branch that lost (or the node is lagging).
            // Never process a block that doesn't link to our chain; retry later.
            getLogger().warn(`[Streamer] Block ${blockNumber} (previous ${actualPreviousId}) does not link to processed block ${blockNumber - 1} (${expectedPreviousId}); waiting for the provider to settle`);
            return 'missing';
        }

        getLogger().warn(`[Streamer] Fork detected at block ${blockNumber}: expected previous ${expectedPreviousId}, got ${actualPreviousId}`, {
            commonAncestor,
            orphanedBlocks
        });

        await this.runHook('onFork', {
            streamer: this,
            blockNumber,
            expectedPreviousId,
            actualPreviousId,
            commonAncestor,
            orphanedBlocks
        });

        if (commonAncestor === null) {
            await this.haltStream(
                new Error(`Fork deeper than MAX_FORK_DEPTH (${this.config.MAX_FORK_DEPTH}) at block ${blockNumber}`),
                'fork',
                { blockNumber }
            );
        }

        for (const orphan of orphanedBlocks) {
            this.recentBlockIds.delete(orphan.blockNumber);
            this.blockCache.delete(orphan.blockNumber);
        }

        this.lastBlockNumber = commonAncestor as number;
        this.lastBlockId = this.recentBlockIds.get(this.lastBlockNumber) ?? null;
        await this.checkpoint(true);

        return 'rewound';
    }

    /**
     * Persists the cursor. In `block` mode this runs after every block; in
     * `interval` mode at most every CHECKPOINT_INTERVAL_MS unless forced.
     */
    private async checkpoint(force: boolean = false): Promise<void> {
        if (!this.adapterInitialized || !this.adapter?.saveState) {
            return;
        }

        if (!force && this.config.CHECKPOINT_MODE === 'interval' &&
            Date.now() - this.lastStateSave < this.config.CHECKPOINT_INTERVAL_MS) {
            return;
        }

        this.lastStateSave = Date.now();

        try {
            await this.saveStateToDisk();
        } catch (error) {
            await this.reportError(error, 'checkpoint', { blockNumber: this.lastBlockNumber });
            return;
        }

        await this.runHook('onCheckpoint', {
            streamer: this,
            blockNumber: this.lastBlockNumber,
            blockId: this.lastBlockId ?? ''
        });
    }

    private async maybePruneLedger(): Promise<void> {
        if (!this.config.IDEMPOTENCY_ENABLED || !this.adapter?.pruneProcessedOperations) {
            return;
        }

        if (this.lastBlockNumber - this.lastLedgerPruneBlock < 1000) {
            return;
        }

        this.lastLedgerPruneBlock = this.lastBlockNumber;
        const cutoff = this.lastBlockNumber - this.config.IDEMPOTENCY_RETENTION_BLOCKS;

        if (cutoff <= 0) {
            return;
        }

        try {
            await this.adapter.pruneProcessedOperations(cutoff);
        } catch (error) {
            await this.reportError(error, 'adapter', { blockNumber: this.lastBlockNumber });
        }
    }

    // Takes the block from Hive and allows us to work with it
    private async loadBlock(blockNumber: number): Promise<LoadBlockResult> {
        const block = await this.fetchBlock(blockNumber);

        // The block isn't available yet; the caller decides when to retry.
        if (!block) {
            return 'missing';
        }

        const expectedPreviousId = this.lastBlockNumber === blockNumber - 1
            ? this.recentBlockIds.get(blockNumber - 1)
            : undefined;

        if (expectedPreviousId && block.previous && block.previous !== expectedPreviousId) {
            this.blockCache.delete(blockNumber);
            return this.handleFork(blockNumber, expectedPreviousId, block.previous);
        }

        // Get the block date and time
        const blockTime = new Date(`${block.timestamp}Z`);
        const isNewBlock = this.lastBlockNumber !== blockNumber;

        this.blockId = block.block_id;
        this.previousBlockId = block.previous;
        this.transactionId = block.transaction_ids?.[0];
        this.blockTime = blockTime;

        const blockContext: BlockHookContext = {
            streamer: this,
            block,
            blockNumber,
            blockId: block.block_id,
            previousBlockId: block.previous,
            blockTime
        };

        await this.runHook('beforeBlock', blockContext);

        if (this.adapter?.processBlock) {
            await this.runWithErrorPolicy(() => this.adapter.processBlock(block as any), 'adapter', { blockNumber });
        }

        await this.notify(this.blockSubscriptions, (sub) => sub.callback(block, blockNumber), { blockNumber });

        // Hive operations are order-sensitive, so process them sequentially.
        const transactions = (block.transactions ?? []) as any[];
        const transactionIds = block.transaction_ids ?? [];
        const hasOperationHooks = this.hookRegistry.has('beforeOperation') || this.hookRegistry.has('afterOperation');

        for (let i = 0; i < transactions.length; i++) {
            const operations = transactions[i]?.operations ?? [];
            const transactionId = transactionIds[i];

            for (let opIndex = 0; opIndex < operations.length; opIndex++) {
                const op = operations[opIndex] as [string, any];
                const operationContext: OperationHookContext | null = hasOperationHooks ? {
                    streamer: this,
                    operation: op,
                    type: op?.[0],
                    data: op?.[1],
                    blockNumber,
                    blockId: block.block_id,
                    previousBlockId: block.previous,
                    transactionId,
                    transactionIndex: i,
                    operationIndex: opIndex,
                    blockTime
                } : null;

                if (operationContext && !(await this.shouldProcessOperation(operationContext))) {
                    continue;
                }

                await this.runWithErrorPolicy(() => this.processOperation(
                    op,
                    blockNumber,
                    block.block_id,
                    block.previous,
                    transactionId,
                    blockTime,
                    opIndex
                ), 'operation', { blockNumber, transactionId, operationIndex: opIndex });

                if (operationContext) {
                    await this.runHook('afterOperation', operationContext);
                }
            }
        }

        // Time actions run after the block's operations, against the block's
        // own timestamp, so replays and catch-up are deterministic.
        if (isNewBlock) {
            await this.processActions(blockTime, blockNumber);
        }

        this.lastBlockNumber = blockNumber;
        this.lastBlockId = block.block_id;
        this.rememberBlockId(blockNumber, block.block_id);
        this.lastProcessedAt = Date.now();

        await this.checkpoint();
        await this.runHook('afterBlock', blockContext);
        await this.maybePruneLedger();
        this.cleanupCaches();

        return 'processed';
    }

    private async shouldProcessOperation(ctx: OperationHookContext): Promise<boolean> {
        for (const handler of this.hookRegistry.get('beforeOperation')) {
            try {
                if (await handler(ctx) === false) {
                    return false;
                }
            } catch (error) {
                await this.reportError(error, 'hook', {
                    blockNumber: ctx.blockNumber,
                    transactionId: ctx.transactionId,
                    operationIndex: ctx.operationIndex
                });
            }
        }

        return true;
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

    /**
     * Process Operation
     *
     * Runs a single operation through the adapter, subscriptions, and
     * contracts. `operationIndex` (the operation's position inside its
     * transaction) enables the idempotency ledger; the block loop always
     * supplies it. Calls without it — e.g. apps feeding operations in
     * manually — dispatch contracts without duplicate protection.
     */
    public async processOperation(
        op: [string, any],
        blockNumber: number,
        blockId: string,
        prevBlockId: string,
        trxId: string,
        blockTime: Date,
        operationIndex?: number
    ): Promise<void> {
        const operationType = op[0];
        const operationData = op[1];
        const operationMetadata = {
            blockNumber,
            blockId,
            previousBlockId: prevBlockId,
            transactionId: trxId,
            operationIndex,
            blockTime
        };
        const errorMeta: ErrorMeta = { blockNumber, transactionId: trxId, operationIndex };
        const ledgerKey = this.buildOperationLedgerKey(blockNumber, trxId, operationIndex);
        const notifyStandard = (subscriptions: SubscriptionCallback[]) => this.notify(
            subscriptions,
            (sub) => sub.callback(operationData, blockNumber, blockId, prevBlockId, trxId, blockTime),
            errorMeta
        );

        if (this.adapter?.processOperation) {
            await this.adapter.processOperation(op, blockNumber, blockId, prevBlockId, trxId, blockTime);
        }

        // Fire onAnyOperation subscribers
        await this.notify(
            this.anyOperationSubscriptions,
            (sub) => sub.callback(op, blockNumber, blockId, prevBlockId, trxId, blockTime),
            errorMeta
        );

        // Operation is a "comment" which could either be a post or comment
        if (operationType === 'comment') {
            if (operationData?.parent_author === '') {
                await notifyStandard(this.postSubscriptions);
            } else {
                await notifyStandard(this.commentSubscriptions);
            }
        }

        // This is a transfer
        if (operationType === 'transfer') {
            const sender = operationData?.from;
            const rawAmount = operationData?.amount;
            const transferInfo = this.buildTransferInfo(operationData);

            const json = Utils.jsonParse(operationData?.memo);
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
                    operationIndex,
                    operation: {
                        type: operationType,
                        data: operationData
                    }
                });

                await this.dispatchContractAction(payload, context, { ledgerKey });
            }

            await this.notify(
                this.transferSubscriptions.filter((sub) => sub.account === operationData?.to),
                (sub) => sub.callback(operationData, blockNumber, blockId, prevBlockId, trxId, blockTime),
                errorMeta
            );
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

            const json = Utils.jsonParse(operationData?.json);
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
                    operationIndex,
                    operation: {
                        type: operationType,
                        data: operationData
                    }
                });

                await this.dispatchContractAction(payload, context, { ledgerKey });
            }

            const authInfo = { sender, isSignedWithActiveKey };

            await this.notify(
                this.customJsonSubscriptions,
                (sub) => sub.callback(operationData, authInfo, blockNumber, blockId, prevBlockId, trxId, blockTime),
                errorMeta
            );

            await this.notify(
                this.customJsonIdSubscriptions.filter((sub) => sub.id === id),
                (sub) => sub.callback(operationData, authInfo, blockNumber, blockId, prevBlockId, trxId, blockTime),
                errorMeta
            );

            if (id === this.config.HIVE_ENGINE_ID && this.customJsonHiveEngineSubscriptions.length > 0) {
                const enginePayload = json || {};
                const { contractName, contractAction, contractPayload } = enginePayload;
                let hasVerificationErrors = false;

                try {
                    const txInfo = await this.hive.getTransactionInfo(trxId);
                    const logs = txInfo && txInfo.logs ? Utils.jsonParse(txInfo.logs) : null;
                    hasVerificationErrors = Boolean(txInfo && logs && typeof logs.errors !== 'undefined');
                } catch (e) {
                    getLogger().error(e);
                }

                if (!hasVerificationErrors) {
                    await this.notify(
                        this.customJsonHiveEngineSubscriptions,
                        (sub) => sub.callback(
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
                        ),
                        errorMeta
                    );
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
                    transfer: this.buildTransferInfo(operationData),
                    operationIndex,
                    operation: {
                        type: operationType,
                        data: operationData
                    }
                });

                await this.dispatchContractAction(payload, context, { ledgerKey });
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
                        operationIndex,
                        operation: {
                            type: operationType,
                            data: operationData
                        }
                    });

                    await this.dispatchContractAction(payload, context, { ledgerKey });
                }
            }

            await notifyStandard(this.escrowSubscriptions.filter((sub) => sub.type === operationType));
        }

        if (operationType === 'vote') {
            await notifyStandard(this.voteSubscriptions);
        }

        if (operationType === 'delegate_vesting_shares') {
            await notifyStandard(this.delegateSubscriptions);
        }

        // Power up (transfer_to_vesting)
        if (operationType === 'transfer_to_vesting') {
            await notifyStandard(this.powerUpSubscriptions);
        }

        // Power down (withdraw_vesting)
        if (operationType === 'withdraw_vesting') {
            await notifyStandard(this.powerDownSubscriptions);
        }

        if (operationType === 'claim_reward_balance') {
            await notifyStandard(this.claimRewardsSubscriptions);
        }

        if (operationType === 'account_witness_vote') {
            await notifyStandard(this.witnessVoteSubscriptions);
        }

        // Follow/unfollow/mute/reblog via custom_json with id 'follow'
        if (operationType === 'custom_json' && operationData?.id === 'follow') {
            const json = Utils.jsonParse(operationData.json);

            if (Array.isArray(json) && json.length === 2) {
                const [type, payload] = json;
                const notifySocial = (subscriptions: SubscriptionCallback[]) => this.notify(
                    subscriptions,
                    (sub) => sub.callback(payload, blockNumber, blockId, prevBlockId, trxId, blockTime),
                    errorMeta
                );

                if (type === 'follow' && payload) {
                    await notifySocial(this.followSubscriptions);
                }

                if (type === 'reblog' && payload) {
                    await notifySocial(this.reblogSubscriptions);
                }
            }
        }

        if (operationType === 'account_update' || operationType === 'account_update2') {
            await notifyStandard(this.accountUpdateSubscriptions);
        }

        if (operationType === 'delete_comment') {
            await notifyStandard(this.deleteCommentSubscriptions);
        }

        if (operationType === 'limit_order_create' || operationType === 'limit_order_create2' || operationType === 'limit_order_cancel') {
            await notifyStandard(this.limitOrderSubscriptions);
        }

        if (operationType === 'transfer_to_savings' || operationType === 'transfer_from_savings' || operationType === 'cancel_transfer_from_savings') {
            await notifyStandard(this.savingsSubscriptions);
        }

        if (operationType === 'convert' || operationType === 'collateralized_convert') {
            await notifyStandard(this.convertSubscriptions);
        }
    }

    /**
     * Ledger keys use the transaction id and operation index rather than
     * the block number, so a transaction that moves to a different block
     * after a fork is still recognised as already processed.
     */
    private buildOperationLedgerKey(blockNumber: number, trxId: string, operationIndex?: number): string | undefined {
        if (operationIndex === undefined || operationIndex === null) {
            return undefined;
        }

        return trxId ? `op:${trxId}:${operationIndex}` : `op:${blockNumber}::${operationIndex}`;
    }

    private buildTransferInfo(operationData: any): NonNullable<ContractContext['transfer']> {
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

        return {
            from: operationData?.from,
            to: operationData?.to,
            rawAmount: rawAmount || '',
            amount,
            asset,
            memo: operationData?.memo
        };
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
            getLogger().warn('[Streamer] Legacy contract payload detected (name/action). Please migrate to { contract, action, payload }.');
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
            operationIndex?: number;
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
                id: transactionId,
                operationIndex: details.operationIndex
            },
            sender: details.sender,
            transfer: details.transfer,
            customJson: details.customJson,
            escrow: details.escrow,
            operation: details.operation
        };
    }

    private async rejectAction(
        contract: string,
        action: string,
        reason: ActionRejectionReason,
        message: string,
        context: ContractContext,
        level: 'warn' | 'debug' = 'warn'
    ): Promise<ContractDispatchResult> {
        if (level === 'warn') {
            getLogger().warn(`[Streamer] ${message}`);
        } else if (this.config.DEBUG_MODE) {
            getLogger().debug(`[Streamer] ${message}`);
        }

        await this.runHook('onActionRejected', {
            streamer: this,
            contract,
            action,
            reason,
            message,
            context
        });

        return reason === 'duplicate' ? 'duplicate' : 'rejected';
    }

    private resolveGuards(contract: ContractDefinition, actionDefinition: ContractActionDefinition<any>): ContractActionGuards {
        return {
            ...(contract.guards ?? {}),
            ...(actionDefinition.guards ?? {})
        };
    }

    private rateLimitKey(contract: string, action: string, sender?: string): string {
        return `${contract}.${action}:${sender ?? ''}`;
    }

    /**
     * Evaluates declarative guards. Returns a rejection or null when the
     * call may proceed.
     */
    private evaluateGuards(
        contractName: string,
        actionName: string,
        guards: ContractActionGuards,
        context: ContractContext
    ): { reason: ActionRejectionReason; message: string } | null {
        const label = `${contractName}.${actionName}`;

        if (guards.paused || this.isContractPaused(contractName, actionName)) {
            return { reason: 'paused', message: `Action '${label}' is paused` };
        }

        if (context.trigger !== 'time') {
            const sender = context.sender;

            if (guards.allowedSenders && (!sender || !guards.allowedSenders.includes(sender))) {
                return { reason: 'sender_not_allowed', message: `Sender '${sender ?? ''}' is not allowed to call '${label}'` };
            }

            if (guards.blockedSenders && sender && guards.blockedSenders.includes(sender)) {
                return { reason: 'sender_not_allowed', message: `Sender '${sender}' is blocked from calling '${label}'` };
            }
        }

        const transfer = context.transfer;

        if (transfer) {
            const asset = String(transfer.asset || '').toUpperCase();

            if (guards.allowedAssets && !guards.allowedAssets.map((entry) => entry.toUpperCase()).includes(asset)) {
                return { reason: 'asset_not_allowed', message: `Asset '${asset}' is not accepted by '${label}'` };
            }

            const amount = new BigNumber(transfer.amount);

            if (guards.minAmount !== undefined) {
                if (!amount.isFinite() || amount.isLessThan(guards.minAmount)) {
                    return { reason: 'amount_too_low', message: `Amount ${transfer.rawAmount} is below the minimum ${guards.minAmount} for '${label}'` };
                }
            }

            if (guards.maxAmount !== undefined) {
                if (!amount.isFinite() || amount.isGreaterThan(guards.maxAmount)) {
                    return { reason: 'amount_too_high', message: `Amount ${transfer.rawAmount} is above the maximum ${guards.maxAmount} for '${label}'` };
                }
            }
        }

        if (guards.rateLimit && context.trigger !== 'time') {
            const now = context.block.time.getTime();
            const windowStart = now - guards.rateLimit.windowSeconds * 1000;
            const key = this.rateLimitKey(contractName, actionName, context.sender);
            const hits = (this.rateLimitHits.get(key) ?? []).filter((time) => time > windowStart);

            this.rateLimitHits.set(key, hits);

            if (hits.length >= guards.rateLimit.max) {
                return {
                    reason: 'rate_limited',
                    message: `Sender '${context.sender ?? ''}' exceeded ${guards.rateLimit.max} calls per ${guards.rateLimit.windowSeconds}s on '${label}'`
                };
            }
        }

        return null;
    }

    private recordRateLimitHit(contractName: string, actionName: string, guards: ContractActionGuards, context: ContractContext): void {
        if (!guards.rateLimit || context.trigger === 'time') {
            return;
        }

        const key = this.rateLimitKey(contractName, actionName, context.sender);
        const hits = this.rateLimitHits.get(key) ?? [];
        hits.push(context.block.time.getTime());
        this.rateLimitHits.set(key, hits);

        if (this.rateLimitHits.size > 50000) {
            // Bound memory: drop the oldest tracked senders.
            const excess = this.rateLimitHits.size - 50000;
            const keys = this.rateLimitHits.keys();

            for (let i = 0; i < excess; i++) {
                this.rateLimitHits.delete(keys.next().value);
            }
        }
    }

    private async isDuplicate(ledgerKey: string | undefined): Promise<boolean> {
        if (!ledgerKey || !this.config.IDEMPOTENCY_ENABLED || this.bypassLedger || !this.adapter?.hasProcessedOperation) {
            return false;
        }

        return this.adapter.hasProcessedOperation(ledgerKey);
    }

    private async recordLedger(
        ledgerKey: string | undefined,
        payload: ContractPayload,
        context: ContractContext,
        status: 'success' | 'failed'
    ): Promise<void> {
        if (!ledgerKey || !this.config.IDEMPOTENCY_ENABLED || !this.adapter?.markOperationProcessed) {
            return;
        }

        await this.adapter.markOperationProcessed({
            key: ledgerKey,
            blockNumber: context.block.number,
            transactionId: context.transaction.id,
            operationIndex: context.transaction.operationIndex,
            contract: payload.contract,
            action: payload.action,
            status
        });
    }

    private async runContractHook<T>(fn: (() => T | Promise<T>) | undefined, meta: ErrorMeta): Promise<T | undefined> {
        if (!fn) {
            return undefined;
        }

        try {
            return await fn();
        } catch (error) {
            await this.reportError(error, 'hook', meta);
            return undefined;
        }
    }

    /**
     * Resolves, validates, guards, and executes a contract action.
     *
     * Order: contract/action/trigger lookup → idempotency check → active key
     * → schema → guards → `beforeContractAction` hooks → contract
     * `beforeAction` → handler (with ERROR_POLICY) → ledger → after hooks.
     */
    private async dispatchContractAction(
        payload: ContractPayload,
        context: ContractContext,
        options: { ledgerKey?: string } = {}
    ): Promise<ContractDispatchResult> {
        const contract = this.contractCache.get(payload.contract) ||
            this.contracts.find(c => c.name === payload.contract);

        if (!contract) {
            return this.rejectAction(payload.contract, payload.action, 'contract_not_found',
                `Contract '${payload.contract}' not found for action '${payload.action}'`, context);
        }

        if (!this.contractCache.has(payload.contract)) {
            this.contractCache.set(payload.contract, contract);
        }

        const actionDefinition = contract.actions?.[payload.action];

        if (!actionDefinition || typeof actionDefinition.handler !== 'function') {
            return this.rejectAction(payload.contract, payload.action, 'action_not_found',
                `Action '${payload.action}' not found in contract '${payload.contract}'`, context);
        }

        if (!this.isActionTriggerAllowed(actionDefinition, context.trigger)) {
            return this.rejectAction(payload.contract, payload.action, 'trigger_not_allowed',
                `Action '${payload.action}' does not allow trigger '${context.trigger}'`, context);
        }

        const errorMeta: ErrorMeta = {
            blockNumber: context.block.number,
            transactionId: context.transaction.id,
            operationIndex: context.transaction.operationIndex
        };

        if (await this.isDuplicate(options.ledgerKey)) {
            return this.rejectAction(payload.contract, payload.action, 'duplicate',
                `Skipping ${payload.contract}.${payload.action}: operation ${options.ledgerKey} was already processed`, context, 'debug');
        }

        if (actionDefinition.requiresActiveKey &&
            context.trigger === 'custom_json' &&
            !context.customJson?.isSignedWithActiveKey) {
            return this.rejectAction(payload.contract, payload.action, 'active_key_required',
                `Action '${payload.action}' requires active key signature`, context);
        }

        let actionPayload: any = payload.payload ?? {};

        if (actionDefinition.schema) {
            const result = actionDefinition.schema.safeParse(actionPayload);

            if (!result.success) {
                const issues = (result.error as any)?.issues ?? [];

                getLogger().warn(`[Streamer] Invalid payload for ${payload.contract}.${payload.action}`, {
                    errors: issues
                });

                await this.runHook('onInvalidPayload', {
                    streamer: this,
                    contract: payload.contract,
                    action: payload.action,
                    payload: actionPayload,
                    issues,
                    context
                });

                return 'rejected';
            }

            actionPayload = result.data;
        }

        const guards = this.resolveGuards(contract, actionDefinition);
        const rejection = this.evaluateGuards(payload.contract, payload.action, guards, context);

        if (rejection) {
            return this.rejectAction(payload.contract, payload.action, rejection.reason, rejection.message, context);
        }

        const hookContext: ContractActionHookContext = {
            streamer: this,
            contract: payload.contract,
            action: payload.action,
            payload: actionPayload,
            meta: payload.meta,
            context
        };

        for (const handler of this.hookRegistry.get('beforeContractAction')) {
            let outcome: unknown;

            try {
                outcome = await handler(hookContext);
            } catch (error) {
                // Fail closed: a crashing guard must not let the action through.
                await this.reportError(error, 'hook', errorMeta);
                outcome = false;
            }

            if (outcome === false) {
                return this.rejectAction(payload.contract, payload.action, 'vetoed',
                    `Action ${payload.contract}.${payload.action} vetoed by beforeContractAction hook`, context, 'debug');
            }

            if (outcome && typeof outcome === 'object' && 'payload' in (outcome as any)) {
                hookContext.payload = (outcome as { payload: any }).payload;
            }
        }

        actionPayload = hookContext.payload;

        if (contract.hooks?.beforeAction) {
            let proceed: unknown;

            try {
                proceed = await contract.hooks.beforeAction({ action: payload.action, payload: actionPayload, ctx: context });
            } catch (error) {
                await this.reportError(error, 'hook', errorMeta);
                proceed = false;
            }

            if (proceed === false) {
                return this.rejectAction(payload.contract, payload.action, 'vetoed',
                    `Action ${payload.contract}.${payload.action} vetoed by contract beforeAction hook`, context, 'debug');
            }
        }

        this.recordRateLimitHit(payload.contract, payload.action, guards, context);

        const policy = this.config.ERROR_POLICY;
        const maxAttempts = policy === 'retry' ? 1 + this.config.ERROR_MAX_RETRIES : 1;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            const startedAt = Date.now();

            try {
                await actionDefinition.handler(actionPayload, context);
            } catch (error) {
                if (error instanceof StreamHaltError) {
                    throw error;
                }

                const err = this.toError(error);
                const willRetry = attempt < maxAttempts;

                getLogger().error(`[Streamer] Contract action error for ${payload.contract}.${payload.action}:`, err);

                await this.runContractHook(
                    contract.hooks?.onError
                        ? () => contract.hooks.onError({ action: payload.action, payload: actionPayload, ctx: context, error: err })
                        : undefined,
                    errorMeta
                );

                await this.runHook('onContractError', {
                    ...hookContext,
                    payload: actionPayload,
                    error: err,
                    attempt,
                    willRetry
                });

                if (willRetry) {
                    await Utils.sleep(this.retryDelay(attempt));
                    continue;
                }

                if (policy === 'skip') {
                    if (context.trigger === 'time') {
                        // Leave the time action due so it runs again next block.
                        throw err;
                    }

                    await this.recordLedger(options.ledgerKey, payload, context, 'failed');
                    return 'failed';
                }

                await this.haltStream(err, context.trigger === 'time' ? 'action' : 'contract', errorMeta);
            }

            const durationMs = Date.now() - startedAt;

            await this.recordLedger(options.ledgerKey, payload, context, 'success');

            await this.runContractHook(
                contract.hooks?.afterAction
                    ? () => contract.hooks.afterAction({ action: payload.action, payload: actionPayload, ctx: context, durationMs })
                    : undefined,
                errorMeta
            );

            await this.runHook('afterContractAction', {
                ...hookContext,
                payload: actionPayload,
                durationMs
            });

            return 'executed';
        }

        return 'failed';
    }

    /**
     * Runs due time actions. The block loop passes the block's timestamp and
     * number so scheduling follows blockchain time deterministically and
     * each tick is recorded in the idempotency ledger. Called without
     * arguments it falls back to the latest known chain time.
     */
    private async processActions(referenceTime?: Date, blockNumber?: number): Promise<void> {
        const now = referenceTime ?? this.latestBlockchainTime;

        if (!now || this.actions.length === 0) {
            return;
        }

        const currentTime = now.getTime();
        const contextBlockNumber = blockNumber ?? this.lastBlockNumber;
        const executedActions: string[] = [];

        for (let i = 0; i < this.actions.length; i++) {
            const action = this.actions[i];

            // Skip disabled actions or actions that have reached max executions
            if (!action.enabled || action.hasReachedMaxExecutions()) {
                continue;
            }

            let contract = this.contractCache.get(action.contractName);
            if (!contract) {
                contract = this.contracts.find(c => c.name === action.contractName);
                if (contract) {
                    this.contractCache.set(action.contractName, contract);
                }
            }

            if (!contract) {
                getLogger().warn(`[Streamer] Contract '${action.contractName}' not found for action '${action.id}'`);
                continue;
            }

            const actionDefinition = contract.actions?.[action.contractAction];
            if (!actionDefinition || typeof actionDefinition.handler !== 'function') {
                getLogger().warn(`[Streamer] Action '${action.contractAction}' not found in contract '${action.contractName}' for action '${action.id}'`);
                continue;
            }

            if (!this.isActionTriggerAllowed(actionDefinition, 'time')) {
                getLogger().warn(`[Streamer] Action '${action.contractAction}' does not allow time triggers for action '${action.id}'`);
                continue;
            }

            const frequencySeconds = this.actionFrequencyMap.get(action.timeValue);
            if (!frequencySeconds) {
                getLogger().warn(`[Streamer] Invalid time value '${action.timeValue}' for action '${action.id}'`);
                continue;
            }

            const differenceSeconds = (currentTime - action.date.getTime()) / 1000;

            if (differenceSeconds < frequencySeconds) {
                continue;
            }

            try {
                const context = this.buildContractContext(
                    'time',
                    contextBlockNumber,
                    this.blockId,
                    this.previousBlockId,
                    action.id,
                    now,
                    {}
                );

                const result = await this.dispatchContractAction({
                    contract: action.contractName,
                    action: action.contractAction,
                    payload: action.payload || {}
                }, context, {
                    ledgerKey: blockNumber !== undefined ? `time:${action.id}:${blockNumber}` : undefined
                });

                // Reset the timer anchored to blockchain time so wall-clock
                // skew and replayed/simulated blocks stay consistent. A tick
                // rejected by a guard (e.g. paused) is skipped, not counted.
                action.reset(now);

                if (result === 'executed' || result === 'duplicate') {
                    action.incrementExecutionCount(now);
                }

                executedActions.push(action.id);

                if (this.config.DEBUG_MODE) {
                    getLogger().debug(`[Streamer] Time action ${action.id}: ${result} (execution #${action.executionCount})`);
                }
            } catch (error) {
                if (error instanceof StreamHaltError) {
                    throw error;
                }

                const err = this.toError(error);
                getLogger().error(`[Streamer] Action execution error for ${action.contractName}.${action.contractAction}:`, {
                    actionId: action.id,
                    error: err.message,
                    stack: err.stack,
                    payload: action.payload
                });
            }
        }

        if (executedActions.length > 0) {
            await this.saveActionsToDisk();
        }

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
                    getLogger().debug(`[Streamer] Removing completed action: ${action.id} (${action.executionCount}/${action.maxExecutions} executions)`);
                }
                return false;
            }
            return true;
        });

        const afterCount = this.actions.length;

        if (beforeCount !== afterCount) {
            // Save state if we removed any actions
            this.saveActionsToDisk().catch(error => {
                getLogger().error('[Streamer] Failed to save state after action cleanup:', error);
            });
        }
    }

    public async saveStateToDisk(): Promise<void> {
        if (this.adapterInitialized && this.adapter?.saveState) {
            await this.adapter.saveState({
                lastBlockNumber: this.lastBlockNumber,
                lastBlockId: this.lastBlockId,
                actions: this.actions.map(action => action.toJSON())
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
        if (signingKeys) {
            return Utils.broadcastOperations(this.client, operations, signingKeys);
        }

        // Auto-detect key: use posting key for posting-level ops, active key for active-level ops
        const activeOps = new Set([
            'transfer', 'transfer_to_vesting', 'withdraw_vesting', 'delegate_vesting_shares',
            'transfer_to_savings', 'transfer_from_savings', 'cancel_transfer_from_savings',
            'convert', 'collateralized_convert', 'limit_order_create', 'limit_order_create2',
            'limit_order_cancel', 'escrow_transfer', 'escrow_approve', 'escrow_dispute',
            'escrow_release', 'account_update', 'account_witness_vote', 'account_witness_proxy',
            'set_withdraw_vesting_route', 'claim_account', 'create_claimed_account',
            'create_proposal', 'update_proposal_votes', 'remove_proposal', 'recurrent_transfer',
            'feed_publish'
        ]);

        const needsActive = operations.some(([opType]) => activeOps.has(opType));
        const key = needsActive
            ? (this.config.ACTIVE_KEY || this.config.POSTING_KEY)
            : (this.config.POSTING_KEY || this.config.ACTIVE_KEY);

        return Utils.broadcastOperations(this.client, operations, key);
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
        const targetBlockNumber = this.config.STREAM_MODE === 'head'
            ? this.headBlockNumber
            : (this.irreversibleBlockNumber || this.headBlockNumber);

        return {
            streamMode: this.config.STREAM_MODE,
            lastBlockNumber: this.lastBlockNumber,
            lastBlockId: this.lastBlockId,
            headBlockNumber: this.headBlockNumber,
            irreversibleBlockNumber: this.irreversibleBlockNumber,
            targetBlockNumber,
            blocksBehind: targetBlockNumber
                ? Math.max(0, targetBlockNumber - this.lastBlockNumber)
                : 0,
            latestBlockchainTime: this.latestBlockchainTime,
            isCatchingUp: this.isCatchingUp,
            halted: this.halted,
            lastError: this.lastError
        };
    }

    /**
     * Get Health
     *
     * A machine-readable health summary suitable for load balancer checks
     * and monitoring. Status meanings:
     * - `ok`       — started and within the blocks-behind warning threshold
     * - `behind`   — started but at least BLOCKS_BEHIND_WARNING blocks behind head
     * - `stalled`  — started but no block processed in the last 60 seconds
     * - `halted`   — the error policy stopped processing (see `lastError`)
     * - `stopped`  — not started
     */
    public getHealth() {
        const status = this.getStatus();
        const now = Date.now();
        const lastBlockAgeSeconds = this.blockTime
            ? Math.round((now - this.blockTime.getTime()) / 1000)
            : null;

        let health: 'ok' | 'behind' | 'stalled' | 'halted' | 'stopped' = 'ok';

        if (this.halted) {
            health = 'halted';
        } else if (!this.isStarted) {
            health = 'stopped';
        } else if (this.lastProcessedAt && now - this.lastProcessedAt > 60000) {
            health = 'stalled';
        } else if (status.blocksBehind >= this.config.BLOCKS_BEHIND_WARNING) {
            health = 'behind';
        }

        return {
            status: health,
            healthy: health === 'ok' || health === 'behind',
            isStarted: this.isStarted,
            uptimeSeconds: this.startedAt ? Math.round((now - this.startedAt) / 1000) : 0,
            lastBlockAgeSeconds,
            contracts: this.contracts.map((contract) => contract.name),
            actions: this.actions.length,
            ...status
        };
    }

    /**
     * Enable Graceful Shutdown
     *
     * Registers signal handlers that stop the streamer cleanly — halting
     * polling, closing the API server, running contract destroy hooks, and
     * closing the adapter — before exiting. A second signal forces exit.
     *
     * Returns a disposer that removes the handlers.
     */
    public enableGracefulShutdown(signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM']): () => void {
        let shuttingDown = false;

        const handler = async (signal: NodeJS.Signals) => {
            if (shuttingDown) {
                getLogger().warn(`[Streamer] Received ${signal} during shutdown, forcing exit`);
                process.exit(1);
            }

            shuttingDown = true;
            getLogger().info(`[Streamer] Received ${signal}, shutting down gracefully`);

            try {
                await this.stop();
                process.exit(0);
            } catch (error) {
                getLogger().error('[Streamer] Error during graceful shutdown:', error);
                process.exit(1);
            }
        };

        for (const signal of signals) {
            process.on(signal, handler);
        }

        return () => {
            for (const signal of signals) {
                process.removeListener(signal, handler);
            }
        };
    }

    /**
     * Replay Blocks
     *
     * Reprocesses a historical block range through every registered
     * subscription, contract, and adapter — useful for backfills and
     * debugging. Cannot run while the streamer is started, and moves the
     * streaming cursor: afterwards the streamer resumes from `toBlock`.
     *
     * Contract actions that already ran (per the idempotency ledger) are
     * skipped. Pass `{ force: true }` to run them again — only do that when
     * the handlers are safe to repeat.
     *
     * Returns the number of blocks replayed.
     */
    public async replayBlocks(fromBlock: number, toBlock: number, options: { force?: boolean } = {}): Promise<number> {
        if (this.isStarted) {
            throw new Error('Stop the streamer before replaying blocks');
        }

        if (!Number.isInteger(fromBlock) || !Number.isInteger(toBlock) || fromBlock < 1 || toBlock < fromBlock) {
            throw new Error(`Invalid replay range: ${fromBlock} to ${toBlock}`);
        }

        await this.init();

        this.lastBlockNumber = fromBlock - 1;
        this.lastBlockId = null;
        this.recentBlockIds.clear();
        this.disableAllProcessing = false;
        this.halted = false;
        this.bypassLedger = Boolean(options.force);
        let replayed = 0;

        try {
            while (this.lastBlockNumber < toBlock) {
                const target = this.lastBlockNumber + 1;
                const result = await this.loadBlock(target);

                if (result === 'missing') {
                    getLogger().warn(`[Streamer] Replay stopped: block ${target} unavailable from provider`);
                    break;
                }

                if (result === 'processed') {
                    replayed++;
                }
            }
        } finally {
            this.bypassLedger = false;
        }

        await this.saveStateToDisk();

        return replayed;
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

    // ─── New Event Subscriptions ────────────────────────────────────────

    public onVote(callback: (data: any, blockNumber: number, blockId: string, prevBlockId: string, trxId: string, blockTime: Date) => void): void {
        this.voteSubscriptions.push({ callback });
    }

    public onDelegate(callback: (data: any, blockNumber: number, blockId: string, prevBlockId: string, trxId: string, blockTime: Date) => void): void {
        this.delegateSubscriptions.push({ callback });
    }

    public onPowerUp(callback: (data: any, blockNumber: number, blockId: string, prevBlockId: string, trxId: string, blockTime: Date) => void): void {
        this.powerUpSubscriptions.push({ callback });
    }

    public onPowerDown(callback: (data: any, blockNumber: number, blockId: string, prevBlockId: string, trxId: string, blockTime: Date) => void): void {
        this.powerDownSubscriptions.push({ callback });
    }

    public onClaimRewards(callback: (data: any, blockNumber: number, blockId: string, prevBlockId: string, trxId: string, blockTime: Date) => void): void {
        this.claimRewardsSubscriptions.push({ callback });
    }

    public onAccountWitnessVote(callback: (data: any, blockNumber: number, blockId: string, prevBlockId: string, trxId: string, blockTime: Date) => void): void {
        this.witnessVoteSubscriptions.push({ callback });
    }

    // ─── Social Operations ──────────────────────────────────────────────

    public follow(follower: string, following: string) {
        return Utils.follow(this.client, this.config, follower, following);
    }

    public unfollow(follower: string, following: string) {
        return Utils.unfollow(this.client, this.config, follower, following);
    }

    public mute(follower: string, following: string) {
        return Utils.mute(this.client, this.config, follower, following);
    }

    public reblog(account: string, author: string, permlink: string) {
        return Utils.reblog(this.client, this.config, account, author, permlink);
    }

    // ─── Staking Operations ─────────────────────────────────────────────

    public powerUp(from: string, to: string, amount: string) {
        return Utils.powerUp(this.client, this.config, from, to, amount);
    }

    public powerDown(account: string, vestingShares: string) {
        return Utils.powerDown(this.client, this.config, account, vestingShares);
    }

    public cancelPowerDown(account: string) {
        return Utils.cancelPowerDown(this.client, this.config, account);
    }

    public delegateVestingShares(delegator: string, delegatee: string, vestingShares: string) {
        return Utils.delegateVestingShares(this.client, this.config, delegator, delegatee, vestingShares);
    }

    public undelegateVestingShares(delegator: string, delegatee: string) {
        return Utils.undelegateVestingShares(this.client, this.config, delegator, delegatee);
    }

    // ─── Account Operations ─────────────────────────────────────────────

    public claimRewards(account: string, rewardHive: string, rewardHbd: string, rewardVests: string) {
        return Utils.claimRewards(this.client, this.config, account, rewardHive, rewardHbd, rewardVests);
    }

    public witnessVote(account: string, witness: string, approve: boolean = true) {
        return Utils.witnessVote(this.client, this.config, account, witness, approve);
    }

    public setProxy(account: string, proxy: string) {
        return Utils.setProxy(this.client, this.config, account, proxy);
    }

    public clearProxy(account: string) {
        return Utils.clearProxy(this.client, this.config, account);
    }

    public updateProfile(account: string, profile: Record<string, any>) {
        return Utils.updateProfile(this.client, this.config, account, profile);
    }

    public getAccount(username: string) {
        return Utils.getAccount(this.client, username);
    }

    public getAccounts(usernames: string[]) {
        return Utils.getAccounts(this.client, usernames);
    }

    // ─── Savings Operations ─────────────────────────────────────────────

    public transferToSavings(from: string, to: string, amount: string, symbol: string, memo: string = '') {
        return Utils.transferToSavings(this.client, this.config, from, to, amount, symbol, memo);
    }

    public transferFromSavings(from: string, to: string, amount: string, symbol: string, requestId: number = 0, memo: string = '') {
        return Utils.transferFromSavings(this.client, this.config, from, to, amount, symbol, requestId, memo);
    }

    public cancelTransferFromSavings(from: string, requestId: number) {
        return Utils.cancelTransferFromSavings(this.client, this.config, from, requestId);
    }

    // ─── Convert Operations ─────────────────────────────────────────────

    public convert(owner: string, amount: string, requestId: number = 0) {
        return Utils.convert(this.client, this.config, owner, amount, requestId);
    }

    public collateralizedConvert(owner: string, amount: string, requestId: number = 0) {
        return Utils.collateralizedConvert(this.client, this.config, owner, amount, requestId);
    }

    // ─── Content Operations ─────────────────────────────────────────────

    public deleteComment(author: string, permlink: string) {
        return Utils.deleteComment(this.client, this.config, author, permlink);
    }

    public commentOptions(author: string, permlink: string, options: {
        max_accepted_payout?: string;
        percent_hbd?: number;
        allow_votes?: boolean;
        allow_curation_rewards?: boolean;
        extensions?: any[];
    }) {
        return Utils.commentOptions(this.client, this.config, author, permlink, options);
    }

    // ─── Market Operations ──────────────────────────────────────────────

    public limitOrderCreate(owner: string, orderId: number, amountToSell: string, minToReceive: string, fillOrKill: boolean = false, expiration?: string | Date, signingKeys?: string | string[]) {
        return Utils.limitOrderCreate(this.client, this.config, owner, orderId, amountToSell, minToReceive, fillOrKill, expiration);
    }

    public limitOrderCancel(owner: string, orderId: number, signingKeys?: string | string[]) {
        return Utils.limitOrderCancel(this.client, this.config, owner, orderId);
    }

    // ─── Vesting Route ──────────────────────────────────────────────────

    public setWithdrawVestingRoute(fromAccount: string, toAccount: string, percent: number, autoVest: boolean = false, signingKeys?: string | string[]) {
        return Utils.setWithdrawVestingRoute(this.client, this.config, fromAccount, toAccount, percent, autoVest, signingKeys);
    }

    // ─── Account Creation ───────────────────────────────────────────────

    public claimAccount(creator: string, fee: string = '0.000 HIVE') {
        return Utils.claimAccount(this.client, this.config, creator, fee);
    }

    public feedPublish(publisher: string, baseAmount: string, quoteAmount: string = '1.000 HIVE') {
        return Utils.feedPublish(this.client, this.config, publisher, baseAmount, quoteAmount);
    }

    // ─── Batch Builder ────────────────────────────────────────────────

    public batch(): BatchBuilder {
        return new HiveBatchBuilder(this);
    }

    // ─── Authority Management ───────────────────────────────────────────

    public hasPostingAuth(account: string, authAccount: string) {
        return Utils.hasPostingAuth(this.client, account, authAccount);
    }

    public grantPostingAuth(account: string, authAccount: string, signingKeys?: string | string[]) {
        return Utils.grantPostingAuth(this.client, this.config, account, authAccount, signingKeys);
    }

    public revokePostingAuth(account: string, authAccount: string, signingKeys?: string | string[]) {
        return Utils.revokePostingAuth(this.client, this.config, account, authAccount, signingKeys);
    }

    // ─── Additional Event Subscriptions ─────────────────────────────────

    public onFollow(callback: (data: { follower: string; following: string; what: string[] }, blockNumber: number, blockId: string, prevBlockId: string, trxId: string, blockTime: Date) => void): void {
        this.followSubscriptions.push({ callback });
    }

    public onReblog(callback: (data: { account: string; author: string; permlink: string }, blockNumber: number, blockId: string, prevBlockId: string, trxId: string, blockTime: Date) => void): void {
        this.reblogSubscriptions.push({ callback });
    }

    public onAccountUpdate(callback: (data: any, blockNumber: number, blockId: string, prevBlockId: string, trxId: string, blockTime: Date) => void): void {
        this.accountUpdateSubscriptions.push({ callback });
    }

    public onDeleteComment(callback: (data: any, blockNumber: number, blockId: string, prevBlockId: string, trxId: string, blockTime: Date) => void): void {
        this.deleteCommentSubscriptions.push({ callback });
    }

    public onLimitOrder(callback: (data: any, blockNumber: number, blockId: string, prevBlockId: string, trxId: string, blockTime: Date) => void): void {
        this.limitOrderSubscriptions.push({ callback });
    }

    public onSavingsTransfer(callback: (data: any, blockNumber: number, blockId: string, prevBlockId: string, trxId: string, blockTime: Date) => void): void {
        this.savingsSubscriptions.push({ callback });
    }

    public onConvert(callback: (data: any, blockNumber: number, blockId: string, prevBlockId: string, trxId: string, blockTime: Date) => void): void {
        this.convertSubscriptions.push({ callback });
    }

    public onBlock(callback: (block: any, blockNumber: number) => void): void {
        this.blockSubscriptions.push({ callback });
    }

    public onAnyOperation(callback: (op: [string, any], blockNumber: number, blockId: string, prevBlockId: string, trxId: string, blockTime: Date) => void): void {
        this.anyOperationSubscriptions.push({ callback });
    }

    // ─── Hive Engine Write Operations ───────────────────────────────────

    public stakeEngineTokens(from: string, to: string, symbol: string, quantity: string) {
        return Utils.stakeEngineTokens(this.client, this.config, from, to, symbol, quantity);
    }

    public unstakeEngineTokens(from: string, symbol: string, quantity: string) {
        return Utils.unstakeEngineTokens(this.client, this.config, from, symbol, quantity);
    }

    public buyEngineTokens(from: string, symbol: string, quantity: string, price: string) {
        return Utils.buyEngineTokens(this.client, this.config, from, symbol, quantity, price);
    }

    public sellEngineTokens(from: string, symbol: string, quantity: string, price: string) {
        return Utils.sellEngineTokens(this.client, this.config, from, symbol, quantity, price);
    }

    public cancelEngineOrder(from: string, type: 'buy' | 'sell', orderId: string) {
        return Utils.cancelEngineOrder(this.client, this.config, from, type, orderId);
    }

    public delegateEngineTokens(from: string, to: string, symbol: string, quantity: string) {
        return Utils.delegateEngineTokens(this.client, this.config, from, to, symbol, quantity);
    }

    public undelegateEngineTokens(from: string, to: string, symbol: string, quantity: string) {
        return Utils.undelegateEngineTokens(this.client, this.config, from, to, symbol, quantity);
    }

    // ─── Community Operations ───────────────────────────────────────────

    public subscribeCommunity(account: string, community: string) {
        return Utils.subscribeCommunity(this.client, this.config, account, community);
    }

    public unsubscribeCommunity(account: string, community: string) {
        return Utils.unsubscribeCommunity(this.client, this.config, account, community);
    }

    /**
     * Warns (once per subscription list) when a list grows past
     * `maxSubscriptions`, which usually means handlers are being registered
     * in a loop and never removed. Subscriptions are never dropped
     * automatically: silently discarding a registered handler would lose
     * events without any signal to the app.
     */
    private cleanupSubscriptions(): void {
        const lists = [
            'customJsonSubscriptions', 'customJsonIdSubscriptions', 'customJsonHiveEngineSubscriptions',
            'commentSubscriptions', 'postSubscriptions', 'transferSubscriptions', 'escrowSubscriptions',
            'voteSubscriptions', 'delegateSubscriptions', 'powerUpSubscriptions', 'powerDownSubscriptions',
            'claimRewardsSubscriptions', 'witnessVoteSubscriptions', 'followSubscriptions', 'reblogSubscriptions',
            'accountUpdateSubscriptions', 'deleteCommentSubscriptions', 'limitOrderSubscriptions',
            'savingsSubscriptions', 'convertSubscriptions', 'blockSubscriptions', 'anyOperationSubscriptions'
        ] as const;

        for (const name of lists) {
            const size = this[name].length;

            if (size > this.maxSubscriptions && !this.subscriptionWarnings.has(name)) {
                this.subscriptionWarnings.add(name);
                getLogger().warn(`[Streamer] ${name} has ${size} handlers (over ${this.maxSubscriptions}). Are handlers being registered repeatedly without being removed?`);
            }
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
