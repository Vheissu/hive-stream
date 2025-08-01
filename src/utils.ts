import { HiveRates } from './hive-rates';
import { Client, SignedTransaction, PrivateKey } from '@hiveio/dhive';
import { Config, ConfigInterface } from './config';
import seedrandom from 'seedrandom';

const MAX_PAYLOAD_SIZE = 2000;
const MAX_ACCOUNTS_CHECK = 999;

/**
 * Utility functions for Hive blockchain operations and general helpers
 */
export const Utils = {

    /**
     * Pauses execution for the specified number of milliseconds
     * @param milliseconds - The number of milliseconds to sleep
     * @returns Promise that resolves after the specified time
     */
    sleep(milliseconds: number): Promise<void> {
        if (milliseconds < 0) {
            throw new Error('Sleep duration cannot be negative');
        }
        return new Promise((resolve) => setTimeout(resolve, milliseconds));
    },

    /**
     * Shuffles an array in place using the Fisher-Yates algorithm
     * @param array - The array to shuffle (modified in place)
     * @returns The shuffled array
     */
    shuffle<T>(array: T[]): T[] {
        if (!Array.isArray(array)) {
            throw new Error('Input must be an array');
        }
        
        let currentIndex = array.length;
        let temporaryValue: T;
        let randomIndex: number;
      
        while (currentIndex !== 0) {
            // Pick a remaining element
            randomIndex = Math.floor(Math.random() * currentIndex);
            currentIndex -= 1;
      
            // Swap with the current element
            temporaryValue = array[currentIndex];
            array[currentIndex] = array[randomIndex];
            array[randomIndex] = temporaryValue;
        }
      
        return array;
    },

    /**
     * Rounds a number to the specified precision
     * @param value - The number to round
     * @param precision - The number of decimal places
     * @returns The rounded number
     */
    roundPrecision(value: number, precision: number): number {
        if (typeof value !== 'number' || isNaN(value)) {
            return NaN;
        }
        if (typeof precision !== 'number' || precision < 0) {
            throw new Error('Precision must be a non-negative number');
        }

        const numberSign = value >= 0 ? 1 : -1;
        const factor = Math.pow(10, precision);
        
        return parseFloat(
            (Math.round((value * factor) + (numberSign * 0.0001)) / factor).toFixed(precision)
        );
    },

    /**
     * Generates a random number within the specified range (inclusive)
     * @param min - The minimum value (default: 0)
     * @param max - The maximum value (default: 2000)
     * @returns A random number between min and max, or NaN if inputs are invalid
     */
    randomRange(min: number = 0, max: number = 2000): number {
        if (isNaN(min) || isNaN(max)) {
            return NaN;
        }
        if (min > max) {
            throw new Error('Minimum value cannot be greater than maximum value');
        }
        
        return Math.floor(Math.random() * (max - min + 1)) + min;
    },

    /**
     * Generates a random alphanumeric string of the specified length
     * @param length - The desired length of the string (default: 12)
     * @returns A random string containing numbers and letters
     */
    randomString(length: number = 12): string {
        if (length < 0) {
            throw new Error('Length cannot be negative');
        }
        if (length === 0) {
            return '';
        }
        
        let str = '';
        const characters = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
        const max = characters.length - 1;
    
        for (let i = 0; i < length; i++) {
            str += characters[Utils.randomRange(0, max)];
        }
    
        return str;
    },

    /**
     * Converts a Hive amount from one currency to another using current exchange rates
     * @param amount - The amount to convert
     * @param fiatSymbol - The source currency symbol
     * @param hiveSymbol - The target Hive currency symbol
     * @returns The converted amount rounded to 3 decimal places
     */
    async convertHiveAmount(amount: number, fiatSymbol: string, hiveSymbol: string): Promise<number> {
        if (typeof amount !== 'number' || amount < 0) {
            throw new Error('Amount must be a non-negative number');
        }
        if (!fiatSymbol || !hiveSymbol) {
            throw new Error('Currency symbols cannot be empty');
        }
        
        if (fiatSymbol === hiveSymbol) {
            return amount;
        }
    
        try {
            const rates = new HiveRates();
            await rates.fetchRates();
    
            const rate = rates.fiatToHiveRate(fiatSymbol, hiveSymbol);
            
            if (rate <= 0) {
                return 0;
            }
            
            const total = amount / rate;
            return Utils.roundPrecision(total, 3);
        } catch (error) {
            if (Config.DEBUG_MODE) {
                console.error('[Utils] Failed to convert Hive amount:', error);
            }
            return 0;
        }
    },

    /**
     * Safely parses a JSON string
     * @param str - The string to parse
     * @returns The parsed object or null if parsing fails
     */
    jsonParse(str: string): any | null {
        if (!str || typeof str !== 'string') {
            return null;
        }

        try {
            return JSON.parse(str);
        } catch (e) {
            if (Config.DEBUG_MODE) {
                const error = e instanceof Error ? e : new Error(String(e));
                console.warn(`[Utils] JSON parse failed: ${error.message}`, {
                    input: str.substring(0, 100) + (str.length > 100 ? '...' : ''),
                    stack: error.stack
                });
            }
            return null;
        }
    },

    /**
     * Retrieves a transaction from a specific block
     * @param client - The Hive client instance
     * @param blockNumber - The block number containing the transaction
     * @param transactionId - The transaction ID to retrieve
     * @returns The signed transaction
     * @throws Error if transaction is not found in the block
     */
    async getTransaction(client: Client, blockNumber: number, transactionId: string): Promise<SignedTransaction> {
        if (!client) {
            throw new Error('Client instance is required');
        }
        if (!transactionId) {
            throw new Error('Transaction ID is required');
        }
        
        try {
            const block = await client.database.getBlock(blockNumber);
            
            if (!block || !block.transaction_ids) {
                throw new Error(`Block ${blockNumber} not found or invalid`);
            }

            const index = block.transaction_ids.indexOf(transactionId);

            if (index === -1) {
                throw new Error(`Unable to find transaction ${transactionId} in block ${blockNumber}`);
            }

            return block.transactions[index] as SignedTransaction;
        } catch (error) {
            if (Config.DEBUG_MODE) {
                console.error('[Utils] Failed to get transaction:', error);
            }
            throw error;
        }
    },

    /**
     * Verifies that a transfer transaction matches the expected parameters
     * @param transaction - The signed transaction to verify
     * @param from - Expected sender account
     * @param to - Expected recipient account
     * @param amount - Expected transfer amount
     * @returns True if the transfer matches all parameters
     */
    async verifyTransfer(transaction: SignedTransaction, from: string, to: string, amount: string): Promise<boolean> {
        if (!transaction || !transaction.operations || transaction.operations.length === 0) {
            return false;
        }
        
        try {
            const operation = transaction.operations[0][1] as any;
            return (operation.from === from && operation.to === to && operation.amount === amount);
        } catch (error) {
            if (Config.DEBUG_MODE) {
                console.error('[Utils] Failed to verify transfer:', error);
            }
            return false;
        }
    },

    /**
     * Transfers Hive tokens between accounts
     * @param client - The Hive client instance
     * @param config - Configuration containing the active key
     * @param from - Sender account name
     * @param to - Recipient account name
     * @param amount - Amount to transfer (will be formatted to 3 decimal places)
     * @param symbol - Token symbol (e.g., 'HIVE', 'HBD')
     * @param memo - Optional memo for the transfer
     * @returns Promise resolving to the broadcast result
     */
    transferHiveTokens(
        client: Client, 
        config: Partial<ConfigInterface>, 
        from: string, 
        to: string, 
        amount: string, 
        symbol: string, 
        memo: string = ''
    ) {
        if (!client || !config.ACTIVE_KEY || !from || !to || !amount || !symbol) {
            throw new Error('Missing required parameters for Hive token transfer');
        }
        
        const key = PrivateKey.fromString(config.ACTIVE_KEY);
        const formattedAmount = `${parseFloat(amount).toFixed(3)} ${symbol}`;
        
        return client.broadcast.transfer({ from, to, amount: formattedAmount, memo }, key);
    },

    /**
     * Transfers Hive tokens to multiple accounts with a delay between transfers
     * @param client - The Hive client instance
     * @param config - Configuration containing the active key
     * @param from - Sender account name
     * @param accounts - Array of recipient account names
     * @param amount - Amount to transfer to each account
     * @param symbol - Token symbol
     * @param memo - Memo for all transfers
     * @returns True if all transfers completed successfully
     */
    async transferHiveTokensMultiple(
        client: Client, 
        config: ConfigInterface, 
        from: string, 
        accounts: string[], 
        amount: string = '0', 
        symbol: string, 
        memo: string
    ): Promise<boolean> {
        if (!Array.isArray(accounts) || accounts.length === 0) {
            throw new Error('Accounts array cannot be empty');
        }
        
        const key = PrivateKey.fromString(config.ACTIVE_KEY);
        let completed = 0;

        for (const user of accounts) {
            const to = user.replace('@', '');
            const formattedAmount = `${parseFloat(amount).toFixed(3)} ${symbol}`;

            try {
                await client.broadcast.transfer({ from, to, amount: formattedAmount, memo }, key);
                completed++;
                
                // Add delay between transfers to avoid rate limiting
                if (completed < accounts.length) {
                    await this.sleep(3000);
                }
            } catch (error) {
                if (Config.DEBUG_MODE) {
                    console.error(`[Utils] Failed to transfer to ${to}:`, error);
                }
                // Continue with other transfers even if one fails
            }
        }

        return completed === accounts.length;
    },

    /**
     * Retrieves account transfer history
     * @param client - The Hive client instance
     * @param account - Account name to get transfers for
     * @param from - Starting index (default: -1 for most recent)
     * @param max - Maximum number of transfers to retrieve
     * @returns Array of transfer operations with date information
     */
    async getAccountTransfers(client: Client, account: string, from: number = -1, max: number = 100): Promise<any[]> {
        if (!account) {
            throw new Error('Account name is required');
        }
        
        try {
            const history = await client.call('condenser_api', 'get_account_history', [account, from, max]);
            
            if (!Array.isArray(history)) {
                return [];
            }
            
            const transfers = history.filter(tx => tx[1]?.op?.[0] === 'transfer');

            return transfers.reduce((arr, tx) => {
                try {
                    const transaction = { ...tx[1].op[1] };
                    const date = new Date(`${tx[1].timestamp}Z`);
        
                    transaction.date = date;
                    arr.push(transaction);
                } catch (error) {
                    if (Config.DEBUG_MODE) {
                        console.warn('[Utils] Failed to process transfer:', error);
                    }
                }
    
                return arr;
            }, []);
        } catch (error) {
            if (Config.DEBUG_MODE) {
                console.error('[Utils] Failed to get account transfers:', error);
            }
            return [];
        }
    },

    /**
     * Retrieves custom JSON operations from the hiveapi account
     * @param client - The Hive client instance
     * @param from - Starting index (default: -1)
     * @param limit - Maximum number of operations to retrieve
     * @returns Array of custom JSON operations with date information
     */
    async getApiJson(client: Client, from: number = -1, limit: number = 500): Promise<any[]> {
        try {
            const history = await client.call('condenser_api', 'get_account_history', ['hiveapi', from, limit]);
            
            if (!Array.isArray(history)) {
                return [];
            }
            
            const customJson = history.filter(tx => tx[1]?.op?.[0] === 'custom_json');

            return customJson.reduce((arr, tx) => {
                try {
                    const transaction = { ...tx[1].op[1] };
                    const date = new Date(`${tx[1].timestamp}Z`);
        
                    transaction.date = date;
                    arr.push(transaction);
                } catch (error) {
                    if (Config.DEBUG_MODE) {
                        console.warn('[Utils] Failed to process custom JSON:', error);
                    }
                }
    
                return arr;
            }, []);
        } catch (error) {
            if (Config.DEBUG_MODE) {
                console.error('[Utils] Failed to get API JSON:', error);
            }
            return [];
        }
    },

    /**
     * Transfers Hive Engine tokens between accounts
     * @param client - The Hive client instance
     * @param config - Configuration containing the active key and Hive Engine ID
     * @param from - Sender account name
     * @param to - Recipient account name
     * @param quantity - Token quantity to transfer
     * @param symbol - Token symbol (will be converted to uppercase)
     * @param memo - Optional memo for the transfer
     * @returns Promise resolving to the broadcast result
     */
    transferHiveEngineTokens(
        client: Client, 
        config: ConfigInterface, 
        from: string, 
        to: string, 
        quantity: string, 
        symbol: string, 
        memo: string = ''
    ) {
        if (!client || !config.ACTIVE_KEY || !from || !to || !quantity || !symbol) {
            throw new Error('Missing required parameters for Hive Engine token transfer');
        }
        
        const key = PrivateKey.fromString(config.ACTIVE_KEY);

        const json = {
            contractName: 'tokens',
            contractAction: 'transfer',
            contractPayload: {
                symbol: symbol.toUpperCase(),
                to,
                quantity,
                memo,
            }
        };

        return client.broadcast.json({
            required_auths: [from], 
            required_posting_auths: [], 
            id: config.HIVE_ENGINE_ID, 
            json: JSON.stringify(json)
        }, key);
    },

    /**
     * Transfers Hive Engine tokens to multiple accounts in batches
     * @param client - The Hive client instance
     * @param config - Configuration containing the active key and Hive Engine ID
     * @param from - Sender account name
     * @param accounts - Array of account objects with 'account' and optional 'amount' properties
     * @param symbol - Token symbol
     * @param memo - Memo for all transfers
     * @param amount - Default amount if not specified per account
     * @returns Promise that resolves when all batches are completed
     */
    async transferHiveEngineTokensMultiple(
        client: Client, 
        config: ConfigInterface, 
        from: string, 
        accounts: any[], 
        symbol: string, 
        memo: string, 
        amount: string = '0'
    ): Promise<void> {
        if (!Array.isArray(accounts) || accounts.length === 0) {
            throw new Error('Accounts array cannot be empty');
        }
        
        const key = PrivateKey.fromString(config.ACTIVE_KEY);
        const payloads: any[][] = [[]];
        let completed = 0;

        // Build payloads in batches to respect size limits
        for (const user of accounts) {
            const account = user.account?.replace('@', '') || '';
            const quantity = user.amount 
                ? parseFloat(user.amount.replace(',', '.')).toString() 
                : parseFloat(amount).toString();

            // Skip if no valid quantity
            if (parseFloat(quantity) <= 0 || !account) {
                continue;
            }

            const json = {
                contractName: 'tokens',
                contractAction: 'transfer',
                contractPayload: {
                    symbol: symbol.toUpperCase(),
                    to: account,
                    quantity,
                    memo,
                },
            };

            const lastPayloadSize = JSON.stringify(payloads[payloads.length - 1]).length;
            const payloadSize = JSON.stringify(json).length;

            if (payloadSize + lastPayloadSize > MAX_PAYLOAD_SIZE) {
                payloads.push([json]);
            } else {
                payloads[payloads.length - 1].push(json);
            }
        }

        // Execute batches with delays
        for (const payload of payloads) {
            if (payload.length === 0) continue;
            
            try {
                await client.broadcast.json({
                    required_auths: [from], 
                    required_posting_auths: [], 
                    id: config.HIVE_ENGINE_ID, 
                    json: JSON.stringify(payload)
                }, key);

                completed++;

                // Add delay between batches
                if (completed < payloads.length) {
                    await this.sleep(3000);
                }
            } catch (error) {
                if (Config.DEBUG_MODE) {
                    console.error('[Utils] Failed to transfer Hive Engine tokens batch:', error);
                }
                throw error;
            }
        }
    },

    /**
     * Issues new Hive Engine tokens to an account
     * @param client - The Hive client instance
     * @param config - Configuration containing the active key and Hive Engine ID
     * @param from - Issuer account name
     * @param to - Recipient account name
     * @param symbol - Token symbol
     * @param quantity - Quantity of tokens to issue
     * @param memo - Optional memo for the issuance
     * @returns Promise resolving to the broadcast result
     */
    issueHiveEngineTokens(
        client: Client, 
        config: ConfigInterface, 
        from: string, 
        to: string, 
        symbol: string, 
        quantity: string, 
        memo: string = ''
    ) {
        if (!client || !config.ACTIVE_KEY || !from || !to || !symbol || !quantity) {
            throw new Error('Missing required parameters for Hive Engine token issuance');
        }
        
        const key = PrivateKey.fromString(config.ACTIVE_KEY);

        const json = {
            contractName: 'tokens',
            contractAction: 'issue',
            contractPayload: {
                symbol,
                to,
                quantity,
                memo,
            },
        };

        if (Config.DEBUG_MODE) {
            console.log('[Utils] Issuing Hive Engine Token:', json);
        }

        return client.broadcast.json({
            required_auths: [from], 
            required_posting_auths: [], 
            id: config.HIVE_ENGINE_ID, 
            json: JSON.stringify(json)
        }, key);
    },

    /**
     * Issues Hive Engine tokens to multiple accounts in batches
     * @param client - The Hive client instance
     * @param config - Configuration containing the active key and Hive Engine ID
     * @param from - Issuer account name
     * @param accounts - Array of account objects with 'account' and optional 'amount' properties
     * @param symbol - Token symbol
     * @param memo - Memo for all issuances
     * @param amount - Default amount if not specified per account
     * @returns Promise that resolves when all batches are completed
     */
    async issueHiveEngineTokensMultiple(
        client: Client, 
        config: ConfigInterface, 
        from: string, 
        accounts: any[], 
        symbol: string, 
        memo: string, 
        amount: string = '0'
    ): Promise<void> {
        if (!Array.isArray(accounts) || accounts.length === 0) {
            throw new Error('Accounts array cannot be empty');
        }
        
        const key = PrivateKey.fromString(config.ACTIVE_KEY);
        const payloads: any[][] = [[]];
        let completed = 0;

        // Build payloads in batches to respect size limits
        for (const user of accounts) {
            const to = user.account?.replace('@', '') || '';
            const quantity = user.amount 
                ? parseFloat(user.amount.replace(',', '.')).toString() 
                : parseFloat(amount).toString();

            // Skip if no valid quantity
            if (parseFloat(quantity) <= 0 || !to) {
                continue;
            }

            const json = {
                contractName: 'tokens',
                contractAction: 'issue',
                contractPayload: {
                    symbol: symbol.toUpperCase(),
                    to,
                    quantity,
                    memo,
                },
            };

            const lastPayloadSize = JSON.stringify(payloads[payloads.length - 1]).length;
            const payloadSize = JSON.stringify(json).length;

            if (payloadSize + lastPayloadSize > MAX_PAYLOAD_SIZE) {
                payloads.push([json]);
            } else {
                payloads[payloads.length - 1].push(json);
            }
        }

        // Execute batches with delays
        for (const payload of payloads) {
            if (payload.length === 0) continue;
            
            try {
                await client.broadcast.json({
                    required_auths: [from], 
                    required_posting_auths: [], 
                    id: config.HIVE_ENGINE_ID, 
                    json: JSON.stringify(payload)
                }, key);

                completed++;

                // Add delay between batches
                if (completed < payloads.length) {
                    await this.sleep(3000);
                }
            } catch (error) {
                if (Config.DEBUG_MODE) {
                    console.error('[Utils] Failed to issue Hive Engine tokens batch:', error);
                }
                throw error;
            }
        }
    },

    /**
     * Generates a deterministic random number based on blockchain data
     * @param previousBlockId - The previous block ID
     * @param blockId - The current block ID
     * @param transactionId - The transaction ID
     * @returns A deterministic random number between 1 and 100
     */
    randomNumber(previousBlockId: string, blockId: string, transactionId: string): number {
        if (!previousBlockId || !blockId || !transactionId) {
            throw new Error('All block and transaction IDs are required for deterministic random number generation');
        }
        
        const seed = `${previousBlockId}${blockId}${transactionId}`;
        const random = seedrandom(seed).double();
        return Math.floor(random * 100) + 1;
    },

    /**
     * Upvotes a post or comment
     * @param client - The Hive client instance
     * @param config - Configuration containing the posting key
     * @param voter - The account name doing the voting
     * @param votePercentage - Vote percentage as a string (default: '100.0')
     * @param author - The author of the post/comment
     * @param permlink - The permlink of the post/comment
     * @returns Promise resolving to the broadcast result
     * @throws Error if negative voting values are provided
     */
    upvote(
        client: Client, 
        config: Partial<ConfigInterface>, 
        voter: string, 
        votePercentage: string = '100.0',
        author: string, 
        permlink: string
    ) {
        if (!client || !config.POSTING_KEY || !voter || !author || !permlink) {
            throw new Error('Missing required parameters for upvote');
        }
        
        const percentage = parseFloat(votePercentage);

        if (percentage < 0) {
            throw new Error('Negative voting values are for downvotes, not upvotes');
        }

        const key = PrivateKey.fromString(config.POSTING_KEY);
        const weight = this.votingWeight(percentage);

        return client.broadcast.vote({ voter, author, permlink, weight }, key);
    },

    /**
     * Downvotes a post or comment
     * @param client - The Hive client instance
     * @param config - Configuration containing the posting key
     * @param voter - The account name doing the voting
     * @param votePercentage - Vote percentage as a string (default: '100.0')
     * @param author - The author of the post/comment
     * @param permlink - The permlink of the post/comment
     * @returns Promise resolving to the broadcast result
     */
    downvote(
        client: Client, 
        config: Partial<ConfigInterface>, 
        voter: string, 
        votePercentage: string = '100.0',
        author: string, 
        permlink: string
    ) {
        if (!client || !config.POSTING_KEY || !voter || !author || !permlink) {
            throw new Error('Missing required parameters for downvote');
        }
        
        const weight = this.votingWeight(parseFloat(votePercentage)) * -1;
        const key = PrivateKey.fromString(config.POSTING_KEY);

        return client.broadcast.vote({ voter, author, permlink, weight }, key);
    },

    /**
     * Converts vote percentage to voting weight for Hive blockchain
     * @param votePercentage - Vote percentage (0-100)
     * @returns Voting weight (0-10000)
     */
    votingWeight(votePercentage: number): number {
        if (typeof votePercentage !== 'number' || votePercentage < 0) {
            throw new Error('Vote percentage must be a non-negative number');
        }
        
        return Math.min(Math.floor(parseFloat(votePercentage.toFixed(2)) * 100), 10000);
    },

    /**
     * Executes an async function for each element in an array sequentially
     * @param array - The array to iterate over
     * @param callback - The async callback function to execute for each element
     * @returns Promise that resolves when all iterations are complete
     */
    async asyncForEach<T>(array: T[], callback: (value: T, index: number, array: T[]) => Promise<void>): Promise<void> {
        if (!Array.isArray(array)) {
            throw new Error('First argument must be an array');
        }
        if (typeof callback !== 'function') {
            throw new Error('Second argument must be a function');
        }
        
        for (let index = 0; index < array.length; index++) {
            await callback(array[index], index, array);
        }
    },

    /**
     * Generates a Hivesigner transfer URL
     * @param to - Recipient account name
     * @param memo - Transfer memo
     * @param amount - Transfer amount with currency symbol
     * @param redirectUri - URI to redirect to after signing
     * @returns The complete Hivesigner transfer URL
     */
    getTransferUrl(to: string, memo: string, amount: string, redirectUri: string): string {
        if (!to || !memo || !amount || !redirectUri) {
            throw new Error('All parameters are required for transfer URL generation');
        }
        
        // URL encode the parameters to handle special characters
        const encodedTo = encodeURIComponent(to);
        const encodedMemo = encodeURIComponent(memo);
        const encodedAmount = encodeURIComponent(amount);
        const encodedRedirectUri = encodeURIComponent(redirectUri);
        
        return `https://hivesigner.com/sign/transfer?to=${encodedTo}&memo=${encodedMemo}&amount=${encodedAmount}&redirect_uri=${encodedRedirectUri}`;
    }

};