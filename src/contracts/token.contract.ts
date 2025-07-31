import { Streamer } from '../streamer';
import { Utils } from '../utils';
import BigNumber from 'bignumber.js';

const CONTRACT_NAME = 'hivetoken';

interface TokenMetadata {
    name: string;
    symbol: string;
    url?: string;
    precision: number;
    maxSupply: string;
    creator: string;
    createdAt: Date;
}

interface TokenBalance {
    account: string;
    symbol: string;
    balance: string;
}

interface TokenTransfer {
    from: string;
    to: string;
    amount: string;
    symbol: string;
    memo?: string;
    timestamp: Date;
}

export class TokenContract {
    public _instance: Streamer;
    private adapter;

    private blockNumber: number;
    private blockId: string;
    private previousBlockId: string;
    private transactionId: string;

    public create() {
        this.adapter = this._instance.getAdapter();
        this.initializeTokenTables();
    }

    public destroy() {
        // Cleanup logic if needed
    }

    public updateBlockInfo(blockNumber: number, blockId: string, previousBlockId: string, transactionId: string) {
        this.blockNumber = blockNumber;
        this.blockId = blockId;
        this.previousBlockId = previousBlockId;
        this.transactionId = transactionId;
    }

    private async initializeTokenTables() {
        try {
            await this.adapter.query(`
                CREATE TABLE IF NOT EXISTS tokens (
                    symbol TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    url TEXT,
                    precision INTEGER NOT NULL DEFAULT 3,
                    max_supply TEXT NOT NULL,
                    current_supply TEXT NOT NULL DEFAULT '0',
                    creator TEXT NOT NULL,
                    created_at DATETIME NOT NULL
                )
            `);

            await this.adapter.query(`
                CREATE TABLE IF NOT EXISTS token_balances (
                    account TEXT NOT NULL,
                    symbol TEXT NOT NULL,
                    balance TEXT NOT NULL DEFAULT '0',
                    PRIMARY KEY (account, symbol),
                    FOREIGN KEY (symbol) REFERENCES tokens(symbol)
                )
            `);

            await this.adapter.query(`
                CREATE TABLE IF NOT EXISTS token_transfers (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    from_account TEXT NOT NULL,
                    to_account TEXT NOT NULL,
                    amount TEXT NOT NULL,
                    symbol TEXT NOT NULL,
                    memo TEXT,
                    block_number INTEGER NOT NULL,
                    transaction_id TEXT NOT NULL,
                    timestamp DATETIME NOT NULL,
                    FOREIGN KEY (symbol) REFERENCES tokens(symbol)
                )
            `);
        } catch (error) {
            console.error('[TokenContract] Error initializing tables:', error);
        }
    }

    private async createToken(payload: {
        symbol: string;
        name: string;
        url?: string;
        precision?: number;
        maxSupply: string;
    }, { sender }) {
        try {
            const { symbol, name, url = '', precision = 3, maxSupply } = payload;

            if (!symbol.match(/^[A-Z0-9]{1,10}$/)) {
                throw new Error('Symbol must be 1-10 uppercase alphanumeric characters');
            }

            if (!name || name.length > 50) {
                throw new Error('Name is required and must be 50 characters or less');
            }

            if (precision < 0 || precision > 8) {
                throw new Error('Precision must be between 0 and 8');
            }

            const maxSupplyBN = new BigNumber(maxSupply);
            if (maxSupplyBN.isNaN() || maxSupplyBN.lt(1) || maxSupplyBN.gt(9007199254740991)) {
                throw new Error('Maximum supply must be between 1 and 9007199254740991');
            }

            if (url && url.length > 256) {
                throw new Error('URL must be 256 characters or less');
            }

            const existingToken = await this.adapter.query(
                'SELECT symbol FROM tokens WHERE symbol = ?',
                [symbol]
            );

            if (existingToken && existingToken.length > 0) {
                throw new Error(`Token with symbol ${symbol} already exists`);
            }

            await this.adapter.query(`
                INSERT INTO tokens (symbol, name, url, precision, max_supply, current_supply, creator, created_at)
                VALUES (?, ?, ?, ?, ?, '0', ?, ?)
            `, [symbol, name, url, precision, maxSupply, sender, new Date()]);

            await this.adapter.addEvent(new Date(), CONTRACT_NAME, 'createToken', payload, {
                action: 'token_created',
                data: {
                    symbol,
                    name,
                    creator: sender,
                    maxSupply,
                    precision
                }
            });

            console.log(`[TokenContract] Token ${symbol} created by ${sender}`);

        } catch (error) {
            console.error('[TokenContract] Error creating token:', error);
            throw error;
        }
    }

