import { Utils } from './utils';
import type { Streamer } from './streamer';
import type {
    AutoRouteIncomingTransfersOptions,
    BurnOperationBuilder,
    ClaimRewardsBuilder,
    DelegateBuilder,
    EscrowTransferBuilder,
    FlowAllocationInput,
    FlowDedupeStore,
    FlowGroupRecipient,
    FlowGroupSplitStrategy,
    FlowMemoInput,
    FlowRoute,
    FlowSubscriptionHandle,
    FollowBuilder,
    HiveEngineBurnBuilder,
    HiveEngineIssueBuilder,
    HiveEngineTransferBuilder,
    IncomingTransferFlowBuilder,
    PlannedIncomingTransferRoutes,
    PowerDownBuilder,
    PowerUpBuilder,
    ProposalBuilder,
    ProposalVotesBuilder,
    ReblogBuilder,
    RemoveProposalsBuilder,
    RecurrentTransferBuilder,
    SetProxyBuilder,
    TransferEvent,
    TransferOperationBuilder,
    UpdateProfileBuilder,
    VoteBuilder,
    WitnessVoteBuilder
} from './types/hive-stream';

interface BuilderAllocation {
    percentage?: string | number;
    percent?: string | number;
    basisPoints?: number;
}

interface IncomingTransferFlowStep extends BuilderAllocation {
    type: 'burn' | 'transfer' | 'refund';
    mode?: 'base' | 'onTop';
    to?: string;
    group?: FlowGroupRecipient[];
    split?: FlowGroupSplitStrategy;
    memo?: FlowMemoInput;
}

function normalizeAllocationInput(input: FlowAllocationInput, context: string): BuilderAllocation {
    if (typeof input === 'number') {
        return { percentage: input };
    }

    if (typeof input === 'string') {
        const value = input.trim();
        if (!/^-?\d+(\.\d+)?$/.test(value)) {
            throw new Error(`${context} allocation string must be numeric`);
        }

        return { percentage: value };
    }

    if (!input || typeof input !== 'object') {
        throw new Error(`${context} allocation is required`);
    }

    const percentage = input.percentage ?? input.percent;
    const basisPoints = input.basisPoints;

    if (percentage !== undefined && basisPoints !== undefined) {
        throw new Error(`${context} accepts either percentage or basisPoints, not both`);
    }

    if (percentage === undefined && basisPoints === undefined) {
        throw new Error(`${context} allocation is required`);
    }

    return {
        percentage: input.percentage,
        percent: input.percent,
        basisPoints: input.basisPoints
    };
}

function resolveRouteMemo(stepMemo: FlowMemoInput | undefined, defaultMemo: FlowMemoInput | undefined): FlowMemoInput | undefined {
    return stepMemo !== undefined ? stepMemo : defaultMemo;
}

function normalizeGroupRecipients(recipients: FlowGroupRecipient[], context: string): FlowGroupRecipient[] {
    if (!Array.isArray(recipients) || recipients.length === 0) {
        throw new Error(`${context} requires at least one group recipient`);
    }

    return recipients.map((recipient, index) => {
        if (!recipient || typeof recipient !== 'object') {
            throw new Error(`${context} recipient ${index + 1} is invalid`);
        }

        if (typeof recipient.account === 'string') {
            const account = recipient.account.trim();
            if (!account) {
                throw new Error(`${context} recipient ${index + 1} account is required`);
            }

            return {
                account,
                weight: recipient.weight
            };
        }

        if (typeof recipient.account !== 'function') {
            throw new Error(`${context} recipient ${index + 1} account is required`);
        }

        return recipient;
    });
}

function parseAssetInput(amount: string | number, symbol?: string): { amount: string; symbol: string } {
    if (symbol) {
        return {
            amount: Utils.formatAmount(amount),
            symbol: symbol.trim()
        };
    }

    if (typeof amount === 'string' && amount.includes(' ')) {
        const parsed = Utils.parseAssetAmount(amount);

        return {
            amount: Utils.formatAmount(parsed.amount),
            symbol: parsed.asset
        };
    }

    throw new Error('Provide a symbol or an asset amount string like "1.000 HIVE"');
}

