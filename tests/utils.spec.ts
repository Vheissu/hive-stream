import { Utils } from './../src/utils';

describe('Utils', () => {

    beforeEach(() => {
        fetchMock.resetMocks();
    });

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
            expect(Utils.roundPrecision('dasd', 3)).toBeNaN();
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
                .once(JSON.stringify({'success':true,'message':'','result':{'Bid':6905.98900000,'Ask':6925.65900000,'Last':6925.66500000}}))
                .once(JSON.stringify({'success':true,'message':'','result':{'Bid':0.00003083,'Ask':0.00003169,'Last':0.00003192}}))
                .once(JSON.stringify({'success':true,'message':'','result':{'Bid':0.00010800,'Ask':0.00010900,'Last':0.00010800}}))
                .once(JSON.stringify({'rates':{'CAD':1.4383752203,'HKD':7.7558193453,'ISK':140.4989335064,'PHP':51.4003524066,'DKK':6.9281276083,'HUF':326.7458035797,'CZK':25.6283038116,'GBP':0.862190485,'RON':4.4960586108,'SEK':10.2675507744,'IDR':16574.9976815358,'INR':76.1620142817,'BRL':5.0683483261,'RUB':79.8293610313,'HRK':7.053695632,'JPY':110.4609106928,'THB':32.8646944264,'CHF':0.982101456,'EUR':0.9273856997,'MYR':4.4449596587,'BGN':1.8137809515,'TRY':6.5859222851,'CNY':7.0838356673,'NOK':11.3667810442,'NZD':1.7563757767,'ZAR':17.6333116943,'USD':1.0,'MXN':24.6805156264,'SGD':1.4601687842,'AUD':1.7236390615,'ILS':3.6698506909,'KRW':1256.7003616804,'PLN':4.2711675786},'base':'USD','date':'2020-03-23'}));
    
            const value = await Utils.convertHiveAmount(amount, fiatSymbol, hiveSymbol);
            
            expect(fetch).toBeCalledWith(`https://api.bittrex.com/api/v1.1/public/getticker?market=USD-BTC`);
            expect(fetch).toBeCalledWith(`https://api.bittrex.com/api/v1.1/public/getticker?market=BTC-HIVE`);
            expect(fetch).toBeCalledWith(`https://api.bittrex.com/api/v1.1/public/getticker?market=BTC-HBD`);
            expect(fetch).toBeCalledWith(`https://api.exchangeratesapi.io/latest?base=USD`);

            expect(value).toStrictEqual(113.088);
        });
    });

    describe('Get transfer URL', () => {
        test('Gets a transfer URL string', () => {
            expect(Utils.getTransferUrl('beggars', 'TEST123', '10.000 HIVE', 'http://localhost:5001')).toStrictEqual(`https://hivesigner.com/sign/transfer?to=beggars&memo=TEST123&amount=10.000 HIVE&redirect_uri=http://localhost:5001`);
        });
    });

});