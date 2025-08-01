import { CoinGeckoExchange } from '../../src/exchanges/coingecko';
import { NetworkError, ValidationError } from '../../src/types/rates';
import { mockSuccessfulApis, mockNetworkErrors, mockHttpErrors, mockInvalidResponses, cleanupMocks } from '../helpers/mock-fetch';

describe('CoinGeckoExchange', () => {
    let exchange: CoinGeckoExchange;

    beforeEach(() => {
        exchange = new CoinGeckoExchange();
    });

    afterEach(() => {
        cleanupMocks();
    });

    describe('fetchRates', () => {
        it('should fetch rates successfully', async () => {
            mockSuccessfulApis();

            const success = await exchange.fetchRates();

            expect(success).toBe(true);
            expect(exchange.rateUsdHive).toBe(0.25);
            expect(exchange.rateUsdHbd).toBe(1.00);
        });

        it('should handle network errors', async () => {
            mockNetworkErrors();

            await expect(exchange.fetchRates()).rejects.toThrow(NetworkError);
        });

        it('should handle HTTP errors', async () => {
            mockHttpErrors(500);

            await expect(exchange.fetchRates()).rejects.toThrow(NetworkError);
        });

        it('should handle invalid JSON responses', async () => {
            mockInvalidResponses();

            await expect(exchange.fetchRates()).rejects.toThrow(ValidationError);
        });

        it('should retry on failure', async () => {
            const retryExchange = new CoinGeckoExchange({ maxRetries: 2, retryDelay: 100 });
            
            // Mock first two calls to fail, third to succeed
            let callCount = 0;
            global.fetch = jest.fn().mockImplementation(() => {
                callCount++;
                if (callCount <= 2) {
                    return Promise.reject(new Error('Network error'));
                }
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        hive: { usd: 0.25 },
                        'hive_dollar': { usd: 1.00 }
                    })
                });
            });

            const success = await retryExchange.fetchRates();
            
            expect(success).toBe(true);
            expect(retryExchange.rateUsdHive).toBe(0.25);
            expect(callCount).toBe(3);
        }, 10000); // Increase timeout for retry test

        it('should respect timeout', async () => {
            const timeoutExchange = new CoinGeckoExchange({ timeout: 100 });
            
            // Mock a delayed response
            global.fetch = jest.fn().mockImplementation(() => 
                new Promise((resolve) => {
                    setTimeout(() => resolve({
                        ok: true,
                        json: () => Promise.resolve({ hive: { usd: 0.25 } })
                    }), 200); // Longer than timeout
                })
            );

            await expect(timeoutExchange.fetchRates()).rejects.toThrow();
        });

        it('should validate rate values', async () => {
            // Mock response with invalid rates
            global.fetch = jest.fn().mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({
                    hive: { usd: -1 }, // Invalid negative rate
                    'hive_dollar': { usd: 1.00 }
                })
            });

            await expect(exchange.fetchRates()).rejects.toThrow(ValidationError);
        });

        it('should handle missing rate data', async () => {
            // Mock response with missing hive data
            global.fetch = jest.fn().mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({
                    'hive_dollar': { usd: 1.00 }
                    // Missing hive data
                })
            });

            await expect(exchange.fetchRates()).rejects.toThrow(ValidationError);
        });
    });

    describe('caching', () => {
        it('should use cached rates when valid', async () => {
            mockSuccessfulApis();

            // First fetch
            const rates1 = await exchange.fetchRates();
            
            // Second fetch should use cache
            const rates2 = await exchange.fetchRates();

            expect(rates1).toEqual(rates2);
            expect(global.fetch).toHaveBeenCalledTimes(1);
        });

        it('should refresh cache when expired', async () => {
            const shortCacheExchange = new CoinGeckoExchange({ cacheDuration: 100 });
            mockSuccessfulApis();

            // First fetch
            await shortCacheExchange.fetchRates();

            // Wait for cache to expire
            await new Promise(resolve => setTimeout(resolve, 150));

            // Second fetch should hit API again
            await shortCacheExchange.fetchRates();

            expect(global.fetch).toHaveBeenCalledTimes(2);
        });

        it('should report cache validity correctly', async () => {
            mockSuccessfulApis();

            expect(exchange.isCacheValid()).toBe(false);

            await exchange.fetchRates();
            
            expect(exchange.isCacheValid()).toBe(true);
        });

        it('should report last fetch time', async () => {
            mockSuccessfulApis();

            expect(exchange.getLastFetchTime()).toBeNull();

            const beforeFetch = Date.now();
            await exchange.fetchRates();
            const afterFetch = Date.now();

            const lastFetchTime = exchange.getLastFetchTime();
            expect(lastFetchTime).toBeGreaterThanOrEqual(beforeFetch);
            expect(lastFetchTime).toBeLessThanOrEqual(afterFetch);
        });
    });
});