function buildAssetAmount(amount: string | number, symbol?: string): string {
    const parsed = parseAssetInput(amount, symbol);
    return Utils.formatAssetAmount(parsed.amount, parsed.symbol);
}

function normalizeEngineQuantity(quantity: string | number): string {
    const normalized = String(quantity).trim();
    if (!normalized) {
        throw new Error('Quantity is required');
    }

    return normalized;
}

export class IncomingTransfersBuilder implements IncomingTransferFlowBuilder {
    private account?: string;
    private allowedSymbols?: string[];
    private dedupeStore?: FlowDedupeStore;
    private ignoreZeroAmountValue?: boolean;
    private errorHandler?: (error: unknown, event: TransferEvent) => void | Promise<void>;
    private defaultMemo?: FlowMemoInput;
    private steps: IncomingTransferFlowStep[] = [];

    constructor(private readonly streamer: Streamer, account?: string) {
        this.account = account;
    }

    public forAccount(account: string): this {
        this.account = account;
        return this;
    }

    public allowSymbols(...symbols: string[]): this {
        this.allowedSymbols = symbols.map((symbol) => symbol.trim()).filter(Boolean);
        return this;
    }

    public memo(memo: FlowMemoInput): this {
        this.defaultMemo = memo;
        return this;
    }

    public dedupeWith(store: FlowDedupeStore): this {
        this.dedupeStore = store;
        return this;
    }

    public ignoreZeroAmount(ignore: boolean = true): this {
        this.ignoreZeroAmountValue = ignore;
        return this;
    }

    public onError(handler: (error: unknown, event: TransferEvent) => void | Promise<void>): this {
        this.errorHandler = handler;
        return this;
    }

    public burn(allocation: FlowAllocationInput, memo?: FlowMemoInput): this {
        this.steps.push({
            type: 'burn',
            ...normalizeAllocationInput(allocation, 'burn()'),
            memo
        });
        return this;
    }

    public burnOnTop(allocation: FlowAllocationInput, memo?: FlowMemoInput): this {
        this.steps.push({
            type: 'burn',
            mode: 'onTop',
            ...normalizeAllocationInput(allocation, 'burnOnTop()'),
            memo
        });
        return this;
    }

    public forwardTo(to: string, allocation?: FlowAllocationInput, memo?: FlowMemoInput): this {
        if (typeof to !== 'string' || to.trim().length === 0) {
            throw new Error('forwardTo() requires a destination account');
        }

        this.steps.push({
            type: 'transfer',
            to: to.trim(),
            ...(allocation === undefined ? {} : normalizeAllocationInput(allocation, 'forwardTo()')),
            memo
        });
        return this;
    }

    public forwardOnTop(to: string, allocation: FlowAllocationInput, memo?: FlowMemoInput): this {
        if (typeof to !== 'string' || to.trim().length === 0) {
            throw new Error('forwardOnTop() requires a destination account');
        }

        this.steps.push({
            type: 'transfer',
            mode: 'onTop',
            to: to.trim(),
            ...normalizeAllocationInput(allocation, 'forwardOnTop()'),
            memo
        });
        return this;
    }

    public donateOnTop(to: string, allocation: FlowAllocationInput, memo?: FlowMemoInput): this {
        return this.forwardOnTop(to, allocation, memo);
    }

    public forwardGroup(
        recipients: FlowGroupRecipient[],
        allocation: FlowAllocationInput,
        options: { memo?: FlowMemoInput; split?: FlowGroupSplitStrategy } = {}
    ): this {
        this.steps.push({
            type: 'transfer',
            group: normalizeGroupRecipients(recipients, 'forwardGroup()'),
            split: options.split,
            ...normalizeAllocationInput(allocation, 'forwardGroup()'),
            memo: options.memo
        });
        return this;
    }

    public forwardGroupOnTop(
        recipients: FlowGroupRecipient[],
        allocation: FlowAllocationInput,
        options: { memo?: FlowMemoInput; split?: FlowGroupSplitStrategy } = {}
    ): this {
        this.steps.push({
            type: 'transfer',
            mode: 'onTop',
            group: normalizeGroupRecipients(recipients, 'forwardGroupOnTop()'),
            split: options.split,
            ...normalizeAllocationInput(allocation, 'forwardGroupOnTop()'),
            memo: options.memo
        });
        return this;
    }

