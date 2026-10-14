import { getLogger } from '../logger';
import { TimeAction } from './../actions';
import { ContractPayload, TransferMetadata, CustomJsonMetadata, ProcessedOperationRecord, operationRecordId } from './../types/hive-stream';
import { AdapterBase, ListOptions, RecordCounts } from './base.adapter';

import { Knex, knex } from 'knex';
import path from 'path';

export class SqliteAdapter extends AdapterBase {
    public declare db: Knex;
    public override readonly capabilities = {
        sql: true
    };
    private dbPath: string;
    
    constructor(dbPath?: string) {
        super();
        this.dbPath = dbPath || path.resolve(process.cwd(), 'hive-stream.db');
        this.db = knex({
            client: 'better-sqlite3',
            connection: {
                filename: this.dbPath
            },
            useNullAsDefault: true,
            pool: {
                afterCreate: (conn: any, cb: any) => {
                    conn.pragma('journal_mode = WAL');
                    cb();
                }
            }
        });
    }

    private blockNumber: number;
    private lastBlockNumber: number;
    private blockId: string;
    private prevBlockId: string;
    private transactionId: string;

    public getDb(): Knex {
        return this.db;
    }

    public async create(): Promise<boolean> {
        try {
            if (!await this.db.schema.hasTable('params')) {
                await this.db.schema.createTable('params', table => {
                    table.integer('id').primary();
                    table.integer('lastBlockNumber');
                    table.text('actions');
                    table.text('lastBlockId');
                });
            } else if (!await this.db.schema.hasColumn('params', 'lastBlockId')) {
                await this.db.schema.alterTable('params', table => {
                    table.text('lastBlockId');
                });
            }

            if (!await this.db.schema.hasTable('processed_operations')) {
                await this.db.schema.createTable('processed_operations', table => {
                    table.text('key').primary();
                    table.integer('blockNumber').index();
                    table.text('transactionId');
                    table.integer('operationIndex');
                    table.text('contract');
                    table.text('action');
                    table.text('status');
                    table.text('processedAt');
                });
            }

            if (!await this.db.schema.hasTable('transfers')) {
                await this.db.schema.createTable('transfers', table => {
                    table.text('id').primary();
                    table.text('blockId');
                    table.integer('blockNumber');
                    table.text('sender');
                    table.text('amount');
                    table.text('contractName');
                    table.text('contractAction');
                    table.text('contractPayload');
                });
            }

            if (!await this.db.schema.hasTable('customJson')) {
                await this.db.schema.createTable('customJson', table => {
                    table.text('id').primary();
                    table.text('blockId');
                    table.integer('blockNumber');
                    table.text('sender');
                    table.integer('isSignedWithActiveKey');
                    table.text('contractName');
                    table.text('contractAction');
                    table.text('contractPayload');
                });
            }

            if (!await this.db.schema.hasTable('events')) {
                await this.db.schema.createTable('events', table => {
                    table.increments('id').primary();
                    table.text('date');
                    table.text('contract');
                    table.text('action');
                    table.text('payload');
                    table.text('data');
                });
            }

            return true;
        } catch (error) {
            getLogger().error('[SqliteAdapter] Error creating tables:', error);
            throw error;
        }
    }
    

    public async loadActions(): Promise<TimeAction[]> {
        const state = await this.loadState();

        if (state && state.actions) {
            try {
                return state.actions.map((actionData: any) => {
                    try {
                        return TimeAction.fromJSON(actionData);
                    } catch (error) {
                        getLogger().warn(`[SqliteAdapter] Failed to restore action ${actionData?.id || 'unknown'}:`, error);
                        return null;
                    }
                }).filter(Boolean) as TimeAction[];
            } catch (error) {
                getLogger().error('[SqliteAdapter] Error loading actions:', error);
                return [];
            }
        }

        return [];
    }

