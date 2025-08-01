import { Exchange } from './exchange';
import { ValidationError, NetworkError, RateConfig } from '../types/rates';

interface CoinGeckoResponse {
    hive?: { usd?: number };
    hive_dollar?: { usd?: number };
}

export class CoinGeckoExchange extends Exchange {
    public readonly exchangeId = 'coingecko';
    private static readonly API_BASE = 'https://api.coingecko.com/api/v3';
    private static readonly ENDPOINT = '/simple/price?ids=hive,hive_dollar&vs_currencies=usd';

    constructor(config?: RateConfig) {
        super(config);
    }

    public async fetchRates(): Promise<boolean> {
        try {
            const url = `${CoinGeckoExchange.API_BASE}${CoinGeckoExchange.ENDPOINT}`;
            const response = await this.fetchWithTimeout(url);
            const data: CoinGeckoResponse = await response.json();

            const { usdHiveRate, usdHbdRate } = this.parseRatesResponse(data);

            this.validateRates(usdHiveRate, usdHbdRate);

            this.rateUsdHive = usdHiveRate;
            this.rateUsdHbd = usdHbdRate;

            console.log(
                `CoinGecko rates updated: HIVE=$${usdHiveRate.toFixed(6)}, HBD=$${usdHbdRate.toFixed(6)}`
            );

            return true;
        } catch (error) {
            if (error instanceof ValidationError || error instanceof NetworkError) {
                throw error;
            }

            throw new NetworkError(
                `Unexpected error fetching rates: ${error instanceof Error ? error.message : String(error)}`,
                this.exchangeId
            );
        }
    }

    private parseRatesResponse(data: CoinGeckoResponse): { usdHiveRate: number; usdHbdRate: number } {
        if (!data || typeof data !== 'object') {
            throw new ValidationError('Invalid response format: expected object', this.exchangeId);
        }

        const usdHiveRate = data.hive?.usd;
        const usdHbdRate = data.hive_dollar?.usd;

        if (typeof usdHiveRate !== 'number' || typeof usdHbdRate !== 'number') {
            throw new ValidationError(
                'Invalid response format: missing or invalid rate data',
                this.exchangeId
            );
        }

        return { usdHiveRate, usdHbdRate };
    }

    private validateRates(hiveRate: number, hbdRate: number): void {
        if (isNaN(hiveRate) || isNaN(hbdRate)) {
            throw new ValidationError('Received NaN values from API', this.exchangeId);
        }

        if (hiveRate <= 0 || hbdRate <= 0) {
            throw new ValidationError('Received non-positive rate values', this.exchangeId);
        }

        // Sanity check: HIVE and HBD should be reasonable values (between $0.01 and $1000)
        if (hiveRate < 0.01 || hiveRate > 1000 || hbdRate < 0.01 || hbdRate > 1000) {
            throw new ValidationError(
                `Rates outside expected range: HIVE=${hiveRate}, HBD=${hbdRate}`,
                this.exchangeId
            );
        }
    }
}
