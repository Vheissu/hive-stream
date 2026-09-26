import type { Streamer } from './streamer';
import type { BlockData } from './providers/block-provider';
import type { ContractContext } from './types/hive-stream';

/**
 * Streamer hooks.
 *
 * Hooks are awaited in registration order. A hook that throws is isolated:
 * the error is logged and reported to `onError` (phase `hook`), and the
 * stream keeps going. The one exception is `beforeContractAction`, which
 * fails closed — a throwing hook vetoes the action, because letting a
 * money-moving action through after a guard crashed is the worse outcome.
 */

export interface LifecycleHookContext {
    streamer: Streamer;
}

export interface BlockHookContext {
    streamer: Streamer;
    block: BlockData;
    blockNumber: number;
    blockId: string;
    previousBlockId: string;
    blockTime: Date;
}

export interface OperationHookContext {
    streamer: Streamer;
    operation: [string, any];
    type: string;
    data: any;
    blockNumber: number;
    blockId: string;
    previousBlockId: string;
    transactionId: string;
    transactionIndex: number;
    operationIndex: number;
    blockTime: Date;
}

export interface ContractActionHookContext {
    streamer: Streamer;
    contract: string;
    action: string;
    payload: any;
    meta?: any;
    context: ContractContext;
}

/**
 * Returning `false` from `beforeContractAction` vetoes the action. Returning
 * `{ payload }` replaces the payload the handler receives. Anything else
 * lets the action run unchanged.
 */
export type BeforeContractActionResult = void | boolean | { payload: any };

export interface AfterContractActionHookContext extends ContractActionHookContext {
    durationMs: number;
}

export interface ContractErrorHookContext extends ContractActionHookContext {
    error: Error;
    /** 1-based attempt number that failed. */
    attempt: number;
    /** True when the error policy will retry the handler. */
    willRetry: boolean;
}

export interface InvalidPayloadHookContext {
    streamer: Streamer;
    contract: string;
    action: string;
    payload: unknown;
    issues: unknown[];
    context: ContractContext;
}

export type ActionRejectionReason =
    | 'contract_not_found'
    | 'action_not_found'
    | 'trigger_not_allowed'
    | 'active_key_required'
    | 'paused'
    | 'sender_not_allowed'
    | 'asset_not_allowed'
    | 'amount_too_low'
    | 'amount_too_high'
    | 'rate_limited'
    | 'vetoed'
    | 'duplicate';

export interface ActionRejectedHookContext {
    streamer: Streamer;
    contract: string;
    action: string;
    reason: ActionRejectionReason;
    message: string;
    context: ContractContext;
}

export interface ForkHookContext {
    streamer: Streamer;
    /** The block whose `previous` did not match the block we processed. */
    blockNumber: number;
    expectedPreviousId: string;
    actualPreviousId: string;
    /** Last block both chains agree on, or null if none was found within MAX_FORK_DEPTH. */
    commonAncestor: number | null;
    /** Blocks we processed that are no longer on the canonical chain. */
    orphanedBlocks: Array<{ blockNumber: number; blockId: string }>;
}

export type ErrorPhase =
    | 'block'
    | 'operation'
    | 'subscription'
    | 'contract'
    | 'action'
    | 'hook'
    | 'checkpoint'
    | 'fork'
    | 'adapter';

export interface ErrorHookContext {
    streamer: Streamer;
    error: Error;
    phase: ErrorPhase;
    /** True when the error halted the streamer. */
    fatal: boolean;
    blockNumber?: number;
    transactionId?: string;
    operationIndex?: number;
}

export interface CaughtUpHookContext {
    streamer: Streamer;
    blockNumber: number;
    headBlockNumber: number;
    targetBlockNumber: number;
}

export interface CheckpointHookContext {
    streamer: Streamer;
    blockNumber: number;
    blockId: string;
}

type HookResult = void | Promise<void>;

