import { createHash, createHmac, randomBytes } from 'crypto';
import {
    FairRandom,
    buildFairMessage,
    deriveOutcome,
    formatMultiplierCents,
    hashServerSeed,
    hmacSha256Hex,
    parseMultiplierCents,
    sha256Hex,
    verifyOutcome,
    verifyServerSeedCommitment
} from '../src/client';
import {
    AdapterFairnessStore,
    FairnessManager,
    MemoryFairnessStore,
    SqliteAdapter,
    createFairness,
    resolveFairnessOption
} from '../src';

describe('sha256 / hmac', () => {
    test('match node:crypto across lengths and block boundaries', () => {
        for (let length = 0; length < 200; length++) {
            const message = randomBytes(length).toString('latin1');
            const key = randomBytes(length % 130).toString('hex');

            expect(sha256Hex(message)).toBe(createHash('sha256').update(message, 'utf8').digest('hex'));
            expect(hmacSha256Hex(key, message)).toBe(createHmac('sha256', key).update(message, 'utf8').digest('hex'));
        }
    });

    test('known vectors', () => {
        expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
        expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
        expect(hmacSha256Hex('key', 'The quick brown fox jumps over the lazy dog'))
            .toBe('f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8');
    });
});

describe('fairness core', () => {
    const input = { serverSeed: 'server-seed', clientSeed: 'alice', nonce: 7 };

    test('commitment round-trips and rejects tampering', () => {
        const hash = hashServerSeed('secret');

        expect(verifyServerSeedCommitment('secret', hash)).toBe(true);
        expect(verifyServerSeedCommitment('secret', hash.toUpperCase())).toBe(true);
        expect(verifyServerSeedCommitment('Secret', hash)).toBe(false);
        expect(() => hashServerSeed('')).toThrow();
    });

    test('message format is stable and right-anchored', () => {
        expect(buildFairMessage(input)).toBe('alice:7:0');
        expect(buildFairMessage({ ...input, entropy: 'abc123' }, 2)).toBe('alice:abc123:7:2');
        expect(() => new FairRandom({ ...input, entropy: 'a:b' })).toThrow('entropy');
        expect(() => new FairRandom({ ...input, nonce: -1 })).toThrow('nonce');
    });

    test('outcomes are deterministic and pinned (regression guard for the published scheme)', () => {
        expect(deriveOutcome(input, { type: 'dice' })).toBe(deriveOutcome(input, { type: 'dice' }));
        // Pinned values: changing these breaks verification of every past bet.
        expect(deriveOutcome(input, { type: 'dice' })).toBe(46);
        expect(deriveOutcome(input, { type: 'roulette' })).toBe(24);
        expect(deriveOutcome(input, { type: 'coin' })).toBe('tails');
        expect(deriveOutcome(input, { type: 'crash', houseEdgeBps: 100 })).toEqual({ multiplierCents: 106, multiplier: '1.06' });
        expect(deriveOutcome(input, { type: 'pick', count: 3, total: 10 })).toEqual([5, 9, 1]);

        const first = new FairRandom(input).nextUint32();
        expect(first).toBe(parseInt(hmacSha256Hex('server-seed', 'alice:7:0').slice(0, 8), 16));
    });

    test('changing any input changes the stream', () => {
        const base = new FairRandom(input).nextUint32();

        expect(new FairRandom({ ...input, nonce: 8 }).nextUint32()).not.toBe(base);
        expect(new FairRandom({ ...input, clientSeed: 'bob' }).nextUint32()).not.toBe(base);
        expect(new FairRandom({ ...input, entropy: 'deadbeef' }).nextUint32()).not.toBe(base);
        expect(new FairRandom({ ...input, serverSeed: 'other' }).nextUint32()).not.toBe(base);
    });

    test('streams extend past 32 bytes by incrementing the round', () => {
        const random = new FairRandom(input);
        const values = Array.from({ length: 20 }, () => random.nextUint32());
        const round1 = hmacSha256Hex('server-seed', 'alice:7:1');

        expect(values[8]).toBe(parseInt(round1.slice(0, 8), 16));
    });

    test('int() stays in range and covers every value', () => {
        const seen = new Set<number>();

        for (let nonce = 0; nonce < 2000; nonce++) {
            const value = new FairRandom({ ...input, nonce }).int(3, 9);
            expect(value).toBeGreaterThanOrEqual(3);
            expect(value).toBeLessThanOrEqual(9);
            seen.add(value);
        }

        expect(seen.size).toBe(7);
        expect(new FairRandom(input).int(5, 5)).toBe(5);
        expect(() => new FairRandom(input).int(5, 4)).toThrow();
        expect(() => new FairRandom(input).int(0, 2 ** 32)).toThrow();
    });

    test('roulette distribution is roughly uniform', () => {
        const counts = new Array(37).fill(0);
        const samples = 37000;

        for (let nonce = 0; nonce < samples; nonce++) {
            counts[deriveOutcome({ ...input, nonce }, { type: 'roulette' })]++;
        }

        for (const count of counts) {
            expect(count).toBeGreaterThan(800);
            expect(count).toBeLessThan(1200);
        }
    });

    test('pick() returns distinct in-range indices', () => {
        for (let nonce = 0; nonce < 200; nonce++) {
            const picked = deriveOutcome({ ...input, nonce }, { type: 'pick', count: 5, total: 12 });
            expect(new Set(picked).size).toBe(5);
            picked.forEach((index) => {
                expect(index).toBeGreaterThanOrEqual(0);
                expect(index).toBeLessThan(12);
            });
        }

        expect(deriveOutcome(input, { type: 'pick', count: 3, total: 3 }).sort()).toEqual([0, 1, 2]);
        expect(() => deriveOutcome(input, { type: 'pick', count: 4, total: 3 })).toThrow();
    });

    test('crash multipliers honour the house edge', () => {
        let reached2x = 0;
        const samples = 40000;

        for (let nonce = 0; nonce < samples; nonce++) {
            const result = deriveOutcome({ ...input, nonce }, { type: 'crash', houseEdgeBps: 100 });
            expect(result.multiplierCents).toBeGreaterThanOrEqual(100);
            expect(result.multiplier).toBe(formatMultiplierCents(result.multiplierCents));

            if (result.multiplierCents >= 200) {
                reached2x++;
            }
        }

        // Expected P(>= 2x) = 0.99 / 2
        expect(Math.abs(reached2x / samples - 0.495)).toBeLessThan(0.015);
        expect(deriveOutcome(input, { type: 'crash', houseEdgeBps: 100, maxMultiplierCents: 100 }).multiplierCents).toBe(100);
        expect(() => deriveOutcome(input, { type: 'crash', houseEdgeBps: 10000 })).toThrow();
    });

    test('multiplier parsing avoids float rounding', () => {
        expect(parseMultiplierCents('2')).toBe(200);
        expect(parseMultiplierCents('2.5')).toBe(250);
        expect(parseMultiplierCents(1.01)).toBe(101);
        expect(parseMultiplierCents('0.29')).toBe(29);
        expect(parseMultiplierCents('2.555')).toBeNull();
        expect(parseMultiplierCents('abc')).toBeNull();
        expect(formatMultiplierCents(1005)).toBe('10.05');
    });

    test('verifyOutcome checks the commitment and the settled outcome', () => {
        const serverSeed = 'revealed-seed';
        const proof = { serverSeed, serverSeedHash: hashServerSeed(serverSeed), clientSeed: 'alice', nonce: 3, entropy: '00ff' };
        const outcome = deriveOutcome(proof, { type: 'dice', sides: 100 });

        expect(verifyOutcome(proof, { type: 'dice', sides: 100 }, outcome)).toEqual(expect.objectContaining({ valid: true, outcomeMatches: true }));
        expect(verifyOutcome(proof, { type: 'dice', sides: 100 }).outcome).toBe(outcome);

        const wrong = verifyOutcome(proof, { type: 'dice', sides: 100 }, outcome === 1 ? 2 : 1);
        expect(wrong.valid).toBe(false);
        expect(wrong.outcomeMatches).toBe(false);

        const tampered = verifyOutcome({ ...proof, serverSeed: 'other' }, { type: 'dice', sides: 100 }, outcome);
        expect(tampered.valid).toBe(false);
        expect(tampered.commitmentValid).toBe(false);
    });
});

