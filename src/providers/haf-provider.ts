import { Client as PgClient } from 'pg';
import { BlockProvider, BlockData, DynamicGlobalProperties } from './block-provider';

export interface HafProviderConfig {
    host?: string;
    port?: number;
    user?: string;
    password?: string;
    database?: string;
    ssl?: boolean | object;
    connectionString?: string;
    schema?: string;
    useHafContext?: boolean;
    hafAppName?: string;
    statementTimeout?: string;
}

/**
 * Maps HAF numeric operation type IDs to Hive operation string names.
 * Only includes the most commonly used operations.
 */
export const HAF_OP_TYPES: Record<number, string> = {
    0: 'vote',
    1: 'comment',
    2: 'transfer',
    3: 'transfer_to_vesting',
    4: 'withdraw_vesting',
    5: 'limit_order_create',
    6: 'limit_order_cancel',
    7: 'feed_publish',
    8: 'convert',
    9: 'account_create',
    10: 'account_update',
    11: 'witness_update',
    12: 'account_witness_vote',
    13: 'account_witness_proxy',
    14: 'pow',
    15: 'custom',
    16: 'witness_block_approve',
    17: 'delete_comment',
    18: 'custom_json',
    19: 'comment_options',
    20: 'set_withdraw_vesting_route',
    21: 'limit_order_create2',
    22: 'claim_account',
    23: 'create_claimed_account',
    24: 'request_account_recovery',
    25: 'recover_account',
    26: 'change_recovery_account',
    27: 'escrow_transfer',
    28: 'escrow_dispute',
    29: 'escrow_release',
    30: 'pow2',
    31: 'escrow_approve',
    32: 'transfer_to_savings',
    33: 'transfer_from_savings',
    34: 'cancel_transfer_from_savings',
    35: 'custom_binary',
    36: 'decline_voting_rights',
    37: 'reset_account',
    38: 'set_reset_account',
    39: 'claim_reward_balance',
    40: 'delegate_vesting_shares',
    41: 'account_create_with_delegation',
    42: 'witness_set_properties',
    43: 'account_update2',
    44: 'create_proposal',
    45: 'update_proposal_votes',
    46: 'remove_proposal',
    47: 'update_proposal',
    48: 'collateralized_convert',
    49: 'recurrent_transfer',
};

const DEFAULT_CONFIG: Required<Omit<HafProviderConfig, 'connectionString' | 'ssl' | 'hafAppName'>> & Pick<HafProviderConfig, 'connectionString' | 'ssl' | 'hafAppName'> = {
    host: 'hafsql-sql.mahdiyari.info',
    port: 5432,
    user: 'hafsql_public',
    password: 'hafsql_public',
    database: 'haf_block_log',
    ssl: undefined,
    connectionString: undefined,
    schema: 'hafsql',
    useHafContext: false,
    hafAppName: undefined,
    statementTimeout: '90s',
};

export class HafProvider implements BlockProvider {
    private client: PgClient;
    private config: typeof DEFAULT_CONFIG;
    private connected = false;

    constructor(config: HafProviderConfig = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.client = this.buildPgClient();
    }

    private buildPgClient(): PgClient {
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

        return new PgClient(pgOptions);
    }

    public async create(): Promise<void> {
        // pg Client cannot reconnect after end(); create a fresh one
        if (!this.connected) {
            this.client = this.buildPgClient();
        }

        await this.client.connect();
        this.connected = true;

        await this.client.query(`SET statement_timeout = '${this.config.statementTimeout}'`);

        if (this.config.useHafContext && this.config.hafAppName) {
            await this.client.query(`SELECT hive.app_create_context($1)`, [this.config.hafAppName]);
        }
    }

    public async getDynamicGlobalProperties(): Promise<DynamicGlobalProperties> {
        const result = await this.client.query(
            `SELECT num AS head_block_number, created_at AS time
             FROM hafbe_bal.blocks_view
             WHERE num = (SELECT MAX(num) FROM hafbe_bal.blocks_view)`
        );

        if (result.rows.length === 0) {
            throw new Error('No blocks found in HAF database');
        }

        const row = result.rows[0];
        return {
            head_block_number: row.head_block_number,
            time: row.time instanceof Date ? row.time.toISOString().replace('Z', '') : String(row.time),
        };
    }

    private bytesToHex(buf: any): string {
        if (Buffer.isBuffer(buf)) {
            return buf.toString('hex');
        }
        return String(buf);
    }

    public async getBlock(blockNumber: number): Promise<BlockData | null> {
        // Fetch block metadata (hash/prev are bytea columns)
        const blockResult = await this.client.query(
            `SELECT num, encode(hash, 'hex') AS hash, encode(prev, 'hex') AS prev, created_at
             FROM hafbe_bal.blocks_view
             WHERE num = $1`,
            [blockNumber]
        );

        if (blockResult.rows.length === 0) {
            return null;
        }

        const blockRow = blockResult.rows[0];

        // Fetch operations for this block (operations_view has no trx_hash)
        const opsResult = await this.client.query(
            `SELECT op_type_id, body, trx_in_block
             FROM hafbe_bal.operations_view
             WHERE block_num = $1
             ORDER BY trx_in_block, op_pos`,
            [blockNumber]
        );

        // Fetch transaction hashes separately (trx_hash is bytea)
        const trxResult = await this.client.query(
            `SELECT trx_in_block, encode(trx_hash, 'hex') AS trx_hash
             FROM hafbe_bal.transactions_view
             WHERE block_num = $1
             ORDER BY trx_in_block`,
            [blockNumber]
        );

        // Build trx_hash lookup by trx_in_block
        const trxHashMap = new Map<number, string>();
        for (const row of trxResult.rows) {
            trxHashMap.set(row.trx_in_block, row.trx_hash);
        }

        // Group operations into transactions
        const transactionMap = new Map<number, { operations: Array<[string, any]> }>();
        const transactionOrder: number[] = [];

        for (const op of opsResult.rows) {
            const trxIndex: number = op.trx_in_block;

            if (!transactionMap.has(trxIndex)) {
                transactionMap.set(trxIndex, { operations: [] });
                transactionOrder.push(trxIndex);
            }

            const opName = HAF_OP_TYPES[op.op_type_id] ?? `unknown_op_${op.op_type_id}`;
            const opBody = op.body?.value ?? op.body;

            transactionMap.get(trxIndex)!.operations.push([opName, opBody]);
        }

        // Build transaction arrays
        const transactions: Array<{ operations: Array<[string, any]> }> = [];
        const transaction_ids: string[] = [];

        for (const idx of transactionOrder) {
            const trx = transactionMap.get(idx)!;
            transactions.push({ operations: trx.operations });
            transaction_ids.push(trxHashMap.get(idx) || '');
        }

        const timestamp = blockRow.created_at instanceof Date
            ? blockRow.created_at.toISOString().replace('Z', '')
            : String(blockRow.created_at);

        return {
            block_id: blockRow.hash || '',
            previous: blockRow.prev || '',
            timestamp,
            transactions,
            transaction_ids,
        };
    }

    public async destroy(): Promise<void> {
        if (this.config.useHafContext && this.config.hafAppName) {
            try {
                await this.client.query(`SELECT hive.app_remove_context($1)`, [this.config.hafAppName]);
            } catch {
                // Context may already be removed; ignore
            }
        }

        if (this.connected) {
            await this.client.end();
            this.connected = false;
        }
    }

    public getConfig(): Readonly<typeof DEFAULT_CONFIG> {
        return { ...this.config };
    }
}
