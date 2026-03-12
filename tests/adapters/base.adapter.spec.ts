import { AdapterBase } from '../../src/adapters/base.adapter';

describe('AdapterBase', () => {
    let adapter: AdapterBase;

    beforeEach(() => {
        adapter = new AdapterBase();
    });

    describe('constructor', () => {
        test('initializes with null client and db', () => {
            expect(adapter['client']).toBeNull();
            expect(adapter['db']).toBeNull();
        });

        test('capabilities.sql is false', () => {
            expect(adapter.capabilities.sql).toBe(false);
        });
    });

    describe('lifecycle methods', () => {
        test('create() returns true', async () => {
            expect(await adapter.create()).toBe(true);
        });

        test('destroy() returns true', async () => {
            expect(await adapter.destroy()).toBe(true);
        });
    });

    describe('state methods', () => {
        test('loadActions() returns empty array', async () => {
            expect(await adapter.loadActions()).toEqual([]);
        });

        test('loadState() throws not implemented', async () => {
            await expect(adapter.loadState()).rejects.toThrow('not implemented');
        });

        test('saveState() throws not implemented', async () => {
            await expect(adapter.saveState({ lastBlockNumber: 1 })).rejects.toThrow('not implemented');
        });
    });

    describe('block processing', () => {
        test('processBlock() returns true', async () => {
            expect(await adapter.processBlock({} as any)).toBe(true);
        });

        test('processOperation() returns true', async () => {
            expect(await adapter.processOperation(
                ['transfer', {}], 1, 'block-1', 'block-0', 'trx-1', new Date()
            )).toBe(true);
        });
    });

    describe('operation persistence', () => {
        test('processTransfer() returns true (no-op)', async () => {
            expect(await adapter.processTransfer(
                {}, { contract: 'test', action: 'test', payload: {} }, { transactionId: 'trx-1' } as any
            )).toBe(true);
        });

        test('processCustomJson() returns true (no-op)', async () => {
            expect(await adapter.processCustomJson(
                {}, { contract: 'test', action: 'test', payload: {} }, { sender: 'alice' } as any
            )).toBe(true);
        });

        test('processEscrow() returns true (no-op)', async () => {
            expect(await adapter.processEscrow(
                'escrow_transfer', {}, {} as any
            )).toBe(true);
        });
    });

    describe('data access methods', () => {
        test('find() returns empty array', async () => {
            expect(await adapter.find('table', { key: 'value' })).toEqual([]);
        });

        test('findOne() returns null', async () => {
            expect(await adapter.findOne('table', { key: 'value' })).toBeNull();
        });

        test('insert() returns true', async () => {
            expect(await adapter.insert('table', { key: 'value' })).toBe(true);
        });

        test('replace() returns the data', async () => {
            const data = { key: 'newValue' };
            expect(await adapter.replace('table', { key: 'value' }, data)).toBe(data);
        });
    });

    describe('transaction support', () => {
        test('runInTransaction() passes through to work function', async () => {
            const work = jest.fn().mockResolvedValue('result');
            const result = await adapter.runInTransaction(work);

            expect(result).toBe('result');
            expect(work).toHaveBeenCalledWith(adapter);
        });
    });

    describe('query method', () => {
        test('throws not implemented', async () => {
            await expect(adapter.query('SELECT 1')).rejects.toThrow('not implemented');
        });
    });

    describe('event methods', () => {
        test('addEvent() returns true', async () => {
            expect(await adapter.addEvent(new Date(), 'contract', 'action', {}, {})).toBe(true);
        });

        test('getEvents() returns empty array', async () => {
            expect(await adapter.getEvents()).toEqual([]);
        });

        test('getEventsByContract() returns empty array', async () => {
            expect(await adapter.getEventsByContract('token')).toEqual([]);
        });

        test('getEventsByAccount() returns empty array', async () => {
            expect(await adapter.getEventsByAccount('alice')).toEqual([]);
        });
    });

    describe('exchange methods', () => {
        test('getExchangeBalances() returns empty array', async () => {
            expect(await adapter.getExchangeBalances()).toEqual([]);
            expect(await adapter.getExchangeBalances('alice')).toEqual([]);
        });

        test('getExchangeOrders() returns empty array', async () => {
            expect(await adapter.getExchangeOrders()).toEqual([]);
            expect(await adapter.getExchangeOrders({ account: 'alice', status: 'open' })).toEqual([]);
        });

        test('getExchangeTrades() returns empty array', async () => {
            expect(await adapter.getExchangeTrades()).toEqual([]);
        });

        test('getExchangeOrderBookSnapshots() returns empty array', async () => {
            expect(await adapter.getExchangeOrderBookSnapshots()).toEqual([]);
        });
    });
});
