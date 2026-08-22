const BLOCKCHAIN_ENDPOINT = 'blockchain';
const CONTRACTS_ENDPOINT = 'contracts';

interface JsonRpcError {
    code?: number;
    message?: string;
    data?: unknown;
}

interface JsonRpcResponse<T> {
    result?: T;
    error?: JsonRpcError;
}

export interface HiveEngineIndex {
    index: string;
    descending: boolean;
}

export class HiveEngineRpcError extends Error {
    public readonly code?: number;
    public readonly data?: unknown;
    public readonly method: string;

    constructor(method: string, error: JsonRpcError) {
        super(`Hive Engine RPC '${method}' failed${error.code === undefined ? '' : ` (${error.code})`}: ${error.message ?? 'Unknown error'}`);
        this.name = 'HiveEngineRpcError';
        this.code = error.code;
        this.data = error.data;
        this.method = method;
    }
}

/**
 * Small JSON-RPC client for the Hive Engine endpoints used by Streamer.
 * Keeping this local avoids exposing applications to the abandoned sscjs
 * dependency and gives callers useful HTTP, RPC, and timeout errors.
 */
export class HiveEngineClient {
    private requestId = 1;
    private readonly rpcNodeUrl: string;

    constructor(rpcNodeUrl: string, private readonly timeout = 15000) {
        const normalizedUrl = rpcNodeUrl.replace(/\/+$/, '');
        let parsedUrl: URL;

        try {
            parsedUrl = new URL(normalizedUrl);
        } catch {
            throw new Error(`Invalid Hive Engine API URL '${rpcNodeUrl}'.`);
        }

        if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
            throw new Error(`Hive Engine API URL must use HTTP or HTTPS, received '${parsedUrl.protocol}'.`);
        }

        if (!Number.isFinite(timeout) || timeout <= 0) {
            throw new Error('Hive Engine request timeout must be a positive number.');
        }

        this.rpcNodeUrl = normalizedUrl;
    }

    public getContractInfo<T = any>(name: string): Promise<T> {
        return this.send<T>(CONTRACTS_ENDPOINT, 'getContract', { name });
    }

    public findOne<T = any>(contract: string, table: string, query: Record<string, any>): Promise<T | null> {
        return this.send<T | null>(CONTRACTS_ENDPOINT, 'findOne', { contract, table, query });
    }

    public find<T = any>(
        contract: string,
        table: string,
        query: Record<string, any>,
        limit = 1000,
        offset = 0,
        indexes: HiveEngineIndex[] = []
    ): Promise<T[]> {
        return this.send<T[]>(CONTRACTS_ENDPOINT, 'find', {
            contract,
            table,
            query,
            limit,
            offset,
            indexes
        });
    }

    public getTransactionInfo<T = any>(txid: string): Promise<T | null> {
        return this.send<T | null>(BLOCKCHAIN_ENDPOINT, 'getTransactionInfo', { txid });
    }

    private async send<T>(endpoint: string, method: string, params: Record<string, any>): Promise<T> {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);
        const id = this.requestId++;

        try {
            const response = await fetch(`${this.rpcNodeUrl}/${endpoint}`, {
                method: 'POST',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id,
                    method,
                    params
                }),
                signal: controller.signal
            });

            if (!response.ok) {
                const status = `${response.status}${response.statusText ? ` ${response.statusText}` : ''}`;
                throw new Error(`Hive Engine RPC '${method}' failed with HTTP ${status}.`);
            }

            const payload = await response.json() as JsonRpcResponse<T>;

            if (payload.error) {
                throw new HiveEngineRpcError(method, payload.error);
            }

            return payload.result as T;
        } catch (error) {
            if (error instanceof Error && error.name === 'AbortError') {
                throw new Error(`Hive Engine RPC '${method}' timed out after ${this.timeout}ms.`);
            }

            throw error;
        } finally {
            clearTimeout(timeoutId);
        }
    }
}
