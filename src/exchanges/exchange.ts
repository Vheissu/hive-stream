import { ExchangeInterface, RateConfig, NetworkError } from '../types/rates';

export abstract class Exchange implements ExchangeInterface {
    public abstract readonly exchangeId: string;
    public rateUsdHive?: number;
    public rateUsdHbd?: number;

    private lastFetch?: number;
    private readonly config: Required<RateConfig>;

    constructor(config: RateConfig = {}) {
        this.config = {
            cacheDuration: config.cacheDuration ?? 60 * 60 * 1000, // 1 hour
            maxRetries: config.maxRetries ?? 3,
            retryDelay: config.retryDelay ?? 1000, // 1 second
            timeout: config.timeout ?? 10000, // 10 seconds
        };
    }

    public async updateRates(): Promise<boolean> {
        const cacheExpiry = Date.now() - this.config.cacheDuration;

        // Return cached data if still valid
        if (this.lastFetch && this.lastFetch > cacheExpiry) {
            return false; // No update needed
        }

        const success = await this.fetchRatesWithRetry();

        if (success) {
            this.lastFetch = Date.now();
        }

        return success;
    }

    public abstract fetchRates(): Promise<boolean>;

    private async fetchRatesWithRetry(): Promise<boolean> {
        let lastError: Error | null = null;

        for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
            try {
                const success = await this.fetchRates();
                if (success) {
                    return true;
                }
            } catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));
                
                if (attempt < this.config.maxRetries) {
                    await this.delay(this.config.retryDelay * attempt);
                }
            }
        }

        throw new NetworkError(
            `Failed to fetch rates after ${this.config.maxRetries} attempts: ${lastError?.message}`,
            this.exchangeId
        );
    }

    protected async fetchWithTimeout(url: string): Promise<Response> {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

        try {
            const response = await fetch(url, {
                signal: controller.signal,
                headers: {
                    'User-Agent': 'hive-stream/3.0.0',
                    'Accept': 'application/json',
                },
            });

            if (!response.ok) {
                throw new NetworkError(
                    `HTTP ${response.status}: ${response.statusText}`,
                    this.exchangeId
                );
            }

            return response;
        } finally {
            clearTimeout(timeoutId);
        }
    }

    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    public getLastFetchTime(): number | undefined {
        return this.lastFetch;
    }

    public isCacheValid(): boolean {
        if (!this.lastFetch) return false;
        return this.lastFetch > (Date.now() - this.config.cacheDuration);
    }
}