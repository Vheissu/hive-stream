import { PrivateKey } from '@hiveio/dhive';
import { Streamer } from '../src/streamer';
import { Utils } from '../src/utils';
import { createMockAdapter } from './helpers/mock-adapter';

describe('Wave 4 Features', () => {
    const activeKey = PrivateKey.fromSeed('test-active').toString();
    const postingKey = PrivateKey.fromSeed('test-posting').toString();
    let streamer: Streamer;

    beforeEach(async () => {
        streamer = new Streamer({
            ACTIVE_KEY: activeKey,
            POSTING_KEY: postingKey,
            USERNAME: 'testuser',
            JSON_ID: 'testing',
            PAYLOAD_IDENTIFIER: 'hive_stream',
            DEBUG_MODE: false
        });

        await streamer.registerAdapter(createMockAdapter());
    });

    afterEach(async () => {
        jest.restoreAllMocks();
        await streamer.stop();
    });

    // ─── Hive Engine Query Namespace ────────────────────────────────────

    describe('engine query namespace', () => {
        test('engine namespace is defined', () => {
            expect(streamer.engine).toBeDefined();
        });

        const methods = [
            'getTokenBalances', 'getTokenBalance', 'getToken', 'getTokens',
            'getMarketBuyBook', 'getMarketSellBook', 'getMarketHistory', 'getMarketMetrics',
            'getNFT', 'getNFTInstances', 'getNFTBalance', 'getNFTSellBook',
            'getPendingUnstakes', 'getDelegations', 'getContractInfo',
            'find', 'findOne'
        ];

        methods.forEach(method => {
            test(`engine.${method} is a function`, () => {
                expect(typeof (streamer.engine as any)[method]).toBe('function');
            });
        });
    });

    // ─── Hive Engine Ops Builders ───────────────────────────────────────

    describe('ops.stakeEngine() builder', () => {
        test('has correct methods', () => {
            const b = streamer.ops.stakeEngine();
            expect(typeof b.from).toBe('function');
            expect(typeof b.to).toBe('function');
            expect(typeof b.symbol).toBe('function');
            expect(typeof b.quantity).toBe('function');
            expect(typeof b.send).toBe('function');
        });

        test('throws without required fields', () => {
            expect(() => streamer.ops.stakeEngine().from('alice').send()).toThrow();
        });

        test('supports chaining', () => {
            const b = streamer.ops.stakeEngine();
            expect(b.from('alice').to('bob').symbol('BEE').quantity(100)).toBe(b);
        });
    });

    describe('ops.unstakeEngine() builder', () => {
        test('has correct methods', () => {
            const b = streamer.ops.unstakeEngine();
            expect(typeof b.from).toBe('function');
            expect(typeof b.symbol).toBe('function');
            expect(typeof b.quantity).toBe('function');
        });

        test('throws without required fields', () => {
            expect(() => streamer.ops.unstakeEngine().from('alice').send()).toThrow();
        });
    });

    describe('ops.buyEngine() / ops.sellEngine() builders', () => {
        test('buy builder has correct methods', () => {
            const b = streamer.ops.buyEngine();
            expect(typeof b.from).toBe('function');
            expect(typeof b.symbol).toBe('function');
            expect(typeof b.quantity).toBe('function');
            expect(typeof b.price).toBe('function');
        });

        test('sell builder has correct methods', () => {
            const b = streamer.ops.sellEngine();
            expect(typeof b.from).toBe('function');
            expect(typeof b.price).toBe('function');
        });

        test('throws without required fields', () => {
            expect(() => streamer.ops.buyEngine().from('alice').symbol('BEE').send()).toThrow();
            expect(() => streamer.ops.sellEngine().from('alice').symbol('BEE').send()).toThrow();
        });
    });

    describe('ops.cancelEngineOrder() builder', () => {
        test('has correct methods', () => {
            const b = streamer.ops.cancelEngineOrder();
            expect(typeof b.from).toBe('function');
            expect(typeof b.type).toBe('function');
            expect(typeof b.orderId).toBe('function');
        });

        test('throws without required fields', () => {
            expect(() => streamer.ops.cancelEngineOrder().from('alice').send()).toThrow();
        });
    });

    describe('ops.delegateEngine() / ops.undelegateEngine() builders', () => {
        test('delegate builder has correct methods', () => {
            const b = streamer.ops.delegateEngine();
            expect(typeof b.from).toBe('function');
            expect(typeof b.to).toBe('function');
            expect(typeof b.symbol).toBe('function');
            expect(typeof b.quantity).toBe('function');
        });

        test('undelegate builder has correct methods', () => {
            const b = streamer.ops.undelegateEngine();
            expect(typeof b.from).toBe('function');
        });

        test('throws without required fields', () => {
            expect(() => streamer.ops.delegateEngine().from('alice').to('bob').send()).toThrow();
        });
    });

    // ─── Community Builders ─────────────────────────────────────────────

    describe('ops.subscribeCommunity() builder', () => {
        test('has correct methods', () => {
            const b = streamer.ops.subscribeCommunity();
            expect(typeof b.account).toBe('function');
            expect(typeof b.community).toBe('function');
            expect(typeof b.send).toBe('function');
        });

        test('throws without required fields', () => {
            expect(() => streamer.ops.subscribeCommunity().account('alice').send()).toThrow();
        });
    });

    describe('ops.unsubscribeCommunity() builder', () => {
        test('has correct methods', () => {
            const b = streamer.ops.unsubscribeCommunity();
            expect(typeof b.account).toBe('function');
        });
    });

    describe('ops.cancelRecurrentTransfer() builder', () => {
        test('has correct methods', () => {
            const b = streamer.ops.cancelRecurrentTransfer();
            expect(typeof b.from).toBe('function');
            expect(typeof b.to).toBe('function');
            expect(typeof b.amount).toBe('function');
        });
    });

    // ─── Key Derivation ─────────────────────────────────────────────────

    describe('deriveKeys', () => {
        test('derives all key roles from account + password', () => {
            const keys = Utils.deriveKeys('testaccount', 'testpassword123');
            expect(keys.owner).toBeDefined();
            expect(keys.active).toBeDefined();
            expect(keys.posting).toBeDefined();
            expect(keys.memo).toBeDefined();
            expect(keys.ownerPublic).toBeDefined();
            expect(keys.activePublic).toBeDefined();
            expect(keys.postingPublic).toBeDefined();
            expect(keys.memoPublic).toBeDefined();

            // All private keys start with 5
            expect(keys.owner.startsWith('5')).toBe(true);
            expect(keys.active.startsWith('5')).toBe(true);
            expect(keys.posting.startsWith('5')).toBe(true);
            expect(keys.memo.startsWith('5')).toBe(true);

            // All public keys start with STM
            expect(keys.ownerPublic.startsWith('STM')).toBe(true);
            expect(keys.activePublic.startsWith('STM')).toBe(true);
            expect(keys.postingPublic.startsWith('STM')).toBe(true);
            expect(keys.memoPublic.startsWith('STM')).toBe(true);
        });

        test('produces deterministic results', () => {
            const keys1 = Utils.deriveKeys('alice', 'password');
            const keys2 = Utils.deriveKeys('alice', 'password');
            expect(keys1).toEqual(keys2);
        });

        test('different accounts produce different keys', () => {
            const keys1 = Utils.deriveKeys('alice', 'password');
            const keys2 = Utils.deriveKeys('bob', 'password');
            expect(keys1.posting).not.toBe(keys2.posting);
        });

        test('throws without account or password', () => {
            expect(() => Utils.deriveKeys('', 'password')).toThrow();
            expect(() => Utils.deriveKeys('alice', '')).toThrow();
        });
    });

    describe('getPublicKey', () => {
        test('derives public key from private key', () => {
            const keys = Utils.deriveKeys('alice', 'password');
            const pubKey = Utils.getPublicKey(keys.posting);
            expect(pubKey).toBe(keys.postingPublic);
        });
    });

    // ─── onBlock / onAnyOperation Subscriptions ─────────────────────────

    describe('onAnyOperation subscription', () => {
        test('fires for every operation', async () => {
            const callback = jest.fn();
            streamer.onAnyOperation(callback);

            await streamer.processOperation(
                ['transfer', { from: 'alice', to: 'bob', amount: '1.000 HIVE', memo: '' }],
                1000, 'blockid', 'prevblockid', 'trxid', new Date()
            );

            expect(callback).toHaveBeenCalledTimes(1);
            expect(callback).toHaveBeenCalledWith(
                ['transfer', expect.any(Object)],
                1000, 'blockid', 'prevblockid', 'trxid', expect.any(Date)
            );
        });

        test('fires for vote operations too', async () => {
            const callback = jest.fn();
            streamer.onAnyOperation(callback);

            await streamer.processOperation(
                ['vote', { voter: 'alice', author: 'bob', permlink: 'test', weight: 10000 }],
                1000, 'blockid', 'prevblockid', 'trxid', new Date()
            );

            expect(callback).toHaveBeenCalledTimes(1);
        });
    });

    describe('onBlock subscription', () => {
        test('onBlock method exists', () => {
            expect(typeof streamer.onBlock).toBe('function');
        });
    });

    // ─── Streamer Write Methods ─────────────────────────────────────────

    describe('engine write methods exist', () => {
        test('stakeEngineTokens', () => expect(typeof streamer.stakeEngineTokens).toBe('function'));
        test('unstakeEngineTokens', () => expect(typeof streamer.unstakeEngineTokens).toBe('function'));
        test('buyEngineTokens', () => expect(typeof streamer.buyEngineTokens).toBe('function'));
        test('sellEngineTokens', () => expect(typeof streamer.sellEngineTokens).toBe('function'));
        test('cancelEngineOrder', () => expect(typeof streamer.cancelEngineOrder).toBe('function'));
        test('delegateEngineTokens', () => expect(typeof streamer.delegateEngineTokens).toBe('function'));
        test('undelegateEngineTokens', () => expect(typeof streamer.undelegateEngineTokens).toBe('function'));
    });

    describe('community write methods exist', () => {
        test('subscribeCommunity', () => expect(typeof streamer.subscribeCommunity).toBe('function'));
        test('unsubscribeCommunity', () => expect(typeof streamer.unsubscribeCommunity).toBe('function'));
    });

    // ─── Engine Operation Validation ────────────────────────────────────

    describe('engine operation validation', () => {
        test('stakeEngineTokens throws without params', () => {
            expect(() => Utils.stakeEngineTokens(null as any, {}, 'a', 'a', 'BEE', '100')).toThrow();
        });

        test('unstakeEngineTokens throws without params', () => {
            expect(() => Utils.unstakeEngineTokens(null as any, {}, 'a', 'BEE', '100')).toThrow();
        });

        test('buyEngineTokens throws without params', () => {
            expect(() => Utils.buyEngineTokens(null as any, {}, 'a', 'BEE', '100', '1')).toThrow();
        });

        test('sellEngineTokens throws without params', () => {
            expect(() => Utils.sellEngineTokens(null as any, {}, 'a', 'BEE', '100', '1')).toThrow();
        });

        test('cancelEngineOrder throws without params', () => {
            expect(() => Utils.cancelEngineOrder(null as any, {}, 'a', 'buy', 'id')).toThrow();
        });

        test('delegateEngineTokens throws without params', () => {
            expect(() => Utils.delegateEngineTokens(null as any, {}, 'a', 'b', 'BEE', '100')).toThrow();
        });
    });

    describe('community operation validation', () => {
        test('subscribeCommunity throws without params', () => {
            expect(() => Utils.subscribeCommunity(null as any, {}, 'a', 'hive-12345')).toThrow();
        });

        test('unsubscribeCommunity throws without params', () => {
            expect(() => Utils.unsubscribeCommunity(null as any, {}, 'a', 'hive-12345')).toThrow();
        });
    });
});
