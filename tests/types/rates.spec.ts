import { 
    RatesError, 
    NetworkError, 
    ValidationError,
    ExchangeRates,
    HiveRates,
    CryptoRates,
    ExchangeResponse,
    FiatResponse,
    RateConfig,
    CurrencyPair,
    SupportedCrypto,
    SupportedFiat
} from '../../src/types/rates';

describe('Types and Error Classes', () => {
    describe('RatesError', () => {
        it('should create basic RatesError', () => {
            const error = new RatesError('Test message', 'TEST_CODE');
            
            expect(error.message).toBe('Test message');
            expect(error.code).toBe('TEST_CODE');
            expect(error.name).toBe('RatesError');
            expect(error.source).toBeUndefined();
        });

        it('should create RatesError with source', () => {
            const error = new RatesError('Test message', 'TEST_CODE', 'test-source');
            
            expect(error.source).toBe('test-source');
        });

        it('should be instance of Error', () => {
            const error = new RatesError('Test', 'CODE');
            expect(error).toBeInstanceOf(Error);
            expect(error).toBeInstanceOf(RatesError);
        });
    });

    describe('NetworkError', () => {
        it('should create NetworkError', () => {
            const error = new NetworkError('Network failed');
            
            expect(error.message).toBe('Network failed');
            expect(error.code).toBe('NETWORK_ERROR');
            expect(error.name).toBe('NetworkError');
        });

        it('should create NetworkError with source', () => {
            const error = new NetworkError('Network failed', 'api-endpoint');
            
            expect(error.source).toBe('api-endpoint');
        });

        it('should be instance of RatesError', () => {
            const error = new NetworkError('Test');
            expect(error).toBeInstanceOf(Error);
            expect(error).toBeInstanceOf(RatesError);
            expect(error).toBeInstanceOf(NetworkError);
        });
    });

    describe('ValidationError', () => {
        it('should create ValidationError', () => {
            const error = new ValidationError('Invalid data');
            
            expect(error.message).toBe('Invalid data');
            expect(error.code).toBe('VALIDATION_ERROR');
            expect(error.name).toBe('ValidationError');
        });

        it('should create ValidationError with source', () => {
            const error = new ValidationError('Invalid data', 'response-parser');
            
            expect(error.source).toBe('response-parser');
        });

        it('should be instance of RatesError', () => {
            const error = new ValidationError('Test');
            expect(error).toBeInstanceOf(Error);
            expect(error).toBeInstanceOf(RatesError);
            expect(error).toBeInstanceOf(ValidationError);
        });
    });

    describe('Type Definitions', () => {
        it('should accept valid ExchangeRates', () => {
            const rates: ExchangeRates = {
                EUR: 0.85,
                GBP: 0.73,
                JPY: 110
            };
            
            expect(typeof rates.EUR).toBe('number');
            expect(typeof rates.GBP).toBe('number');
            expect(typeof rates.JPY).toBe('number');
        });

        it('should accept valid HiveRates', () => {
            const rates: HiveRates = {
                'USD_EUR': 0.85,
                'EUR_HIVE': 0.425,
                'GBP_HBD': 0.73
            };
            
            expect(typeof rates['USD_EUR']).toBe('number');
            expect(typeof rates['EUR_HIVE']).toBe('number');
            expect(typeof rates['GBP_HBD']).toBe('number');
        });

        it('should accept valid CryptoRates', () => {
            const rates: CryptoRates = {
                usdHive: 0.5,
                usdHbd: 1.0
            };
            
            expect(rates.usdHive).toBe(0.5);
            expect(rates.usdHbd).toBe(1.0);
        });

        it('should accept valid ExchangeResponse', () => {
            const successResponse: ExchangeResponse = {
                success: true,
                rates: { usdHive: 0.5, usdHbd: 1.0 }
            };
            
            const errorResponse: ExchangeResponse = {
                success: false,
                error: 'API failed'
            };
            
            expect(successResponse.success).toBe(true);
            expect(successResponse.rates).toBeDefined();
            expect(errorResponse.success).toBe(false);
            expect(errorResponse.error).toBe('API failed');
        });

        it('should accept valid FiatResponse', () => {
            const successResponse: FiatResponse = {
                success: true,
                rates: { EUR: 0.85, GBP: 0.73 }
            };
            
            const errorResponse: FiatResponse = {
                success: false,
                error: 'API failed'
            };
            
            expect(successResponse.success).toBe(true);
            expect(successResponse.rates).toBeDefined();
            expect(errorResponse.success).toBe(false);
            expect(errorResponse.error).toBe('API failed');
        });

        it('should accept valid RateConfig', () => {
            const config: RateConfig = {
                cacheDuration: 3600000,
                maxRetries: 3,
                retryDelay: 1000,
                timeout: 10000
            };
            
            expect(config.cacheDuration).toBe(3600000);
            expect(config.maxRetries).toBe(3);
            expect(config.retryDelay).toBe(1000);
            expect(config.timeout).toBe(10000);
        });

        it('should accept partial RateConfig', () => {
            const config: RateConfig = {
                cacheDuration: 5000
            };
            
            expect(config.cacheDuration).toBe(5000);
            expect(config.maxRetries).toBeUndefined();
        });

        it('should work with CurrencyPair type', () => {
            const pair1: CurrencyPair = 'USD_EUR';
            const pair2: CurrencyPair = 'EUR_HIVE';
            const pair3: CurrencyPair = 'GBP_HBD';
            
            expect(pair1).toBe('USD_EUR');
            expect(pair2).toBe('EUR_HIVE');
            expect(pair3).toBe('GBP_HBD');
        });

        it('should work with SupportedCrypto type', () => {
            const crypto1: SupportedCrypto = 'HIVE';
            const crypto2: SupportedCrypto = 'HBD';
            
            expect(crypto1).toBe('HIVE');
            expect(crypto2).toBe('HBD');
        });

        it('should work with SupportedFiat type', () => {
            const fiat1: SupportedFiat = 'USD';
            const fiat2: SupportedFiat = 'EUR';
            const fiat3: SupportedFiat = 'GBP';
            const fiat4: SupportedFiat = 'JPY';
            const fiat5: SupportedFiat = 'CAD';
            const fiat6: SupportedFiat = 'AUD';
            const fiat7: SupportedFiat = 'CHF';
            const fiat8: SupportedFiat = 'CNY';
            
            expect(fiat1).toBe('USD');
            expect(fiat2).toBe('EUR');
            expect(fiat3).toBe('GBP');
            expect(fiat4).toBe('JPY');
            expect(fiat5).toBe('CAD');
            expect(fiat6).toBe('AUD');
            expect(fiat7).toBe('CHF');
            expect(fiat8).toBe('CNY');
        });
    });
});
