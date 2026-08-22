import { HiveEngineClient, HiveEngineRpcError } from '../../src/providers/hive-engine-client';

describe('HiveEngineClient', () => {
    const mockFetch = jest.fn() as jest.MockedFunction<typeof fetch>;

    beforeEach(() => {
        global.fetch = mockFetch;
        mockFetch.mockReset();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    test('sends contract queries with stable defaults and incrementing request ids', async () => {
        mockFetch
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({ result: [{ symbol: 'BEE' }] })
            } as Response)
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({ result: { symbol: 'BEE' } })
            } as Response);

        const client = new HiveEngineClient('https://api.hive-engine.com/rpc/');

        await expect(client.find('tokens', 'tokens', { symbol: 'BEE' })).resolves.toEqual([{ symbol: 'BEE' }]);
        await expect(client.findOne('tokens', 'tokens', { symbol: 'BEE' })).resolves.toEqual({ symbol: 'BEE' });

        expect(mockFetch).toHaveBeenNthCalledWith(1, 'https://api.hive-engine.com/rpc/contracts', expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'find',
                params: {
                    contract: 'tokens',
                    table: 'tokens',
                    query: { symbol: 'BEE' },
                    limit: 1000,
                    offset: 0,
                    indexes: []
                }
            })
        }));

        const secondRequest = JSON.parse((mockFetch.mock.calls[1][1] as RequestInit).body as string);
        expect(secondRequest).toEqual(expect.objectContaining({ id: 2, method: 'findOne' }));
    });

    test('uses the blockchain endpoint for transaction lookups', async () => {
        mockFetch.mockResolvedValue({
            ok: true,
            json: async () => ({ result: { transactionId: 'abc' } })
        } as Response);

        const client = new HiveEngineClient('https://api.hive-engine.com/rpc');
        await client.getTransactionInfo('abc');

        expect(mockFetch.mock.calls[0][0]).toBe('https://api.hive-engine.com/rpc/blockchain');
        expect(JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string)).toEqual(expect.objectContaining({
            method: 'getTransactionInfo',
            params: { txid: 'abc' }
        }));
    });

    test('surfaces JSON-RPC errors with their code and data', async () => {
        mockFetch.mockResolvedValue({
            ok: true,
            json: async () => ({
                error: { code: -32602, message: 'Invalid params', data: { field: 'contract' } }
            })
        } as Response);

        const client = new HiveEngineClient('https://api.hive-engine.com/rpc');
        const request = client.getContractInfo('');

        await expect(request).rejects.toBeInstanceOf(HiveEngineRpcError);
        await expect(request).rejects.toMatchObject({
            name: 'HiveEngineRpcError',
            code: -32602,
            method: 'getContract',
            data: { field: 'contract' }
        });
        await expect(request).rejects.toThrow("Hive Engine RPC 'getContract' failed (-32602): Invalid params");
    });

    test('surfaces HTTP failures with the method and status', async () => {
        mockFetch.mockResolvedValue({
            ok: false,
            status: 503,
            statusText: 'Service Unavailable'
        } as Response);

        const client = new HiveEngineClient('https://api.hive-engine.com/rpc');

        await expect(client.findOne('tokens', 'tokens', {})).rejects.toThrow(
            "Hive Engine RPC 'findOne' failed with HTTP 503 Service Unavailable."
        );
    });

    test('aborts requests after the configured timeout', async () => {
        jest.useFakeTimers();
        mockFetch.mockImplementation((_url, init) => new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
                const error = new Error('aborted');
                error.name = 'AbortError';
                reject(error);
            });
        }));

        const client = new HiveEngineClient('https://api.hive-engine.com/rpc', 25);
        const request = client.find('tokens', 'tokens', {});
        const expectation = expect(request).rejects.toThrow("Hive Engine RPC 'find' timed out after 25ms.");
        await jest.advanceTimersByTimeAsync(25);

        await expectation;
    });

    test('rejects invalid endpoints and timeouts before a request is sent', () => {
        expect(() => new HiveEngineClient('not-a-url')).toThrow("Invalid Hive Engine API URL 'not-a-url'.");
        expect(() => new HiveEngineClient('ftp://example.com/rpc')).toThrow('must use HTTP or HTTPS');
        expect(() => new HiveEngineClient('https://example.com/rpc', 0)).toThrow('timeout must be a positive number');
    });
});