export interface StreamerHooks {
    onStart?: (ctx: LifecycleHookContext) => HookResult;
    onStop?: (ctx: LifecycleHookContext) => HookResult;
    beforeBlock?: (ctx: BlockHookContext) => HookResult;
    afterBlock?: (ctx: BlockHookContext) => HookResult;
    /** Return `false` to skip the operation entirely (subscribers and contracts). */
    beforeOperation?: (ctx: OperationHookContext) => void | boolean | Promise<void | boolean>;
    afterOperation?: (ctx: OperationHookContext) => HookResult;
    beforeContractAction?: (ctx: ContractActionHookContext) => BeforeContractActionResult | Promise<BeforeContractActionResult>;
    afterContractAction?: (ctx: AfterContractActionHookContext) => HookResult;
    onContractError?: (ctx: ContractErrorHookContext) => HookResult;
    onInvalidPayload?: (ctx: InvalidPayloadHookContext) => HookResult;
    onActionRejected?: (ctx: ActionRejectedHookContext) => HookResult;
    onFork?: (ctx: ForkHookContext) => HookResult;
    onError?: (ctx: ErrorHookContext) => HookResult;
    onCaughtUp?: (ctx: CaughtUpHookContext) => HookResult;
    onCheckpoint?: (ctx: CheckpointHookContext) => HookResult;
}

export type StreamerHookName = keyof StreamerHooks;

export type StreamerHookHandler<K extends StreamerHookName> = NonNullable<StreamerHooks[K]>;

/**
 * A plugin is either a hooks object or a function that receives the
 * streamer and optionally returns hooks.
 */
export type StreamerPlugin = StreamerHooks | ((streamer: Streamer) => StreamerHooks | void);

export const STREAMER_HOOK_NAMES: readonly StreamerHookName[] = [
    'onStart',
    'onStop',
    'beforeBlock',
    'afterBlock',
    'beforeOperation',
    'afterOperation',
    'beforeContractAction',
    'afterContractAction',
    'onContractError',
    'onInvalidPayload',
    'onActionRejected',
    'onFork',
    'onError',
    'onCaughtUp',
    'onCheckpoint',
];

const HOOK_NAME_SET = new Set<string>(STREAMER_HOOK_NAMES);

export function isStreamerHookName(name: string): name is StreamerHookName {
    return HOOK_NAME_SET.has(name);
}

/**
 * Typed identity helper for authoring hooks/plugins in their own module.
 */
export function defineHooks(hooks: StreamerHooks): StreamerHooks {
    validateHooks(hooks);
    return hooks;
}

export function validateHooks(hooks: StreamerHooks): void {
    if (!hooks || typeof hooks !== 'object' || Array.isArray(hooks)) {
        throw new Error('Hooks must be an object');
    }

    for (const [name, handler] of Object.entries(hooks)) {
        if (!isStreamerHookName(name)) {
            throw new Error(`Unknown streamer hook '${name}'. Valid hooks: ${STREAMER_HOOK_NAMES.join(', ')}`);
        }

        if (handler !== undefined && typeof handler !== 'function') {
            throw new Error(`Streamer hook '${name}' must be a function`);
        }
    }
}

export class HookRegistry {
    private handlers = new Map<StreamerHookName, Array<(...args: any[]) => any>>();

    public add<K extends StreamerHookName>(name: K, handler: StreamerHookHandler<K>): () => void {
        if (!isStreamerHookName(name)) {
            throw new Error(`Unknown streamer hook '${String(name)}'. Valid hooks: ${STREAMER_HOOK_NAMES.join(', ')}`);
        }

        if (typeof handler !== 'function') {
            throw new Error(`Streamer hook '${name}' must be a function`);
        }

        const list = this.handlers.get(name) ?? [];
        list.push(handler);
        this.handlers.set(name, list);

        return () => {
            const current = this.handlers.get(name);

            if (!current) {
                return;
            }

            const index = current.indexOf(handler);

            if (index >= 0) {
                current.splice(index, 1);
            }
        };
    }

    public addAll(hooks: StreamerHooks): () => void {
        validateHooks(hooks);

        const disposers: Array<() => void> = [];

        for (const name of STREAMER_HOOK_NAMES) {
            const handler = hooks[name];

            if (handler) {
                disposers.push(this.add(name, handler as StreamerHookHandler<typeof name>));
            }
        }

        return () => {
            for (const dispose of disposers) {
                dispose();
            }
        };
    }

    public has(name: StreamerHookName): boolean {
        return (this.handlers.get(name)?.length ?? 0) > 0;
    }

    public get<K extends StreamerHookName>(name: K): Array<StreamerHookHandler<K>> {
        return [...(this.handlers.get(name) ?? [])] as Array<StreamerHookHandler<K>>;
    }

    public clear(): void {
        this.handlers.clear();
    }
}
