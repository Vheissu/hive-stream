import { Streamer } from '../streamer';
import seedrandom from 'seedrandom';
import { v4 as uuidv4 } from 'uuid';
import BigNumber from 'bignumber.js';

const CONTRACT_NAME = 'coinflip';

const ACCOUNT = 'beggars';
const TOKEN_SYMBOL = 'HIVE';
const VALID_CURRENCIES = ['HIVE'];
const MAX_AMOUNT = 20;
const MIN_AMOUNT = 0.001;

// Provably Fair Random Number Generator for coinflip
// Uses deterministic blockchain data to ensure results are verifiable by users
function rng(previousBlockId, blockId, transactionId, serverSeed, clientSeed = ''): 'heads' | 'tails' {
    // Validate inputs to prevent manipulation
    if (!previousBlockId || !blockId || !transactionId || !serverSeed) {
        throw new Error('Invalid RNG parameters');
    }
    
    const random = seedrandom(`${previousBlockId}${blockId}${transactionId}${clientSeed}${serverSeed}`).double();
    const randomRoll = Math.floor(random * 2) + 1;
    
    // Ensure result is within expected range
    if (randomRoll < 1 || randomRoll > 2) {
        throw new Error('RNG generated invalid result');
    }

    return randomRoll === 1 ? 'heads' : 'tails';
}

export class CoinflipContract {
    public _instance: Streamer;
    private adapter;

    private blockNumber;
    private blockId;
    private previousBlockId;
    private transactionId;
    
    // Cache for account balance to reduce API calls
    private balanceCache: { balance: BigNumber, timestamp: number } | null = null;
    private readonly balanceCacheTimeout = 30000; // 30 seconds
    
    // Queue system for processing bets to prevent race conditions
    private betQueue: Array<() => Promise<void>> = [];
    private processingQueue = false;
    private pendingPayouts = new BigNumber(0);

    public create() {
        this.adapter = this._instance.getAdapter();
    }
    
    public destroy() {
        // Cleanup resources
    }
    
    /**
     * Get Balance with caching
     */
    private async getBalance(): Promise<BigNumber> {
        const now = Date.now();
        
        // Return cached balance if still valid
        if (this.balanceCache && (now - this.balanceCache.timestamp) < this.balanceCacheTimeout) {
            return this.balanceCache.balance;
        }
        
        try {
            const account = await this._instance['client'].database.getAccounts([ACCOUNT]);

            if (account?.[0]) {
                const balance = (account[0].balance as string).split(' ');
                const amount = new BigNumber(balance[0]);
                
                // Validate the amount is a valid number
                if (amount.isNaN() || !amount.isFinite()) {
                    throw new Error('Invalid balance format received from API');
                }
                
                // Cache the balance
                this.balanceCache = {
                    balance: amount,
                    timestamp: now
                };
                
                return amount;
            }
        } catch (error) {
            console.error('[CoinflipContract] Error fetching balance:', error);
            // Return cached balance if available, even if expired
            if (this.balanceCache) {
                return this.balanceCache.balance;
            }
        }

        return new BigNumber(0);
    }

    public updateBlockInfo(blockNumber, blockId, previousBlockId, transactionId) {
        // Lifecycle method which sets block info 
        this.blockNumber = blockNumber;
        this.blockId = blockId;
        this.previousBlockId = previousBlockId;
        this.transactionId = transactionId;
    }

    async flip(payload, { sender, amount }) {
        // Add bet to queue for processing
        return new Promise<void>((resolve, reject) => {
            this.betQueue.push(async () => {
                try {
                    await this.processFlip(payload, { sender, amount });
                    resolve();
                } catch (error) {
                    reject(error);
                }
            });
            
            // Start processing queue if not already running
            this.processQueue();
        });
    }
    
    private async processQueue() {
        if (this.processingQueue || this.betQueue.length === 0) {
            return;
        }
        
        this.processingQueue = true;
        
        while (this.betQueue.length > 0) {
            const nextBet = this.betQueue.shift();
            if (nextBet) {
                try {
                    await nextBet();
                } catch (error) {
                    console.error('[CoinflipContract] Queue processing error:', error);
                }
            }
        }
        
        this.processingQueue = false;
    }
    
