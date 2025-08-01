import { Utils } from './../src/utils';

describe('Utils', () => {

    describe('Round Precision', () => {
        test('Properly rounds precision of number to 3 places', () => {
            const value = 99.299223;
    
            expect(Utils.roundPrecision(value, 3)).toStrictEqual(99.299);
        });
    
        test('Properly rounds precision of number up and to 3 places', () => {
            const value = 99.2966;
    
            expect(Utils.roundPrecision(value, 3)).toStrictEqual(99.297);
        });
    
        test('Invalid numeric values passed', () => {
            expect(Utils.roundPrecision('dasd' as any, 3)).toBeNaN();
        });
    });

    test('Should generate two deterministic numbers', () => {
        // Should generate a deterministic random number
        expect(Utils.randomNumber('dasdasdas', '2312fsdfsdfsdf', 'kfjlksdjflksdjf999')).toStrictEqual(26);

        expect(Utils.randomNumber('fdfsdfsdfsdfsf', '2312fsdfsdfsdf', 'kfjlksdjflksdjf999')).toStrictEqual(43);
    });

    test('Should shuffle array in a non-deterministic way', () => {
        const array = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
        const arrayCloned = [...array];
        
        Utils.shuffle(array);

        expect(array).not.toMatchObject(arrayCloned);
    });

    describe('Generate String', () => {
        test('Generates a memo 6 characters in length', () => {
            expect(Utils.randomString(6)).toHaveLength(6);
        });
    
        test('Generates a memo using default 12 character length', () => {
            expect(Utils.randomString()).toHaveLength(12);
        });
    });

    describe('Random Range', () => {
        test('Should generate a random number between 0 and 10', () => {
            expect(Utils.randomRange(0, 10)).toBeLessThanOrEqual(10);
        });

        test('Should generate the number 10', () => {
            expect(Utils.randomRange(10, 10)).toStrictEqual(10);
        });

        test('Only pass min and not max', () => {
            expect(Utils.randomRange(0)).toBeLessThanOrEqual(2000);
        });

        test('Pass non numeric values to random range', () => {
            expect(Utils.randomRange('dd' as any, 'asjj' as any)).toBeNaN();
        });
    });

    describe('Convert Hive Amount', () => {
        test('Converts amount', async () => {
            const amount = 25;
            const fiatSymbol = 'USD';
            const hiveSymbol = 'HIVE';

            (fetch as any)
                .once(JSON.stringify({'hive':{'usd':0.229951},'hive_dollar':{'usd':0.99805}})) // CoinGecko HIVE/HBD prices
                .once(JSON.stringify({'date':'2025-07-31','usd':{'cad':1.38249328,'hkd':7.84969296,'isk':124.40606356,'php':58.05502018,'dkk':6.52928985,'huf':350.43324994,'czk':21.5182452,'gbp':0.75416895,'ron':4.43971718,'sek':9.77798397,'idr':16437.63140133,'inr':87.62805331,'brl':5.57697598,'rub':81.01377784,'hrk':6.59133796,'jpy':148.8919467,'thb':32.6921739,'chf':0.81307502,'eur':0.87482089,'myr':4.2526877,'bgn':1.71100093,'try':40.59221009,'cny':7.19127973,'nok':10.30319488,'nzd':1.69157541,'zar':17.98114271,'usd':1.0,'mxn':18.84341987,'sgd':1.29367688,'aud':1.5491513,'ils':3.38255864,'krw':1389.43611488,'pln':3.73980141}})); // Currency API fiat rates
    
            const value = await Utils.convertHiveAmount(amount, fiatSymbol, hiveSymbol);
            
            expect(fetch).toHaveBeenCalledWith('https://api.coingecko.com/api/v3/simple/price?ids=hive,hive_dollar&vs_currencies=usd');
            expect(fetch).toHaveBeenCalledWith('https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json');

            expect(value).toStrictEqual(Number((amount / 0.229951).toFixed(3))); // amount / HIVE price from CoinGecko (fiat to HIVE conversion)
        });
    });

    describe('Get transfer URL', () => {
        test('Gets a transfer URL string with proper URL encoding', () => {
            const result = Utils.getTransferUrl('beggars', 'TEST123', '10.000 HIVE', 'http://localhost:5001');
            const expected = 'https://hivesigner.com/sign/transfer?to=beggars&memo=TEST123&amount=10.000%20HIVE&redirect_uri=http%3A%2F%2Flocalhost%3A5001';
            expect(result).toStrictEqual(expected);
        });
    });

});