    private async issueTokens(payload: {
        symbol: string;
        to: string;
        amount: string;
        memo?: string;
    }, { sender }) {
        try {
            const { symbol, to, amount, memo = '' } = payload;

            const token = await this.adapter.query(
                'SELECT * FROM tokens WHERE symbol = ?',
                [symbol]
            );

            if (!token || token.length === 0) {
                throw new Error(`Token ${symbol} does not exist`);
            }

            const tokenData = token[0];

            if (tokenData.creator !== sender) {
                throw new Error('Only the token creator can issue new tokens');
            }

            const amountBN = new BigNumber(amount);
            if (amountBN.isNaN() || amountBN.lte(0)) {
                throw new Error('Amount must be a positive number');
            }

            const currentSupplyBN = new BigNumber(tokenData.current_supply);
            const maxSupplyBN = new BigNumber(tokenData.max_supply);
            const newSupplyBN = currentSupplyBN.plus(amountBN);

            if (newSupplyBN.gt(maxSupplyBN)) {
                throw new Error('Cannot issue tokens: would exceed maximum supply');
            }

            await this.adapter.query(
                'UPDATE tokens SET current_supply = ? WHERE symbol = ?',
                [newSupplyBN.toFixed(tokenData.precision), symbol]
            );

            const existingBalance = await this.adapter.query(
                'SELECT balance FROM token_balances WHERE account = ? AND symbol = ?',
                [to, symbol]
            );

            if (existingBalance && existingBalance.length > 0) {
                const currentBalanceBN = new BigNumber(existingBalance[0].balance);
                const newBalanceBN = currentBalanceBN.plus(amountBN);

                await this.adapter.query(
                    'UPDATE token_balances SET balance = ? WHERE account = ? AND symbol = ?',
                    [newBalanceBN.toFixed(tokenData.precision), to, symbol]
                );
            } else {
                await this.adapter.query(
                    'INSERT INTO token_balances (account, symbol, balance) VALUES (?, ?, ?)',
                    [to, symbol, amountBN.toFixed(tokenData.precision)]
                );
            }

            await this.adapter.query(`
                INSERT INTO token_transfers (from_account, to_account, amount, symbol, memo, block_number, transaction_id, timestamp)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `, ['null', to, amount, symbol, memo, this.blockNumber, this.transactionId, new Date()]);

            await this.adapter.addEvent(new Date(), CONTRACT_NAME, 'issueTokens', payload, {
                action: 'tokens_issued',
                data: {
                    symbol,
                    to,
                    amount,
                    newSupply: newSupplyBN.toFixed(tokenData.precision)
                }
            });

            console.log(`[TokenContract] Issued ${amount} ${symbol} to ${to}`);

        } catch (error) {
            console.error('[TokenContract] Error issuing tokens:', error);
            throw error;
        }
    }

