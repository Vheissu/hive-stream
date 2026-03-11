import http from 'http';
import { Api } from '../src/api';

function createMockStreamer(overrides: Record<string, any> = {}) {
    const defaultAdapter = {
        getTransfers: jest.fn().mockResolvedValue([{ from: 'alice', to: 'bob', amount: '1.000 HIVE' }]),
        getTransfersByContract: jest.fn().mockResolvedValue([]),
        getTransfersByAccount: jest.fn().mockResolvedValue([]),
        getTransfersByBlockid: jest.fn().mockResolvedValue([]),
        getJson: jest.fn().mockResolvedValue([{ id: 'test', json: '{}' }]),
        getJsonByContract: jest.fn().mockResolvedValue([]),
        getJsonByAccount: jest.fn().mockResolvedValue([]),
        getJsonByBlockid: jest.fn().mockResolvedValue([]),
        getEvents: jest.fn().mockResolvedValue([]),
        getEventsByContract: jest.fn().mockResolvedValue([]),
        getEventsByAccount: jest.fn().mockResolvedValue([]),
        getExchangeBalances: jest.fn().mockResolvedValue([]),
        getExchangeOrders: jest.fn().mockResolvedValue([]),
        getExchangeTrades: jest.fn().mockResolvedValue([]),
        getExchangeOrderBookSnapshots: jest.fn().mockResolvedValue([]),
        ...overrides,
    };

    return {
        getAdapter: jest.fn().mockReturnValue(defaultAdapter),
        _adapter: defaultAdapter,
    };
}

function httpGet(app: any, path: string): Promise<{ status: number; body: any }> {
    return new Promise((resolve, reject) => {
        const server = app.listen(0, '127.0.0.1', () => {
            const port = (server.address() as any).port;
            const req = http.get(`http://127.0.0.1:${port}${path}`, (res) => {
                let data = '';
                res.on('data', (chunk: string) => { data += chunk; });
                res.on('end', () => {
                    server.close(() => {
                        try {
                            resolve({ status: res.statusCode!, body: JSON.parse(data) });
                        } catch {
                            resolve({ status: res.statusCode!, body: data });
                        }
                    });
                });
            });
            req.on('error', (err) => {
                server.close();
                reject(err);
            });
        });
    });
}