    public async loadState(): Promise<any> {
        try {
            const row = await this.db('params')
                .select('actions', 'lastBlockNumber', 'lastBlockId')
                .first();

            if (row) {
                try {
                    row.actions = row.actions ? JSON.parse(row.actions) : [];
                } catch (parseError) {
                    getLogger().warn('[SqliteAdapter] Failed to parse actions from database, using empty array:', parseError);
                    row.actions = [];
                }
                return row;
            }
            
            return null;
        } catch (error) {
            getLogger().error('[SqliteAdapter] Error loading state:', error);
            throw error;
        }
    }

    public async saveState(data: any): Promise<boolean> {
        try {
            let actionsJson: string;
            try {
                actionsJson = JSON.stringify(data.actions || []);
            } catch (error) {
                getLogger().error('[SqliteAdapter] Failed to serialize actions:', error);
                actionsJson = '[]';
            }

            await this.db('params')
                .insert({
                    id: 1,
                    actions: actionsJson,
                    lastBlockNumber: data.lastBlockNumber,
                    lastBlockId: data.lastBlockId ?? null
                })
                .onConflict('id')
                .merge();

            return true;
        } catch (error) {
            getLogger().error('[SqliteAdapter] Error saving state:', error);
            throw error;
        }
    }

    public async processOperation(op: any, blockNumber: number, blockId: string, prevBlockId: string, trxId: string, blockTime: Date) {
        this.blockNumber = blockNumber;
        this.blockId = blockId;
        this.prevBlockId = prevBlockId;
        this.transactionId = trxId;
    }

    public async processTransfer(operation: any, payload: ContractPayload, metadata: TransferMetadata): Promise<boolean> {
        try {
            await this.db('transfers').insert({
                id: operationRecordId(metadata.transactionId || this.transactionId, metadata.operationIndex),
                blockId: metadata.blockId || this.blockId,
                blockNumber: metadata.blockNumber || this.blockNumber,
                sender: metadata.sender,
                amount: metadata.amount,
                contractName: payload.contract,
                contractAction: payload.action,
                contractPayload: JSON.stringify(payload.payload)
            }).onConflict('id').ignore();
            
            return true;
        } catch (error) {
            getLogger().error('[SqliteAdapter] Error processing transfer:', error);
            throw error;
        }
    }

    public async processCustomJson(operation: any, payload: ContractPayload, metadata: CustomJsonMetadata): Promise<boolean> {
        try {
            await this.db('customJson').insert({
                id: operationRecordId(metadata.transactionId || this.transactionId, metadata.operationIndex),
                blockId: metadata.blockId || this.blockId,
                blockNumber: metadata.blockNumber || this.blockNumber,
                sender: metadata.sender,
                isSignedWithActiveKey: metadata.isSignedWithActiveKey ? 1 : 0,
                contractName: payload.contract,
                contractAction: payload.action,
                contractPayload: JSON.stringify(payload.payload)
            }).onConflict('id').ignore();
            
            return true;
        } catch (error) {
            getLogger().error('[SqliteAdapter] Error processing custom JSON:', error);
            throw error;
        }
    }

    public async addEvent(date: string, contract: string, action: string, payload: ContractPayload, data: unknown): Promise<boolean> {
        try {
            await this.db('events').insert({
                date,
                contract,
                action,
                payload: JSON.stringify(payload),
                data: JSON.stringify(data)
            });
            
            return true;
        } catch (error) {
            getLogger().error('[SqliteAdapter] Error adding event:', error);
            throw error;
        }
    }

    public async getTransfers(options?: ListOptions) {
        try {
            const rows = await this.applyListOptions(this.db('transfers')
                .select('id', 'blockId', 'blockNumber', 'sender', 'amount', 'contractName', 'contractAction', 'contractPayload'), options);
            
            if (rows.length) {
                return rows.map(row => ({
                    ...row,
                    contractPayload: JSON.parse(row.contractPayload) ?? {}
                }));
            }

            return [];
        } catch (error) {
            getLogger().error('[SqliteAdapter] Error getting transfers:', error);
            throw error;
        }
    }

