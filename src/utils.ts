import BigNumber from 'bignumber.js';
import { HiveRates } from './hive-rates';
import { Client, SignedTransaction, PrivateKey } from '@hiveio/dhive';
import { Config, ConfigInterface } from './config';
import seedrandom from 'seedrandom';
import type { ParsedAssetAmount } from './types/hive-stream';

const MAX_PAYLOAD_SIZE = 2000;
const MAX_ACCOUNTS_CHECK = 999;
const NULL_ACCOUNT = 'null';

type HiveKeyInput = string | PrivateKey;

interface AuthorityInput {
    weight_threshold: number;
    account_auths: [string, number][];
    key_auths: [string, number][];
}

type NumericValue = string | number | BigNumber;

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

    normalizePrivateKeys(keys: HiveKeyInput | HiveKeyInput[]): PrivateKey[] {
        const input = Array.isArray(keys) ? keys : [keys];

        if (input.length === 0) {
            throw new Error('At least one private key is required');
        }

        return input.map((key) => {
            if (key instanceof PrivateKey) {
                return key;
            }

            if (typeof key === 'string' && key.trim().length > 0) {
                return PrivateKey.fromString(key.trim());
            }

            throw new Error('Invalid private key input');
        });
    },

    toHiveTimestamp(value: string | Date): string {
        const date = value instanceof Date ? value : new Date(value);

        if (isNaN(date.getTime())) {
            throw new Error('Invalid date supplied for Hive operation');
        }

        return date.toISOString().replace(/\.\d{3}Z$/, '');
    },

    normalizeJsonMeta(meta?: string | Record<string, any>): string {
        if (meta === undefined || meta === null) {
            return '{}';
        }

        if (typeof meta === 'string') {
            return meta;
        }

        return JSON.stringify(meta);
    },

    parseAssetAmount(rawAmount: string): ParsedAssetAmount {
        if (typeof rawAmount !== 'string' || rawAmount.trim().length === 0) {
            throw new Error('Asset amount must be a non-empty string');
        }

        const parts = rawAmount.trim().split(/\s+/);
        if (parts.length !== 2) {
            throw new Error(`Invalid asset amount '${rawAmount}'`);
        }

        const value = new BigNumber(parts[0]);
        if (value.isNaN() || !value.isFinite()) {
            throw new Error(`Invalid asset amount '${rawAmount}'`);
        }

        return {
            rawAmount: rawAmount.trim(),
            amount: parts[0],
            asset: parts[1],
            value
        };
    },

    calculateBasisPointsAmount(
        amount: NumericValue,
        basisPoints: number,
        precision: number = 3,
        roundingMode: BigNumber.RoundingMode = BigNumber.ROUND_DOWN
    ): string {
        if (!Number.isInteger(basisPoints) || basisPoints < 0 || basisPoints > 10000) {
            throw new Error('basisPoints must be an integer between 0 and 10000');
        }

        if (!Number.isInteger(precision) || precision < 0) {
            throw new Error('precision must be a non-negative integer');
        }

        const value = BigNumber.isBigNumber(amount) ? amount : new BigNumber(amount);
        if (value.isNaN() || !value.isFinite()) {
            throw new Error('Invalid amount');
        }

        return value
            .multipliedBy(basisPoints)
            .dividedBy(10000)
            .decimalPlaces(precision, roundingMode)
            .toFixed(precision);
    },

    formatAmount(
        amount: NumericValue,
        precision: number = 3,
        roundingMode: BigNumber.RoundingMode = BigNumber.ROUND_DOWN
    ): string {
        if (!Number.isInteger(precision) || precision < 0) {
            throw new Error('precision must be a non-negative integer');
        }

        const value = BigNumber.isBigNumber(amount) ? amount : new BigNumber(amount);
        if (value.isNaN() || !value.isFinite()) {
            throw new Error('Invalid amount');
        }

        return value.decimalPlaces(precision, roundingMode).toFixed(precision);
    },

    formatAssetAmount(
        amount: NumericValue,
        symbol: string,
        precision: number = 3,
        roundingMode: BigNumber.RoundingMode = BigNumber.ROUND_DOWN
    ): string {
        if (typeof symbol !== 'string' || symbol.trim().length === 0) {
            throw new Error('Asset symbol is required');
        }

        return `${this.formatAmount(amount, precision, roundingMode)} ${symbol.trim()}`;
    },

    calculatePercentageAmount(
        amount: NumericValue,
        percentage: NumericValue,
        precision: number = 3,
        roundingMode: BigNumber.RoundingMode = BigNumber.ROUND_DOWN
    ): string {
        if (!Number.isInteger(precision) || precision < 0) {
            throw new Error('precision must be a non-negative integer');
        }

        const value = BigNumber.isBigNumber(amount) ? amount : new BigNumber(amount);
        const percentageValue = BigNumber.isBigNumber(percentage) ? percentage : new BigNumber(percentage);

        if (value.isNaN() || !value.isFinite()) {
            throw new Error('Invalid amount');
        }

        if (percentageValue.isNaN() || !percentageValue.isFinite()) {
            throw new Error('Invalid percentage');
        }

        if (percentageValue.lt(0) || percentageValue.gt(100)) {
            throw new Error('percentage must be between 0 and 100');
        }

        return value
            .multipliedBy(percentageValue)
            .dividedBy(100)
            .decimalPlaces(precision, roundingMode)
            .toFixed(precision);
    },

    splitAmountByBasisPoints(
        amount: NumericValue,
        basisPoints: number[],
        precision: number = 3,
        roundingMode: BigNumber.RoundingMode = BigNumber.ROUND_DOWN
    ): string[] {
        if (!Array.isArray(basisPoints) || basisPoints.length === 0) {
            throw new Error('basisPoints array cannot be empty');
        }

        if (!Number.isInteger(precision) || precision < 0) {
            throw new Error('precision must be a non-negative integer');
        }

        const totalBps = basisPoints.reduce((sum, value) => sum + value, 0);
        if (totalBps !== 10000) {
            throw new Error('basisPoints allocations must total 10000');
        }

        const value = BigNumber.isBigNumber(amount) ? amount : new BigNumber(amount);
        if (value.isNaN() || !value.isFinite()) {
            throw new Error('Invalid amount');
        }

        let allocated = new BigNumber(0);

        return basisPoints.map((bps, index) => {
            if (!Number.isInteger(bps) || bps < 0 || bps > 10000) {
                throw new Error('basisPoints must be integers between 0 and 10000');
            }

            const share = index === basisPoints.length - 1
                ? value.minus(allocated)
                : value.multipliedBy(bps).dividedBy(10000).decimalPlaces(precision, roundingMode);

            allocated = allocated.plus(share);
            return share.toFixed(precision);
        });
    },

    splitAmountByPercentage(
        amount: NumericValue,
        percentages: Array<string | number>,
        precision: number = 3,
        roundingMode: BigNumber.RoundingMode = BigNumber.ROUND_DOWN
    ): string[] {
        if (!Array.isArray(percentages) || percentages.length === 0) {
            throw new Error('percentages array cannot be empty');
        }

        const normalized = percentages.map((percentage) => {
            const value = BigNumber.isBigNumber(percentage) ? percentage : new BigNumber(percentage);

            if (value.isNaN() || !value.isFinite()) {
                throw new Error('Invalid percentage');
            }

            if (value.lt(0) || value.gt(100)) {
                throw new Error('percentage must be between 0 and 100');
            }

            return value;
        });

        const total = normalized.reduce((sum, value) => sum.plus(value), new BigNumber(0));
        if (!total.eq(100)) {
            throw new Error('percentages must total 100');
        }

        const value = BigNumber.isBigNumber(amount) ? amount : new BigNumber(amount);
        if (value.isNaN() || !value.isFinite()) {
            throw new Error('Invalid amount');
        }

        let allocated = new BigNumber(0);

        return normalized.map((percentage, index) => {
            const share = index === normalized.length - 1
                ? value.minus(allocated)
                : value.multipliedBy(percentage).dividedBy(100).decimalPlaces(precision, roundingMode);

            allocated = allocated.plus(share);
            return share.toFixed(precision);
        });
    },

    splitAmountByWeights(
        amount: NumericValue,
        weights: Array<string | number>,
        precision: number = 3,
        roundingMode: BigNumber.RoundingMode = BigNumber.ROUND_DOWN
    ): string[] {
        if (!Array.isArray(weights) || weights.length === 0) {
            throw new Error('weights array cannot be empty');
        }

        if (!Number.isInteger(precision) || precision < 0) {
            throw new Error('precision must be a non-negative integer');
        }

        const normalized = weights.map((weight) => {
            const value = BigNumber.isBigNumber(weight) ? weight : new BigNumber(weight);

            if (value.isNaN() || !value.isFinite()) {
                throw new Error('Invalid weight');
            }

            if (value.lte(0)) {
                throw new Error('weights must be greater than zero');
            }

            return value;
        });

        const totalWeight = normalized.reduce((sum, value) => sum.plus(value), new BigNumber(0));
        const value = BigNumber.isBigNumber(amount) ? amount : new BigNumber(amount);

        if (value.isNaN() || !value.isFinite()) {
            throw new Error('Invalid amount');
        }

        let allocated = new BigNumber(0);

        return normalized.map((weight, index) => {
            const share = index === normalized.length - 1
                ? value.minus(allocated)
                : value.multipliedBy(weight).dividedBy(totalWeight).decimalPlaces(precision, roundingMode);

            allocated = allocated.plus(share);
            return share.toFixed(precision);
        });
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

        let formattedAmount: string;
        try {
            formattedAmount = this.formatAssetAmount(amount, symbol);
        } catch (error) {
            throw new Error('Invalid transfer amount');
        }

        const key = PrivateKey.fromString(config.ACTIVE_KEY);

        return client.broadcast.transfer({ from, to, amount: formattedAmount, memo }, key);
    },

    /**
     * Burns HIVE or HBD by transferring the amount to the null account.
     * @param client - The Hive client instance
     * @param config - Configuration containing the active key
     * @param from - Sender account name
     * @param amount - Amount to burn
     * @param symbol - Asset symbol (HIVE or HBD)
     * @param memo - Optional memo for the burn transfer
     * @returns Promise resolving to the broadcast result
     */
    burnHiveTokens(
        client: Client,
        config: Partial<ConfigInterface>,
        from: string,
        amount: string,
        symbol: string,
        memo: string = ''
    ) {
        return this.transferHiveTokens(client, config, from, NULL_ACCOUNT, amount, symbol, memo);
    },

    /**
     * Broadcasts one or more Hive operations signed by one or multiple private keys.
     */
    broadcastOperations(
        client: Client,
        operations: Array<[string, any]>,
        signingKeys: HiveKeyInput | HiveKeyInput[]
    ) {
        if (!client || !Array.isArray(operations) || operations.length === 0) {
            throw new Error('Client and at least one operation are required');
        }

        const keys = this.normalizePrivateKeys(signingKeys);

        return client.broadcast.sendOperations(operations as any, keys.length === 1 ? keys[0] : keys);
    },

    /**
     * Alias for explicitly broadcasting with multiple signatures.
     */
    broadcastMultiSigOperations(
        client: Client,
        operations: Array<[string, any]>,
        signingKeys: HiveKeyInput[]
    ) {
        if (!Array.isArray(signingKeys) || signingKeys.length < 2) {
            throw new Error('Multi-sign broadcast requires at least two keys');
        }

        return this.broadcastOperations(client, operations, signingKeys);
    },

    /**
     * Builds a Hive authority object for account_update/account_update2 operations.
     */
    createAuthority(
        keyAuths: Array<[string, number]> = [],
        accountAuths: Array<[string, number]> = [],
        weightThreshold: number = 1
    ): AuthorityInput {
        if (weightThreshold <= 0) {
            throw new Error('Authority weight threshold must be greater than zero');
        }

        if (!Array.isArray(keyAuths) || !Array.isArray(accountAuths)) {
            throw new Error('Authority auths must be arrays');
        }

        return {
            weight_threshold: weightThreshold,
            account_auths: accountAuths,
            key_auths: keyAuths
        };
    },

    /**
     * Updates account authorities, enabling native Hive multisig thresholds.
     */
    async updateAccountAuthorities(
        client: Client,
        config: Partial<ConfigInterface>,
        account: string,
        authorityUpdate: {
            owner?: AuthorityInput;
            active?: AuthorityInput;
            posting?: AuthorityInput;
            memo_key?: string;
            json_metadata?: string;
            posting_json_metadata?: string;
            useAccountUpdate2?: boolean;
        },
        signingKeys?: HiveKeyInput | HiveKeyInput[]
    ) {
        if (!client || !account || !authorityUpdate) {
            throw new Error('Client, account, and authority update data are required');
        }

        const keys = signingKeys || config.ACTIVE_KEY;

        if (!keys) {
            throw new Error('Active key or explicit signing keys are required for account authority updates');
        }

        const accounts = await client.database.getAccounts([account]);
        const existingAccount = Array.isArray(accounts) ? accounts[0] : null;

        if (!existingAccount) {
            throw new Error(`Unable to load account '${account}' for authority update`);
        }

        const memoKey = authorityUpdate.memo_key || existingAccount.memo_key;
        const jsonMetadata = authorityUpdate.json_metadata !== undefined
            ? authorityUpdate.json_metadata
            : (existingAccount.json_metadata || '');
        const postingJsonMetadata = authorityUpdate.posting_json_metadata !== undefined
            ? authorityUpdate.posting_json_metadata
            : (existingAccount.posting_json_metadata || '');

        const useUpdate2 = Boolean(authorityUpdate.useAccountUpdate2 || authorityUpdate.posting_json_metadata !== undefined);

        if (useUpdate2) {
            const operation: [string, any] = ['account_update2', {
                account,
                owner: authorityUpdate.owner,
                active: authorityUpdate.active,
                posting: authorityUpdate.posting,
                memo_key: memoKey,
                json_metadata: jsonMetadata,
                posting_json_metadata: postingJsonMetadata,
                extensions: []
            }];

            return this.broadcastOperations(client, [operation], keys);
        }

        const operation: [string, any] = ['account_update', {
            account,
            owner: authorityUpdate.owner,
            active: authorityUpdate.active,
            posting: authorityUpdate.posting,
            memo_key: memoKey,
            json_metadata: jsonMetadata
        }];

        return this.broadcastOperations(client, [operation], keys);
    },

    /**
     * Creates an escrow transfer on Hive.
     */
    escrowTransfer(
        client: Client,
        config: Partial<ConfigInterface>,
        options: {
            from: string;
            to: string;
            agent: string;
            escrow_id: number;
            hive_amount?: string;
            hbd_amount?: string;
            fee: string;
            ratification_deadline: string | Date;
            escrow_expiration: string | Date;
            json_meta?: string | Record<string, any>;
        },
        signingKeys?: HiveKeyInput | HiveKeyInput[]
    ) {
        if (!client || !options?.from || !options?.to || !options?.agent) {
            throw new Error('Escrow transfer requires client, from, to, and agent');
        }

        if (typeof options.escrow_id !== 'number') {
            throw new Error('Escrow transfer requires a numeric escrow_id');
        }

        if (!options.fee) {
            throw new Error('Escrow transfer requires an escrow fee');
        }

        const keys = signingKeys || config.ACTIVE_KEY;

        if (!keys) {
            throw new Error('Active key or explicit signing keys are required for escrow transfer');
        }

        const operation: [string, any] = ['escrow_transfer', {
            from: options.from,
            to: options.to,
            agent: options.agent,
            escrow_id: options.escrow_id,
            hive_amount: options.hive_amount || '0.000 HIVE',
            hbd_amount: options.hbd_amount || '0.000 HBD',
            fee: options.fee,
            ratification_deadline: this.toHiveTimestamp(options.ratification_deadline),
            escrow_expiration: this.toHiveTimestamp(options.escrow_expiration),
            json_meta: this.normalizeJsonMeta(options.json_meta)
        }];

        return this.broadcastOperations(client, [operation], keys);
    },

    /**
     * Approves or rejects an escrow transfer.
     */
    escrowApprove(
        client: Client,
        config: Partial<ConfigInterface>,
        options: {
            from: string;
            to: string;
            agent: string;
            who: string;
            escrow_id: number;
            approve: boolean;
        },
        signingKeys?: HiveKeyInput | HiveKeyInput[]
    ) {
        if (!client || !options?.from || !options?.to || !options?.agent || !options?.who) {
            throw new Error('Escrow approve requires client, from, to, agent, and who');
        }

        const keys = signingKeys || config.ACTIVE_KEY;

        if (!keys) {
            throw new Error('Active key or explicit signing keys are required for escrow approval');
        }

        const operation: [string, any] = ['escrow_approve', {
            from: options.from,
            to: options.to,
            agent: options.agent,
            who: options.who,
            escrow_id: options.escrow_id,
            approve: options.approve
        }];

        return this.broadcastOperations(client, [operation], keys);
    },

    /**
     * Opens an escrow dispute.
     */
    escrowDispute(
        client: Client,
        config: Partial<ConfigInterface>,
        options: {
            from: string;
            to: string;
            agent: string;
            who: string;
            escrow_id: number;
        },
        signingKeys?: HiveKeyInput | HiveKeyInput[]
    ) {
        if (!client || !options?.from || !options?.to || !options?.agent || !options?.who) {
            throw new Error('Escrow dispute requires client, from, to, agent, and who');
        }

        const keys = signingKeys || config.ACTIVE_KEY;

        if (!keys) {
            throw new Error('Active key or explicit signing keys are required for escrow dispute');
        }

        const operation: [string, any] = ['escrow_dispute', {
            from: options.from,
            to: options.to,
            agent: options.agent,
            who: options.who,
            escrow_id: options.escrow_id
        }];

        return this.broadcastOperations(client, [operation], keys);
    },

    /**
     * Releases escrow funds.
     */
    escrowRelease(
        client: Client,
        config: Partial<ConfigInterface>,
        options: {
            from: string;
            to: string;
            agent: string;
            who: string;
            receiver: string;
            escrow_id: number;
            hive_amount?: string;
            hbd_amount?: string;
        },
        signingKeys?: HiveKeyInput | HiveKeyInput[]
    ) {
        if (!client || !options?.from || !options?.to || !options?.agent || !options?.who || !options?.receiver) {
            throw new Error('Escrow release requires client, from, to, agent, who, and receiver');
        }

        const keys = signingKeys || config.ACTIVE_KEY;

        if (!keys) {
            throw new Error('Active key or explicit signing keys are required for escrow release');
        }

        const operation: [string, any] = ['escrow_release', {
            from: options.from,
            to: options.to,
            agent: options.agent,
            who: options.who,
            receiver: options.receiver,
            escrow_id: options.escrow_id,
            hive_amount: options.hive_amount || '0.000 HIVE',
            hbd_amount: options.hbd_amount || '0.000 HBD'
        }];

        return this.broadcastOperations(client, [operation], keys);
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
            const formattedAmount = this.formatAssetAmount(amount, symbol);

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
     * Burns Hive Engine tokens by transferring them to the null account.
     * @param client - The Hive client instance
     * @param config - Configuration containing the active key and Hive Engine ID
     * @param from - Sender account name
     * @param symbol - Token symbol
     * @param quantity - Token quantity to burn
     * @param memo - Optional memo for the burn transfer
     * @returns Promise resolving to the broadcast result
     */
    burnHiveEngineTokens(
        client: Client,
        config: ConfigInterface,
        from: string,
        symbol: string,
        quantity: string,
        memo: string = ''
    ) {
        return this.transferHiveEngineTokens(client, config, from, NULL_ACCOUNT, quantity, symbol, memo);
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
     * Schedules a recurrent transfer on Hive.
     */
    recurrentTransfer(
        client: Client,
        config: Partial<ConfigInterface>,
        options: {
            from: string;
            to: string;
            amount: string;
            memo?: string;
            recurrence: number;
            executions: number;
        },
        signingKeys?: HiveKeyInput | HiveKeyInput[]
    ) {
        if (!client || !options?.from || !options?.to || !options?.amount) {
            throw new Error('Recurrent transfer requires client, from, to, and amount');
        }

        if (!Number.isInteger(options.recurrence) || options.recurrence <= 0) {
            throw new Error('Recurrent transfer requires a positive integer recurrence');
        }

        if (!Number.isInteger(options.executions) || options.executions <= 0) {
            throw new Error('Recurrent transfer requires a positive integer executions value');
        }

        const keys = signingKeys || config.ACTIVE_KEY;

        if (!keys) {
            throw new Error('Active key or explicit signing keys are required for recurrent transfer');
        }

        const operation: [string, any] = ['recurrent_transfer', {
            from: options.from,
            to: options.to,
            amount: options.amount,
            memo: options.memo || '',
            recurrence: options.recurrence,
            executions: options.executions,
            extensions: []
        }];

        return this.broadcastOperations(client, [operation], keys);
    },

    /**
     * Creates a DHF proposal.
     */
    createProposal(
        client: Client,
        config: Partial<ConfigInterface>,
        options: {
            creator: string;
            receiver: string;
            start_date: string | Date;
            end_date: string | Date;
            daily_pay: string;
            subject: string;
            permlink: string;
        },
        signingKeys?: HiveKeyInput | HiveKeyInput[]
    ) {
        if (!client || !options?.creator || !options?.receiver || !options?.daily_pay || !options?.subject || !options?.permlink) {
            throw new Error('Create proposal requires creator, receiver, daily_pay, subject, and permlink');
        }

        const keys = signingKeys || config.ACTIVE_KEY;

        if (!keys) {
            throw new Error('Active key or explicit signing keys are required for proposal creation');
        }

        const operation: [string, any] = ['create_proposal', {
            creator: options.creator,
            receiver: options.receiver,
            start_date: this.toHiveTimestamp(options.start_date),
            end_date: this.toHiveTimestamp(options.end_date),
            daily_pay: options.daily_pay,
            subject: options.subject,
            permlink: options.permlink,
            extensions: []
        }];

        return this.broadcastOperations(client, [operation], keys);
    },

    /**
     * Votes for/against one or more DHF proposals.
     */
    updateProposalVotes(
        client: Client,
        config: Partial<ConfigInterface>,
        options: {
            voter: string;
            proposal_ids: number[];
            approve: boolean;
        },
        signingKeys?: HiveKeyInput | HiveKeyInput[]
    ) {
        if (!client || !options?.voter || !Array.isArray(options.proposal_ids) || options.proposal_ids.length === 0) {
            throw new Error('Proposal votes require voter and proposal_ids');
        }

        const keys = signingKeys || config.ACTIVE_KEY;

        if (!keys) {
            throw new Error('Active key or explicit signing keys are required for proposal voting');
        }

        const operation: [string, any] = ['update_proposal_votes', {
            voter: options.voter,
            proposal_ids: options.proposal_ids,
            approve: options.approve,
            extensions: []
        }];

        return this.broadcastOperations(client, [operation], keys);
    },

    /**
     * Removes one or more DHF proposals.
     */
    removeProposals(
        client: Client,
        config: Partial<ConfigInterface>,
        options: {
            proposal_owner: string;
            proposal_ids: number[];
        },
        signingKeys?: HiveKeyInput | HiveKeyInput[]
    ) {
        if (!client || !options?.proposal_owner || !Array.isArray(options.proposal_ids) || options.proposal_ids.length === 0) {
            throw new Error('Remove proposals requires proposal_owner and proposal_ids');
        }

        const keys = signingKeys || config.ACTIVE_KEY;

        if (!keys) {
            throw new Error('Active key or explicit signing keys are required for proposal removal');
        }

        const operation: [string, any] = ['remove_proposal', {
            proposal_owner: options.proposal_owner,
            proposal_ids: options.proposal_ids,
            extensions: []
        }];

        return this.broadcastOperations(client, [operation], keys);
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