    private async processFlip(payload, { sender, amount }) {
        
        try {
            // Validate payload structure
            if (!payload || typeof payload !== 'object') {
                throw new Error('Invalid payload structure');
            }
            
            const { guess, seed } = payload;

            const VALID_GUESSES = ['heads', 'tails'];

            // Validate amount format
            if (!amount || typeof amount !== 'string' || !amount.includes(' ')) {
                throw new Error('Invalid amount format');
            }

            const amountTrim = amount.split(' ');
            
            if (amountTrim.length !== 2) {
                throw new Error('Invalid amount format');
            }

            // Parse the numeric value using BigNumber for precision
            const amountParsed = new BigNumber(amountTrim[0]);
            
            // Validate the parsed amount
            if (amountParsed.isNaN() || !amountParsed.isFinite() || amountParsed.isNegative()) {
                throw new Error('Invalid amount value');
            }
            
            const amountCurrency = amountTrim[1].trim();

            const transaction = await this._instance.getTransaction(this.blockNumber, this.transactionId);
            const verify = await this._instance.verifyTransfer(transaction, sender, ACCOUNT, amount);
            
            // Get the balance of our contract account
            const balance = await this.getBalance();
            
            // Calculate available balance (total - pending payouts)
            const availableBalance = balance.minus(this.pendingPayouts);

            if (verify) {
                // User sent an invalid currency
                if (!VALID_CURRENCIES.includes(amountCurrency)) {
                    await this._instance.transferHiveTokens(ACCOUNT, sender, amountTrim[0], amountTrim[1], `[Refund] You sent an invalid currency.`);
                    return;
                }
                
                // Validate bet amount is within bounds
                if (amountParsed.isLessThan(MIN_AMOUNT)) {
                    await this._instance.transferHiveTokens(ACCOUNT, sender, amountTrim[0], amountTrim[1], `[Refund] Bet amount too small. Minimum: ${MIN_AMOUNT} ${amountCurrency}.`);
                    return;
                }

                // User sent too much, refund the bet
                if (amountParsed.isGreaterThan(MAX_AMOUNT)) {
                    await this._instance.transferHiveTokens(ACCOUNT, sender, amountTrim[0], amountTrim[1], `[Refund] You sent too much. Maximum: ${MAX_AMOUNT} ${amountCurrency}.`);
                    return;
                }
                
                // Calculate potential payout (2x bet amount)
                const potentialPayout = amountParsed.multipliedBy(2);
                
                // Check if server can afford the payout
                if (potentialPayout.isGreaterThan(availableBalance)) {
                    await this._instance.transferHiveTokens(ACCOUNT, sender, amountTrim[0], amountTrim[1], `[Refund] The server cannot afford this bet payout.`);
                    return;
                }

                // Invalid guess
                if (!guess || !VALID_GUESSES.includes(guess)) {
                    await this._instance.transferHiveTokens(ACCOUNT, sender, amountTrim[0], amountTrim[1], `[Refund] Invalid guess. Please only send heads or tails.`);
                    return;
                }
                
                // Reserve the potential payout
                this.pendingPayouts = this.pendingPayouts.plus(potentialPayout);

                try {
                    const serverSeed = uuidv4();
                    
                    // Validate server seed was generated
                    if (!serverSeed || typeof serverSeed !== 'string') {
                        throw new Error('Failed to generate server seed');
                    }
                    
                    const generatedGuess = rng(this.previousBlockId, this.blockId, this.transactionId, serverSeed, seed ?? '');

                    if (generatedGuess === guess) {
                        await this.adapter.addEvent(new Date(), CONTRACT_NAME, 'flip', payload, {
                            action: 'transfer',
                            data: {
                                date: new Date(),
                                guess,
                                serverSeed,
                                previousBlockId: this.previousBlockId,
                                blockId: this.blockId,
                                transactionId: this.transactionId,
                                userWon: 'true'
                            }
                        });

                        await this._instance.transferHiveTokens(ACCOUNT, sender, potentialPayout.toFixed(3), amountTrim[1], `[Winner] | Guess: ${guess} | Server Roll: ${generatedGuess} | Previous block id: ${this.previousBlockId} | BlockID: ${this.blockId} | Trx ID: ${this.transactionId} | Server Seed: ${serverSeed}`);
                        return;
                    }

                    await this.adapter.addEvent(new Date(), CONTRACT_NAME, 'flip', payload, {
                        action: 'transfer',
                        data: {
                            guess,
                            serverSeed,
                            previousBlockId: this.previousBlockId,
                            blockId: this.blockId,
                            transactionId: this.transactionId,
                            userWon: 'false'
                        }
                    });

                    await this._instance.transferHiveTokens(ACCOUNT, sender, '0.001', amountTrim[1], `[Lost] | Guess: ${guess} | Server Roll: ${generatedGuess} | Previous block id: ${this.previousBlockId} | BlockID: ${this.blockId} | Trx ID: ${this.transactionId} | Server Seed: ${serverSeed}`);
                } finally {
                    // Release the reserved payout
                    this.pendingPayouts = this.pendingPayouts.minus(potentialPayout);
                }
            }
        } catch (e) {
            const error = e instanceof Error ? e : new Error(String(e));
            console.error(`[CoinflipContract] Flip processing error: ${error.message}`, {
                sender,
                amount,
                payload,
                stack: error.stack
            });
            
            // Attempt to refund on error if amount is valid
            try {
                if (amount && typeof amount === 'string' && amount.includes(' ')) {
                    const [amountStr, currency] = amount.split(' ');
                    const amountBN = new BigNumber(amountStr);
                    if (!amountBN.isNaN() && amountBN.isFinite() && !amountBN.isNegative()) {
                        await this._instance.transferHiveTokens(ACCOUNT, sender, amountStr, currency, '[Refund] Processing error occurred.');
                    }
                }
            } catch (refundError) {
                console.error(`[CoinflipContract] Failed to refund after error:`, refundError);
            }
            
            throw error;
        }
    }
}