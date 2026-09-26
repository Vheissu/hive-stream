import { randomBytes } from 'crypto';
import { getLogger } from '../logger';
import { AdapterBase } from '../adapters/base.adapter';
import {
    deriveOutcome,
    hashServerSeed,
    type FairOutcome,
    type FairOutcomeSpec,
    type FairProof
} from './core';

const SEEDS_TABLE = 'fairness_seeds';

export type FairnessSeedStatus = 'active' | 'revealed';

export interface FairnessSeedRecord {
    scope: string;
    seedIndex: number;
    serverSeed: string;
    serverSeedHash: string;
    /** The nonce the next draw will use. */
    nonce: number;
    status: FairnessSeedStatus;
    createdAt: string;
    revealedAt: string | null;
}

/**
 * Where server seeds and nonces live. Seeds are secret until revealed, so a
 * store must never expose `serverSeed` for an active record to players.
 */
export interface FairnessStore {
    init?(): Promise<void>;
    getActive(scope: string): Promise<FairnessSeedRecord | null>;
    getSeed(scope: string, seedIndex: number): Promise<FairnessSeedRecord | null>;
    insert(record: FairnessSeedRecord): Promise<void>;
    update(record: FairnessSeedRecord): Promise<void>;
}

export class MemoryFairnessStore implements FairnessStore {
    private readonly records = new Map<string, FairnessSeedRecord>();

    private key(scope: string, seedIndex: number): string {
        return `${scope}:${seedIndex}`;
    }

    public async getActive(scope: string): Promise<FairnessSeedRecord | null> {
        for (const record of this.records.values()) {
            if (record.scope === scope && record.status === 'active') {
                return { ...record };
            }
        }

        return null;
    }

    public async getSeed(scope: string, seedIndex: number): Promise<FairnessSeedRecord | null> {
        const record = this.records.get(this.key(scope, seedIndex));
        return record ? { ...record } : null;
    }

    public async insert(record: FairnessSeedRecord): Promise<void> {
        const key = this.key(record.scope, record.seedIndex);

        if (this.records.has(key)) {
            throw new Error(`Fairness seed ${key} already exists`);
        }

        this.records.set(key, { ...record });
    }

    public async update(record: FairnessSeedRecord): Promise<void> {
        this.records.set(this.key(record.scope, record.seedIndex), { ...record });
    }
}

function rowToRecord(row: any): FairnessSeedRecord | null {
    if (!row) {
        return null;
    }

    return {
        scope: row.scope,
        seedIndex: Number(row.seed_index ?? row.seedIndex),
        serverSeed: row.server_seed ?? row.serverSeed,
        serverSeedHash: row.server_seed_hash ?? row.serverSeedHash,
        nonce: Number(row.nonce),
        status: row.status,
        createdAt: String(row.created_at ?? row.createdAt),
        revealedAt: (row.revealed_at ?? row.revealedAt) ? String(row.revealed_at ?? row.revealedAt) : null
    };
}

/**
 * Persists seeds through a hive-stream adapter. SQL adapters get a
 * `fairness_seeds` table; document adapters (MongoDB) use a collection of the
 * same name via find/insert/replace.
 */
export class AdapterFairnessStore implements FairnessStore {
    constructor(private readonly adapter: any) {
        if (!adapter) {
            throw new Error('AdapterFairnessStore requires an adapter');
        }
    }

    private get isSql(): boolean {
        return Boolean(this.adapter?.capabilities?.sql);
    }

    public async init(): Promise<void> {
        if (!this.isSql) {
            return;
        }

        await this.adapter.query(`
            CREATE TABLE IF NOT EXISTS ${SEEDS_TABLE} (
                id TEXT PRIMARY KEY,
                scope TEXT NOT NULL,
                seed_index INTEGER NOT NULL,
                server_seed TEXT NOT NULL,
                server_seed_hash TEXT NOT NULL,
                nonce INTEGER NOT NULL,
                status TEXT NOT NULL,
                created_at TEXT NOT NULL,
                revealed_at TEXT
            )
        `);
    }

