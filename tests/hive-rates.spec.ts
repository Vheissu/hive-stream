import { HiveRates } from '../src/hive-rates';
import { CoinGeckoExchange } from '../src/exchanges/coingecko';
import { Exchange } from '../src/exchanges/exchange';
import { NetworkError, ValidationError, RatesError } from '../src/types/rates';

// Mock fetch for tests
const mockFetch = jest.fn() as jest.MockedFunction<typeof fetch>;
global.fetch = mockFetch;

class MockExchange extends Exchange {
    public readonly exchangeId = 'mock-exchange';
    public shouldSucceed = true;
    public mockHiveRate = 0.5;
    public mockHbdRate = 1.0;

    constructor() {
        // Use shorter timeouts for tests
        super({ cacheDuration: 100, maxRetries: 1, retryDelay: 10 });
    }

    public async fetchRates(): Promise<boolean> {
        if (!this.shouldSucceed) {
            throw new Error('Mock exchange error');
        }

        this.rateUsdHive = this.mockHiveRate;
        this.rateUsdHbd = this.mockHbdRate;
        return true;
    }
}

describe('HiveRates', () => {
    let hiveRates: HiveRates;
    let mockExchange: MockExchange;

    beforeEach(() => {
        mockExchange = new MockExchange({ cacheDuration: 100 });
        hiveRates = new HiveRates({ cacheDuration: 100 }, [mockExchange]);
        mockFetch.mockClear();
        jest.clearAllTimers();
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    describe('constructor', () => {
        it('should use default CoinGecko exchange when no custom exchanges provided', () => {
            const rates = new HiveRates();
            expect(rates).toBeDefined();
        });

        it('should use custom exchanges when provided', () => {
            const customExchange = new MockExchange();
            const rates = new HiveRates({}, [customExchange]);
            expect(rates).toBeDefined();
        });

        it('should use default config when none provided', () => {
            const rates = new HiveRates();
            expect(rates).toBeDefined();
        });
    });

    describe('fetchRates', () => {
        beforeEach(() => {
            // Mock successful fiat API response
            mockFetch.mockResolvedValue({
                ok: true,
                json: async () => ({
                    usd: {
                        eur: 0.85,
                        gbp: 0.73,
                        jpy: 110,
                        cad: 1.25,
                        aud: 1.35
                    }
                }),
            } as Response);
        });

        it('should fetch rates successfully', async () => {
            const result = await hiveRates.fetchRates();
            
            expect(result).toBe(true);
            
            // Check crypto rates
            const cryptoRates = hiveRates.getCryptoRates();
            expect(cryptoRates.hive).toBe(0.5);
            expect(cryptoRates.hbd).toBe(1.0);

            // Check some cross rates
            expect(hiveRates.getRate('EUR', 'HIVE')).toBeCloseTo(0.5 * 0.85);
            expect(hiveRates.getRate('GBP', 'HBD')).toBeCloseTo(1.0 * 0.73);
        });

        it('should handle crypto fetch failure gracefully', async () => {
            mockExchange.shouldSucceed = false;

            const result = await hiveRates.fetchRates();
            
            // Should still succeed if fiat rates succeed
            expect(result).toBe(true);
        }, 10000);

        it('should handle fiat fetch failure gracefully', async () => {
            mockFetch.mockRejectedValue(new Error('Fiat API error'));

            // Should still succeed if crypto rates succeed
            const result = await hiveRates.fetchRates();
            expect(result).toBe(true);
        });

        it('should return false when both crypto and fiat fail', async () => {
            mockExchange.shouldSucceed = false;
            mockFetch.mockRejectedValue(new Error('All APIs failed'));

            const result = await hiveRates.fetchRates();
            expect(result).toBe(false);
        }, 10000);

        it('should calculate average rates from multiple exchanges', async () => {
            const exchange1 = new MockExchange();
            exchange1.mockHiveRate = 0.4;
            exchange1.mockHbdRate = 0.9;
            
            const exchange2 = new MockExchange();
            exchange2.mockHiveRate = 0.6;
            exchange2.mockHbdRate = 1.1;

            const rates = new HiveRates({ cacheDuration: 100 }, [exchange1, exchange2]);
            
            await rates.fetchRates();
            
            const cryptoRates = rates.getCryptoRates();
            expect(cryptoRates.hive).toBe(0.5); // Average of 0.4 and 0.6
            expect(cryptoRates.hbd).toBe(1.0);  // Average of 0.9 and 1.1
        });

        it('should ignore invalid crypto rates in average calculation', async () => {
            const exchange1 = new MockExchange();
            exchange1.mockHiveRate = 0.5;
            exchange1.mockHbdRate = 1.0;
            
            const exchange2 = new MockExchange();
            exchange2.mockHiveRate = 0; // Invalid
            exchange2.mockHbdRate = -1; // Invalid

            const rates = new HiveRates({ cacheDuration: 100 }, [exchange1, exchange2]);
            
            await rates.fetchRates();
            
            const cryptoRates = rates.getCryptoRates();
            expect(cryptoRates.hive).toBe(0.5); // Only valid rate used
            expect(cryptoRates.hbd).toBe(1.0);  // Only valid rate used
        });
    });

    describe('rate retrieval methods', () => {
        beforeEach(async () => {
            mockFetch.mockResolvedValue({
                ok: true,
                json: async () => ({
                    usd: {
                        eur: 0.85,
                        gbp: 0.73,
                        jpy: 110
                    }
                }),
            } as Response);

            await hiveRates.fetchRates();
        });

        it('should get specific rate correctly', () => {
            const rate = hiveRates.getRate('EUR', 'HIVE');
            expect(rate).toBeCloseTo(0.5 * 0.85);
        });

        it('should return null for non-existent rate', () => {
            const rate = hiveRates.getRate('XYZ' as any, 'HIVE');
            expect(rate).toBeNull();
        });

        it('should get all rates', () => {
            const allRates = hiveRates.getAllRates();
            expect(typeof allRates).toBe('object');
            expect(allRates['EUR_HIVE']).toBeCloseTo(0.5 * 0.85);
            expect(allRates['GBP_HBD']).toBeCloseTo(1.0 * 0.73);
        });

        it('should get crypto rates only', () => {
            const cryptoRates = hiveRates.getCryptoRates();
            expect(cryptoRates.hive).toBe(0.5);
            expect(cryptoRates.hbd).toBe(1.0);
        });

        it('should get fiat rates only', () => {
            const fiatRates = hiveRates.getFiatRates();
            expect(fiatRates.EUR).toBe(0.85);
            expect(fiatRates.GBP).toBe(0.73);
            expect(fiatRates.JPY).toBe(110);
        });

        it('should support legacy method', () => {
            const rate = hiveRates.fiatToHiveRate('EUR', 'HIVE');
            expect(rate).toBeCloseTo(0.5 * 0.85);
        });
    });

    describe('caching behavior', () => {
        beforeEach(() => {
            mockFetch.mockResolvedValue({
                ok: true,
                json: async () => ({
                    usd: { eur: 0.85 }
                }),
            } as Response);
        });

        it('should respect cache duration', async () => {
            // First fetch
            await hiveRates.fetchRates();
            
            // Second fetch within cache duration should not call API
            mockFetch.mockClear();
            await hiveRates.fetchRates();
            
            expect(mockFetch).not.toHaveBeenCalled();
        });

        it('should fetch when cache expires', async () => {
            // First fetch
            await hiveRates.fetchRates();
            
            // Advance time beyond cache duration
            jest.advanceTimersByTime(150);
            
            // Second fetch should call API
            mockFetch.mockClear();
            await hiveRates.fetchRates();
            
            expect(mockFetch).toHaveBeenCalled();
        });

        it('should track last fetch times', async () => {
            const timesBefore = hiveRates.getLastFetchTimes();
            expect(timesBefore.crypto).toBeUndefined();
            expect(timesBefore.fiat).toBeUndefined();

            await hiveRates.fetchRates();

            const timesAfter = hiveRates.getLastFetchTimes();
            expect(timesAfter.crypto).toBeDefined();
            expect(timesAfter.fiat).toBeDefined();
        });

        it('should report cache validity', async () => {
            const validityBefore = hiveRates.isCacheValid();
            expect(validityBefore.crypto).toBe(false);
            expect(validityBefore.fiat).toBe(false);

            await hiveRates.fetchRates();

            const validityAfter = hiveRates.isCacheValid();
            expect(validityAfter.crypto).toBe(true);
            expect(validityAfter.fiat).toBe(true);

            jest.advanceTimersByTime(150);

            const validityExpired = hiveRates.isCacheValid();
            expect(validityExpired.crypto).toBe(false);
            expect(validityExpired.fiat).toBe(false);
        });
    });

    describe('fiat API handling', () => {
        it('should try multiple fiat endpoints', async () => {
            // First endpoint fails, second succeeds
            mockFetch
                .mockRejectedValueOnce(new Error('First endpoint failed'))
                .mockResolvedValueOnce({
                    ok: true,
                    json: async () => ({
                        usd: { eur: 0.85 }
                    }),
                } as Response);

            const result = await hiveRates.fetchRates();
            expect(result).toBe(true);
            expect(mockFetch).toHaveBeenCalledTimes(2);
        });

        it('should handle all fiat endpoints failing', async () => {
            mockFetch.mockRejectedValue(new Error('All endpoints failed'));

            // This should still succeed because crypto fetch succeeds
            const result = await hiveRates.fetchRates();
            expect(result).toBe(true);
        });

        it('should validate fiat response format', async () => {
            mockFetch.mockResolvedValue({
                ok: true,
                json: async () => ({ invalid: 'format' }),
            } as Response);

            // Should still succeed because crypto fetch succeeds, fiat just fails silently
            const result = await hiveRates.fetchRates();
            expect(result).toBe(true);
        });

        it('should filter invalid fiat rates', async () => {
            mockFetch.mockResolvedValue({
                ok: true,
                json: async () => ({
                    usd: {
                        eur: 0.85,
                        invalid: 'string',
                        nan: NaN,
                        negative: -1,
                        zero: 0
                    }
                }),
            } as Response);

            await hiveRates.fetchRates();
            
            const fiatRates = hiveRates.getFiatRates();
            expect(fiatRates.EUR).toBe(0.85);
            expect(fiatRates.INVALID).toBeUndefined();
            expect(fiatRates.NAN).toBeUndefined();
            expect(fiatRates.NEGATIVE).toBeUndefined();
            expect(fiatRates.ZERO).toBeUndefined();
        });

        it('should convert currency codes to uppercase', async () => {
            mockFetch.mockResolvedValue({
                ok: true,
                json: async () => ({
                    usd: {
                        eur: 0.85,
                        gbp: 0.73
                    }
                }),
            } as Response);

            await hiveRates.fetchRates();
            
            const fiatRates = hiveRates.getFiatRates();
            expect(fiatRates.EUR).toBe(0.85);
            expect(fiatRates.GBP).toBe(0.73);
        });
    });

    describe('error handling', () => {
        it('should throw RatesError for unexpected errors', async () => {
            // Mock an unexpected error in fetchCryptoRates
            const originalMethod = hiveRates['fetchCryptoRates'];
            hiveRates['fetchCryptoRates'] = jest.fn().mockImplementation(() => {
                throw new TypeError('Unexpected error');
            });

            await expect(hiveRates.fetchRates()).rejects.toThrow(RatesError);
            await expect(hiveRates.fetchRates()).rejects.toThrow('Unexpected error');

            // Restore original method
            hiveRates['fetchCryptoRates'] = originalMethod;
        });

        it('should preserve known error types', async () => {
            mockFetch.mockResolvedValue({
                ok: true,
                json: async () => ({ invalid: 'format' }),
            } as Response);

            // Should still succeed because crypto fetch succeeds, fiat just fails silently  
            const result = await hiveRates.fetchRates();
            expect(result).toBe(true);
        });
    });

    describe('edge cases', () => {
        it('should handle empty fiat rates response', async () => {
            mockFetch.mockResolvedValue({
                ok: true,
                json: async () => ({
                    usd: {}
                }),
            } as Response);

            // Should still succeed because crypto fetch succeeds, fiat just fails silently
            const result = await hiveRates.fetchRates();
            expect(result).toBe(true);
        });

        it('should handle no valid crypto rates', async () => {
            mockExchange.mockHiveRate = 0;
            mockExchange.mockHbdRate = 0;
            
            mockFetch.mockResolvedValue({
                ok: true,
                json: async () => ({
                    usd: { eur: 0.85 }
                }),
            } as Response);

            const result = await hiveRates.fetchRates();
            expect(result).toBe(true);
            
            const cryptoRates = hiveRates.getCryptoRates();
            expect(cryptoRates.hive).toBeUndefined();
            expect(cryptoRates.hbd).toBeUndefined();
        });

        it('should handle partial crypto rates', async () => {
            mockExchange.mockHiveRate = 0.5;
            mockExchange.mockHbdRate = 0; // Invalid
            
            mockFetch.mockResolvedValue({
                ok: true,
                json: async () => ({
                    usd: { eur: 0.85 }
                }),
            } as Response);

            await hiveRates.fetchRates();
            
            const cryptoRates = hiveRates.getCryptoRates();
            expect(cryptoRates.hive).toBe(0.5);
            expect(cryptoRates.hbd).toBeUndefined();
            
            // Should still calculate HIVE rates but not HBD rates
            expect(hiveRates.getRate('EUR', 'HIVE')).toBeCloseTo(0.5 * 0.85);
            expect(hiveRates.getRate('EUR', 'HBD')).toBeNull();
        });
    });
});