describe('Api', () => {
    let api: Api;
    let mockStreamer: ReturnType<typeof createMockStreamer>;

    beforeEach(() => {
        mockStreamer = createMockStreamer();
        api = new Api(mockStreamer, { port: 0 });
    });

    afterEach(async () => {
        await api.stop();
    });

    describe('start() / stop()', () => {
        test('start returns server and sets server property', async () => {
            const server = await api.start();
            expect(server).toBeDefined();
            expect(api.server).toBe(server);
        });

        test('start is idempotent', async () => {
            const server1 = await api.start();
            const server2 = await api.start();
            expect(server1).toBe(server2);
        });

        test('stop clears server property', async () => {
            await api.start();
            await api.stop();
            expect(api.server).toBeNull();
        });

        test('stop is safe when not started', async () => {
            await expect(api.stop()).resolves.toBeUndefined();
        });
    });

    describe('GET /health', () => {
        test('returns health status', async () => {
            const res = await httpGet(api.app, '/health');
            expect(res.status).toBe(200);
            expect(res.body.status).toBe('ok');
            expect(res.body.timestamp).toBeDefined();
            expect(typeof res.body.uptime).toBe('number');
        });
    });

    describe('Transfer routes', () => {
        test('GET /transfers returns transfers', async () => {
            const res = await httpGet(api.app, '/transfers');
            expect(res.status).toBe(200);
            expect(res.body).toEqual([{ from: 'alice', to: 'bob', amount: '1.000 HIVE' }]);
            expect(mockStreamer._adapter.getTransfers).toHaveBeenCalled();
        });

        test('GET /transfers/contract/:contractName', async () => {
            await httpGet(api.app, '/transfers/contract/token');
            expect(mockStreamer._adapter.getTransfersByContract).toHaveBeenCalledWith('token');
        });

        test('GET /transfers/account/:account', async () => {
            await httpGet(api.app, '/transfers/account/alice');
            expect(mockStreamer._adapter.getTransfersByAccount).toHaveBeenCalledWith('alice');
        });

        test('GET /transfers/block/:blockId', async () => {
            await httpGet(api.app, '/transfers/block/abc123');
            expect(mockStreamer._adapter.getTransfersByBlockid).toHaveBeenCalledWith('abc123');
        });
    });

    describe('JSON routes', () => {
        test('GET /json returns custom json entries', async () => {
            const res = await httpGet(api.app, '/json');
            expect(res.status).toBe(200);
            expect(res.body).toEqual([{ id: 'test', json: '{}' }]);
        });

        test('GET /json/contract/:contractName', async () => {
            await httpGet(api.app, '/json/contract/nft');
            expect(mockStreamer._adapter.getJsonByContract).toHaveBeenCalledWith('nft');
        });

        test('GET /json/account/:account', async () => {
            await httpGet(api.app, '/json/account/bob');
            expect(mockStreamer._adapter.getJsonByAccount).toHaveBeenCalledWith('bob');
        });

        test('GET /json/block/:blockId', async () => {
            await httpGet(api.app, '/json/block/xyz789');
            expect(mockStreamer._adapter.getJsonByBlockid).toHaveBeenCalledWith('xyz789');
        });
    });

    describe('Events routes', () => {
        test('GET /events returns events', async () => {
            const res = await httpGet(api.app, '/events');
            expect(res.status).toBe(200);
            expect(Array.isArray(res.body)).toBe(true);
        });

        test('GET /events/contract/:contractName', async () => {
            await httpGet(api.app, '/events/contract/token');
            expect(mockStreamer._adapter.getEventsByContract).toHaveBeenCalledWith('token');
        });

        test('GET /events/account/:account', async () => {
            await httpGet(api.app, '/events/account/alice');
            expect(mockStreamer._adapter.getEventsByAccount).toHaveBeenCalledWith('alice');
        });
    });

    describe('GET /stats', () => {
        test('returns aggregated stats', async () => {
            const res = await httpGet(api.app, '/stats');
            expect(res.status).toBe(200);
            expect(res.body.totalTransfers).toBe(1);
            expect(res.body.totalCustomJson).toBe(1);
            expect(res.body.totalEvents).toBe(0);
            expect(res.body.lastUpdated).toBeDefined();
        });
    });

    describe('Exchange routes', () => {
        test('GET /exchange/balances', async () => {
            const res = await httpGet(api.app, '/exchange/balances');
            expect(res.status).toBe(200);
            expect(mockStreamer._adapter.getExchangeBalances).toHaveBeenCalledWith(undefined);
        });

        test('GET /exchange/balances?account=alice', async () => {
            await httpGet(api.app, '/exchange/balances?account=alice');
            expect(mockStreamer._adapter.getExchangeBalances).toHaveBeenCalledWith('alice');
        });

        test('GET /exchange/balances/:account', async () => {
            await httpGet(api.app, '/exchange/balances/bob');
            expect(mockStreamer._adapter.getExchangeBalances).toHaveBeenCalledWith('bob');
        });

        test('GET /exchange/orders with filters', async () => {
            await httpGet(api.app, '/exchange/orders?base=HIVE&quote=HBD&status=open');
            expect(mockStreamer._adapter.getExchangeOrders).toHaveBeenCalledWith({
                account: undefined,
                base: 'HIVE',
                quote: 'HBD',
                status: 'open',
            });
        });

        test('GET /exchange/orders/account/:account', async () => {
            await httpGet(api.app, '/exchange/orders/account/alice');
            expect(mockStreamer._adapter.getExchangeOrders).toHaveBeenCalledWith({ account: 'alice' });
        });

        test('GET /exchange/trades with filters', async () => {
            await httpGet(api.app, '/exchange/trades?base=HIVE&quote=HBD');
            expect(mockStreamer._adapter.getExchangeTrades).toHaveBeenCalledWith({
                account: undefined,
                base: 'HIVE',
                quote: 'HBD',
            });
        });

        test('GET /exchange/orderbook', async () => {
            await httpGet(api.app, '/exchange/orderbook?limit=10');
            expect(mockStreamer._adapter.getExchangeOrderBookSnapshots).toHaveBeenCalledWith({
                base: undefined,
                quote: undefined,
                limit: 10,
            });
        });

        test('GET /exchange/orderbook/:base/:quote', async () => {
            await httpGet(api.app, '/exchange/orderbook/HIVE/HBD?limit=5');
            expect(mockStreamer._adapter.getExchangeOrderBookSnapshots).toHaveBeenCalledWith({
                base: 'HIVE',
                quote: 'HBD',
                limit: 5,
            });
        });
    });

    describe('Exchange routes return 501 when adapter throws', () => {
        test('GET /exchange/balances returns 501', async () => {
            mockStreamer._adapter.getExchangeBalances.mockRejectedValue(new Error('not supported'));
            const res = await httpGet(api.app, '/exchange/balances');
            expect(res.status).toBe(501);
            expect(res.body.error).toContain('SQL-capable adapter');
        });
    });

    describe('Error handling', () => {
        test('returns 500 when route handler throws', async () => {
            mockStreamer._adapter.getTransfers.mockRejectedValue(new Error('db error'));
            const res = await httpGet(api.app, '/transfers');
            expect(res.status).toBe(500);
            expect(res.body.error).toBe('Internal server error');
        });
    });
});
