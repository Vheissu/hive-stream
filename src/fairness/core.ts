/**
 * Provably-fair outcome derivation and verification.
 *
 * Everything in this file is pure and synchronous so the exact same code runs
 * on the server that settles bets and in the player's browser that checks
 * them (it is re-exported from `hive-stream/client`).
 *
 * Scheme (commit-reveal, HMAC-SHA256):
 *
 * 1. The operator generates a secret `serverSeed` and publishes
 *    `serverSeedHash = sha256(serverSeed)` before accepting bets.
 * 2. Each bet supplies a `clientSeed` (player-chosen, or their account name)
 *    and receives the next `nonce` for the active server seed. Optionally the
 *    block id of the bet is mixed in as public `entropy`.
 * 3. Random bytes are HMAC-SHA256(key = serverSeed, message), where message is
 *    `${clientSeed}:${nonce}:${round}` or, with entropy,
 *    `${clientSeed}:${entropy}:${nonce}:${round}`. `round` starts at 0 and
 *    increments whenever more than 32 bytes are needed.
 * 4. Bytes are read as big-endian uint32 values and mapped to ranges by
 *    rejection sampling, so there is no modulo bias.
 * 5. When the seed is rotated the operator reveals `serverSeed`; anyone can
 *    check it against the published hash and recompute every outcome.
 */
import { bytesToHex, hmacSha256, sha256Hex } from './sha256';

const UINT32_RANGE = 0x100000000;
const TWO_POW_52 = 2 ** 52;

export interface FairInput {
    serverSeed: string;
    clientSeed: string;
    nonce: number;
    /** Public entropy mixed into the message, typically the bet's block id. */
    entropy?: string;
}

export interface FairProof extends FairInput {
    serverSeedHash: string;
}

export type FairOutcomeSpec =
    | { type: 'int'; min: number; max: number }
    | { type: 'float' }
    | { type: 'coin' }
    | { type: 'dice'; sides?: number }
    | { type: 'roulette' }
    | { type: 'pick'; count: number; total: number }
    | { type: 'crash'; houseEdgeBps: number; maxMultiplierCents?: number };

export interface CrashOutcome {
    /** Crash point in hundredths, e.g. 235 means 2.35x. Always >= 100. */
    multiplierCents: number;
    /** Crash point formatted with two decimals, e.g. "2.35". */
    multiplier: string;
}

export type FairOutcome<S extends FairOutcomeSpec> =
    S extends { type: 'int' } ? number :
    S extends { type: 'float' } ? number :
    S extends { type: 'coin' } ? 'heads' | 'tails' :
    S extends { type: 'dice' } ? number :
    S extends { type: 'roulette' } ? number :
    S extends { type: 'pick' } ? number[] :
    S extends { type: 'crash' } ? CrashOutcome :
    never;

export interface FairVerification<S extends FairOutcomeSpec = FairOutcomeSpec> {
    /** True when the commitment matches and (if supplied) the expected outcome matches. */
    valid: boolean;
    commitmentValid: boolean;
    outcome: FairOutcome<S> | null;
    outcomeMatches: boolean | null;
    reason?: string;
}

export function hashServerSeed(serverSeed: string): string {
    if (typeof serverSeed !== 'string' || serverSeed.length === 0) {
        throw new Error('Server seed must be a non-empty string');
    }

    return sha256Hex(serverSeed);
}

export function verifyServerSeedCommitment(serverSeed: string, serverSeedHash: string): boolean {
    if (typeof serverSeed !== 'string' || !serverSeed || typeof serverSeedHash !== 'string') {
        return false;
    }

    return hashServerSeed(serverSeed) === serverSeedHash.toLowerCase();
}

function assertFairInput(input: FairInput): void {
    if (!input || typeof input.serverSeed !== 'string' || input.serverSeed.length === 0) {
        throw new Error('serverSeed is required');
    }

    if (typeof input.clientSeed !== 'string') {
        throw new Error('clientSeed must be a string');
    }

    if (!Number.isSafeInteger(input.nonce) || input.nonce < 0) {
        throw new Error('nonce must be a non-negative integer');
    }

    if (input.entropy !== undefined && input.entropy !== null) {
        if (typeof input.entropy !== 'string' || input.entropy.includes(':')) {
            throw new Error('entropy must be a string without ":" characters');
        }
    }
}

/**
 * Builds the HMAC message for a round. The fixed-position fields sit to the
 * right of the client seed, so a client seed containing ":" cannot collide
 * with a different (clientSeed, nonce) pair.
 */
export function buildFairMessage(input: FairInput, round: number = 0): string {
    const parts = [input.clientSeed];

    if (input.entropy) {
        parts.push(input.entropy);
    }

    parts.push(String(input.nonce), String(round));

    return parts.join(':');
}

export function fairRoundHex(input: FairInput, round: number = 0): string {
    assertFairInput(input);
    return bytesToHex(hmacSha256(input.serverSeed, buildFairMessage(input, round)));
}

/**
 * A deterministic stream of uint32 values derived from one bet's inputs.
 */
export class FairRandom {
    private round = 0;
    private buffer: Uint8Array | null = null;
    private offset = 0;

    constructor(private readonly input: FairInput) {
        assertFairInput(input);
    }

    public nextUint32(): number {
        if (!this.buffer || this.offset + 4 > this.buffer.length) {
            this.buffer = hmacSha256(this.input.serverSeed, buildFairMessage(this.input, this.round));
            this.round++;
            this.offset = 0;
        }

        const b = this.buffer;
        const value = ((b[this.offset] << 24) | (b[this.offset + 1] << 16) | (b[this.offset + 2] << 8) | b[this.offset + 3]) >>> 0;
        this.offset += 4;
        return value;
    }