    public async getActive(scope: string): Promise<FairnessSeedRecord | null> {
        if (this.isSql) {
            const rows = await this.adapter.query(
                `SELECT * FROM ${SEEDS_TABLE} WHERE scope = ? AND status = ? ORDER BY seed_index DESC LIMIT 1`,
                [scope, 'active']
            );
            return rowToRecord(rows?.[0]);
        }

        return rowToRecord(await this.adapter.findOne(SEEDS_TABLE, { scope, status: 'active' }));
    }

    public async getSeed(scope: string, seedIndex: number): Promise<FairnessSeedRecord | null> {
        if (this.isSql) {
            const rows = await this.adapter.query(
                `SELECT * FROM ${SEEDS_TABLE} WHERE scope = ? AND seed_index = ?`,
                [scope, seedIndex]
            );
            return rowToRecord(rows?.[0]);
        }

        return rowToRecord(await this.adapter.findOne(SEEDS_TABLE, { scope, seedIndex }));
    }

    public async insert(record: FairnessSeedRecord): Promise<void> {
        if (this.isSql) {
            await this.adapter.query(
                `INSERT INTO ${SEEDS_TABLE} (id, scope, seed_index, server_seed, server_seed_hash, nonce, status, created_at, revealed_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    `${record.scope}:${record.seedIndex}`,
                    record.scope,
                    record.seedIndex,
                    record.serverSeed,
                    record.serverSeedHash,
                    record.nonce,
                    record.status,
                    record.createdAt,
                    record.revealedAt
                ]
            );
            return;
        }

        await this.adapter.insert(SEEDS_TABLE, { id: `${record.scope}:${record.seedIndex}`, ...record });
    }

    public async update(record: FairnessSeedRecord): Promise<void> {
        if (this.isSql) {
            await this.adapter.query(
                `UPDATE ${SEEDS_TABLE} SET nonce = ?, status = ?, revealed_at = ? WHERE id = ?`,
                [record.nonce, record.status, record.revealedAt, `${record.scope}:${record.seedIndex}`]
            );
            return;
        }

        await this.adapter.replace(
            SEEDS_TABLE,
            { id: `${record.scope}:${record.seedIndex}` },
            { id: `${record.scope}:${record.seedIndex}`, ...record }
        );
    }
}

export interface FairnessCommitment {
    scope: string;
    seedIndex: number;
    serverSeedHash: string;
    nextNonce: number;
}

export interface RevealedSeed {
    scope: string;
    seedIndex: number;
    serverSeed: string;
    serverSeedHash: string;
    /** Number of draws made with this seed (nonces 0..noncesUsed-1). */
    noncesUsed: number;
    revealedAt: string;
}

export interface FairnessRotation {
    revealed: RevealedSeed | null;
    commitment: FairnessCommitment;
}

export interface FairDrawProof {
    scope: string;
    seedIndex: number;
    serverSeedHash: string;
    clientSeed: string;
    nonce: number;
    entropy?: string;
}

export interface FairDrawResult<S extends FairOutcomeSpec> {
    outcome: FairOutcome<S>;
    proof: FairDrawProof;
}

export interface FairDrawOptions {
    clientSeed: string;
    /** Public entropy for this draw (the bet's block id). Ignored when the manager's entropy mode is 'none'. */
    blockId?: string;
}

export interface FairnessOptions {
    /** Namespace for seeds; defaults to the owning contract's name. */
    scope?: string;
    /**
     * 'block' (recommended) mixes the bet's block id into every draw, so even
     * a leaked server seed does not let players predict outcomes in advance.
     */
    entropy?: 'block' | 'none';
    /** Rotate (and reveal) the server seed automatically after this many draws. */
    rotateAfter?: number;
    /** Custom persistence. Defaults to the contract's adapter, then memory. */
    store?: FairnessStore;
    /** Called after every rotation, e.g. to publish the new commitment on-chain. */
    onRotate?: (rotation: FairnessRotation) => void | Promise<void>;
    /** Override seed generation (tests). Must return a high-entropy secret. */
    generateSeed?: () => string;
}

export function generateServerSeed(): string {
    return randomBytes(32).toString('hex');
}

/**
 * Server-side seed lifecycle: commitment, nonce allocation, draws and
 * rotation. Draws are serialized so concurrent bets never share a nonce.
 */
export class FairnessManager {
    private store: FairnessStore | null;
    private active: FairnessSeedRecord | null = null;
    private scope: string;
    private readonly entropyMode: 'block' | 'none';
    private readonly rotateAfter?: number;
    private readonly generateSeed: () => string;
    private queue: Promise<unknown> = Promise.resolve();
    private initialized = false;

    constructor(private readonly options: FairnessOptions = {}) {
        this.store = options.store ?? null;
        this.scope = options.scope ?? '';
        this.entropyMode = options.entropy ?? 'block';
        this.generateSeed = options.generateSeed ?? generateServerSeed;

        if (options.rotateAfter !== undefined) {
            if (!Number.isInteger(options.rotateAfter) || options.rotateAfter < 1) {
                throw new Error('rotateAfter must be a positive integer');
            }
            this.rotateAfter = options.rotateAfter;
        }
    }

    public get entropy(): 'block' | 'none' {
        return this.entropyMode;
    }

    public get isInitialized(): boolean {
        return this.initialized;
    }

    /**
     * Loads the active seed or creates the first one. `adapter` is used for
     * persistence when no explicit store was configured; adapters without
     * SQL or document support fall back to memory with a warning.
     */
    public async init(context: { adapter?: any; scope?: string } = {}): Promise<FairnessCommitment> {
        if (!this.scope) {
            this.scope = context.scope || 'default';
        }

        if (!this.store) {
            this.store = await this.resolveStore(context.adapter);
        }

        await this.store.init?.();
        this.active = await this.store.getActive(this.scope);

        if (!this.active) {
            this.active = await this.createSeed(0);
        }

        this.initialized = true;
        return this.getCommitment();
    }

    private async resolveStore(adapter: any): Promise<FairnessStore> {
        if (adapter?.capabilities?.sql) {
            return new AdapterFairnessStore(adapter);
        }

        // Document adapters (MongoDB) persist through find/insert/replace. The
        // base adapter's versions are no-ops, so only accept real overrides.
        if (adapter
            && typeof adapter.findOne === 'function'
            && adapter.findOne !== AdapterBase.prototype.findOne
            && adapter.insert !== AdapterBase.prototype.insert
            && adapter.replace !== AdapterBase.prototype.replace) {
            return new AdapterFairnessStore(adapter);
        }

        getLogger().warn(`[Fairness] No persistent store for scope '${this.scope}'; seeds and nonces are kept in memory and lost on restart.`);
        return new MemoryFairnessStore();
    }

    private async createSeed(seedIndex: number): Promise<FairnessSeedRecord> {
        const serverSeed = this.generateSeed();
        const record: FairnessSeedRecord = {
            scope: this.scope,
            seedIndex,
            serverSeed,
            serverSeedHash: hashServerSeed(serverSeed),
            nonce: 0,
            status: 'active',
            createdAt: new Date().toISOString(),
            revealedAt: null
        };

        await this.store!.insert(record);
        return record;
    }

    private assertReady(): FairnessSeedRecord {
        if (!this.initialized || !this.active || !this.store) {
            throw new Error('FairnessManager is not initialized; call init() first');
        }

        return this.active;
    }

    private serialize<T>(work: () => Promise<T>): Promise<T> {
        const run = this.queue.then(work, work);
        this.queue = run.catch(() => undefined);
        return run;
    }

    public getCommitment(): FairnessCommitment {
        const active = this.assertReady();

        return {
            scope: active.scope,
            seedIndex: active.seedIndex,
            serverSeedHash: active.serverSeedHash,
            nextNonce: active.nonce
        };
    }

    /**
     * Allocates the next nonce (persisted before the outcome is computed, so a
     * crash can never reuse one) and derives the outcome.
     */
    public draw<S extends FairOutcomeSpec>(spec: S, options: FairDrawOptions): Promise<FairDrawResult<S>> {
        return this.serialize(async () => {
            const active = this.assertReady();
            const clientSeed = String(options?.clientSeed ?? '');
            const entropy = this.entropyMode === 'block' ? options?.blockId : undefined;

            if (this.entropyMode === 'block' && !entropy) {
                throw new Error('A blockId is required when fairness entropy mode is "block"');
            }

            const nonce = active.nonce;
            const next: FairnessSeedRecord = { ...active, nonce: nonce + 1 };
            await this.store!.update(next);
            this.active = next;

            const input: FairProof = {
                serverSeed: active.serverSeed,
                serverSeedHash: active.serverSeedHash,
                clientSeed,
                nonce,
                ...(entropy ? { entropy } : {})
            };

            const outcome = deriveOutcome(input, spec);

            const proof: FairDrawProof = {
                scope: active.scope,
                seedIndex: active.seedIndex,
                serverSeedHash: active.serverSeedHash,
                clientSeed,
                nonce,
                ...(entropy ? { entropy } : {})
            };

            if (this.rotateAfter !== undefined && next.nonce >= this.rotateAfter) {
                await this.rotateUnlocked();
            }

            return { outcome, proof };
        });
    }

    /** Reveals the active seed and commits to a fresh one. */
    public rotate(): Promise<FairnessRotation> {
        return this.serialize(() => this.rotateUnlocked());
    }

    private async rotateUnlocked(): Promise<FairnessRotation> {
        const active = this.assertReady();
        const revealedAt = new Date().toISOString();
        const revealedRecord: FairnessSeedRecord = { ...active, status: 'revealed', revealedAt };

        await this.store!.update(revealedRecord);
        this.active = await this.createSeed(active.seedIndex + 1);

        const rotation: FairnessRotation = {
            revealed: {
                scope: revealedRecord.scope,
                seedIndex: revealedRecord.seedIndex,
                serverSeed: revealedRecord.serverSeed,
                serverSeedHash: revealedRecord.serverSeedHash,
                noncesUsed: revealedRecord.nonce,
                revealedAt
            },
            commitment: this.getCommitment()
        };

        if (this.options.onRotate) {
            try {
                await this.options.onRotate(rotation);
            } catch (error) {
                getLogger().error('[Fairness] onRotate callback failed:', error);
            }
        }

        return rotation;
    }

    /** Returns a revealed seed. Active (unrevealed) seeds are never returned. */
    public async getRevealedSeed(seedIndex: number): Promise<RevealedSeed | null> {
        this.assertReady();
        const record = await this.store!.getSeed(this.scope, seedIndex);

        if (!record || record.status !== 'revealed' || !record.revealedAt) {
            return null;
        }

        return {
            scope: record.scope,
            seedIndex: record.seedIndex,
            serverSeed: record.serverSeed,
            serverSeedHash: record.serverSeedHash,
            noncesUsed: record.nonce,
            revealedAt: record.revealedAt
        };
    }
}

export function createFairness(options: FairnessOptions = {}): FairnessManager {
    return new FairnessManager(options);
}

/**
 * Normalizes the `fairness` option accepted by the game contracts.
 * `true` means "enable with defaults"; falsy means legacy mode.
 */
export function resolveFairnessOption(
    option: FairnessManager | FairnessOptions | boolean | undefined
): FairnessManager | null {
    if (!option) {
        return null;
    }

    if (option instanceof FairnessManager) {
        return option;
    }

    return new FairnessManager(option === true ? {} : option);
}
