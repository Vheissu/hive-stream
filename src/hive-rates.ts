import { CoinGeckoExchange } from './exchanges/coingecko';

export class HiveRates {
    private fiatRates = {};
    private hiveRates = {};
    private lastFetch;
    private oneHour = 1000 * 60 * 60;

    public async fetchRates() {
        let hiveAverage = 0;
        let hbdAverage = 0;

        let hiveCount = 0;
        let hbdCount = 0;

        let exchangesUpdated = false;

        const exchanges = [ new CoinGeckoExchange() ];

        for (const exchange of exchanges) {
            const updated = await exchange.updateRates();

            if (updated) {
                exchangesUpdated = true;

                const usdHiveRate = exchange.rateUsdHive;
                const usdHbdRate = exchange.rateUsdHbd;

                if (usdHiveRate && usdHiveRate > 0) {
                    hiveAverage += usdHiveRate;
                    hiveCount++;
                }

                if (usdHbdRate && usdHbdRate > 0) {
                    hbdAverage += usdHbdRate;
                    hbdCount++;
                }
            }
        }

        const fiatRates = await this.getFiatRates();

        if (hiveCount === 0 && hbdCount === 0) {
            return false;
        }

        if (hiveCount > 0) {
            hiveAverage = hiveAverage / hiveCount;
        }

        if (hbdCount > 0) {
            hbdAverage = hbdAverage / hbdCount;
        }

        for (const [symbol, value] of Object.entries(this.fiatRates)) {
            const rate = Number(value);
            this.hiveRates[`USD_${symbol}`] = rate;
            this.hiveRates[`${symbol}_HIVE`] = hiveAverage * rate;
            this.hiveRates[`${symbol}_HBD`] = hbdAverage * rate;
        }

        return true;
    }
    
    public fiatToHiveRate(fiatSymbol, hiveSymbol) {
        if (!this.hiveRates) {
            return null;
        }

        if (!this.hiveRates[`${fiatSymbol}_${hiveSymbol}`]) {
            return null;
        }

        return this.hiveRates[`${fiatSymbol}_${hiveSymbol}`];
    }

    private async getFiatRates(base = 'USD') {
        const HOUR_AGO = Date.now() - this.oneHour;

        if (this.lastFetch && this.lastFetch > HOUR_AGO) {
            return false;
        }

        try {
            const baseKey = base.toLowerCase();
            let response = null;
            let exchangeRates = null;

            // Try primary endpoint first
            try {
                const primaryUrl = `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/${baseKey}.json`;
                const request = await fetch(primaryUrl);
                
                if (request.ok) {
                    response = await request.json();
                    exchangeRates = response?.[baseKey];
                }
            } catch (primaryError) {
                console.warn('Primary API endpoint failed:', primaryError.message);
            }

            // If primary fails, try the Cloudflare fallback
            if (!exchangeRates) {
                try {
                    const fallbackUrl = `https://latest.currency-api.pages.dev/v1/currencies/${baseKey}.json`;
                    const request = await fetch(fallbackUrl);
                    
                    if (request.ok) {
                        response = await request.json();
                        exchangeRates = response?.[baseKey];
                    }
                } catch (fallbackError) {
                    console.warn('Fallback API endpoint failed:', fallbackError.message);
                }
            }

            if (!exchangeRates || typeof exchangeRates !== 'object') {
                console.error('No valid exchange rates found in API response');
                return false;
            }

            // Convert the currency codes to uppercase to match the previous format
            const upperCaseRates = {};
            for (const [currency, rate] of Object.entries(exchangeRates)) {
                if (typeof rate === 'number' && !isNaN(rate)) {
                    upperCaseRates[currency.toUpperCase()] = rate;
                }
            }

            if (Object.keys(upperCaseRates).length === 0) {
                console.error('No valid currency rates found');
                return false;
            }

            this.fiatRates = upperCaseRates;
            this.lastFetch = Date.now();

            console.log(`Successfully fetched ${Object.keys(upperCaseRates).length} currency rates with base ${base}`);
            return true;
        } catch (error) {
            console.error('Error fetching fiat rates:', error);
            return false;
        }
    }
}