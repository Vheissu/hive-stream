import { Exchange } from './exchange';

export class CoinGeckoExchange extends Exchange {
    public exchangeId = 'coingecko';

    public async fetchRates() {
        try {
            // CoinGecko's free API endpoint for HIVE and HBD prices
            const endpoint = 'https://api.coingecko.com/api/v3/simple/price?ids=hive,hive_dollar&vs_currencies=usd';
            const request = await fetch(endpoint);
            
            if (!request.ok) {
                console.warn(`CoinGecko API request failed with status: ${request.status}`);
                return false;
            }

            const response = await request.json();

            // Extract USD rates for HIVE and HBD
            const usdHiveRate = response?.hive?.usd;
            const usdHbdRate = response?.hive_dollar?.usd;

            if (typeof usdHiveRate !== 'number' || typeof usdHbdRate !== 'number') {
                console.warn('Invalid response format from CoinGecko API');
                return false;
            }

            if (isNaN(usdHiveRate) || isNaN(usdHbdRate)) {
                console.warn('Received NaN values from CoinGecko API');
                return false;
            }

            this.rateUsdHive = usdHiveRate;
            this.rateUsdHbd = usdHbdRate;

            console.log(`CoinGecko rates updated: HIVE=$${usdHiveRate.toFixed(6)}, HBD=$${usdHbdRate.toFixed(6)}`);
            return true;

        } catch (error) {
            console.error('Error fetching rates from CoinGecko:', error);
            return false;
        }
    }
}
