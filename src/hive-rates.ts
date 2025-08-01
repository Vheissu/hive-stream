import { CoinGeckoExchange } from './exchanges/coingecko';
import { Exchange } from './exchanges/exchange';
import { 
    ExchangeRates, 
    HiveRates as HiveRatesType, 
    CurrencyPair, 
    SupportedCrypto, 
    SupportedFiat,
    RateConfig,
    NetworkError,
    ValidationError,
    RatesError
} from './types/rates';

interface FiatApiResponse {
    [currency: string]: Record<string, number>;
}

export class HiveRates {
    private fiatRates: ExchangeRates = {};
    private hiveRates: HiveRatesType = {};
    private lastFiatFetch?: number;
    private readonly exchanges: Exchange[];
    private readonly config: Required<RateConfig>;

    private static readonly FIAT_API_ENDPOINTS = [
        'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies',
        'https://latest.currency-api.pages.dev/v1/currencies'
    ] as const;

    constructor(config: RateConfig = {}, customExchanges: Exchange[] = []) {
        this.config = {
            cacheDuration: config.cacheDuration ?? 60 * 60 * 1000, // 1 hour
            maxRetries: config.maxRetries ?? 3,
            retryDelay: config.retryDelay ?? 1000,
            timeout: config.timeout ?? 10000,
        };

        this.exchanges = customExchanges.length > 0 
            ? customExchanges 
            : [new CoinGeckoExchange(this.config)];
    }

    public async fetchRates(): Promise<boolean> {
        try {
            const [cryptoSuccess, fiatSuccess] = await Promise.allSettled([
                this.fetchCryptoRates(),
                this.fetchFiatRates()
            ]);

            const cryptoUpdated = cryptoSuccess.status === 'fulfilled' && cryptoSuccess.value;
            const fiatUpdated = fiatSuccess.status === 'fulfilled' && fiatSuccess.value;

            if (!cryptoUpdated && !fiatUpdated) {
                console.warn('No rates were updated');
                return false;
            }

            if (cryptoUpdated) {
                this.calculateCrossRates();
            }

            return true;
        } catch (error) {
            console.error('Error in fetchRates:', error);
            throw error instanceof RatesError ? error : new RatesError(
                `Unexpected error: ${error instanceof Error ? error.message : String(error)}`,
                'UNKNOWN_ERROR'
            );
        }
    }

    private async fetchCryptoRates(): Promise<boolean> {
        const results = await Promise.allSettled(
            this.exchanges.map(exchange => exchange.updateRates())
        );

        const successfulUpdates = results
            .map((result, index) => ({
                result,
                exchange: this.exchanges[index]
            }))
            .filter(({ result }) => result.status === 'fulfilled' && result.value);

        if (successfulUpdates.length === 0) {
            const errors = results
                .filter(result => result.status === 'rejected')
                .map(result => (result as PromiseRejectedResult).reason);
            
            console.warn('All crypto exchanges failed:', errors);
            return false;
        }

        return true;
    }

    private calculateCrossRates(): void {
        const { hiveAverage, hbdAverage } = this.calculateAverageRates();

        if (hiveAverage === 0 && hbdAverage === 0) {
            console.warn('No valid crypto rates available for cross-rate calculation');
            return;
        }

        // Calculate cross rates with fiat currencies
        Object.entries(this.fiatRates).forEach(([symbol, rate]) => {
            if (typeof rate === 'number' && !isNaN(rate) && rate > 0) {
                this.hiveRates[`USD_${symbol}` as CurrencyPair] = rate;
                
                if (hiveAverage > 0) {
                    this.hiveRates[`${symbol}_HIVE` as CurrencyPair] = hiveAverage * rate;
                }
                
                if (hbdAverage > 0) {
                    this.hiveRates[`${symbol}_HBD` as CurrencyPair] = hbdAverage * rate;
                }
            }
        });
    }

    private calculateAverageRates(): { hiveAverage: number; hbdAverage: number } {
        let hiveSum = 0;
        let hbdSum = 0;
        let hiveCount = 0;
        let hbdCount = 0;

        for (const exchange of this.exchanges) {
            if (exchange.rateUsdHive && exchange.rateUsdHive > 0) {
                hiveSum += exchange.rateUsdHive;
                hiveCount++;
            }

            if (exchange.rateUsdHbd && exchange.rateUsdHbd > 0) {
                hbdSum += exchange.rateUsdHbd;
                hbdCount++;
            }
        }

        return {
            hiveAverage: hiveCount > 0 ? hiveSum / hiveCount : 0,
            hbdAverage: hbdCount > 0 ? hbdSum / hbdCount : 0
        };
    }

