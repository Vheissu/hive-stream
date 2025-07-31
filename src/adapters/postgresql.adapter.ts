import { TimeAction } from './../actions';
import { ContractPayload, TransferMetadata, CustomJsonMetadata } from './../types/hive-stream';
import { AdapterBase } from './base.adapter';

import { Knex, knex } from 'knex';

export interface PostgreSQLConfig {
    host?: string;
    port?: number;
    user?: string;
    password?: string;
    database?: string;
    ssl?: boolean | object;
    connectionString?: string;
}

export class PostgreSQLAdapter extends AdapterBase {
    public declare db: Knex;
    private config: PostgreSQLConfig;
    
    constructor(config: PostgreSQLConfig) {
        super();
        this.config = config;
        
        // Support both individual config and connection string
        const connection = config.connectionString ? {
            connectionString: config.connectionString,
            ssl: config.ssl || false
        } : {
            host: config.host || 'localhost',
            port: config.port || 5432,
            user: config.user || 'postgres',
            password: config.password,
            database: config.database || 'hive_stream',
            ssl: config.ssl || false
        };

        this.db = knex({
            client: 'pg',
            connection,
            pool: {
                min: 2,
                max: 10,
                acquireTimeoutMillis: 30000,
                idleTimeoutMillis: 30000
            },
            migrations: {
                tableName: 'knex_migrations'
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
                table.bigInteger('lastBlockNumber');
                table.text('actions');
            });

            await this.db.schema.createTableIfNotExists('transfers', table => {
                table.text('id').primary();
                table.text('blockId');
                table.bigInteger('blockNumber');
                table.text('sender');
                table.text('amount');
                table.text('contractName');
                table.text('contractAction');
                table.text('contractPayload');
                table.timestamp('created_at').defaultTo(this.db.fn.now());
                
                // Add indexes for common queries
                table.index(['sender']);
                table.index(['contractName']);
                table.index(['blockNumber']);
                table.index(['blockId']);
            });

            await this.db.schema.createTableIfNotExists('customJson', table => {
                table.text('id').primary();
                table.text('blockId');
                table.bigInteger('blockNumber');
                table.text('sender');
                table.integer('isSignedWithActiveKey');
                table.text('contractName');
                table.text('contractAction');
                table.text('contractPayload');
                table.timestamp('created_at').defaultTo(this.db.fn.now());
                
                // Add indexes for common queries
                table.index(['sender']);
                table.index(['contractName']);
                table.index(['blockNumber']);
                table.index(['blockId']);
            });

            await this.db.schema.createTableIfNotExists('events', table => {
                table.increments('id').primary();
                table.timestamp('date').defaultTo(this.db.fn.now());
                table.text('contract');
                table.text('action');
                table.text('payload');
                table.text('data');
                
                // Add indexes for common queries
                table.index(['contract']);
                table.index(['action']);
                table.index(['date']);
            });

            return true;
        } catch (error) {
            console.error('[PostgreSQLAdapter] Error creating tables:', error);
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
                        console.warn(`[PostgreSQLAdapter] Failed to restore action ${actionData?.id || 'unknown'}:`, error);
                        return null;
                    }
                }).filter(Boolean) as TimeAction[];
            } catch (error) {
                console.error('[PostgreSQLAdapter] Error loading actions:', error);
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
                    console.warn('[PostgreSQLAdapter] Failed to parse actions from database, using empty array:', parseError);
                    row.actions = [];
                }
                return row;
            }
            
            return null;
        } catch (error) {
            console.error('[PostgreSQLAdapter] Error loading state:', error);
            throw error;
        }
    }

    public async saveState(data: any): Promise<boolean> {
        try {
            let actionsJson: string;
            try {
                actionsJson = JSON.stringify(data.actions || []);
            } catch (error) {
                console.error('[PostgreSQLAdapter] Failed to serialize actions:', error);
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
            console.error('[PostgreSQLAdapter] Error saving state:', error);
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
                id: this.transactionId,
                blockId: this.blockId,
                blockNumber: this.blockNumber,
                sender: metadata.sender,
                amount: metadata.amount,
                contractName: payload.name,
                contractAction: payload.action,
                contractPayload: JSON.stringify(payload.payload)
            });
            
            return true;
        } catch (error) {
            console.error('[PostgreSQLAdapter] Error processing transfer:', error);
            throw error;
        }
    }

    public async processCustomJson(operation: any, payload: ContractPayload, metadata: CustomJsonMetadata): Promise<boolean> {
        try {
            await this.db('customJson').insert({
                id: this.transactionId,
                blockId: this.blockId,
                blockNumber: this.blockNumber,
                sender: metadata.sender,
                isSignedWithActiveKey: metadata.isSignedWithActiveKey ? 1 : 0,
                contractName: payload.name,
                contractAction: payload.action,
                contractPayload: JSON.stringify(payload.payload)
            });
            
            return true;
        } catch (error) {
            console.error('[PostgreSQLAdapter] Error processing custom JSON:', error);
            throw error;
        }
    }

    public async addEvent(date: string, contract: string, action: string, payload: ContractPayload, data: unknown): Promise<boolean> {
        try {
            await this.db('events').insert({
                date: new Date(date),
                contract,
                action,
                payload: JSON.stringify(payload),
                data: JSON.stringify(data)
            });
            
            return true;
        } catch (error) {
            console.error('[PostgreSQLAdapter] Error adding event:', error);
            throw error;
        }
    }

    public async getTransfers() {
        try {
            const rows = await this.db('transfers')
                .select('id', 'blockId', 'blockNumber', 'sender', 'amount', 'contractName', 'contractAction', 'contractPayload')
                .orderBy('blockNumber', 'desc');
            
            if (rows.length) {
                return rows.map(row => ({
                    ...row,
                    contractPayload: JSON.parse(row.contractPayload) ?? {}
                }));
            }
            
            return null;
        } catch (error) {
            console.error('[PostgreSQLAdapter] Error getting transfers:', error);
            throw error;
        }
    }

    public async getEvents() {
        try {
            const rows = await this.db('events')
                .select('id', 'date', 'contract', 'action', 'payload', 'data')
                .orderBy('date', 'desc');
            
            if (rows.length) {
                return rows.map(row => ({
                    ...row,
                    payload: JSON.parse(row.payload) ?? {},
                    data: JSON.parse(row.data) ?? {}
                }));
            }
            
            return null;
        } catch (error) {
            console.error('[PostgreSQLAdapter] Error getting events:', error);
            throw error;
        }
    }

    public async getTransfersByContract(contract: string) {
        try {
            const rows = await this.db('transfers')
                .select('id', 'blockId', 'blockNumber', 'sender', 'amount', 'contractName', 'contractAction', 'contractPayload')
                .where('contractName', contract)
                .orderBy('blockNumber', 'desc');
            
            if (rows.length) {
                return rows.map(row => ({
                    ...row,
                    contractPayload: JSON.parse(row.contractPayload) ?? {}
                }));
            }
            
            return null;
        } catch (error) {
            console.error('[PostgreSQLAdapter] Error getting transfers by contract:', error);
            throw error;
        }
    }

    public async getTransfersByAccount(account: string) {
        try {
            const rows = await this.db('transfers')
                .select('id', 'blockId', 'blockNumber', 'sender', 'amount', 'contractName', 'contractAction', 'contractPayload')
                .where('sender', account)
                .orderBy('blockNumber', 'desc');
            
            if (rows.length) {
                return rows.map(row => ({
                    ...row,
                    contractPayload: JSON.parse(row.contractPayload) ?? {}
                }));
            }
            
            return null;
        } catch (error) {
            console.error('[PostgreSQLAdapter] Error getting transfers by account:', error);
            throw error;
        }
    }

    public async getTransfersByBlockid(blockId: any) {
        try {
            const rows = await this.db('transfers')
                .select('id', 'blockId', 'blockNumber', 'sender', 'amount', 'contractName', 'contractAction', 'contractPayload')
                .where('blockId', blockId)
                .orderBy('blockNumber', 'desc');
            
            if (rows.length) {
                return rows.map(row => ({
                    ...row,
                    contractPayload: JSON.parse(row.contractPayload) ?? {}
                }));
            }
            
            return null;
        } catch (error) {
            console.error('[PostgreSQLAdapter] Error getting transfers by blockId:', error);
            throw error;
        }
    }

    public async getJson() {
        try {
            const rows = await this.db('customJson')
                .select('id', 'blockId', 'blockNumber', 'sender', 'isSignedWithActiveKey', 'contractName', 'contractAction', 'contractPayload')
                .orderBy('blockNumber', 'desc');
            
            if (rows.length) {
                return rows.map(row => ({
                    ...row,
                    contractPayload: JSON.parse(row.contractPayload) ?? {}
                }));
            }
            
            return null;
        } catch (error) {
            console.error('[PostgreSQLAdapter] Error getting JSON:', error);
            throw error;
        }
    }

    public async getJsonByContract(contract: string) {
        try {
            const rows = await this.db('customJson')
                .select('id', 'blockId', 'blockNumber', 'sender', 'isSignedWithActiveKey', 'contractName', 'contractAction', 'contractPayload')
                .where('contractName', contract)
                .orderBy('blockNumber', 'desc');
            
            if (rows.length) {
                return rows.map(row => ({
                    ...row,
                    contractPayload: JSON.parse(row.contractPayload) ?? {}
                }));
            }
            
            return null;
        } catch (error) {
            console.error('[PostgreSQLAdapter] Error getting JSON by contract:', error);
            throw error;
        }
    }

    public async getJsonByAccount(account: string) {
        try {
            const rows = await this.db('customJson')
                .select('id', 'blockId', 'blockNumber', 'sender', 'isSignedWithActiveKey', 'contractName', 'contractAction', 'contractPayload')
                .where('sender', account)
                .orderBy('blockNumber', 'desc');
            
            if (rows.length) {
                return rows.map(row => ({
                    ...row,
                    contractPayload: JSON.parse(row.contractPayload) ?? {}
                }));
            }
            
            return null;
        } catch (error) {
            console.error('[PostgreSQLAdapter] Error getting JSON by account:', error);
            throw error;
        }
    }

    public async getJsonByBlockid(blockId: any) {
        try {
            const rows = await this.db('customJson')
                .select('id', 'blockId', 'blockNumber', 'sender', 'isSignedWithActiveKey', 'contractName', 'contractAction', 'contractPayload')
                .where('blockId', blockId)
                .orderBy('blockNumber', 'desc');
            
            if (rows.length) {
                return rows.map(row => ({
                    ...row,
                    contractPayload: JSON.parse(row.contractPayload) ?? {}
                }));
            }
            
            return null;
        } catch (error) {
            console.error('[PostgreSQLAdapter] Error getting JSON by blockId:', error);
            throw error;
        }
    }

    public async destroy(): Promise<boolean> {
        try {
            await this.db.destroy();
            return true;
        } catch (error) {
            console.error('[PostgreSQLAdapter] Error destroying database connection:', error);
            throw error;
        }
    }

    public async find(table: string, query: Record<string, any>) {
        try {
            const rows = await this.db(table).where(query);
            return rows.length ? rows : null;
        } catch (error) {
            console.error(`[PostgreSQLAdapter] Error finding in table ${table}:`, error);
            throw error;
        }
    }

    public async findOne(table: string, query: Record<string, any>) {
        try {
            const row = await this.db(table).where(query).first();
            return row || null;
        } catch (error) {
            console.error(`[PostgreSQLAdapter] Error finding one in table ${table}:`, error);
            throw error;
        }
    }

    public async insert(table: string, data: any) {
        try {
            await this.db(table).insert(data);
            return true;
        } catch (error) {
            console.error(`[PostgreSQLAdapter] Error inserting into table ${table}:`, error);
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
            console.error(`[PostgreSQLAdapter] Error replacing in table ${table}:`, error);
            throw error;
        }
    }

    public async query(sql: string, params?: any[]): Promise<any[]> {
        try {
            const result = await this.db.raw(sql, params);
            // PostgreSQL returns results in result.rows
            return result.rows || [];
        } catch (error) {
            console.error('[PostgreSQLAdapter] Error executing raw query:', error);
            throw error;
        }
    }
}