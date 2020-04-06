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

    protected async create() {
        const sql = `
            CREATE TABLE IF NOT EXISTS params ( id INTEGER PRIMARY KEY, lastBlockNumber NUMERIC )
            CREATE TABLE IF NOT EXISTS transfers ( id TEXT UNIQUE KEY, blockId TEXT, blockNumber INTEGER, lastBlockNumber INTEGER, sender TEXT, amount TEXT, contractName TEXT, contractAction TEXT, contractPayload TEXT)
            CREATE TABLE IF NOT EXISTS transactions ( id TEXT UNIQUE KEY, blockId TEXT, blockNumber INTEGER, lastBlockNumber INTEGER, sender TEXT, isSignedWithActiveKey INTEGER, contractName TEXT, contractAction TEXT, contractPayload TEXT)
        `;

        this.db.run(sql, [], (err, result) => {
            return true;
        });
    }

    protected async loadState() {
        this.db.all('SELECT lastBlockNumber FROM params LIMIT 1', (err, rows) => {
            if (!err) {
                return rows[0];
            }
        });
    }

    protected async saveState(data: any) {
        const sql = `REPLACE INTO params (id, lastBlockNumber) VALUES(1, '${data.lastBlockNumber}')`;

        this.db.run(sql, [], (err, result) => {
            if (!err) {
                return true;
            } else {
                return err;
            }
        });
    }

    protected async processOperation(op: any, blockNumber: number, blockId: string, prevBlockId: string, trxId: string, blockTime: Date) {

    }

    protected async processTransfer(operation, payload: ContractPayload, metadata: { sender: string, amount: string }) {
        const sql = `INSERT INTO transfers (id, blockId, blockNumber, lastBlockNumber, transactionId, sender, amount, contractName, contractAction, contractPayload) 
                     VALUES ('${this.transactionId}, '${this.blockId}', ${this.blockNumber}, ${this.lastBlockNumber}, '${metadata.sender}', '${metadata.amount}', '${payload.name}', '${payload.action}', '${JSON.stringify(payload.payload)}')`;

        this.db.run(sql, [], (err, result) => {
            if (!err) {
                return true;
            } else {
                return err;
            }
        });
    }

    protected async processCustomJson(operation, payload: ContractPayload, metadata: { sender: string, isSignedWithActiveKey: boolean }) {
        const sql = `INSERT INTO transfers (id, blockId, blockNumber, lastBlockNumber, transactionId, sender, isSignedWithActiveKey, contractName, contractAction, contractPayload) 
                     VALUES ('${this.transactionId}, '${this.blockId}', ${this.blockNumber}, ${this.lastBlockNumber}, '${metadata.sender}', ${metadata.isSignedWithActiveKey}, '${payload.name}', '${payload.action}', '${JSON.stringify(payload.payload)}')`;

        this.db.run(sql, [], (err, result) => {
            if (!err) {
                return true;
            } else {
                return err;
            }
        });
    }

    protected async destroy() {
        this.db.close();
    }
}