    public remainderTo(to: string, memo?: FlowMemoInput): this {
        return this.forwardTo(to, undefined, memo);
    }

    public remainderToGroup(
        recipients: FlowGroupRecipient[],
        options: { memo?: FlowMemoInput; split?: FlowGroupSplitStrategy } = {}
    ): this {
        this.steps.push({
            type: 'transfer',
            group: normalizeGroupRecipients(recipients, 'remainderToGroup()'),
            split: options.split,
            memo: options.memo
        });
        return this;
    }

    public refund(memo?: FlowMemoInput): this {
        this.steps.push({
            type: 'refund',
            memo
        });
        return this;
    }

    public refundPortion(allocation: FlowAllocationInput, memo?: FlowMemoInput): this {
        this.steps.push({
            type: 'refund',
            ...normalizeAllocationInput(allocation, 'refundPortion()'),
            memo
        });
        return this;
    }

    public remainderToSender(memo?: FlowMemoInput): this {
        return this.refund(memo);
    }

    public plan(transfer: string | TransferEvent | { amount?: string; from?: string; to?: string; memo?: string }): PlannedIncomingTransferRoutes {
        const commonOptions = {
            routes: this.buildRoutes(),
            allowedSymbols: this.allowedSymbols
        };

        return this.streamer.planIncomingTransferRoutes(transfer, commonOptions);
    }

    public start(): FlowSubscriptionHandle {
        if (this.steps.length === 0) {
            throw new Error('Add at least one builder step before calling start()');
        }

        const commonOptions = {
            account: this.account,
            allowedSymbols: this.allowedSymbols,
            dedupeStore: this.dedupeStore,
            ignoreZeroAmount: this.ignoreZeroAmountValue,
            onError: this.errorHandler
        };

        if (this.steps.length === 1 && !this.steps[0].group && this.steps[0].mode !== 'onTop') {
            const step = this.steps[0];
            const memo = resolveRouteMemo(step.memo, this.defaultMemo);

            if (step.type === 'burn') {
                return this.streamer.autoBurnIncomingTransfers({
                    ...commonOptions,
                    percentage: step.percentage,
                    percent: step.percent,
                    basisPoints: step.basisPoints,
                    memo
                });
            }

            if (step.type === 'refund') {
                return this.streamer.autoRefundIncomingTransfers({
                    ...commonOptions,
                    percentage: step.percentage,
                    percent: step.percent,
                    basisPoints: step.basisPoints,
                    memo
                });
            }

            return this.streamer.autoForwardIncomingTransfers({
                ...commonOptions,
                to: step.to,
                percentage: step.percentage,
                percent: step.percent,
                basisPoints: step.basisPoints,
                memo
            });
        }

        const options: AutoRouteIncomingTransfersOptions = {
            ...commonOptions,
            routes: this.buildRoutes()
        };

        return this.streamer.autoRouteIncomingTransfers(options);
    }

    private buildRoutes(): FlowRoute[] {
        if (this.steps.length === 0) {
            throw new Error('Add at least one builder step before planning or starting a flow');
        }

        return this.steps.map((step) => {
            const memo = resolveRouteMemo(step.memo, this.defaultMemo);

            if (step.type === 'burn') {
                return {
                    type: 'burn',
                    mode: step.mode,
                    percentage: step.percentage,
                    percent: step.percent,
                    basisPoints: step.basisPoints,
                    memo
                };
            }

            if (step.type === 'refund') {
                return {
                    mode: step.mode,
                    to: (event: TransferEvent) => event.transfer.from,
                    percentage: step.percentage,
                    percent: step.percent,
                    basisPoints: step.basisPoints,
                    memo
                };
            }

            if (step.group) {
                return {
                    mode: step.mode,
                    group: step.group,
                    split: step.split,
                    percentage: step.percentage,
                    percent: step.percent,
                    basisPoints: step.basisPoints,
                    memo
                };
            }

            return {
                mode: step.mode,
                to: step.to,
                percentage: step.percentage,
                percent: step.percent,
                basisPoints: step.basisPoints,
                memo
            };
        });
    }
}

