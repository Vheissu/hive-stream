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

export type FlowMemoInput = string | ((event: TransferEvent) => string);
export type FlowRouteMode = 'base' | 'onTop';
export type FlowGroupSplitStrategy = 'equal' | 'weighted';
export type FlowAllocationInput = string | number | {
    percentage?: string | number;
    percent?: string | number;
    basisPoints?: number;
};

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
    mode?: FlowRouteMode;
}

export interface FlowBurnRoute extends FlowRouteBase {
    type: 'burn';
}

export interface FlowGroupRecipient {
    account: string | ((event: TransferEvent) => string);
    weight?: string | number;
}

export interface FlowTransferRoute extends FlowRouteBase {
    type?: 'transfer';
    to: string | ((event: TransferEvent) => string);
}

export interface FlowTransferGroupRoute extends FlowRouteBase {
    type?: 'transfer';
    group: FlowGroupRecipient[];
    split?: FlowGroupSplitStrategy;
}

export type FlowRoute = FlowBurnRoute | FlowTransferRoute | FlowTransferGroupRoute;

export interface PlannedFlowRoute {
    type: 'burn' | 'transfer';
    mode: FlowRouteMode;
    amount: string;
    asset: string;
    memo: string;
    to?: string;
    routeIndex: number;
    groupIndex?: number;
}

