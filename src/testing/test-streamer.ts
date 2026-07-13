import { Streamer } from '../streamer';
import { ConfigInput, ConfigInterface } from '../config';
import { AdapterBase } from '../adapters/base.adapter';
import { SqliteAdapter } from '../adapters/sqlite.adapter';
import { BlockData } from '../providers/block-provider';
import { MemoryBlockProvider, AddBlockOptions } from './memory-block-provider';
import { FakeHiveClient, RecordedBroadcast } from './fake-client';

export interface TestStreamerOptions extends Omit<ConfigInput, 'blockProvider' | 'client'> {
    /**
     * Storage adapter to use. Defaults to an in-memory SQLite database, so
     * built-in SQL contracts work with no setup and no files on disk.
     */
    adapter?: AdapterBase;
    /**
     * Timestamp of the simulated chain's first block. Defaults to now.
     */
    startTime?: Date;
    /**
     * Milliseconds between simulated blocks. Defaults to 3000.
     */
    blockIntervalMs?: number;
}

export interface ContractCallOptions {
    contract: string;
    action: string;
    payload?: any;
    meta?: any;
}

export interface ContractTransferOptions extends ContractCallOptions {
    from: string;
    /** Defaults to the streamer's configured username. */
    to?: string;
    /** Defaults to '1.000 HIVE'. */
    amount?: string;
}

export interface ContractJsonOptions extends ContractCallOptions {
    /** Signs with the active authority instead of posting. Defaults to false. */
    activeKey?: boolean;
}

export interface CustomJsonOptions {
    activeKey?: boolean;
    /** Defaults to the streamer's configured JSON_ID. */
    id?: string;
}

export interface InjectedBlock {
    block: BlockData;
    blockNumber: number;
    transactionId: string;
}

const DURATION_PATTERN = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d|w)$/;

const DURATION_MULTIPLIERS: Record<string, number> = {
    ms: 1,
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
    w: 7 * 24 * 60 * 60 * 1000
};

export function parseDuration(duration: string | number): number {
    if (typeof duration === 'number') {
        if (!Number.isFinite(duration) || duration < 0) {
            throw new Error(`parseDuration: invalid duration '${duration}'`);
        }
        return duration;
    }

    const match = DURATION_PATTERN.exec(duration.trim());

    if (!match) {
        throw new Error(`parseDuration: invalid duration '${duration}'. Use a number of milliseconds or a string like '30s', '5m', '1h', '2d', '1w'`);
    }

    return Number(match[1]) * DURATION_MULTIPLIERS[match[2]];
}

/**
 * Formats a numeric amount as a Hive asset string, e.g. hive(1.5) === '1.500 HIVE'.
 */
export function hive(amount: number): string {
    return `${amount.toFixed(3)} HIVE`;
}

/**
 * Formats a numeric amount as an HBD asset string, e.g. hbd(0.5) === '0.500 HBD'.
 */
export function hbd(amount: number): string {
    return `${amount.toFixed(3)} HBD`;
}

function hasUsername(options: TestStreamerOptions): boolean {
    return Boolean(options.USERNAME || options.username || options.account || options.hiveAccount);
}

/**
 * A fully offline harness around a real Streamer: blocks come from a
 * MemoryBlockProvider, broadcasts are captured by a FakeHiveClient, and
 * state lives in an in-memory SQLite database by default.
 *
 * Create one with `createTestStreamer()`, register your contracts on
 * `testStreamer.streamer`, then drive the chain with `transfer`,
 * `contractTransfer`, `contractJson`, `advanceBlocks`, and `advanceTime`.
 */
export class TestStreamer {
    public readonly streamer: Streamer;
    public readonly provider: MemoryBlockProvider;
    public readonly client: FakeHiveClient;
    public readonly adapter: AdapterBase;

    private isSetup = false;

    constructor(options: TestStreamerOptions = {}) {
        const { adapter, startTime, blockIntervalMs, ...config } = options;

        this.client = new FakeHiveClient();
        this.provider = new MemoryBlockProvider({ startTime, blockIntervalMs });
        this.adapter = adapter ?? new SqliteAdapter(':memory:');

        const streamerConfig: ConfigInput = { ...config };

        if (!hasUsername(options)) {
            streamerConfig.username = 'testaccount';
        }

        this.streamer = new Streamer({
            ...streamerConfig,
            blockProvider: this.provider,
            client: this.client.asClient()
        });
    }

    /**
     * Registers the adapter and processes a genesis block. Called for you
     * by `createTestStreamer()`.
     */
    public async setup(): Promise<this> {
        if (this.isSetup) {
            return this;
        }

        await this.streamer.registerAdapter(this.adapter);
        this.provider.addBlock();
        await this.streamer.processPendingBlocks();
        this.isSetup = true;

        return this;
    }

    public get config(): Readonly<ConfigInterface> {
        return this.streamer.getConfig();
    }

    public get username(): string {
        return this.config.USERNAME;
    }

    public get currentTime(): Date {
        return this.provider.currentTime;
    }

    public get headBlockNumber(): number {
        return this.provider.head;
    }

    /**
     * Every broadcast the streamer attempted to send (transfers, custom
     * JSON, votes, raw operations), in order.
     */
    public get broadcasts(): RecordedBroadcast[] {
        return this.client.broadcasts;
    }

