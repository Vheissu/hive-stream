import { ContractPayload } from './../types/hive-stream';
import { AdapterBase } from './base.adapter';

import path, { resolve } from 'path';

import { MongoClient } from 'mongodb';

export class MongodbAdapter extends AdapterBase {
    private client;
    private db;

    private blockNumber: number;
    private lastBlockNumber: number;
    private blockId: string;
    private prevBlockId;
    private transactionId: string;

    constructor(uri, options = {}) {
        super();
        this.client = new MongoClient(uri, options);
    }

    protected async create(): Promise<boolean> {
        return new Promise((resolve) => {
            this.db.serialize(() => {
                const params = `CREATE TABLE IF NOT EXISTS params ( id INTEGER PRIMARY KEY, lastBlockNumber NUMERIC )`;
                const transfers = `CREATE TABLE IF NOT EXISTS transfers ( id TEXT NOT NULL UNIQUE, blockId TEXT, blockNumber INTEGER, sender TEXT, amount TEXT, contractName TEXT, contractAction TEXT, contractPayload TEXT)`;
                const transactions = `CREATE TABLE IF NOT EXISTS transactions ( id TEXT NOT NULL UNIQUE, blockId TEXT, blockNumber INTEGER, sender TEXT, isSignedWithActiveKey INTEGER, contractName TEXT, contractAction TEXT, contractPayload TEXT)`;
        
                this.db.run(params).run(transfers).run(transactions, () => {
                    resolve(true);
                });
            });
        })
    }

    protected async loadState(): Promise<any> {
        return new Promise((resolve, reject) => {
            this.db.all('SELECT lastBlockNumber FROM params LIMIT 1', (err, rows) => {
                if (!err) {
                    resolve(rows[0]);
                } else {
                    reject(err);
                }
            });
        });
    }

    protected async saveState(data: any): Promise<boolean> {
        return new Promise((resolve, reject) => {
            const sql = `REPLACE INTO params (id, lastBlockNumber) VALUES(1, '${data.lastBlockNumber}')`;

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
            const sql = `INSERT INTO transfers (id, blockId, blockNumber, sender, isSignedWithActiveKey, contractName, contractAction, contractPayload) 
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