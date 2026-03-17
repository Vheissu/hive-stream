import { TimeAction } from './../actions';
import { ContractPayload, TransferMetadata, CustomJsonMetadata } from './../types/hive-stream';
import { AdapterBase } from './base.adapter';

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
            await this.db.schema.createTableIfNotExists('params', table => {
                table.integer('id').primary();
                table.integer('lastBlockNumber');
                table.text('actions');
            });

            await this.db.schema.createTableIfNotExists('transfers', table => {
                table.text('id').primary();
                table.text('blockId');
                table.integer('blockNumber');
                table.text('sender');
                table.text('amount');
                table.text('contractName');
                table.text('contractAction');
                table.text('contractPayload');
            });

            await this.db.schema.createTableIfNotExists('customJson', table => {
                table.text('id').primary();
                table.text('blockId');
                table.integer('blockNumber');
                table.text('sender');
                table.integer('isSignedWithActiveKey');
                table.text('contractName');
                table.text('contractAction');
                table.text('contractPayload');
            });

            await this.db.schema.createTableIfNotExists('events', table => {
                table.increments('id').primary();
                table.text('date');
                table.text('contract');
                table.text('action');
                table.text('payload');
                table.text('data');
            });

            return true;
        } catch (error) {
            console.error('[SqliteAdapter] Error creating tables:', error);
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
                        console.warn(`[SqliteAdapter] Failed to restore action ${actionData?.id || 'unknown'}:`, error);
                        return null;
                    }
                }).filter(Boolean) as TimeAction[];
            } catch (error) {
                console.error('[SqliteAdapter] Error loading actions:', error);
                return [];
            }
        }

        return [];
    }

    public async loadState(): Promise<any> {
        try {
            const row = await this.db('params')
                .select('actions', 'lastBlockNumber')
                .first();

            if (row) {
                try {
                    row.actions = row.actions ? JSON.parse(row.actions) : [];
                } catch (parseError) {
                    console.warn('[SqliteAdapter] Failed to parse actions from database, using empty array:', parseError);
                    row.actions = [];
                }
                return row;
            }
            
            return null;
        } catch (error) {
            console.error('[SqliteAdapter] Error loading state:', error);
            throw error;
        }
    }

    public async saveState(data: any): Promise<boolean> {
        try {
            let actionsJson: string;
            try {
                actionsJson = JSON.stringify(data.actions || []);
            } catch (error) {
                console.error('[SqliteAdapter] Failed to serialize actions:', error);
                actionsJson = '[]';
            }

            await this.db('params')
                .insert({
                    id: 1,
                    actions: actionsJson,
                    lastBlockNumber: data.lastBlockNumber
                })
                .onConflict('id')
                .merge();

            return true;
        } catch (error) {
            console.error('[SqliteAdapter] Error saving state:', error);
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
                id: metadata.transactionId || this.transactionId,
                blockId: metadata.blockId || this.blockId,
                blockNumber: metadata.blockNumber || this.blockNumber,
                sender: metadata.sender,
                amount: metadata.amount,
                contractName: payload.contract,
                contractAction: payload.action,
                contractPayload: JSON.stringify(payload.payload)
            });
            
            return true;
        } catch (error) {
            console.error('[SqliteAdapter] Error processing transfer:', error);
            throw error;
        }
    }

    public async processCustomJson(operation: any, payload: ContractPayload, metadata: CustomJsonMetadata): Promise<boolean> {
        try {
            await this.db('customJson').insert({
                id: metadata.transactionId || this.transactionId,
                blockId: metadata.blockId || this.blockId,
                blockNumber: metadata.blockNumber || this.blockNumber,
                sender: metadata.sender,
                isSignedWithActiveKey: metadata.isSignedWithActiveKey ? 1 : 0,
                contractName: payload.contract,
                contractAction: payload.action,
                contractPayload: JSON.stringify(payload.payload)
            });
            
            return true;
        } catch (error) {
            console.error('[SqliteAdapter] Error processing custom JSON:', error);
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
            console.error('[SqliteAdapter] Error adding event:', error);
            throw error;
        }
    }

    public async getTransfers() {
        try {
            const rows = await this.db('transfers')
                .select('id', 'blockId', 'blockNumber', 'sender', 'amount', 'contractName', 'contractAction', 'contractPayload');
            
            if (rows.length) {
                return rows.map(row => ({
                    ...row,
                    contractPayload: JSON.parse(row.contractPayload) ?? {}
                }));
            }

            return [];
        } catch (error) {
            console.error('[SqliteAdapter] Error getting transfers:', error);
            throw error;
        }
    }

    public async getEvents() {
        try {
            const rows = await this.db('events')
                .select('id', 'date', 'contract', 'action', 'payload', 'data');
            
            if (rows.length) {
                return rows.map(row => ({
                    ...row,
                    payload: JSON.parse(row.payload) ?? {},
                    data: JSON.parse(row.data) ?? {}
                }));
            }

            return [];
        } catch (error) {
            console.error('[SqliteAdapter] Error getting events:', error);
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
            console.error('[SqliteAdapter] Error getting events by contract:', error);
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
            console.error('[SqliteAdapter] Error getting events by account:', error);
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
            console.error('[SqliteAdapter] Error getting transfers by contract:', error);
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
            console.error('[SqliteAdapter] Error getting transfers by account:', error);
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
            console.error('[SqliteAdapter] Error getting transfers by blockId:', error);
            throw error;
        }
    }

    public async getJson() {
        try {
            const rows = await this.db('customJson')
                .select('id', 'blockId', 'blockNumber', 'sender', 'isSignedWithActiveKey', 'contractName', 'contractAction', 'contractPayload');
            
            if (rows.length) {
                return rows.map(row => ({
                    ...row,
                    contractPayload: JSON.parse(row.contractPayload) ?? {}
                }));
            }

            return [];
        } catch (error) {
            console.error('[SqliteAdapter] Error getting JSON:', error);
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
            console.error('[SqliteAdapter] Error getting JSON by contract:', error);
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
            console.error('[SqliteAdapter] Error getting JSON by account:', error);
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
            console.error('[SqliteAdapter] Error getting JSON by blockId:', error);
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
            console.error('[SqliteAdapter] Error getting exchange balances:', error);
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
            console.error('[SqliteAdapter] Error getting exchange orders:', error);
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
            console.error('[SqliteAdapter] Error getting exchange trades:', error);
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
            console.error('[SqliteAdapter] Error getting exchange order book snapshots:', error);
            throw error;
        }
    }

    public async destroy(): Promise<boolean> {
        try {
            await this.db.destroy();
            return true;
        } catch (error) {
            console.error('[SqliteAdapter] Error destroying database connection:', error);
            throw error;
        }
    }

    public async find(table: string, query: Record<string, any>) {
        try {
            const rows = await this.db(table).where(query);
            return rows.length ? rows : [];
        } catch (error) {
            console.error(`[SqliteAdapter] Error finding in table ${table}:`, error);
            throw error;
        }
    }

    public async findOne(table: string, query: Record<string, any>) {
        try {
            const row = await this.db(table).where(query).first();
            return row || null;
        } catch (error) {
            console.error(`[SqliteAdapter] Error finding one in table ${table}:`, error);
            throw error;
        }
    }

    public async insert(table: string, data: any) {
        try {
            await this.db(table).insert(data);
            return true;
        } catch (error) {
            console.error(`[SqliteAdapter] Error inserting into table ${table}:`, error);
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
            console.error(`[SqliteAdapter] Error replacing in table ${table}:`, error);
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

    public async query(sql: string, params?: any[]): Promise<any[]> {
        try {
            const result = await this.db.raw(sql, params);
            return result || [];
        } catch (error) {
            console.error('[SqliteAdapter] Error executing raw query:', error);
            throw error;
        }
    }
}