    public getRate(fiatSymbol: SupportedFiat, cryptoSymbol: SupportedCrypto): number | null {
        const pair: CurrencyPair = `${fiatSymbol}_${cryptoSymbol}`;
        return this.hiveRates[pair] ?? null;
    }

    public getAllRates(): Readonly<HiveRatesType> {
        return { ...this.hiveRates };
    }

    public getCryptoRates(): { hive?: number; hbd?: number } {
        const { hiveAverage, hbdAverage } = this.calculateAverageRates();
        return {
            ...(hiveAverage > 0 && { hive: hiveAverage }),
            ...(hbdAverage > 0 && { hbd: hbdAverage })
        };
    }

    public getFiatRates(): Readonly<ExchangeRates> {
        return { ...this.fiatRates };
    }

    // Legacy method for backward compatibility
    public fiatToHiveRate(fiatSymbol: string, hiveSymbol: string): number | null {
        return this.getRate(fiatSymbol as SupportedFiat, hiveSymbol as SupportedCrypto);
    }

    private async fetchFiatRates(baseCurrency = 'USD'): Promise<boolean> {
        const cacheExpiry = Date.now() - this.config.cacheDuration;

        if (this.lastFiatFetch && this.lastFiatFetch > cacheExpiry) {
            return false; // Cache still valid
        }

        const baseKey = baseCurrency.toLowerCase();
        let lastError: Error | null = null;

        for (const baseUrl of HiveRates.FIAT_API_ENDPOINTS) {
            try {
                const url = `${baseUrl}/${baseKey}.json`;
                const response = await this.fetchWithTimeout(url);
                const data: FiatApiResponse = await response.json();

                const rates = this.parseFiatResponse(data, baseKey);
                if (Object.keys(rates).length === 0) {
                    throw new ValidationError('No valid currency rates found in response');
                }

                this.fiatRates = rates;
                this.lastFiatFetch = Date.now();

                console.log(`Successfully fetched ${Object.keys(rates).length} fiat rates from ${baseUrl}`);
                return true;

            } catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));
                console.warn(`Fiat API endpoint ${baseUrl} failed:`, lastError.message);
            }
        }

        throw new NetworkError(
            `All fiat API endpoints failed. Last error: ${lastError?.message}`,
            'fiat-api'
        );
    }

    private parseFiatResponse(data: FiatApiResponse, baseKey: string): ExchangeRates {
        if (!data || typeof data !== 'object') {
            throw new ValidationError('Invalid fiat API response format');
        }

        const exchangeRates = data[baseKey];
        if (!exchangeRates || typeof exchangeRates !== 'object') {
            throw new ValidationError(`No exchange rates found for base currency: ${baseKey}`);
        }

        const validRates: ExchangeRates = {};

        Object.entries(exchangeRates).forEach(([currency, rate]) => {
            if (typeof rate === 'number' && !isNaN(rate) && rate > 0) {
                validRates[currency.toUpperCase()] = rate;
            }
        });

        return validRates;
    }

    private async fetchWithTimeout(url: string): Promise<Response> {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

        try {
            const response = await fetch(url, {
                signal: controller.signal,
                headers: {
                    'User-Agent': 'hive-stream/3.0.0',
                    'Accept': 'application/json',
                    'Cache-Control': 'no-cache',
                },
            });

            if (!response.ok) {
                throw new NetworkError(`HTTP ${response.status}: ${response.statusText}`);
            }

            return response;
        } finally {
            clearTimeout(timeoutId);
        }
    }

    public getLastFetchTimes(): { crypto?: number; fiat?: number } {
        const cryptoTimes = this.exchanges
            .map(exchange => exchange.getLastFetchTime())
            .filter((time): time is number => time !== undefined);

        return {
            ...(cryptoTimes.length > 0 && { crypto: Math.max(...cryptoTimes) }),
            ...(this.lastFiatFetch && { fiat: this.lastFiatFetch })
        };
    }

    public isCacheValid(): { crypto: boolean; fiat: boolean } {
        const cryptoValid = this.exchanges.some(exchange => exchange.isCacheValid());
        const fiatValid = this.lastFiatFetch 
            ? this.lastFiatFetch > (Date.now() - this.config.cacheDuration)
            : false;

        return { crypto: cryptoValid, fiat: fiatValid };
    }
}