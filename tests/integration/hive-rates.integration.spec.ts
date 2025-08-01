import { HiveRates } from '../../src/hive-rates';

describe('HiveRates Integration Test', () => {
    it('should fetch real rates successfully', async () => {
        const hiveRates = new HiveRates();
        
        const result = await hiveRates.fetchRates();
        expect(result).toBe(true);
        
        // Check that we have some crypto rates
        const cryptoRates = hiveRates.getCryptoRates();
        expect(cryptoRates.hive).toBeGreaterThan(0);
        expect(cryptoRates.hbd).toBeGreaterThan(0);
        
        // Check that we have some fiat rates
        const fiatRates = hiveRates.getFiatRates();
        expect(Object.keys(fiatRates).length).toBeGreaterThan(0);
        expect(fiatRates.EUR).toBeGreaterThan(0);
        
        // Check that cross rates are calculated
        const eurHiveRate = hiveRates.getRate('EUR', 'HIVE');
        expect(eurHiveRate).toBeGreaterThan(0);
        
        const gbpHbdRate = hiveRates.getRate('GBP', 'HBD');
        expect(gbpHbdRate).toBeGreaterThan(0);
        
        console.log('Sample rates:');
        console.log(`HIVE: $${cryptoRates.hive?.toFixed(6)}`);
        console.log(`HBD: $${cryptoRates.hbd?.toFixed(6)}`);
        console.log(`EUR/HIVE: ${eurHiveRate?.toFixed(6)}`);
        console.log(`GBP/HBD: ${gbpHbdRate?.toFixed(6)}`);
    }, 30000); // 30 second timeout for real API calls
});