export class HiveTransferBuilder implements TransferOperationBuilder {
    private state: {
        from?: string;
        to?: string;
        amount?: string;
        symbol?: string;
        memo?: string;
    } = {};

    constructor(private readonly streamer: Streamer) {}

    public from(account: string): this {
        this.state.from = account;
        return this;
    }

    public to(account: string): this {
        this.state.to = account;
        return this;
    }

    public amount(amount: string | number, symbol?: string): this {
        const parsed = parseAssetInput(amount, symbol);
        this.state.amount = parsed.amount;
        this.state.symbol = parsed.symbol;
        return this;
    }

    public hive(amount: string | number): this {
        return this.amount(amount, 'HIVE');
    }

    public hbd(amount: string | number): this {
        return this.amount(amount, 'HBD');
    }

    public memo(memo: string): this {
        this.state.memo = memo;
        return this;
    }

    public send(): any {
        if (!this.state.from || !this.state.to || !this.state.amount || !this.state.symbol) {
            throw new Error('transfer() builder requires from, to, and amount before send()');
        }

        return this.streamer.transferHiveTokens(
            this.state.from,
            this.state.to,
            this.state.amount,
            this.state.symbol,
            this.state.memo || ''
        );
    }
}

export class HiveBurnBuilder implements BurnOperationBuilder {
    private state: {
        from?: string;
        amount?: string;
        symbol?: string;
        memo?: string;
    } = {};

    constructor(private readonly streamer: Streamer) {}

    public from(account: string): this {
        this.state.from = account;
        return this;
    }

    public amount(amount: string | number, symbol?: string): this {
        const parsed = parseAssetInput(amount, symbol);
        this.state.amount = parsed.amount;
        this.state.symbol = parsed.symbol;
        return this;
    }

    public hive(amount: string | number): this {
        return this.amount(amount, 'HIVE');
    }

    public hbd(amount: string | number): this {
        return this.amount(amount, 'HBD');
    }

    public memo(memo: string): this {
        this.state.memo = memo;
        return this;
    }

    public send(): any {
        if (!this.state.from || !this.state.amount || !this.state.symbol) {
            throw new Error('burn() builder requires from and amount before send()');
        }

        return this.streamer.burnHiveTokens(
            this.state.from,
            this.state.amount,
            this.state.symbol,
            this.state.memo || ''
        );
    }
}

export class HiveEscrowTransferBuilder implements EscrowTransferBuilder {
    private state: {
        from?: string;
        to?: string;
        agent?: string;
        escrow_id?: number;
        hive_amount?: string;
        hbd_amount?: string;
        fee?: string;
        ratification_deadline?: string | Date;
        escrow_expiration?: string | Date;
        json_meta?: string | Record<string, any>;
    } = {};

    constructor(private readonly streamer: Streamer) {}

    public from(account: string): this {
        this.state.from = account;
        return this;
    }

    public to(account: string): this {
        this.state.to = account;
        return this;
    }

    public agent(account: string): this {
        this.state.agent = account;
        return this;
    }

    public id(escrowId: number): this {
        this.state.escrow_id = escrowId;
        return this;
    }

    public hive(amount: string | number): this {
        this.state.hive_amount = buildAssetAmount(amount, 'HIVE');
        return this;
    }

    public hbd(amount: string | number): this {
        this.state.hbd_amount = buildAssetAmount(amount, 'HBD');
        return this;
    }

    public fee(amount: string | number, symbol?: string): this {
        this.state.fee = buildAssetAmount(amount, symbol);
        return this;
    }

    public ratificationDeadline(value: string | Date): this {
        this.state.ratification_deadline = value;
        return this;
    }

    public expiration(value: string | Date): this {
        this.state.escrow_expiration = value;
        return this;
    }

    public jsonMeta(meta: string | Record<string, any>): this {
        this.state.json_meta = meta;
        return this;
    }

