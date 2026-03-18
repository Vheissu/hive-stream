/**
 * Live Hive Engine integration tests against mainnet.
 * Tests the engine query namespace against real Hive Engine data.
 * Read-only, no keys needed.
 */

import { Streamer } from '../../src/streamer';

describe('Live Hive Engine Integration Tests', () => {
    let streamer: Streamer;

    beforeAll(() => {
        streamer = new Streamer({
            API_NODES: ['https://api.hive.blog'],
            HIVE_ENGINE_API: 'https://api.hive-engine.com/rpc',
            DEBUG_MODE: false
        });
    });

    afterAll(async () => {
        await streamer.stop();
    });

    test('getToken returns token info for BEE', async () => {
        const token = await streamer.engine.getToken('BEE');
        expect(token).toBeDefined();
        expect(token.symbol).toBe('BEE');
        expect(token.name).toBeDefined();
        expect(token.issuer).toBeDefined();
    }, 15000);

    test('getTokens returns a list of tokens', async () => {
        const tokens = await streamer.engine.getTokens({}, 5);
        expect(Array.isArray(tokens)).toBe(true);
        expect(tokens.length).toBeGreaterThan(0);
        expect(tokens[0].symbol).toBeDefined();
    }, 15000);

    test('getTokenBalances returns balances for a known account', async () => {
        const balances = await streamer.engine.getTokenBalances('beggars');
        expect(Array.isArray(balances)).toBe(true);
        // beggars should have at least some tokens
    }, 15000);

    test('getTokenBalance returns specific token balance', async () => {
        const balance = await streamer.engine.getTokenBalance('beggars', 'BEE');
        // May be null if account doesn't hold BEE
        if (balance) {
            expect(balance.symbol).toBe('BEE');
            expect(balance.account).toBe('beggars');
        }
    }, 15000);

    test('getMarketBuyBook returns buy orders', async () => {
        const orders = await streamer.engine.getMarketBuyBook('BEE', 5);
        expect(Array.isArray(orders)).toBe(true);
        if (orders.length > 0) {
            expect(orders[0].symbol).toBe('BEE');
            expect(orders[0].price).toBeDefined();
            expect(orders[0].quantity).toBeDefined();
        }
    }, 15000);

    test('getMarketSellBook returns sell orders', async () => {
        const orders = await streamer.engine.getMarketSellBook('BEE', 5);
        expect(Array.isArray(orders)).toBe(true);
        if (orders.length > 0) {
            expect(orders[0].symbol).toBe('BEE');
        }
    }, 15000);

    test('getMarketMetrics returns market data', async () => {
        const metrics = await streamer.engine.getMarketMetrics({ symbol: 'BEE' });
        expect(Array.isArray(metrics)).toBe(true);
        if (metrics.length > 0) {
            expect(metrics[0].symbol).toBe('BEE');
        }
    }, 15000);

    test('getMarketHistory returns trade history', async () => {
        const history = await streamer.engine.getMarketHistory('BEE', 5);
        expect(Array.isArray(history)).toBe(true);
    }, 15000);

    test('find() with custom contract/table query works', async () => {
        const results = await streamer.engine.find('tokens', 'tokens', { symbol: 'BEE' });
        expect(Array.isArray(results)).toBe(true);
        expect(results.length).toBe(1);
        expect(results[0].symbol).toBe('BEE');
    }, 15000);

    test('findOne() with custom query works', async () => {
        const result = await streamer.engine.findOne('tokens', 'tokens', { symbol: 'BEE' });
        expect(result).toBeDefined();
        expect(result.symbol).toBe('BEE');
    }, 15000);

    test('getContractInfo returns contract metadata', async () => {
        const info = await streamer.engine.getContractInfo('tokens');
        expect(info).toBeDefined();
        expect(info.name || info._id).toBeDefined();
    }, 15000);
});