describe('FairnessManager', () => {
    const seeds = (() => {
        let counter = 0;
        return () => `seed-${counter++}`;
    })();

    test('requires init and a block id in block mode', async () => {
        const manager = new FairnessManager({ store: new MemoryFairnessStore() });

        expect(() => manager.getCommitment()).toThrow('not initialized');
        await manager.init({ scope: 'dice' });
        await expect(manager.draw({ type: 'coin' }, { clientSeed: 'alice' })).rejects.toThrow('blockId');
    });

    test('allocates sequential nonces and produces verifiable draws', async () => {
        const manager = createFairness({ store: new MemoryFairnessStore(), generateSeed: seeds });
        const commitment = await manager.init({ scope: 'dice' });

        expect(commitment).toEqual({ scope: 'dice', seedIndex: 0, serverSeedHash: expect.any(String), nextNonce: 0 });

        const first = await manager.draw({ type: 'dice' }, { clientSeed: 'alice', blockId: 'aa' });
        const second = await manager.draw({ type: 'dice' }, { clientSeed: 'alice', blockId: 'aa' });

        expect(first.proof.nonce).toBe(0);
        expect(second.proof.nonce).toBe(1);
        expect(first.proof.entropy).toBe('aa');
        expect(manager.getCommitment().nextNonce).toBe(2);

        expect(await manager.getRevealedSeed(0)).toBeNull();

        const rotation = await manager.rotate();
        expect(rotation.revealed!.noncesUsed).toBe(2);
        expect(rotation.commitment.seedIndex).toBe(1);
        expect(rotation.commitment.nextNonce).toBe(0);

        const revealed = await manager.getRevealedSeed(0);
        expect(revealed!.serverSeedHash).toBe(commitment.serverSeedHash);

        const check = verifyOutcome({ ...first.proof, serverSeed: revealed!.serverSeed }, { type: 'dice' }, first.outcome);
        expect(check.valid).toBe(true);
    });

    test('concurrent draws never share a nonce', async () => {
        const manager = new FairnessManager({ store: new MemoryFairnessStore(), entropy: 'none' });
        await manager.init({ scope: 'roulette' });

        const draws = await Promise.all(Array.from({ length: 25 }, (_, index) =>
            manager.draw({ type: 'roulette' }, { clientSeed: `p${index}` })));

        expect(new Set(draws.map((draw) => draw.proof.nonce)).size).toBe(25);
        expect(draws.every((draw) => draw.proof.entropy === undefined)).toBe(true);
    });

    test('rotateAfter rotates automatically and calls onRotate', async () => {
        const onRotate = jest.fn();
        const manager = new FairnessManager({ store: new MemoryFairnessStore(), rotateAfter: 2, onRotate, entropy: 'none' });
        await manager.init({ scope: 'coin' });

        await manager.draw({ type: 'coin' }, { clientSeed: 'a' });
        expect(onRotate).not.toHaveBeenCalled();
        await manager.draw({ type: 'coin' }, { clientSeed: 'a' });

        expect(onRotate).toHaveBeenCalledTimes(1);
        expect(manager.getCommitment().seedIndex).toBe(1);
        expect(() => new FairnessManager({ rotateAfter: 0 })).toThrow();
    });

    test('persists seeds and nonces through a SQL adapter across restarts', async () => {
        const adapter = new SqliteAdapter(':memory:');
        await adapter.create();

        const first = new FairnessManager();
        await first.init({ adapter, scope: 'dice' });
        await first.draw({ type: 'dice' }, { clientSeed: 'a', blockId: 'b1' });
        await first.draw({ type: 'dice' }, { clientSeed: 'a', blockId: 'b2' });
        const commitment = first.getCommitment();

        const restarted = new FairnessManager();
        await restarted.init({ adapter, scope: 'dice' });

        expect(restarted.getCommitment()).toEqual(commitment);
        const next = await restarted.draw({ type: 'dice' }, { clientSeed: 'a', blockId: 'b3' });
        expect(next.proof.nonce).toBe(2);

        // Scopes are isolated.
        const other = new FairnessManager();
        await other.init({ adapter, scope: 'coinflip' });
        expect(other.getCommitment().nextNonce).toBe(0);

        await adapter.destroy();
    });

    test('AdapterFairnessStore works with document adapters', async () => {
        const documents: any[] = [];
        const documentAdapter = {
            capabilities: { sql: false },
            findOne: async (_table: string, query: Record<string, any>) =>
                documents.find((doc) => Object.entries(query).every(([key, value]) => doc[key] === value)) ?? null,
            insert: async (_table: string, doc: any) => { documents.push({ ...doc }); return true; },
            replace: async (_table: string, query: Record<string, any>, doc: any) => {
                const index = documents.findIndex((existing) => existing.id === query.id);
                documents[index] = { ...doc };
                return doc;
            }
        };

        const manager = new FairnessManager({ store: new AdapterFairnessStore(documentAdapter), entropy: 'none' });
        await manager.init({ scope: 'mongo' });
        await manager.draw({ type: 'coin' }, { clientSeed: 'a' });
        await manager.rotate();

        expect(documents).toHaveLength(2);
        expect(documents[0]).toEqual(expect.objectContaining({ status: 'revealed', nonce: 1 }));
        expect(documents[1]).toEqual(expect.objectContaining({ status: 'active', seedIndex: 1 }));
    });

    test('resolveFairnessOption normalises contract options', () => {
        const manager = new FairnessManager();

        expect(resolveFairnessOption(undefined)).toBeNull();
        expect(resolveFairnessOption(false)).toBeNull();
        expect(resolveFairnessOption(manager)).toBe(manager);
        expect(resolveFairnessOption(true)).toBeInstanceOf(FairnessManager);
        expect(resolveFairnessOption({ entropy: 'none' })!.entropy).toBe('none');
    });
});
