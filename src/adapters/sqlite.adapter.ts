import { TimeAction } from './../actions';
import { ContractPayload, TransferMetadata, CustomJsonMetadata } from './../types/hive-stream';
import { AdapterBase } from './base.adapter';

import { Database } from 'sqlite3';

import path from 'path';

export class SqliteAdapter extends AdapterBase {
    public declare db: Database;
    private dbPath: string;
    
    constructor(dbPath?: string) {
        super();
        this.dbPath = dbPath || path.resolve(__dirname, 'hive-stream.db');
        this.db = new Database(this.dbPath);
    }
    
    // Performance optimization: prepared statements cache
    private preparedStatements: Map<string, any> = new Map();
    private batchOperations: Array<{sql: string, params: any[]}> = [];
    private batchTimeout: NodeJS.Timeout | null = null;
    private readonly batchSize = 100;
    private readonly batchDelayMs = 1000;

    private blockNumber: number;
    private lastBlockNumber: number;
    private blockId: string;
    private prevBlockId;
    private transactionId: string;

    public getDb(): Database {
        return this.db;
    }

    public async create(): Promise<boolean> {
        return new Promise((resolve) => {
            this.db.serialize(() => {
                const params = `CREATE TABLE IF NOT EXISTS params ( id INTEGER PRIMARY KEY, lastBlockNumber NUMERIC, actions TEXT )`;
                const transfers = `CREATE TABLE IF NOT EXISTS transfers ( id TEXT NOT NULL UNIQUE, blockId TEXT, blockNumber INTEGER, sender TEXT, amount TEXT, contractName TEXT, contractAction TEXT, contractPayload TEXT)`;
                const customJson = `CREATE TABLE IF NOT EXISTS customJson ( id TEXT NOT NULL UNIQUE, blockId TEXT, blockNumber INTEGER, sender TEXT, isSignedWithActiveKey INTEGER, contractName TEXT, contractAction TEXT, contractPayload TEXT)`;
                const events = `CREATE TABLE IF NOT EXISTS events ( id INTEGER PRIMARY KEY, date TEXT, contract TEXT, action TEXT, payload TEXT, data TEXT )`;
  
                this.db
                    .run(params)
                    .run(transfers)
                    .run(customJson)
                    .run(events, () => {
                        this.initializePreparedStatements();
                        resolve(true);
                    });
            });
        });
    }
    
    private initializePreparedStatements(): void {
        // Prepare frequently used statements for better performance
        const transferSql = `INSERT INTO transfers (id, blockId, blockNumber, sender, amount, contractName, contractAction, contractPayload) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
        const customJsonSql = `INSERT INTO customJson (id, blockId, blockNumber, sender, isSignedWithActiveKey, contractName, contractAction, contractPayload) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
        
        this.preparedStatements.set('INSERT_TRANSFER', this.db.prepare(transferSql));
        this.preparedStatements.set('INSERT_CUSTOM_JSON', this.db.prepare(customJsonSql));
    }
    
    private async executeBatched(sqlKey: string, params: any[]): Promise<boolean> {
        return new Promise((resolve) => {
            this.batchOperations.push({ sql: sqlKey, params });
            
            if (this.batchOperations.length >= this.batchSize) {
                this.flushBatch();
            } else if (!this.batchTimeout) {
                this.batchTimeout = setTimeout(() => this.flushBatch(), this.batchDelayMs);
            }
            
            resolve(true);
        });
    }
    
    private flushBatch(): void {
        if (this.batchOperations.length === 0) return;
        
        const operations = [...this.batchOperations];
        this.batchOperations = [];
        
        if (this.batchTimeout) {
            clearTimeout(this.batchTimeout);
            this.batchTimeout = null;
        }
        
        this.db.serialize(() => {
            this.db.run('BEGIN TRANSACTION');
            
            operations.forEach(({ sql, params }) => {
                const stmt = this.preparedStatements.get(sql);
                if (stmt) {
                    stmt.run(params);
                }
            });
            
            this.db.run('COMMIT');
        });
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
        return new Promise((resolve, reject) => {
            this.db.all('SELECT actions, lastBlockNumber FROM params LIMIT 1', (err, rows) => {
                if (!err) {
                    if (rows.length) {
                        const row = rows[0];
                        try {
                            row.actions = row.actions ? JSON.parse(row.actions) : [];
                        } catch (parseError) {
                            console.warn('[SqliteAdapter] Failed to parse actions from database, using empty array:', parseError);
                            row.actions = [];
                        }
                        resolve(row);
                    } else {
                        resolve(null);
                    }
                } else {
                    reject(err);
                }
            });
        });
    }

    public async saveState(data: any): Promise<boolean> {
        return new Promise((resolve, reject) => {
            const sql = `REPLACE INTO params (id, actions, lastBlockNumber) VALUES(1, ?, ?)`;
            
            let actionsJson: string;
            try {
                actionsJson = JSON.stringify(data.actions || []);
            } catch (error) {
                console.error('[SqliteAdapter] Failed to serialize actions:', error);
                actionsJson = '[]';
            }

            this.db.run(sql, [actionsJson, data.lastBlockNumber], (err, result) => {
                if (!err) {
                    resolve(true);
                } else {
                    console.error('[SqliteAdapter] Error saving state:', err);
                    reject(err);
                }
            });
        });
    }