export interface PlannedIncomingTransferRoutes {
    incomingAmount: string;
    asset: string;
    baseAmount: string;
    onTopAmount: string;
    routes: PlannedFlowRoute[];
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

export interface IncomingTransferFlowBuilder {
    forAccount(account: string): this;
    allowSymbols(...symbols: string[]): this;
    memo(memo: FlowMemoInput): this;
    dedupeWith(store: FlowDedupeStore): this;
    ignoreZeroAmount(ignore?: boolean): this;
    onError(handler: (error: unknown, event: TransferEvent) => void | Promise<void>): this;
    burn(allocation: FlowAllocationInput, memo?: FlowMemoInput): this;
    burnOnTop(allocation: FlowAllocationInput, memo?: FlowMemoInput): this;
    forwardTo(to: string, allocation?: FlowAllocationInput, memo?: FlowMemoInput): this;
    forwardOnTop(to: string, allocation: FlowAllocationInput, memo?: FlowMemoInput): this;
    donateOnTop(to: string, allocation: FlowAllocationInput, memo?: FlowMemoInput): this;
    forwardGroup(recipients: FlowGroupRecipient[], allocation: FlowAllocationInput, options?: { memo?: FlowMemoInput; split?: FlowGroupSplitStrategy }): this;
    forwardGroupOnTop(recipients: FlowGroupRecipient[], allocation: FlowAllocationInput, options?: { memo?: FlowMemoInput; split?: FlowGroupSplitStrategy }): this;
    remainderTo(to: string, memo?: FlowMemoInput): this;
    remainderToGroup(recipients: FlowGroupRecipient[], options?: { memo?: FlowMemoInput; split?: FlowGroupSplitStrategy }): this;
    refund(memo?: FlowMemoInput): this;
    refundPortion(allocation: FlowAllocationInput, memo?: FlowMemoInput): this;
    remainderToSender(memo?: FlowMemoInput): this;
    plan(transfer: string | TransferEvent | { amount?: string; from?: string; to?: string; memo?: string }): PlannedIncomingTransferRoutes;
    start(): FlowSubscriptionHandle;
}

export interface TransferOperationBuilder {
    from(account: string): this;
    to(account: string): this;
    amount(amount: string | number, symbol?: string): this;
    hive(amount: string | number): this;
    hbd(amount: string | number): this;
    memo(memo: string): this;
    send(): any;
}

export interface BurnOperationBuilder {
    from(account: string): this;
    amount(amount: string | number, symbol?: string): this;
    hive(amount: string | number): this;
    hbd(amount: string | number): this;
    memo(memo: string): this;
    send(): any;
}

export interface EscrowTransferBuilder {
    from(account: string): this;
    to(account: string): this;
    agent(account: string): this;
    id(escrowId: number): this;
    hive(amount: string | number): this;
    hbd(amount: string | number): this;
    fee(amount: string | number, symbol?: string): this;
    ratificationDeadline(value: string | Date): this;
    expiration(value: string | Date): this;
    jsonMeta(meta: string | Record<string, any>): this;
    send(signingKeys?: string | string[]): any;
}

export interface RecurrentTransferBuilder {
    from(account: string): this;
    to(account: string): this;
    amount(amount: string | number, symbol?: string): this;
    hive(amount: string | number): this;
    hbd(amount: string | number): this;
    memo(memo: string): this;
    recurrence(value: number): this;
    executions(value: number): this;
    send(signingKeys?: string | string[]): any;
}

export interface ProposalBuilder {
    creator(account: string): this;
    receiver(account: string): this;
    startDate(value: string | Date): this;
    endDate(value: string | Date): this;
    dailyPay(amount: string | number, symbol?: string): this;
    dailyHive(amount: string | number): this;
    dailyHbd(amount: string | number): this;
    subject(value: string): this;
    permlink(value: string): this;
    send(signingKeys?: string | string[]): any;
}

export interface HiveEngineTransferBuilder {
    from(account: string): this;
    to(account: string): this;
    symbol(symbol: string): this;
    quantity(quantity: string | number): this;
    memo(memo: string): this;
    send(): any;
}

export interface HiveEngineBurnBuilder {
    from(account: string): this;
    symbol(symbol: string): this;
    quantity(quantity: string | number): this;
    memo(memo: string): this;
    send(): any;
}

export interface HiveEngineIssueBuilder {
    from(account: string): this;
    to(account: string): this;
    symbol(symbol: string): this;
    quantity(quantity: string | number): this;
    memo(memo: string): this;
    send(): any;
}

export interface ProposalVotesBuilder {
    voter(account: string): this;
    ids(...proposalIds: number[]): this;
    approve(value?: boolean): this;
    reject(): this;
    send(signingKeys?: string | string[]): any;
}

export interface RemoveProposalsBuilder {
    owner(account: string): this;
    ids(...proposalIds: number[]): this;
    send(signingKeys?: string | string[]): any;
}

export interface VoteBuilder {
    author(account: string): this;
    permlink(value: string): this;
    weight(value: string | number): this;
    send(): any;
}

export interface FollowBuilder {
    follower(account: string): this;
    following(account: string): this;
    send(): any;
}

export interface ReblogBuilder {
    account(account: string): this;
    author(account: string): this;
    permlink(value: string): this;
    send(): any;
}

export interface PowerUpBuilder {
    from(account: string): this;
    to(account: string): this;
    amount(amount: string | number): this;
    send(): any;
}

export interface PowerDownBuilder {
    account(account: string): this;
    vestingShares(amount: string): this;
    send(): any;
}

export interface DelegateBuilder {
    delegator(account: string): this;
    delegatee(account: string): this;
    vestingShares(amount: string): this;
    send(): any;
}

export interface ClaimRewardsBuilder {
    account(account: string): this;
    rewardHive(amount: string): this;
    rewardHbd(amount: string): this;
    rewardVests(amount: string): this;
    send(): any;
}

export interface WitnessVoteBuilder {
    account(account: string): this;
    witness(account: string): this;
    approve(value?: boolean): this;
    unapprove(): this;
    send(): any;
}

export interface SetProxyBuilder {
    account(account: string): this;
    proxy(account: string): this;
    send(): any;
}

export interface UpdateProfileBuilder {
    account(account: string): this;
    name(value: string): this;
    about(value: string): this;
    location(value: string): this;
    website(value: string): this;
    profileImage(url: string): this;
    coverImage(url: string): this;
    set(key: string, value: any): this;
    send(): any;
}

export interface SavingsTransferBuilder {
    from(account: string): this;
    to(account: string): this;
    amount(amount: string | number, symbol?: string): this;
    hive(amount: string | number): this;
    hbd(amount: string | number): this;
    memo(memo: string): this;
    requestId(id: number): this;
    send(): any;
}

export interface ConvertBuilder {
    from(account: string): this;
    amount(amount: string | number, symbol?: string): this;
    hbd(amount: string | number): this;
    requestId(id: number): this;
    send(): any;
}

export interface CollateralizedConvertBuilder {
    from(account: string): this;
    amount(amount: string | number, symbol?: string): this;
    hive(amount: string | number): this;
    requestId(id: number): this;
    send(): any;
}

export interface DeleteCommentBuilder {
    author(account: string): this;
    permlink(value: string): this;
    send(): any;
}

export interface LimitOrderBuilder {
    owner(account: string): this;
    orderId(id: number): this;
    amountToSell(amount: string | number, symbol?: string): this;
    minToReceive(amount: string | number, symbol?: string): this;
    fillOrKill(value?: boolean): this;
    expiration(value: string | Date): this;
    send(signingKeys?: string | string[]): any;
}

export interface CancelOrderBuilder {
    owner(account: string): this;
    orderId(id: number): this;
    send(signingKeys?: string | string[]): any;
}

export interface WithdrawRouteBuilder {
    from(account: string): this;
    to(account: string): this;
    percent(value: number): this;
    autoVest(value?: boolean): this;
    send(signingKeys?: string | string[]): any;
}

export interface CommentOptionsBuilder {
    author(account: string): this;
    permlink(value: string): this;
    maxAcceptedPayout(amount: string | number, symbol?: string): this;
    percentHbd(value: number): this;
    allowVotes(value?: boolean): this;
    allowCurationRewards(value?: boolean): this;
    beneficiary(account: string, weight: number): this;
    send(): any;
}

export interface QueryNamespace {
    getDynamicGlobalProperties(): Promise<any>;
    getChainProperties(): Promise<any>;
    getCurrentMedianHistoryPrice(): Promise<any>;
    getRewardFund(name?: string): Promise<any>;
    getFollowers(account: string, start?: string, type?: string, limit?: number): Promise<any[]>;
    getFollowing(account: string, start?: string, type?: string, limit?: number): Promise<any[]>;
    getFollowCount(account: string): Promise<any>;
    getContent(author: string, permlink: string): Promise<any>;
    getContentReplies(author: string, permlink: string): Promise<any[]>;
    getDiscussions(by: string, query: Record<string, any>): Promise<any[]>;
    getBlog(account: string, options?: Record<string, any>): Promise<any[]>;
    getFeed(account: string, options?: Record<string, any>): Promise<any[]>;
    getTrending(options?: Record<string, any>): Promise<any[]>;
    getHot(options?: Record<string, any>): Promise<any[]>;
    getCreated(options?: Record<string, any>): Promise<any[]>;
    getActiveVotes(author: string, permlink: string): Promise<any[]>;
    getVestingDelegations(account: string, from?: string, limit?: number): Promise<any[]>;
    getAccountHistory(account: string, from?: number, limit?: number): Promise<any[]>;
    getOrderBook(limit?: number): Promise<any>;
    getOpenOrders(account: string): Promise<any[]>;
    getRCMana(account: string): Promise<any>;
    getVPMana(account: string): Promise<any>;
    findRCAccounts(accounts: string[]): Promise<any[]>;
    getCommunity(name: string): Promise<any>;
    listCommunities(options?: Record<string, any>): Promise<any[]>;
    getAccountNotifications(account: string, options?: Record<string, any>): Promise<any[]>;
    listAllSubscriptions(account: string): Promise<any[]>;
    findTransaction(transactionId: string): Promise<any>;
    getWitnessByAccount(account: string): Promise<any>;
    getWitnesses(ids: number[]): Promise<any[]>;
    getWitnessesByVote(from: string, limit: number): Promise<any[]>;
    getBlock(blockNumber: number): Promise<any>;
    getBlockHeader(blockNumber: number): Promise<any>;
    getOperations(blockNumber: number, onlyVirtual?: boolean): Promise<any[]>;
    getConfig(): Promise<any>;
    lookupAccounts(lowerBound: string, limit: number): Promise<string[]>;
    lookupWitnessAccounts(lowerBound: string, limit: number): Promise<string[]>;
    getConversionRequests(account: string): Promise<any[]>;
    getCollateralizedConversionRequests(account: string): Promise<any[]>;
    getSavingsWithdrawFrom(account: string): Promise<any[]>;
    getProposals(options?: Record<string, any>): Promise<any[]>;
}

export interface MoneyNamespace {
    parseAssetAmount(rawAmount: string): ParsedAssetAmount;
    formatAmount(amount: string | number, precision?: number): string;
    formatAssetAmount(amount: string | number, symbol: string, precision?: number): string;
    calculatePercentageAmount(amount: string | number, percentage: string | number, precision?: number): string;
    calculateBasisPointsAmount(amount: string | number, basisPoints: number, precision?: number): string;
    splitAmountByBasisPoints(amount: string | number, basisPoints: number[], precision?: number): string[];
    splitAmountByPercentage(amount: string | number, percentages: Array<string | number>, precision?: number): string[];
    splitAmountByWeights(amount: string | number, weights: Array<string | number>, precision?: number): string[];
}

export interface OpsNamespace {
    transfer(): TransferOperationBuilder;
    burn(): BurnOperationBuilder;
    escrowTransfer(): EscrowTransferBuilder;
    recurrentTransfer(): RecurrentTransferBuilder;
    createProposal(): ProposalBuilder;
    transferEngine(): HiveEngineTransferBuilder;
    burnEngine(): HiveEngineBurnBuilder;
    issueEngine(): HiveEngineIssueBuilder;
    voteProposals(): ProposalVotesBuilder;
    removeProposals(): RemoveProposalsBuilder;
    upvote(): VoteBuilder;
    downvote(): VoteBuilder;
    follow(): FollowBuilder;
    unfollow(): FollowBuilder;
    mute(): FollowBuilder;
    reblog(): ReblogBuilder;
    powerUp(): PowerUpBuilder;
    powerDown(): PowerDownBuilder;
    cancelPowerDown(): PowerDownBuilder;
    delegate(): DelegateBuilder;
    undelegate(): DelegateBuilder;
    claimRewards(): ClaimRewardsBuilder;
    witnessVote(): WitnessVoteBuilder;
    setProxy(): SetProxyBuilder;
    clearProxy(): SetProxyBuilder;
    updateProfile(): UpdateProfileBuilder;
    transferToSavings(): SavingsTransferBuilder;
    transferFromSavings(): SavingsTransferBuilder;
    convert(): ConvertBuilder;
    collateralizedConvert(): CollateralizedConvertBuilder;
    deleteComment(): DeleteCommentBuilder;
    limitOrder(): LimitOrderBuilder;
    cancelOrder(): CancelOrderBuilder;
    withdrawRoute(): WithdrawRouteBuilder;
    commentOptions(): CommentOptionsBuilder;
}

export interface FlowNamespace {
    incomingTransfers(account?: string): IncomingTransferFlowBuilder;
    autoBurnIncomingTransfers(options?: AutoBurnIncomingTransfersOptions): FlowSubscriptionHandle;
    autoForwardIncomingTransfers(options: AutoForwardIncomingTransfersOptions): FlowSubscriptionHandle;
    autoRefundIncomingTransfers(options?: AutoRefundIncomingTransfersOptions): FlowSubscriptionHandle;
    autoSplitIncomingTransfers(options: AutoSplitIncomingTransfersOptions): FlowSubscriptionHandle;
    autoRouteIncomingTransfers(options: AutoRouteIncomingTransfersOptions): FlowSubscriptionHandle;
    planIncomingTransferRoutes(transfer: string | TransferEvent | { amount?: string; from?: string; to?: string; memo?: string }, options: Pick<AutoRouteIncomingTransfersOptions, 'routes' | 'memo' | 'allowedSymbols'>): PlannedIncomingTransferRoutes;
}