    public async getEvents(options?: ListOptions) {
        try {
            const rows = await this.applyListOptions(this.db('events')
                .select('id', 'date', 'contract', 'action', 'payload', 'data'), options);
            
            if (rows.length) {
                return rows.map(row => ({
                    ...row,
                    payload: JSON.parse(row.payload) ?? {},
                    data: JSON.parse(row.data) ?? {}
                }));
            }

            return [];
        } catch (error) {
            getLogger().error('[SqliteAdapter] Error getting events:', error);
            throw error;
        }
    }

    public async getEventsByContract(contract: string) {
        try {
            const rows = await this.db('events')
                .select('id', 'date', 'contract', 'action', 'payload', 'data')
                .where('contract', contract);
            
            if (rows.length) {
                return rows.map(row => ({
                    ...row,
                    payload: JSON.parse(row.payload) ?? {},
                    data: JSON.parse(row.data) ?? {}
                }));
            }

            return [];
        } catch (error) {
            getLogger().error('[SqliteAdapter] Error getting events by contract:', error);
            throw error;
        }
    }

    public async getEventsByAccount(account: string) {
        try {
            const rows = await this.db('events')
                .select('id', 'date', 'contract', 'action', 'payload', 'data')
                .where('data', 'like', `%"${account}"%`);
            
            if (rows.length) {
                return rows.map(row => ({
                    ...row,
                    payload: JSON.parse(row.payload) ?? {},
                    data: JSON.parse(row.data) ?? {}
                }));
            }

            return [];
        } catch (error) {
            getLogger().error('[SqliteAdapter] Error getting events by account:', error);
            throw error;
        }
    }

    public async getTransfersByContract(contract: string) {
        try {
            const rows = await this.db('transfers')
                .select('id', 'blockId', 'blockNumber', 'sender', 'amount', 'contractName', 'contractAction', 'contractPayload')
                .where('contractName', contract);
            
            if (rows.length) {
                return rows.map(row => ({
                    ...row,
                    contractPayload: JSON.parse(row.contractPayload) ?? {}
                }));
            }

            return [];
        } catch (error) {
            getLogger().error('[SqliteAdapter] Error getting transfers by contract:', error);
            throw error;
        }
    }

    public async getTransfersByAccount(account: string) {
        try {
            const rows = await this.db('transfers')
                .select('id', 'blockId', 'blockNumber', 'sender', 'amount', 'contractName', 'contractAction', 'contractPayload')
                .where('sender', account);
            
            if (rows.length) {
                return rows.map(row => ({
                    ...row,
                    contractPayload: JSON.parse(row.contractPayload) ?? {}
                }));
            }

            return [];
        } catch (error) {
            getLogger().error('[SqliteAdapter] Error getting transfers by account:', error);
            throw error;
        }
    }

    public async getTransfersByBlockid(blockId: any) {
        try {
            const rows = await this.db('transfers')
                .select('id', 'blockId', 'blockNumber', 'sender', 'amount', 'contractName', 'contractAction', 'contractPayload')
                .where('blockId', blockId);
            
            if (rows.length) {
                return rows.map(row => ({
                    ...row,
                    contractPayload: JSON.parse(row.contractPayload) ?? {}
                }));
            }

            return [];
        } catch (error) {
            getLogger().error('[SqliteAdapter] Error getting transfers by blockId:', error);
            throw error;
        }
    }

    public async getJson(options?: ListOptions) {
        try {
            const rows = await this.applyListOptions(this.db('customJson')
                .select('id', 'blockId', 'blockNumber', 'sender', 'isSignedWithActiveKey', 'contractName', 'contractAction', 'contractPayload'), options);
            
            if (rows.length) {
                return rows.map(row => ({
                    ...row,
                    contractPayload: JSON.parse(row.contractPayload) ?? {}
                }));
            }

            return [];
        } catch (error) {
            getLogger().error('[SqliteAdapter] Error getting JSON:', error);
            throw error;
        }
    }