    public send(signingKeys?: string | string[]): any {
        return this.streamer.escrowTransfer({
            from: this.state.from,
            to: this.state.to,
            agent: this.state.agent,
            escrow_id: this.state.escrow_id,
            hive_amount: this.state.hive_amount,
            hbd_amount: this.state.hbd_amount,
            fee: this.state.fee,
            ratification_deadline: this.state.ratification_deadline,
            escrow_expiration: this.state.escrow_expiration,
            json_meta: this.state.json_meta
        }, signingKeys);
    }
}

export class HiveRecurrentTransferBuilder implements RecurrentTransferBuilder {
    private state: {
        from?: string;
        to?: string;
        amount?: string;
        memo?: string;
        recurrence?: number;
        executions?: number;
    } = {};

    constructor(private readonly streamer: Streamer) {}

    public from(account: string): this {
        this.state.from = account;
        return this;
    }

    public to(account: string): this {
        this.state.to = account;
        return this;
    }

    public amount(amount: string | number, symbol?: string): this {
        this.state.amount = buildAssetAmount(amount, symbol);
        return this;
    }

    public hive(amount: string | number): this {
        return this.amount(amount, 'HIVE');
    }

    public hbd(amount: string | number): this {
        return this.amount(amount, 'HBD');
    }

    public memo(memo: string): this {
        this.state.memo = memo;
        return this;
    }

    public recurrence(value: number): this {
        this.state.recurrence = value;
        return this;
    }

    public executions(value: number): this {
        this.state.executions = value;
        return this;
    }

    public send(signingKeys?: string | string[]): any {
        return this.streamer.recurrentTransfer({
            from: this.state.from,
            to: this.state.to,
            amount: this.state.amount,
            memo: this.state.memo,
            recurrence: this.state.recurrence,
            executions: this.state.executions
        }, signingKeys);
    }
}

export class HiveProposalBuilder implements ProposalBuilder {
    private state: {
        creator?: string;
        receiver?: string;
        start_date?: string | Date;
        end_date?: string | Date;
        daily_pay?: string;
        subject?: string;
        permlink?: string;
    } = {};

    constructor(private readonly streamer: Streamer) {}

    public creator(account: string): this {
        this.state.creator = account;
        return this;
    }

    public receiver(account: string): this {
        this.state.receiver = account;
        return this;
    }

    public startDate(value: string | Date): this {
        this.state.start_date = value;
        return this;
    }

    public endDate(value: string | Date): this {
        this.state.end_date = value;
        return this;
    }

    public dailyPay(amount: string | number, symbol?: string): this {
        this.state.daily_pay = buildAssetAmount(amount, symbol);
        return this;
    }

    public dailyHive(amount: string | number): this {
        return this.dailyPay(amount, 'HIVE');
    }

    public dailyHbd(amount: string | number): this {
        return this.dailyPay(amount, 'HBD');
    }

    public subject(value: string): this {
        this.state.subject = value;
        return this;
    }

    public permlink(value: string): this {
        this.state.permlink = value;
        return this;
    }

    public send(signingKeys?: string | string[]): any {
        return this.streamer.createProposal({
            creator: this.state.creator,
            receiver: this.state.receiver,
            start_date: this.state.start_date,
            end_date: this.state.end_date,
            daily_pay: this.state.daily_pay,
            subject: this.state.subject,
            permlink: this.state.permlink
        }, signingKeys);
    }
}

export class HiveEngineTokenTransferBuilder implements HiveEngineTransferBuilder {
    private state: {
        from?: string;
        to?: string;
        symbol?: string;
        quantity?: string;
        memo?: string;
    } = {};

    constructor(private readonly streamer: Streamer) {}

    public from(account: string): this {
        this.state.from = account;
        return this;
    }

    public to(account: string): this {
        this.state.to = account;
        return this;
    }

    public symbol(symbol: string): this {
        this.state.symbol = symbol.trim();
        return this;
    }

    public quantity(quantity: string | number): this {
        this.state.quantity = normalizeEngineQuantity(quantity);
        return this;
    }

    public memo(memo: string): this {
        this.state.memo = memo;
        return this;
    }

