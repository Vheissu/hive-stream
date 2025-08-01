import { Exchange } from '../../src/exchanges/exchange';
import { NetworkError, RateConfig } from '../../src/types/rates';

// Mock fetch for tests
const mockFetch = jest.fn() as jest.MockedFunction<typeof fetch>;
global.fetch = mockFetch;

class TestExchange extends Exchange {
    public readonly exchangeId = 'test-exchange';
    public shouldSucceed = true;
    public fetchCallCount = 0;

    public async fetchRates(): Promise<boolean> {
        this.fetchCallCount++;
        
        if (!this.shouldSucceed) {
            throw new Error('Test error');
        }

        this.rateUsdHive = 0.5;
        this.rateUsdHbd = 1.0;
        return true;
    }
}

describe('Exchange', () => {
    let exchange: TestExchange;

    beforeEach(() => {
        exchange = new TestExchange({ cacheDuration: 100, maxRetries: 2, retryDelay: 10 });
        mockFetch.mockClear();
        jest.clearAllTimers();
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    describe('constructor', () => {
        it('should use default config when none provided', () => {
            const exchange = new TestExchange();
            expect(exchange.isCacheValid()).toBe(false);
        });

        it('should accept custom config', () => {
            const config: RateConfig = {
                cacheDuration: 5000,
                maxRetries: 5,
                retryDelay: 2000,
                timeout: 15000
            };
            
            const exchange = new TestExchange(config);
            expect(exchange).toBeDefined();
        });
    });

    describe('updateRates', () => {
        it('should fetch rates successfully', async () => {
            const result = await exchange.updateRates();
            
            expect(result).toBe(true);
            expect(exchange.fetchCallCount).toBe(1);
            expect(exchange.rateUsdHive).toBe(0.5);
            expect(exchange.rateUsdHbd).toBe(1.0);
        });

        it('should return false when cache is valid', async () => {
            // First fetch
            await exchange.updateRates();
            expect(exchange.fetchCallCount).toBe(1);

            // Second fetch should use cache
            const result = await exchange.updateRates();
            expect(result).toBe(false);
            expect(exchange.fetchCallCount).toBe(1);
        });

        it('should update when cache expires', async () => {
            // First fetch
            await exchange.updateRates();
            expect(exchange.fetchCallCount).toBe(1);

            // Advance time beyond cache duration
            jest.advanceTimersByTime(150);

            // Second fetch should happen
            const result = await exchange.updateRates();
            expect(result).toBe(true);
            expect(exchange.fetchCallCount).toBe(2);
        });

        it('should retry on failure', async () => {
            exchange.shouldSucceed = false;

            // First attempt fails, second succeeds
            setTimeout(() => {
                exchange.shouldSucceed = true;
            }, 15);

            const result = await exchange.updateRates();
            expect(result).toBe(true);
            expect(exchange.fetchCallCount).toBe(2);
        }, 10000);

        it('should throw NetworkError after max retries', async () => {
            exchange.shouldSucceed = false;

            await expect(exchange.updateRates()).rejects.toThrow(NetworkError);
            await expect(exchange.updateRates()).rejects.toThrow('Failed to fetch rates after 2 attempts');
            expect(exchange.fetchCallCount).toBe(2);
        }, 10000);
    });

    describe('fetchWithTimeout', () => {
        beforeEach(() => {
            // Reset to use real fetch for this test
            (global.fetch as any) = mockFetch;
        });

        it('should fetch successfully within timeout', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ test: 'data' }),
            } as Response);

            const response = await exchange['fetchWithTimeout']('https://example.com');
            expect(response.ok).toBe(true);
        });

        it('should throw NetworkError for HTTP errors', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 404,
                statusText: 'Not Found',
            } as Response);

            await expect(exchange['fetchWithTimeout']('https://example.com'))
                .rejects.toThrow(NetworkError);
        });

        it('should include proper headers', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
            } as Response);

            await exchange['fetchWithTimeout']('https://example.com');

            expect(mockFetch).toHaveBeenCalledWith(
                'https://example.com',
                expect.objectContaining({
                    headers: {
                        'User-Agent': 'hive-stream/3.0.0',
                        'Accept': 'application/json',
                    },
                })
            );
        });

        it('should handle timeout', async () => {
            const exchange = new TestExchange({ timeout: 50 });
            
            // Mock fetch to never resolve (timeout scenario)
            mockFetch.mockImplementationOnce(() => 
                new Promise(() => {}) // Never resolves
            );

            await expect(exchange['fetchWithTimeout']('https://example.com'))
                .rejects.toThrow();
        }, 1000);
    });

    describe('utility methods', () => {
        it('should track last fetch time correctly', async () => {
            expect(exchange.getLastFetchTime()).toBeUndefined();

            await exchange.updateRates();
            
            const fetchTime = exchange.getLastFetchTime();
            expect(fetchTime).toBeDefined();
            expect(typeof fetchTime).toBe('number');
        });

        it('should report cache validity correctly', async () => {
            expect(exchange.isCacheValid()).toBe(false);

            await exchange.updateRates();
            expect(exchange.isCacheValid()).toBe(true);

            jest.advanceTimersByTime(150);
            expect(exchange.isCacheValid()).toBe(false);
        });

        it('should handle cache check with no previous fetch', () => {
            expect(exchange.isCacheValid()).toBe(false);
        });
    });

    describe('error handling', () => {
        it('should preserve original error types in retries', async () => {
            let callCount = 0;
            exchange.fetchRates = jest.fn().mockImplementation(() => {
                callCount++;
                if (callCount === 1) {
                    throw new NetworkError('First failure', 'test');
                }
                return Promise.resolve(true);
            });

            const result = await exchange.updateRates();
            expect(result).toBe(true);
            expect(exchange.fetchRates).toHaveBeenCalledTimes(2);
        }, 10000);

        it('should handle non-Error rejections', async () => {
            exchange.fetchRates = jest.fn().mockRejectedValue('string error');

            await expect(exchange.updateRates()).rejects.toThrow(NetworkError);
        }, 10000);
    });
});