    public async getJsonByContract(contract: string) {
        try {
            const rows = await this.db('customJson')
                .select('id', 'blockId', 'blockNumber', 'sender', 'isSignedWithActiveKey', 'contractName', 'contractAction', 'contractPayload')
                .where('contractName', contract);
            
            if (rows.length) {
                return rows.map(row => ({
                    ...row,
                    contractPayload: JSON.parse(row.contractPayload) ?? {}
                }));
            }

            return [];
        } catch (error) {
            getLogger().error('[SqliteAdapter] Error getting JSON by contract:', error);
            throw error;
        }
    }

    public async getJsonByAccount(account: string) {
        try {
            const rows = await this.db('customJson')
                .select('id', 'blockId', 'blockNumber', 'sender', 'isSignedWithActiveKey', 'contractName', 'contractAction', 'contractPayload')
                .where('sender', account);
            
            if (rows.length) {
                return rows.map(row => ({
                    ...row,
                    contractPayload: JSON.parse(row.contractPayload) ?? {}
                }));
            }

            return [];
        } catch (error) {
            getLogger().error('[SqliteAdapter] Error getting JSON by account:', error);
            throw error;
        }
    }

    public async getJsonByBlockid(blockId: any) {
        try {
            const rows = await this.db('customJson')
                .select('id', 'blockId', 'blockNumber', 'sender', 'isSignedWithActiveKey', 'contractName', 'contractAction', 'contractPayload')
                .where('blockId', blockId);
            
            if (rows.length) {
                return rows.map(row => ({
                    ...row,
                    contractPayload: JSON.parse(row.contractPayload) ?? {}
                }));
            }

            return [];
        } catch (error) {
            getLogger().error('[SqliteAdapter] Error getting JSON by blockId:', error);
            throw error;
        }
    }

    public async getExchangeBalances(account?: string) {
        try {
            const query = this.db('exchange_balances')
                .select('account', 'asset', 'available', 'locked');

            if (account) {
                query.where('account', account);
            }

            const rows = await query;
            return rows.length ? rows : [];
        } catch (error) {
            getLogger().error('[SqliteAdapter] Error getting exchange balances:', error);
            throw error;
        }
    }

    public async getExchangeOrders(filters: { account?: string; base?: string; quote?: string; status?: string } = {}) {
        try {
            const query = this.db('exchange_orders')
                .select('id', 'account', 'side', 'base_asset', 'quote_asset', 'price', 'amount', 'remaining', 'status', 'created_at');

            if (filters.account) {
                query.where('account', filters.account);
            }

            if (filters.base) {
                query.where('base_asset', filters.base);
            }

            if (filters.quote) {
                query.where('quote_asset', filters.quote);
            }

            if (filters.status) {
                query.where('status', filters.status);
            }

            const rows = await query;
            return rows.length ? rows : [];
        } catch (error) {
            getLogger().error('[SqliteAdapter] Error getting exchange orders:', error);
            throw error;
        }
    }

    public async getExchangeTrades(filters: { account?: string; base?: string; quote?: string } = {}) {
        try {
            const query = this.db('exchange_trades')
                .select('id', 'buy_order_id', 'sell_order_id', 'price', 'amount', 'base_asset', 'quote_asset', 'buyer', 'seller', 'created_at');

            if (filters.account) {
                query.where(builder => {
                    builder.where('buyer', filters.account).orWhere('seller', filters.account);
                });
            }

            if (filters.base) {
                query.where('base_asset', filters.base);
            }

            if (filters.quote) {
                query.where('quote_asset', filters.quote);
            }

            const rows = await query;
            return rows.length ? rows : [];
        } catch (error) {
            getLogger().error('[SqliteAdapter] Error getting exchange trades:', error);
            throw error;
        }
    }

    public async getExchangeOrderBookSnapshots(filters: { base?: string; quote?: string; limit?: number } = {}) {
        try {
            const query = this.db('exchange_orderbook_snapshots')
                .select('id', 'base_asset', 'quote_asset', 'bids', 'asks', 'created_at')
                .orderBy('created_at', 'desc');

            if (filters.base) {
                query.where('base_asset', filters.base);
            }

            if (filters.quote) {
                query.where('quote_asset', filters.quote);
            }

            if (filters.limit) {
                query.limit(filters.limit);
            }

            const rows = await query;
            if (rows.length) {
                return rows.map(row => ({
                    ...row,
                    bids: JSON.parse(row.bids) ?? [],
                    asks: JSON.parse(row.asks) ?? []
                }));
            }

            return [];
        } catch (error) {
            getLogger().error('[SqliteAdapter] Error getting exchange order book snapshots:', error);
            throw error;
        }
    }