    /**
     * Transfers the streamer attempted to broadcast, e.g. game payouts.
     */
    public get outgoingTransfers(): any[] {
        return this.client.transfers;
    }

    /**
     * Builds the wrapped contract payload object used in transfer memos and
     * custom JSON bodies.
     */
    public contractPayload(contract: string, action: string, payload: any = {}, meta?: any): Record<string, any> {
        const body: Record<string, any> = { contract, action, payload };

        if (meta !== undefined) {
            body.meta = meta;
        }

        return { [this.config.PAYLOAD_IDENTIFIER]: body };
    }

    /**
     * JSON string form of `contractPayload`, ready to use as a transfer memo.
     */
    public contractMemo(contract: string, action: string, payload: any = {}, meta?: any): string {
        return JSON.stringify(this.contractPayload(contract, action, payload, meta));
    }

    /**
     * Mints a block containing the given raw operations and processes it.
     */
    public async sendOperations(operations: Array<[string, any]>, options: AddBlockOptions = {}): Promise<InjectedBlock> {
        await this.setup();

        const block = this.provider.addBlock(operations, options);
        await this.streamer.processPendingBlocks();

        return {
            block,
            blockNumber: this.provider.head,
            transactionId: block.transaction_ids[0]
        };
    }

    /**
     * Injects a HIVE/HBD transfer into the simulated chain. The memo can be
     * a plain string or an object (which is JSON stringified), so wrapped
     * contract payloads from `contractPayload` work directly.
     */
    public async transfer(from: string, to: string, amount: string, memo: string | Record<string, any> = ''): Promise<InjectedBlock> {
        if (!/^\d+(\.\d+)? [A-Z.]+$/.test(amount)) {
            throw new Error(`TestStreamer.transfer: invalid amount '${amount}'. Use an asset string like '1.000 HIVE' (see the hive()/hbd() helpers)`);
        }

        const resolvedMemo = typeof memo === 'string' ? memo : JSON.stringify(memo);

        return this.sendOperations([
            ['transfer', { from, to, amount, memo: resolvedMemo }]
        ]);
    }

    /**
     * Injects a transfer whose memo carries a wrapped contract payload,
     * triggering the matching contract action.
     */
    public async contractTransfer(options: ContractTransferOptions): Promise<InjectedBlock> {
        const to = options.to ?? this.username;

        if (!to) {
            throw new Error('TestStreamer.contractTransfer: provide `to` or configure a username on the streamer');
        }

        return this.transfer(
            options.from,
            to,
            options.amount ?? '1.000 HIVE',
            this.contractPayload(options.contract, options.action, options.payload ?? {}, options.meta)
        );
    }

    /**
     * Injects a custom JSON operation. The json argument can be a string or
     * an object; sender authority defaults to posting, pass `activeKey: true`
     * for active authority.
     */
    public async customJson(sender: string, json: string | Record<string, any>, options: CustomJsonOptions = {}): Promise<InjectedBlock> {
        return this.sendOperations([
            ['custom_json', {
                id: options.id ?? this.config.JSON_ID,
                json: typeof json === 'string' ? json : JSON.stringify(json),
                required_auths: options.activeKey ? [sender] : [],
                required_posting_auths: options.activeKey ? [] : [sender]
            }]
        ]);
    }

    /**
     * Injects a custom JSON operation carrying a wrapped contract payload,
     * triggering the matching contract action.
     */
    public async contractJson(sender: string, options: ContractJsonOptions): Promise<InjectedBlock> {
        return this.customJson(
            sender,
            this.contractPayload(options.contract, options.action, options.payload ?? {}, options.meta),
            { activeKey: options.activeKey }
        );
    }

    /**
     * Mints and processes `count` empty blocks.
     */
    public async advanceBlocks(count: number = 1): Promise<void> {
        await this.setup();

        for (let i = 0; i < count; i++) {
            this.provider.addBlock();
        }

        await this.streamer.processPendingBlocks();
    }

    /**
     * Moves simulated chain time forward and processes a block at the new
     * time, firing any due TimeActions. Accepts milliseconds or duration
     * strings like '30s', '5m', '1h', '2d'.
     */
    public async advanceTime(duration: string | number): Promise<void> {
        await this.setup();

        const ms = parseDuration(duration);
        const target = new Date(this.provider.currentTime.getTime() + ms);

        this.provider.addBlock([], { time: target });
        await this.streamer.processPendingBlocks();
    }

    /**
     * Contract events recorded through the adapter, oldest first.
     */
    public async getEvents(): Promise<any[]> {
        return this.adapter.getEvents();
    }

    public async stop(): Promise<void> {
        await this.streamer.stop();
    }
}

/**
 * Creates and initializes a TestStreamer: in-memory storage, simulated
 * blocks, captured broadcasts — no network, no files, no timers.
 *
 * ```ts
 * const ts = await createTestStreamer();
 * await ts.streamer.registerContract(myContract);
 * await ts.contractTransfer({ from: 'alice', contract: 'mygame', action: 'play', amount: hive(1) });
 * expect(ts.outgoingTransfers).toHaveLength(1);
 * await ts.stop();
 * ```
 */
export async function createTestStreamer(options: TestStreamerOptions = {}): Promise<TestStreamer> {
    const testStreamer = new TestStreamer(options);
    return testStreamer.setup();
}