    public send(): any {
        return this.streamer.transferHiveEngineTokens(
            this.state.from,
            this.state.to,
            this.state.symbol,
            this.state.quantity,
            this.state.memo || ''
        );
    }
}

export class HiveEngineTokenBurnBuilder implements HiveEngineBurnBuilder {
    private state: {
        from?: string;
        symbol?: string;
        quantity?: string;
        memo?: string;
    } = {};

    constructor(private readonly streamer: Streamer) {}

    public from(account: string): this {
        this.state.from = account;
        return this;
    }

    public symbol(symbol: string): this {
        this.state.symbol = symbol.trim();
        return this;
    }

    public quantity(quantity: string | number): this {
        this.state.quantity = normalizeEngineQuantity(quantity);
        return this;
    }

    public memo(memo: string): this {
        this.state.memo = memo;
        return this;
    }

    public send(): any {
        return this.streamer.burnHiveEngineTokens(
            this.state.from,
            this.state.symbol,
            this.state.quantity,
            this.state.memo || ''
        );
    }
}

export class HiveEngineTokenIssueBuilder implements HiveEngineIssueBuilder {
    private state: {
        from?: string;
        to?: string;
        symbol?: string;
        quantity?: string;
        memo?: string;
    } = {};

    constructor(private readonly streamer: Streamer) {}

    public from(account: string): this {
        this.state.from = account;
        return this;
    }

    public to(account: string): this {
        this.state.to = account;
        return this;
    }

    public symbol(symbol: string): this {
        this.state.symbol = symbol.trim();
        return this;
    }

    public quantity(quantity: string | number): this {
        this.state.quantity = normalizeEngineQuantity(quantity);
        return this;
    }

    public memo(memo: string): this {
        this.state.memo = memo;
        return this;
    }

    public send(): any {
        return this.streamer.issueHiveEngineTokens(
            this.state.from,
            this.state.to,
            this.state.symbol,
            this.state.quantity,
            this.state.memo || ''
        );
    }
}

export class HiveProposalVotesBuilder implements ProposalVotesBuilder {
    private state: {
        voter?: string;
        proposal_ids?: number[];
        approve?: boolean;
    } = {};

    constructor(private readonly streamer: Streamer) {}

    public voter(account: string): this {
        this.state.voter = account;
        return this;
    }

    public ids(...proposalIds: number[]): this {
        this.state.proposal_ids = proposalIds;
        return this;
    }

    public approve(value: boolean = true): this {
        this.state.approve = value;
        return this;
    }

    public reject(): this {
        return this.approve(false);
    }

    public send(signingKeys?: string | string[]): any {
        return this.streamer.updateProposalVotes({
            voter: this.state.voter,
            proposal_ids: this.state.proposal_ids,
            approve: this.state.approve
        }, signingKeys);
    }
}

export class HiveRemoveProposalsBuilder implements RemoveProposalsBuilder {
    private state: {
        proposal_owner?: string;
        proposal_ids?: number[];
    } = {};

    constructor(private readonly streamer: Streamer) {}

    public owner(account: string): this {
        this.state.proposal_owner = account;
        return this;
    }

    public ids(...proposalIds: number[]): this {
        this.state.proposal_ids = proposalIds;
        return this;
    }

    public send(signingKeys?: string | string[]): any {
        return this.streamer.removeProposals({
            proposal_owner: this.state.proposal_owner,
            proposal_ids: this.state.proposal_ids
        }, signingKeys);
    }
}

export class HiveVoteBuilder implements VoteBuilder {
    private state: {
        username?: string;
        permlink?: string;
        weight?: string;
    } = {};

    constructor(
        private readonly streamer: Streamer,
        private readonly direction: 'upvote' | 'downvote'
    ) {}

    public author(account: string): this {
        this.state.username = account;
        return this;
    }

    public permlink(value: string): this {
        this.state.permlink = value;
        return this;
    }

    public weight(value: string | number): this {
        this.state.weight = String(value);
        return this;
    }

