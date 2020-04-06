import { AdapterBase } from './base.adapter';

import { Database } from 'sqlite3';

export class SqliteAdapter extends AdapterBase {
    private db = new Database('./db/hive-stream.db');

    protected async create() {
        const sql = `CREATE TABLE IF NOT EXISTS params ( id INTEGER PRIMARY KEY, lastBlockNumber NUMERIC )`;

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
        const sql = `REPLACE INTO params (lastBlockNumber) VALUES('${data.lastBlockNumber}')`;

        this.db.run(sql, [], (err, result) => {
            return true;
        });
    }

    protected async destroy() {
        this.db.close();
    }
}