    public async processOperation(op: any, blockNumber: number, blockId: string, prevBlockId: string, trxId: string, blockTime: Date) {
        this.blockNumber = blockNumber;
        this.blockId = blockId;
        this.prevBlockId = prevBlockId;
        this.transactionId = trxId;
    }

    public async processTransfer(operation: any, payload: ContractPayload, metadata: TransferMetadata): Promise<boolean> {
        const sql = 'INSERT_TRANSFER';
        const params = [
            this.transactionId, 
            this.blockId, 
            this.blockNumber, 
            metadata.sender, 
            metadata.amount, 
            payload.name, 
            payload.action, 
            JSON.stringify(payload.payload)
        ];
        
        return this.executeBatched(sql, params);
    }

    public async processCustomJson(operation: any, payload: ContractPayload, metadata: CustomJsonMetadata): Promise<boolean> {
        const sql = 'INSERT_CUSTOM_JSON';
        const params = [
            this.transactionId, 
            this.blockId, 
            this.blockNumber, 
            metadata.sender, 
            metadata.isSignedWithActiveKey ? 1 : 0, 
            payload.name, 
            payload.action, 
            JSON.stringify(payload.payload)
        ];
        
        return this.executeBatched(sql, params);
    }

    public async addEvent(date: string, contract: string, action: string, payload: ContractPayload, data: unknown): Promise<boolean> {
        return new Promise((resolve, reject) => {
            const sql = `INSERT INTO events (date, contract, action, payload, data) 
            VALUES (?, ?, ?, ?, ?)`;

            this.db.run(sql, [
                date, 
                contract, 
                action, 
                JSON.stringify(payload), 
                JSON.stringify(data)
            ], (err, result) => {
                if (!err) {
                    resolve(true);
                } else {
                    reject(err);
                }
            });
        });
    }

    public async getTransfers() {
        return new Promise((resolve, reject) => {
            this.db.all('SELECT id, blockId, blockNumber, sender, amount, contractName, contractAction, contractPayload FROM transfers', (err, rows) => {
                if (!err) {
                    if (rows.length) {
                        resolve(rows.reduce((arr, row) => {
                            row.contractPayload = JSON.parse(row.contractPayload) ?? {};
                            arr.push(row);
                            return arr;
                        }, []));
                    } else {
                        resolve(null);
                    }
                } else {
                    reject(err);
                }
            });
        });
    }

    public async getEvents() {
        return new Promise((resolve, reject) => {
            this.db.all('SELECT id, date, contract, action, payload, data FROM events', (err, rows) => {
                if (!err) {
                    if (rows.length) {
                        resolve(rows.reduce((arr, row) => {
                            row.payload = JSON.parse(row.payload) ?? {};
                            row.data = JSON.parse(row.data) ?? {};

                            arr.push(row);
                            return arr;
                        }, []));
                    } else {
                        resolve(null);
                    }
                } else {
                    reject(err);
                }
            });
        });
    }

    public async getTransfersByContract(contract: string) {
        return new Promise((resolve, reject) => {
            this.db.all(`SELECT id, blockId, blockNumber, sender, amount, contractName, contractAction, contractPayload FROM transfers WHERE contractName = ?`, [contract], (err, rows) => {
                if (!err) {
                    if (rows.length) {
                        resolve(rows.reduce((arr, row) => {
                            row.contractPayload = JSON.parse(row.contractPayload) ?? {};
                            arr.push(row);
                            return arr;
                        }, []));
                    } else {
                        resolve(null);
                    }
                } else {
                    reject(err);
                }
            });
        });
    }

    public async getTransfersByAccount(account: string) {
        return new Promise((resolve, reject) => {
            this.db.all(`SELECT id, blockId, blockNumber, sender, amount, contractName, contractAction, contractPayload FROM transfers WHERE sender = ?`, [account], (err, rows) => {
                if (!err) {
                    if (rows.length) {
                        resolve(rows.reduce((arr, row) => {
                            row.contractPayload = JSON.parse(row.contractPayload) ?? {};
                            arr.push(row);
                            return arr;
                        }, []));
                    } else {
                        resolve(null);
                    }
                } else {
                    reject(err);
                }
            });
        });
    }

    public async getTransfersByBlockid(blockId: any) {
        return new Promise((resolve, reject) => {
            this.db.all(`SELECT id, blockId, blockNumber, sender, amount, contractName, contractAction, contractPayload FROM transfers WHERE blockId = ?`, [blockId], (err, rows) => {
                if (!err) {
                    if (rows.length) {
                        resolve(rows.reduce((arr, row) => {
                            row.contractPayload = JSON.parse(row.contractPayload) ?? {};
                            arr.push(row);
                            return arr;
                        }, []));
                    } else {
                        resolve(null);
                    }
                } else {
                    reject(err);
                }
            });
        });
    }

