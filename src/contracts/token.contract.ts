import BigNumber from 'bignumber.js';
import { z } from 'zod';
import { action, defineContract } from './contract';

const DEFAULT_NAME = 'hivetoken';

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

export interface TokenContractOptions {
    name?: string;
}

export function createTokenContract(options: TokenContractOptions = {}) {
    const name = options.name || DEFAULT_NAME;

    const state = {
        streamer: null as any,
        adapter: null as any
    };

    const createTokenSchema = z.object({
        symbol: z.string().regex(/^[A-Z0-9]{1,10}$/),
        name: z.string().min(1).max(50),
        url: z.string().max(256).optional(),
        precision: z.number().int().min(0).max(8).optional(),
        maxSupply: z.string()
    });

    const issueTokensSchema = z.object({
        symbol: z.string().min(1),
        to: z.string().min(1),
        amount: z.string().min(1),
        memo: z.string().optional()
    });

    const transferTokensSchema = z.object({
        symbol: z.string().min(1),
        to: z.string().min(1),
        amount: z.string().min(1),
        memo: z.string().optional()
    });

    const getBalanceSchema = z.object({
        account: z.string().min(1),
        symbol: z.string().min(1)
    });

    const getTokenInfoSchema = z.object({
        symbol: z.string().min(1)
    });

    const initializeTokenTables = async () => {
        try {
            await state.adapter.query(`
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

            await state.adapter.query(`
                CREATE TABLE IF NOT EXISTS token_balances (
                    account TEXT NOT NULL,
                    symbol TEXT NOT NULL,
                    balance TEXT NOT NULL DEFAULT '0',
                    PRIMARY KEY (account, symbol),
                    FOREIGN KEY (symbol) REFERENCES tokens(symbol)
                )
            `);

            await state.adapter.query(`
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
    };

    const createToken = async (payload: { symbol: string; name: string; url?: string; precision?: number; maxSupply: string }, ctx: any) => {
        try {
            const { symbol, name: tokenName, url = '', precision = 3, maxSupply } = payload;

            if (!symbol.match(/^[A-Z0-9]{1,10}$/)) {
                throw new Error('Symbol must be 1-10 uppercase alphanumeric characters');
            }

            if (!tokenName || tokenName.length > 50) {
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

            const existingToken = await state.adapter.query('SELECT symbol FROM tokens WHERE symbol = ?', [symbol]);

            if (existingToken && existingToken.length > 0) {
                throw new Error(`Token with symbol ${symbol} already exists`);
            }

            await state.adapter.query(`
                INSERT INTO tokens (symbol, name, url, precision, max_supply, current_supply, creator, created_at)
                VALUES (?, ?, ?, ?, ?, '0', ?, ?)
            `, [symbol, tokenName, url, precision, maxSupply, ctx.sender, new Date()]);

            await state.adapter.addEvent(new Date(), name, 'createToken', payload, {
                action: 'token_created',
                data: {
                    symbol,
                    name: tokenName,
                    creator: ctx.sender,
                    maxSupply,
                    precision
                }
            });

            console.log(`[TokenContract] Token ${symbol} created by ${ctx.sender}`);
        } catch (error) {
            console.error('[TokenContract] Error creating token:', error);
            throw error;
        }
    };

    const issueTokens = async (payload: { symbol: string; to: string; amount: string; memo?: string }, ctx: any) => {
        try {
            const { symbol, to, amount, memo = '' } = payload;

            const token = await state.adapter.query('SELECT * FROM tokens WHERE symbol = ?', [symbol]);

            if (!token || token.length === 0) {
                throw new Error(`Token ${symbol} does not exist`);
            }

            const tokenData = token[0];

            if (tokenData.creator !== ctx.sender) {
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

            await state.adapter.query(`
                UPDATE tokens SET current_supply = ? WHERE symbol = ?
            `, [newSupplyBN.toString(), symbol]);

            const existingBalance = await state.adapter.query(
                'SELECT balance FROM token_balances WHERE account = ? AND symbol = ?',
                [to, symbol]
            );

            if (existingBalance && existingBalance.length > 0) {
                const balanceBN = new BigNumber(existingBalance[0].balance);
                const newBalanceBN = balanceBN.plus(amountBN);
                await state.adapter.query(
                    'UPDATE token_balances SET balance = ? WHERE account = ? AND symbol = ?',
                    [newBalanceBN.toString(), to, symbol]
                );
            } else {
                await state.adapter.query(
                    'INSERT INTO token_balances (account, symbol, balance) VALUES (?, ?, ?)',
                    [to, symbol, amountBN.toString()]
                );
            }

            await state.adapter.query(`
                INSERT INTO token_transfers (from_account, to_account, amount, symbol, memo, block_number, transaction_id, timestamp)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `, ['null', to, amount, symbol, memo, ctx.block.number, ctx.transaction.id, new Date()]);

            await state.adapter.addEvent(new Date(), name, 'issueTokens', payload, {
                action: 'tokens_issued',
                data: {
                    to,
                    amount,
                    symbol
                }
            });

            console.log(`[TokenContract] Issued ${amount} ${symbol} to ${to}`);
        } catch (error) {
            console.error('[TokenContract] Error issuing tokens:', error);
            throw error;
        }
    };

    const transferTokens = async (payload: { symbol: string; to: string; amount: string; memo?: string }, ctx: any) => {
        try {
            const { symbol, to, amount, memo = '' } = payload;

            if (ctx.sender === to) {
                throw new Error('Cannot transfer tokens to yourself');
            }

            const token = await state.adapter.query('SELECT * FROM tokens WHERE symbol = ?', [symbol]);

            if (!token || token.length === 0) {
                throw new Error(`Token ${symbol} does not exist`);
            }

            const amountBN = new BigNumber(amount);
            if (amountBN.isNaN() || amountBN.lte(0)) {
                throw new Error('Amount must be a positive number');
            }

            const senderBalance = await state.adapter.query(
                'SELECT balance FROM token_balances WHERE account = ? AND symbol = ?',
                [ctx.sender, symbol]
            );

            if (!senderBalance || senderBalance.length === 0) {
                throw new Error(`Account ${ctx.sender} does not have any ${symbol} tokens`);
            }

            const senderBalanceBN = new BigNumber(senderBalance[0].balance);
            if (senderBalanceBN.lt(amountBN)) {
                throw new Error('Insufficient balance');
            }

            const newSenderBalanceBN = senderBalanceBN.minus(amountBN);
            await state.adapter.query(
                'UPDATE token_balances SET balance = ? WHERE account = ? AND symbol = ?',
                [newSenderBalanceBN.toString(), ctx.sender, symbol]
            );

            const receiverBalance = await state.adapter.query(
                'SELECT balance FROM token_balances WHERE account = ? AND symbol = ?',
                [to, symbol]
            );

            if (receiverBalance && receiverBalance.length > 0) {
                const receiverBalanceBN = new BigNumber(receiverBalance[0].balance);
                const newReceiverBalanceBN = receiverBalanceBN.plus(amountBN);
                await state.adapter.query(
                    'UPDATE token_balances SET balance = ? WHERE account = ? AND symbol = ?',
                    [newReceiverBalanceBN.toString(), to, symbol]
                );
            } else {
                await state.adapter.query(
                    'INSERT INTO token_balances (account, symbol, balance) VALUES (?, ?, ?)',
                    [to, symbol, amountBN.toString()]
                );
            }

            await state.adapter.query(`
                INSERT INTO token_transfers (from_account, to_account, amount, symbol, memo, block_number, transaction_id, timestamp)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `, [ctx.sender, to, amount, symbol, memo, ctx.block.number, ctx.transaction.id, new Date()]);

            await state.adapter.addEvent(new Date(), name, 'transferTokens', payload, {
                action: 'tokens_transferred',
                data: {
                    from: ctx.sender,
                    to,
                    amount,
                    symbol
                }
            });

            console.log(`[TokenContract] Transferred ${amount} ${symbol} from ${ctx.sender} to ${to}`);
        } catch (error) {
            console.error('[TokenContract] Error transferring tokens:', error);
            throw error;
        }
    };

    const getBalance = async (payload: { account: string; symbol: string }, ctx: any) => {
        try {
            const { account, symbol } = payload;

            const balance = await state.adapter.query(
                'SELECT balance FROM token_balances WHERE account = ? AND symbol = ?',
                [account, symbol]
            );

            const balanceAmount = balance && balance.length > 0 ? balance[0].balance : '0';

            await state.adapter.addEvent(new Date(), name, 'getBalance', payload, {
                action: 'balance_query',
                data: {
                    account,
                    symbol,
                    balance: balanceAmount,
                    queried_by: ctx.sender
                }
            });

            console.log(`[TokenContract] Balance query: ${account} has ${balanceAmount} ${symbol}`);
        } catch (error) {
            console.error('[TokenContract] Error getting balance:', error);
            throw error;
        }
    };

    const getTokenInfo = async (payload: { symbol: string }, ctx: any) => {
        try {
            const { symbol } = payload;

            const token = await state.adapter.query('SELECT * FROM tokens WHERE symbol = ?', [symbol]);

            if (!token || token.length === 0) {
                throw new Error(`Token ${symbol} does not exist`);
            }

            const tokenData = token[0];

            await state.adapter.addEvent(new Date(), name, 'getTokenInfo', payload, {
                action: 'token_info_query',
                data: {
                    symbol,
                    queried_by: ctx.sender,
                    token_info: tokenData
                }
            });

            console.log(`[TokenContract] Token info query for ${symbol} by ${ctx.sender}`);
        } catch (error) {
            console.error('[TokenContract] Error getting token info:', error);
            throw error;
        }
    };

    return defineContract({
        name,
        hooks: {
            create: async ({ streamer, adapter }) => {
                state.streamer = streamer;
                state.adapter = adapter;
                await initializeTokenTables();
            }
        },
        actions: {
            createToken: action(createToken, {
                schema: createTokenSchema,
                trigger: 'custom_json'
            }),
            issueTokens: action(issueTokens, {
                schema: issueTokensSchema,
                trigger: 'custom_json'
            }),
            transferTokens: action(transferTokens, {
                schema: transferTokensSchema,
                trigger: 'custom_json'
            }),
            getBalance: action(getBalance, {
                schema: getBalanceSchema,
                trigger: 'custom_json'
            }),
            getTokenInfo: action(getTokenInfo, {
                schema: getTokenInfoSchema,
                trigger: 'custom_json'
            })
        }
    });
}