    private async transferTokens(payload: {
        symbol: string;
        to: string;
        amount: string;
        memo?: string;
    }, { sender }) {
        try {
            const { symbol, to, amount, memo = '' } = payload;

            const token = await this.adapter.query(
                'SELECT precision FROM tokens WHERE symbol = ?',
                [symbol]
            );

            if (!token || token.length === 0) {
                throw new Error(`Token ${symbol} does not exist`);
            }

            const precision = token[0].precision;
            const amountBN = new BigNumber(amount);

            if (amountBN.isNaN() || amountBN.lte(0)) {
                throw new Error('Amount must be a positive number');
            }

            const senderBalance = await this.adapter.query(
                'SELECT balance FROM token_balances WHERE account = ? AND symbol = ?',
                [sender, symbol]
            );

            if (!senderBalance || senderBalance.length === 0) {
                throw new Error('Insufficient balance');
            }

            const senderBalanceBN = new BigNumber(senderBalance[0].balance);

            if (senderBalanceBN.lt(amountBN)) {
                throw new Error('Insufficient balance');
            }

            const newSenderBalanceBN = senderBalanceBN.minus(amountBN);

            await this.adapter.query(
                'UPDATE token_balances SET balance = ? WHERE account = ? AND symbol = ?',
                [newSenderBalanceBN.toFixed(precision), sender, symbol]
            );

            const receiverBalance = await this.adapter.query(
                'SELECT balance FROM token_balances WHERE account = ? AND symbol = ?',
                [to, symbol]
            );

            if (receiverBalance && receiverBalance.length > 0) {
                const receiverBalanceBN = new BigNumber(receiverBalance[0].balance);
                const newReceiverBalanceBN = receiverBalanceBN.plus(amountBN);

                await this.adapter.query(
                    'UPDATE token_balances SET balance = ? WHERE account = ? AND symbol = ?',
                    [newReceiverBalanceBN.toFixed(precision), to, symbol]
                );
            } else {
                await this.adapter.query(
                    'INSERT INTO token_balances (account, symbol, balance) VALUES (?, ?, ?)',
                    [to, symbol, amountBN.toFixed(precision)]
                );
            }

            await this.adapter.query(`
                INSERT INTO token_transfers (from_account, to_account, amount, symbol, memo, block_number, transaction_id, timestamp)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `, [sender, to, amount, symbol, memo, this.blockNumber, this.transactionId, new Date()]);

            await this.adapter.addEvent(new Date(), CONTRACT_NAME, 'transferTokens', payload, {
                action: 'tokens_transferred',
                data: {
                    from: sender,
                    to,
                    amount,
                    symbol
                }
            });

            console.log(`[TokenContract] Transferred ${amount} ${symbol} from ${sender} to ${to}`);

        } catch (error) {
            console.error('[TokenContract] Error transferring tokens:', error);
            throw error;
        }
    }

    private async getBalance(payload: {
        account: string;
        symbol: string;
    }, { sender }) {
        try {
            const { account, symbol } = payload;

            const balance = await this.adapter.query(
                'SELECT balance FROM token_balances WHERE account = ? AND symbol = ?',
                [account, symbol]
            );

            const balanceAmount = balance && balance.length > 0 ? balance[0].balance : '0';

            await this.adapter.addEvent(new Date(), CONTRACT_NAME, 'getBalance', payload, {
                action: 'balance_query',
                data: {
                    account,
                    symbol,
                    balance: balanceAmount,
                    queried_by: sender
                }
            });

            console.log(`[TokenContract] Balance query: ${account} has ${balanceAmount} ${symbol}`);

        } catch (error) {
            console.error('[TokenContract] Error getting balance:', error);
            throw error;
        }
    }

    private async getTokenInfo(payload: {
        symbol: string;
    }, { sender }) {
        try {
            const { symbol } = payload;

            const token = await this.adapter.query(
                'SELECT * FROM tokens WHERE symbol = ?',
                [symbol]
            );

            if (!token || token.length === 0) {
                throw new Error(`Token ${symbol} does not exist`);
            }

            const tokenData = token[0];

            await this.adapter.addEvent(new Date(), CONTRACT_NAME, 'getTokenInfo', payload, {
                action: 'token_info_query',
                data: {
                    symbol,
                    queried_by: sender,
                    token_info: tokenData
                }
            });

            console.log(`[TokenContract] Token info query for ${symbol} by ${sender}`);

        } catch (error) {
            console.error('[TokenContract] Error getting token info:', error);
            throw error;
        }
    }
}