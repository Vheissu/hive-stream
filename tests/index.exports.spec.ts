import * as HiveStream from '../src';

describe('package root exports', () => {
    test('exposes the rates and HTTP API modules from the root entrypoint', () => {
        expect(HiveStream.HiveRates).toBeDefined();
        expect(HiveStream.Exchange).toBeDefined();
        expect(HiveStream.CoinGeckoExchange).toBeDefined();
        expect(HiveStream.Api).toBeDefined();
    });

    test('exposes HiveProvider, HafProvider, and HafClient', () => {
        expect(HiveStream.HiveProvider).toBeDefined();
        expect(HiveStream.HafProvider).toBeDefined();
        expect(HiveStream.HafClient).toBeDefined();
    });
});