    public send(): any {
        if (this.direction === 'upvote') {
            return this.streamer.upvote(
                this.state.weight || '100.0',
                this.state.username,
                this.state.permlink
            );
        }

        return this.streamer.downvote(
            this.state.weight || '100.0',
            this.state.username,
            this.state.permlink
        );
    }
}

export class HiveFollowBuilder implements FollowBuilder {
    private state: {
        follower?: string;
        following?: string;
    } = {};

    constructor(
        private readonly streamer: Streamer,
        private readonly mode: 'follow' | 'unfollow' | 'mute'
    ) {}

    public follower(account: string): this {
        this.state.follower = account;
        return this;
    }

    public following(account: string): this {
        this.state.following = account;
        return this;
    }

    public send(): any {
        if (!this.state.follower || !this.state.following) {
            throw new Error(`${this.mode}() builder requires follower and following before send()`);
        }

        if (this.mode === 'follow') {
            return this.streamer.follow(this.state.follower, this.state.following);
        }

        if (this.mode === 'mute') {
            return this.streamer.mute(this.state.follower, this.state.following);
        }

        return this.streamer.unfollow(this.state.follower, this.state.following);
    }
}

export class HiveReblogBuilder implements ReblogBuilder {
    private state: {
        account?: string;
        author?: string;
        permlink?: string;
    } = {};

    constructor(private readonly streamer: Streamer) {}

    public account(account: string): this {
        this.state.account = account;
        return this;
    }

    public author(account: string): this {
        this.state.author = account;
        return this;
    }

    public permlink(value: string): this {
        this.state.permlink = value;
        return this;
    }

    public send(): any {
        if (!this.state.account || !this.state.author || !this.state.permlink) {
            throw new Error('reblog() builder requires account, author, and permlink before send()');
        }

        return this.streamer.reblog(this.state.account, this.state.author, this.state.permlink);
    }
}

export class HivePowerUpBuilder implements PowerUpBuilder {
    private state: {
        from?: string;
        to?: string;
        amount?: string;
    } = {};

    constructor(private readonly streamer: Streamer) {}

    public from(account: string): this {
        this.state.from = account;
        return this;
    }

    public to(account: string): this {
        this.state.to = account;
        return this;
    }

    public amount(amount: string | number): this {
        this.state.amount = Utils.formatAmount(amount);
        return this;
    }

    public send(): any {
        if (!this.state.from || !this.state.amount) {
            throw new Error('powerUp() builder requires from and amount before send()');
        }

        return this.streamer.powerUp(
            this.state.from,
            this.state.to || this.state.from,
            this.state.amount
        );
    }
}

export class HivePowerDownBuilder implements PowerDownBuilder {
    private state: {
        account?: string;
        vestingShares?: string;
    } = {};

    constructor(
        private readonly streamer: Streamer,
        private readonly cancel: boolean = false
    ) {}

    public account(account: string): this {
        this.state.account = account;
        return this;
    }

    public vestingShares(amount: string): this {
        this.state.vestingShares = amount;
        return this;
    }

    public send(): any {
        if (!this.state.account) {
            throw new Error('powerDown() builder requires account before send()');
        }

        if (this.cancel) {
            return this.streamer.cancelPowerDown(this.state.account);
        }

        if (!this.state.vestingShares) {
            throw new Error('powerDown() builder requires vestingShares before send()');
        }

        return this.streamer.powerDown(this.state.account, this.state.vestingShares);
    }
}

export class HiveDelegateBuilder implements DelegateBuilder {
    private state: {
        delegator?: string;
        delegatee?: string;
        vestingShares?: string;
    } = {};

    constructor(
        private readonly streamer: Streamer,
        private readonly undelegate: boolean = false
    ) {}

    public delegator(account: string): this {
        this.state.delegator = account;
        return this;
    }

    public delegatee(account: string): this {
        this.state.delegatee = account;
        return this;
    }

    public vestingShares(amount: string): this {
        this.state.vestingShares = amount;
        return this;
    }