    /** Uniform integer in [min, max] (inclusive) using rejection sampling. */
    public int(min: number, max: number): number {
        if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || max < min) {
            throw new Error('int() requires integer bounds with min <= max');
        }

        const range = max - min + 1;

        if (range > UINT32_RANGE) {
            throw new Error('int() range cannot exceed 2^32 values');
        }

        if (range === 1) {
            return min;
        }

        const limit = UINT32_RANGE - (UINT32_RANGE % range);

        for (;;) {
            const value = this.nextUint32();

            if (value < limit) {
                return min + (value % range);
            }
        }
    }

    /** Uniform integer in [0, 2^52). */
    public uint52(): number {
        const high = this.nextUint32();
        const low = this.nextUint32();
        return (high * 0x100000) + (low >>> 12);
    }

    /** Uniform float in [0, 1) with 52 bits of precision. */
    public float(): number {
        return this.uint52() / TWO_POW_52;
    }

    /** `count` distinct indices from [0, total) in draw order (partial Fisher-Yates). */
    public pick(count: number, total: number): number[] {
        if (!Number.isSafeInteger(total) || total < 0) {
            throw new Error('pick() total must be a non-negative integer');
        }

        if (!Number.isSafeInteger(count) || count < 0 || count > total) {
            throw new Error('pick() count must be between 0 and total');
        }

        const pool = Array.from({ length: total }, (_, index) => index);

        for (let i = 0; i < count; i++) {
            const j = this.int(i, total - 1);
            const swap = pool[i];
            pool[i] = pool[j];
            pool[j] = swap;
        }

        return pool.slice(0, count);
    }

    /**
     * Crash/limbo multiplier: floor(100 * (1 - edge) / (1 - r)) hundredths,
     * never below 1.00x. P(result >= t) = (1 - edge) / t for any cent-aligned t >= 1.
     */
    public crash(houseEdgeBps: number, maxMultiplierCents?: number): CrashOutcome {
        if (!Number.isInteger(houseEdgeBps) || houseEdgeBps < 0 || houseEdgeBps >= 10000) {
            throw new Error('houseEdgeBps must be an integer between 0 and 9999');
        }

        const h = BigInt(this.uint52());
        const e = BigInt(TWO_POW_52);
        const numerator = 100n * BigInt(10000 - houseEdgeBps) * e;
        const denominator = 10000n * (e - h);
        let cents = numerator / denominator;

        if (cents < 100n) {
            cents = 100n;
        }

        if (maxMultiplierCents !== undefined && cents > BigInt(maxMultiplierCents)) {
            cents = BigInt(maxMultiplierCents);
        }

        const multiplierCents = Number(cents);
        return { multiplierCents, multiplier: formatMultiplierCents(multiplierCents) };
    }
}

export function formatMultiplierCents(cents: number): string {
    const whole = Math.floor(cents / 100);
    const fraction = String(cents % 100).padStart(2, '0');
    return `${whole}.${fraction}`;
}

/**
 * Parses a multiplier such as "2", "2.5" or 2.35 into integer hundredths
 * without floating point rounding. Returns null for invalid input.
 */
export function parseMultiplierCents(value: string | number): number | null {
    const text = typeof value === 'number' ? String(value) : String(value ?? '').trim();

    if (!/^\d+(?:\.\d{1,2})?$/.test(text)) {
        return null;
    }

    const [whole, fraction = ''] = text.split('.');
    const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
    return Number.isSafeInteger(cents) ? cents : null;
}

export function deriveOutcome<S extends FairOutcomeSpec>(input: FairInput, spec: S): FairOutcome<S> {
    const random = new FairRandom(input);

    switch (spec.type) {
        case 'int':
            return random.int(spec.min, spec.max) as FairOutcome<S>;
        case 'float':
            return random.float() as FairOutcome<S>;
        case 'coin':
            return (random.int(0, 1) === 0 ? 'heads' : 'tails') as FairOutcome<S>;
        case 'dice':
            return random.int(1, spec.sides ?? 100) as FairOutcome<S>;
        case 'roulette':
            return random.int(0, 36) as FairOutcome<S>;
        case 'pick':
            return random.pick(spec.count, spec.total) as FairOutcome<S>;
        case 'crash':
            return random.crash(spec.houseEdgeBps, spec.maxMultiplierCents) as FairOutcome<S>;
        default:
            throw new Error(`Unsupported outcome type '${(spec as any)?.type}'`);
    }
}

function outcomesEqual(a: unknown, b: unknown): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Verifies a revealed bet: the server seed must hash to the published
 * commitment, and (when `expected` is provided) recomputing the outcome must
 * reproduce what the operator settled.
 */
export function verifyOutcome<S extends FairOutcomeSpec>(
    proof: FairProof,
    spec: S,
    expected?: FairOutcome<S>
): FairVerification<S> {
    const commitmentValid = verifyServerSeedCommitment(proof?.serverSeed, proof?.serverSeedHash);

    if (!commitmentValid) {
        return {
            valid: false,
            commitmentValid,
            outcome: null,
            outcomeMatches: null,
            reason: 'Server seed does not match the published hash'
        };
    }

    let outcome: FairOutcome<S>;

    try {
        outcome = deriveOutcome(proof, spec);
    } catch (error) {
        return {
            valid: false,
            commitmentValid,
            outcome: null,
            outcomeMatches: null,
            reason: error instanceof Error ? error.message : String(error)
        };
    }

    if (expected === undefined) {
        return { valid: true, commitmentValid, outcome, outcomeMatches: null };
    }

    const outcomeMatches = outcomesEqual(outcome, expected);

    return {
        valid: outcomeMatches,
        commitmentValid,
        outcome,
        outcomeMatches,
        reason: outcomeMatches ? undefined : 'Recomputed outcome differs from the settled outcome'
    };
}
