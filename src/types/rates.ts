export interface ExchangeRates {
    [currency: string]: number;
}

export interface HiveRates {
    [pair: string]: number;
}

export interface CryptoRates {
    usdHive: number;
    usdHbd: number;
}

export interface ExchangeResponse {
    success: boolean;
    rates?: CryptoRates;
    error?: string;
}

export interface FiatResponse {
    success: boolean;
    rates?: ExchangeRates;
    error?: string;
}

export interface RateConfig {
    cacheDuration?: number;
    maxRetries?: number;
    retryDelay?: number;
    timeout?: number;
}

export interface ExchangeInterface {
    readonly exchangeId: string;
    rateUsdHive?: number;
    rateUsdHbd?: number;
    updateRates(): Promise<boolean>;
    fetchRates(): Promise<boolean>;
}

export type CurrencyPair = `${string}_${string}`;
export type SupportedCrypto = 'HIVE' | 'HBD';
export type SupportedFiat = 'USD' | 'EUR' | 'GBP' | 'JPY' | 'CAD' | 'AUD' | 'CHF' | 'CNY';

export class RatesError extends Error {
    constructor(
        message: string,
        public readonly code: string,
        public readonly source?: string
    ) {
        super(message);
        this.name = 'RatesError';
    }
}

export class NetworkError extends RatesError {
    constructor(message: string, source?: string) {
        super(message, 'NETWORK_ERROR', source);
        this.name = 'NetworkError';
    }
}

export class ValidationError extends RatesError {
    constructor(message: string, source?: string) {
        super(message, 'VALIDATION_ERROR', source);
        this.name = 'ValidationError';
    }
}