    public async getJson() {
        return new Promise((resolve, reject) => {
            this.db.all('SELECT id, blockId, blockNumber, sender, isSignedWithActiveKey, contractName, contractAction, contractPayload FROM customJson', (err, rows) => {
                if (!err) {
                    if (rows.length) {
                        resolve(rows.reduce((arr, row) => {
                            row.contractPayload = JSON.parse(row.contractPayload) ?? {};
                            arr.push(row);
                            return arr;
                        }, []));
                    } else {
                        resolve(null);
                    }
                } else {
                    reject(err);
                }
            });
        });
    }

    public async getJsonByContract(contract: string) {
        return new Promise((resolve, reject) => {
            this.db.all(`SELECT id, blockId, blockNumber, sender, isSignedWithActiveKey, contractName, contractAction, contractPayload FROM customJson WHERE contractName = ?`, [contract], (err, rows) => {
                if (!err) {
                    if (rows.length) {
                        resolve(rows.reduce((arr, row) => {
                            row.contractPayload = JSON.parse(row.contractPayload) ?? {};
                            arr.push(row);
                            return arr;
                        }, []));
                    } else {
                        resolve(null);
                    }
                } else {
                    reject(err);
                }
            });
        });
    }

    public async getJsonByAccount(account: string) {
        return new Promise((resolve, reject) => {
            this.db.all(`SELECT id, blockId, blockNumber, sender, isSignedWithActiveKey, contractName, contractAction, contractPayload FROM customJson WHERE sender = ?`, [account], (err, rows) => {
                if (!err) {
                    if (rows.length) {
                        resolve(rows.reduce((arr, row) => {
                            row.contractPayload = JSON.parse(row.contractPayload) ?? {};
                            arr.push(row);
                            return arr;
                        }, []));
                    } else {
                        resolve(null);
                    }
                } else {
                    reject(err);
                }
            });
        });
    }

    public async getJsonByBlockid(blockId: any) {
        return new Promise((resolve, reject) => {
            this.db.all(`SELECT id, blockId, blockNumber, sender, isSignedWithActiveKey, contractName, contractAction, contractPayload FROM customJson WHERE blockId = ?`, [blockId], (err, rows) => {
                if (!err) {
                    if (rows.length) {
                        resolve(rows.reduce((arr, row) => {
                            row.contractPayload = JSON.parse(row.contractPayload) ?? {};
                            arr.push(row);
                            return arr;
                        }, []));
                    } else {
                        resolve(null);
                    }
                } else {
                    reject(err);
                }
            });
        });
    }

    public async destroy(): Promise<boolean> {
        return new Promise((resolve, reject) => {
            // Finalize all prepared statements first
            this.preparedStatements.forEach((stmt, key) => {
                try {
                    stmt.finalize();
                } catch (error) {
                    console.warn(`[SqliteAdapter] Error finalizing statement ${key}:`, error);
                }
            });
            this.preparedStatements.clear();
            
            // Flush any remaining batch operations
            this.flushBatch();
            
            this.db.close((err) => {
                if (!err) {
                    resolve(true);
                } else {
                    reject(err);
                }
            });
        });
    }

    public async find(table: string, query: Record<string, any>) {
        return new Promise((resolve, reject) => {
            const keys = Object.keys(query);
            const queryStr = keys.map(key => `${key} = ?`).join(' AND ');
            const values = keys.map(key => query[key]);

            this.db.all(`SELECT * FROM ${table} WHERE ${queryStr}`, values, (err, rows) => {
                if (!err) {
                    if (rows.length) {
                        resolve(rows);
                    } else {
                        resolve(null);
                    }
                } else {
                    reject(err);
                }
            });
        });
    }

    public async findOne(table: string, query: Record<string, any>) {
        return new Promise((resolve, reject) => {
            const keys = Object.keys(query);
            const queryStr = keys.map(key => `${key} = ?`).join(' AND ');
            const values = keys.map(key => query[key]);

            this.db.get(`SELECT * FROM ${table} WHERE ${queryStr}`, values, (err, row) => {
                if (!err) {
                    if (row) {
                        resolve(row);
                    } else {
                        resolve(null);
                    }
                } else {
                    reject(err);
                }
            });
        });
    }

    public async insert(table: string, data: string) {
        return new Promise((resolve, reject) => {
            this.db.run(`INSERT INTO ${table} VALUES (${data})`, (err) => {
                if (!err) {
                    resolve(true);
                } else {
                    reject(err);
                }
            });
        });
    }

    public async replace(table: string, queryObject: Record<string, any>, data: any): Promise<any> {
        return new Promise((resolve, reject) => {
            const dataKeys = Object.keys(data);
            const placeholders = dataKeys.map(() => '?').join(', ');
            const values = dataKeys.map(key => data[key]);

            this.db.run(`REPLACE INTO ${table} (${dataKeys.join(', ')}) VALUES (${placeholders})`, values, (err) => {
                if (!err) {
                    resolve(data);
                } else {
                    reject(err);
                }
            });
        });
    }
}