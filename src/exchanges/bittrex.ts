import { Exchange } from './exchange';

import BigNumber from 'bignumber.js';

export class BittrexExchange extends Exchange {
    public exchangeId = 'bittrex';

    public async fetchRates() {
        const USD_BTC = new BigNumber(await this.fetchRate('USD', 'BTC'));
        const BTC_HIVE = new BigNumber(await this.fetchRate('BTC', 'HIVE'));
        const BTC_HBD = new BigNumber(await this.fetchRate('BTC', 'HBD'));

        if (isNaN(USD_BTC.toNumber()) || isNaN(BTC_HIVE.toNumber()) || isNaN(BTC_HBD.toNumber())) {
            return false;
        }

        const USD_HIVE = USD_BTC.multipliedBy(BTC_HIVE).toNumber();
        const USD_HBD = USD_BTC.multipliedBy(BTC_HBD).toNumber();

        this.rateUsdHive = USD_HIVE;
        this.rateUsdHbd = USD_HBD;

        return true;
    }

    private async fetchRate(from: string, to: string) {
        const endpoint = `https://api.bittrex.com/api/v1.1/public/getticker?market=${from}-${to}`;
        const request = await fetch(endpoint);
        const response = await request.json();

        if (response) {
            return response?.result?.Last;
        }

        return null;
    }
}