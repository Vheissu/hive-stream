import { Client as PgClient } from 'pg';

export interface HafClientConfig {
    host?: string;
    port?: number;
    user?: string;
    password?: string;
    database?: string;
    ssl?: boolean | object;
    connectionString?: string;
    statementTimeout?: string;
}

export interface TransferQuery {
    accounts: string[];
    fromDate?: string | Date;
    toDate?: string | Date;
    symbol?: string;
}

const DEFAULT_CONFIG = {
    host: 'hafsql-sql.mahdiyari.info',
    port: 5432,
    user: 'hafsql_public',
    password: 'hafsql_public',
    database: 'haf_block_log',
    statementTimeout: '90s',
};

export class HafClient {
    private client: PgClient;
    private config: typeof DEFAULT_CONFIG & HafClientConfig;
    private connected = false;

    constructor(config: HafClientConfig = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };

        const pgOptions: any = {};

        if (this.config.connectionString) {
            pgOptions.connectionString = this.config.connectionString;
        } else {
            pgOptions.host = this.config.host;
            pgOptions.port = this.config.port;
            pgOptions.user = this.config.user;
            pgOptions.password = this.config.password;
            pgOptions.database = this.config.database;
        }

        if (this.config.ssl !== undefined) {
            pgOptions.ssl = this.config.ssl;
        }

        this.client = new PgClient(pgOptions);
    }

    public async connect(): Promise<void> {
        await this.client.connect();
        this.connected = true;
        await this.client.query(`SET statement_timeout = '${this.config.statementTimeout}'`);
    }

    public async disconnect(): Promise<void> {
        if (this.connected) {
            await this.client.end();
            this.connected = false;
        }
    }

    public async query<T = any>(sql: string, params?: any[]): Promise<T[]> {
        const result = await this.client.query(sql, params);
        return result.rows as T[];
    }

    public async getTransfers(options: TransferQuery): Promise<any[]> {
        const conditions: string[] = [];
        const params: any[] = [];
        let paramIndex = 1;

        if (options.accounts.length > 0) {
            conditions.push(`(t.from_account = ANY($${paramIndex}) OR t.to_account = ANY($${paramIndex}))`);
            params.push(options.accounts);
            paramIndex++;
        }

        if (options.fromDate) {
            conditions.push(`t.id >= (SELECT MIN(ov.id) FROM hafbe_bal.operations_view ov JOIN hafbe_bal.blocks_view bv ON ov.block_num = bv.num WHERE bv.created_at >= $${paramIndex})`);
            params.push(options.fromDate instanceof Date ? options.fromDate.toISOString() : options.fromDate);
            paramIndex++;
        }

        if (options.toDate) {
            conditions.push(`t.id <= (SELECT MAX(ov.id) FROM hafbe_bal.operations_view ov JOIN hafbe_bal.blocks_view bv ON ov.block_num = bv.num WHERE bv.created_at <= $${paramIndex})`);
            params.push(options.toDate instanceof Date ? options.toDate.toISOString() : options.toDate);
            paramIndex++;
        }

        if (options.symbol) {
            conditions.push(`t.symbol = $${paramIndex}`);
            params.push(options.symbol);
            paramIndex++;
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

        const sql = `
            SELECT t.from_account AS "from", t.to_account AS "to", t.amount, t.symbol, t.memo
            FROM hafsql.operation_transfer_table t
            ${whereClause}
            ORDER BY t.id DESC
        `;

        return this.query(sql, params);
    }

    public async getAccountBalances(accounts: string[]): Promise<any[]> {
        const sql = `
            SELECT acc.name AS account, cab.nai, cab.balance
            FROM hafbe_bal.current_account_balances cab
            JOIN hafsql.accounts acc ON acc.id = cab.account
            WHERE acc.name = ANY($1)
            ORDER BY acc.name, cab.nai
        `;

        return this.query(sql, [accounts]);
    }

    public async getBlockAtTime(timestamp: string | Date): Promise<number | null> {
        const ts = timestamp instanceof Date ? timestamp.toISOString() : timestamp;

        const result = await this.query<{ num: number }>(
            `SELECT num
             FROM hafbe_bal.blocks_view
             WHERE created_at <= $1
             ORDER BY num DESC
             LIMIT 1`,
            [ts]
        );

        return result.length > 0 ? result[0].num : null;
    }

    public async getBlockTimestamp(blockNumber: number): Promise<string | null> {
        const result = await this.query<{ created_at: string }>(
            `SELECT created_at
             FROM hafbe_bal.blocks_view
             WHERE num = $1`,
            [blockNumber]
        );

        return result.length > 0 ? String(result[0].created_at) : null;
    }

    public async getProposalPayouts(proposalIds: number[]): Promise<any[]> {
        const sql = `
            SELECT pp.proposal_id, pp.receiver, pp.payer, pp.payment, pp.symbol
            FROM hafsql.operation_proposal_pay_table pp
            WHERE pp.proposal_id = ANY($1)
            ORDER BY pp.id DESC
        `;

        return this.query(sql, [proposalIds]);
    }
}