    public async destroy(): Promise<boolean> {
        try {
            await this.db.destroy();
            return true;
        } catch (error) {
            getLogger().error('[SqliteAdapter] Error destroying database connection:', error);
            throw error;
        }
    }

    public async find(table: string, query: Record<string, any>) {
        try {
            const rows = await this.db(table).where(query);
            return rows.length ? rows : [];
        } catch (error) {
            getLogger().error(`[SqliteAdapter] Error finding in table ${table}:`, error);
            throw error;
        }
    }

    public async findOne(table: string, query: Record<string, any>) {
        try {
            const row = await this.db(table).where(query).first();
            return row || null;
        } catch (error) {
            getLogger().error(`[SqliteAdapter] Error finding one in table ${table}:`, error);
            throw error;
        }
    }

    public async insert(table: string, data: any) {
        try {
            await this.db(table).insert(data);
            return true;
        } catch (error) {
            getLogger().error(`[SqliteAdapter] Error inserting into table ${table}:`, error);
            throw error;
        }
    }

    public async replace(table: string, queryObject: Record<string, any>, data: any): Promise<any> {
        try {
            await this.db(table)
                .insert(data)
                .onConflict(Object.keys(queryObject))
                .merge();
            return data;
        } catch (error) {
            getLogger().error(`[SqliteAdapter] Error replacing in table ${table}:`, error);
            throw error;
        }
    }

    public async runInTransaction<T>(work: (adapter: AdapterBase) => Promise<T>): Promise<T> {
        return this.db.transaction(async (trx) => {
            const transactionAdapter = Object.create(this) as SqliteAdapter;
            transactionAdapter.db = trx as unknown as Knex;
            return work(transactionAdapter);
        });
    }


    private applyListOptions(query: any, options?: ListOptions) {
        if (options?.limit !== undefined) {
            query = query.limit(options.limit);
        }

        if (options?.offset !== undefined) {
            query = query.offset(options.offset);
        }

        return query;
    }

    public async getCounts(): Promise<RecordCounts> {
        const [transfers, customJson, events] = await Promise.all([
            this.db('transfers').count({ count: '*' }).first(),
            this.db('customJson').count({ count: '*' }).first(),
            this.db('events').count({ count: '*' }).first()
        ]);

        return {
            transfers: Number(transfers?.count ?? 0),
            customJson: Number(customJson?.count ?? 0),
            events: Number(events?.count ?? 0)
        };
    }

    public async hasProcessedOperation(key: string): Promise<boolean> {
        const row = await this.db('processed_operations').where({ key }).first('key');
        return Boolean(row);
    }

    public async markOperationProcessed(record: ProcessedOperationRecord): Promise<void> {
        await this.db('processed_operations')
            .insert({
                key: record.key,
                blockNumber: record.blockNumber,
                transactionId: record.transactionId ?? null,
                operationIndex: record.operationIndex ?? null,
                contract: record.contract ?? null,
                action: record.action ?? null,
                status: record.status,
                processedAt: (record.processedAt ?? new Date()).toISOString()
            })
            .onConflict('key')
            .ignore();
    }

    public async pruneProcessedOperations(beforeBlockNumber: number): Promise<number> {
        const removed = await this.db('processed_operations')
            .where('blockNumber', '<', beforeBlockNumber)
            .delete();

        return Number(removed) || 0;
    }

    public async query(sql: string, params?: any[]): Promise<any[]> {
        try {
            const result = await this.db.raw(sql, params);
            return result || [];
        } catch (error) {
            getLogger().error('[SqliteAdapter] Error executing raw query:', error);
            throw error;
        }
    }
}