    public send(): any {
        if (!this.state.delegator || !this.state.delegatee) {
            throw new Error('delegate() builder requires delegator and delegatee before send()');
        }

        if (this.undelegate) {
            return this.streamer.undelegateVestingShares(this.state.delegator, this.state.delegatee);
        }

        if (!this.state.vestingShares) {
            throw new Error('delegate() builder requires vestingShares before send()');
        }

        return this.streamer.delegateVestingShares(
            this.state.delegator,
            this.state.delegatee,
            this.state.vestingShares
        );
    }
}

export class HiveClaimRewardsBuilder implements ClaimRewardsBuilder {
    private state: {
        account?: string;
        rewardHive?: string;
        rewardHbd?: string;
        rewardVests?: string;
    } = {};

    constructor(private readonly streamer: Streamer) {}

    public account(account: string): this {
        this.state.account = account;
        return this;
    }

    public rewardHive(amount: string): this {
        this.state.rewardHive = amount;
        return this;
    }

    public rewardHbd(amount: string): this {
        this.state.rewardHbd = amount;
        return this;
    }

    public rewardVests(amount: string): this {
        this.state.rewardVests = amount;
        return this;
    }

    public send(): any {
        if (!this.state.account) {
            throw new Error('claimRewards() builder requires account before send()');
        }

        return this.streamer.claimRewards(
            this.state.account,
            this.state.rewardHive || '0.000 HIVE',
            this.state.rewardHbd || '0.000 HBD',
            this.state.rewardVests || '0.000000 VESTS'
        );
    }
}

export class HiveWitnessVoteBuilder implements WitnessVoteBuilder {
    private state: {
        account?: string;
        witness?: string;
        approve?: boolean;
    } = {};

    constructor(private readonly streamer: Streamer) {}

    public account(account: string): this {
        this.state.account = account;
        return this;
    }

    public witness(account: string): this {
        this.state.witness = account;
        return this;
    }

    public approve(value: boolean = true): this {
        this.state.approve = value;
        return this;
    }

    public unapprove(): this {
        return this.approve(false);
    }

    public send(): any {
        if (!this.state.account || !this.state.witness) {
            throw new Error('witnessVote() builder requires account and witness before send()');
        }

        return this.streamer.witnessVote(
            this.state.account,
            this.state.witness,
            this.state.approve !== false
        );
    }
}

export class HiveSetProxyBuilder implements SetProxyBuilder {
    private state: {
        account?: string;
        proxy?: string;
    } = {};

    constructor(
        private readonly streamer: Streamer,
        private readonly clear: boolean = false
    ) {}

    public account(account: string): this {
        this.state.account = account;
        return this;
    }

    public proxy(account: string): this {
        this.state.proxy = account;
        return this;
    }

    public send(): any {
        if (!this.state.account) {
            throw new Error('setProxy() builder requires account before send()');
        }

        if (this.clear) {
            return this.streamer.clearProxy(this.state.account);
        }

        if (!this.state.proxy) {
            throw new Error('setProxy() builder requires proxy before send()');
        }

        return this.streamer.setProxy(this.state.account, this.state.proxy);
    }
}

export class HiveUpdateProfileBuilder implements UpdateProfileBuilder {
    private state: {
        account?: string;
        profile: Record<string, any>;
    } = { profile: {} };

    constructor(private readonly streamer: Streamer) {}

    public account(account: string): this {
        this.state.account = account;
        return this;
    }

    public name(value: string): this {
        this.state.profile.name = value;
        return this;
    }

    public about(value: string): this {
        this.state.profile.about = value;
        return this;
    }

    public location(value: string): this {
        this.state.profile.location = value;
        return this;
    }

    public website(value: string): this {
        this.state.profile.website = value;
        return this;
    }

    public profileImage(url: string): this {
        this.state.profile.profile_image = url;
        return this;
    }

    public coverImage(url: string): this {
        this.state.profile.cover_image = url;
        return this;
    }

    public set(key: string, value: any): this {
        this.state.profile[key] = value;
        return this;
    }

    public send(): any {
        if (!this.state.account) {
            throw new Error('updateProfile() builder requires account before send()');
        }

        if (Object.keys(this.state.profile).length === 0) {
            throw new Error('updateProfile() builder requires at least one profile field before send()');
        }

        return this.streamer.updateProfile(this.state.account, this.state.profile);
    }
}
