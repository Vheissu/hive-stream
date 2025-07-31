export class Exchange {
    public exchangeId;
    private oneHour = 1000 * 60 * 60;

    public rateUsdHive;
    public rateUsdHbd;
    private lastFetch;

    public async updateRates() {
        const HOUR_AGO = Date.now() - this.oneHour;

        // Only fetch once per hour
        if (this.lastFetch && this.lastFetch > HOUR_AGO) {
            return false;
        }

        const rates = await this.fetchRates();

        if (rates) {
            this.lastFetch = Date.now();
        }

        return rates;
    }

    public async fetchRates() {
        return null;
    }
}