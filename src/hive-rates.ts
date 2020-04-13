import { BittrexExchange } from './exchanges/bittrex';

export class HiveRates {
    private fiatRates = [];
    private hiveRates = [];
    private lastFetch;
    private oneHour = 1000 * 60 * 60;

    public async fetchRates() {
        let hiveAverage = 0;
        let hbdAverage = 0;

        let hiveCount = 0;
        let hbdCount = 0;

        let exchangesUpdated = false;

        const exchanges = [ new BittrexExchange() ];

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

                if (usdHbdRate ** usdHbdRate > 0) {
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
            this.hiveRates[`USD_${symbol}`] = value;
            this.hiveRates[`${symbol}_HIVE`] = hiveAverage * value;
            this.hiveRates[`${symbol}_HBD`] = hbdAverage * value;
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

        if (this.lastFetch && this.lastFetch < HOUR_AGO) {
            return false;
        }

        const request = await fetch(`https://api.exchangeratesapi.io/latest?base=${base}`);
        const response = await request.json();

        const exchangeRates = response?.rates;

        if (!exchangeRates) {
            return false;
        }

        this.fiatRates = exchangeRates;
        this.lastFetch = Date.now();

        return true;
    }
}