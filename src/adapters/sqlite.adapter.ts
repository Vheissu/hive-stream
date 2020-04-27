import { TimeAction } from './../actions';
import { ContractPayload } from './../types/hive-stream';
import { AdapterBase } from './base.adapter';

import { Database } from 'sqlite3';

import path from 'path';

export class SqliteAdapter extends AdapterBase {
    private db = new Database(path.resolve(__dirname, 'hive-stream.db'));

    private blockNumber: number;
    private lastBlockNumber: number;
    private blockId: string;
    private prevBlockId;
    private transactionId: string;

    public getDb(): Database {
        return this.db;
    }

    protected async create(): Promise<boolean> {
        return new Promise((resolve) => {
            this.db.serialize(() => {
                const params = `CREATE TABLE IF NOT EXISTS params ( id INTEGER PRIMARY KEY, lastBlockNumber NUMERIC, actions TEXT )`;
                const transfers = `CREATE TABLE IF NOT EXISTS transfers ( id TEXT NOT NULL UNIQUE, blockId TEXT, blockNumber INTEGER, sender TEXT, amount TEXT, contractName TEXT, contractAction TEXT, contractPayload TEXT)`;
                const customJson = `CREATE TABLE IF NOT EXISTS customJson ( id TEXT NOT NULL UNIQUE, blockId TEXT, blockNumber INTEGER, sender TEXT, isSignedWithActiveKey INTEGER, contractName TEXT, contractAction TEXT, contractPayload TEXT)`;
  
                this.db
                    .run(params)
                    .run(transfers)
                    .run(customJson, () => {
                    resolve(true);
                });
            });
        })
    }

    protected async loadActions(): Promise<TimeAction[]> {
        const state = await this.loadState();

        if (state) {
            return (state?.actions) ? state.actions : [];
        }

        return [];
    }

    protected async loadState(): Promise<any> {
        return new Promise((resolve, reject) => {
            this.db.all('SELECT actions, lastBlockNumber FROM params LIMIT 1', (err, rows) => {
                if (!err) {
                    if (rows.length) {
                        const row = rows[0];
                        row.actions = JSON.parse(row.actions) ?? [];
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

    protected async saveState(data: any): Promise<boolean> {
        return new Promise((resolve, reject) => {
            const sql = `REPLACE INTO params (id, actions, lastBlockNumber) VALUES(1, '${JSON.stringify(data.actions)}', '${data.lastBlockNumber}')`;

            this.db.run(sql, [], (err, result) => {
                if (!err) {
                    resolve(true);
                } else {
                    reject(err);
                }
            });
        });
    }

    protected async processOperation(op: any, blockNumber: number, blockId: string, prevBlockId: string, trxId: string, blockTime: Date) {
        this.blockNumber = blockNumber;
        this.blockId = blockId;
        this.prevBlockId = prevBlockId;
        this.transactionId = trxId;
    }

    protected async processTransfer(operation, payload: ContractPayload, metadata: { sender: string, amount: string }): Promise<boolean> {
        return new Promise((resolve, reject) => {
            const sql = `INSERT INTO transfers (id, blockId, blockNumber, sender, amount, contractName, contractAction, contractPayload) 
            VALUES ('${this.transactionId}', '${this.blockId}', ${this.blockNumber}, '${metadata.sender}', '${metadata.amount}', '${payload.name}', '${payload.action}', '${JSON.stringify(payload.payload)}')`;

            this.db.run(sql, [], (err, result) => {
                if (!err) {
                    resolve(true);
                } else {
                    reject(err);
                }
            });
        });
    }

    protected async processCustomJson(operation, payload: ContractPayload, metadata: { sender: string, isSignedWithActiveKey: boolean }): Promise<boolean> {
        return new Promise((resolve, reject) => {
            const sql = `INSERT INTO customJson (id, blockId, blockNumber, sender, isSignedWithActiveKey, contractName, contractAction, contractPayload) 
            VALUES ('${this.transactionId}', '${this.blockId}', ${this.blockNumber},'${metadata.sender}', ${metadata.isSignedWithActiveKey}, '${payload.name}', '${payload.action}', '${JSON.stringify(payload.payload)}')`;

            this.db.run(sql, [], (err, result) => {
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

    public async getTransfersByContract(contract: string) {
        return new Promise((resolve, reject) => {
            this.db.all(`SELECT id, blockId, blockNumber, sender, amount, contractName, contractAction, contractPayload FROM transfers WHERE contractName = ${contract}`, (err, rows) => {
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
            this.db.all(`SELECT id, blockId, blockNumber, sender, amount, contractName, contractAction, contractPayload FROM transfers WHERE sender = ${account}`, (err, rows) => {
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
            this.db.all(`SELECT id, blockId, blockNumber, sender, amount, contractName, contractAction, contractPayload FROM transfers WHERE blockId = ${blockId}`, (err, rows) => {
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
            this.db.all(`SELECT id, blockId, blockNumber, sender, isSignedWithActiveKey, contractName, contractAction, contractPayload FROM customJson WHERE contractName = ${contract}`, (err, rows) => {
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
            this.db.all(`SELECT id, blockId, blockNumber, sender, isSignedWithActiveKey, contractName, contractAction, contractPayload FROM customJson WHERE sender = ${account}`, (err, rows) => {
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
            this.db.all(`SELECT id, blockId, blockNumber, sender, isSignedWithActiveKey, contractName, contractAction, contractPayload FROM customJson WHERE blockId = ${blockId}`, (err, rows) => {
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

    protected async destroy(): Promise<boolean> {
        return new Promise((resolve, reject) => {
            this.db.close((err) => {
                if (!err) {
                    resolve(true);
                } else {
                    reject(err);
                }
            });
        });
    }
}