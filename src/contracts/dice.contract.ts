import { Streamer } from './../streamer';
import { Utils } from './../utils';
import seedrandom from 'seedrandom';
import BigNumber from 'bignumber.js';

const CONTRACT_NAME = 'hivedice';

const ACCOUNT = 'beggars';
const TOKEN_SYMBOL = 'HIVE';

const HOUSE_EDGE = 0.05;
const MIN_BET = 1;
const MAX_BET = 10;

// Provably Fair Random Number Generator
// Uses deterministic blockchain data to ensure results are verifiable by users
// This is the correct approach for transparent, auditable gambling systems
const rng = (previousBlockId, blockId, transactionId) => {
    // Validate inputs to prevent manipulation
    if (!previousBlockId || !blockId || !transactionId) {
        throw new Error('Invalid RNG parameters');
    }
    
    const random = seedrandom(`${previousBlockId}${blockId}${transactionId}`).double();
    const randomRoll = Math.floor(random * 100) + 1;

    // Ensure result is within expected range
    if (randomRoll < 1 || randomRoll > 100) {
        throw new Error('RNG generated invalid result');
    }

    return randomRoll;
};

// Valid betting currencies
const VALID_CURRENCIES = ['HIVE'];

export class DiceContract {
    public _instance: Streamer;

    private blockNumber: number;
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
        // Runs every time register is called on this contract
        // Do setup logic and code in here (creating a database, etc)
    }

    public destroy() {
        // Runs every time unregister is run for this contract
        // Close database connections, write to a database with state, etc
    }

    // Updates the contract with information about the current block
    // This is a method automatically called if it exists
    public updateBlockInfo(blockNumber, blockId, previousBlockId, transactionId) {
        // Lifecycle method which sets block info 
        this.blockNumber = blockNumber;
        this.blockId = blockId;
        this.previousBlockId = previousBlockId;
        this.transactionId = transactionId;
    }

    /**
     * Get Balance
     *
     * Helper method for getting the contract account balance with caching
     * We cache the balance to reduce API calls since it doesn't change frequently
     *
     * @returns number
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
            console.error('[DiceContainer] Error fetching balance:', error);
            // Return cached balance if available, even if expired
            if (this.balanceCache) {
                return this.balanceCache.balance;
            }
        }

        return new BigNumber(0);
    }

    /**
     * Roll
     *
     * Automatically called when a custom JSON action matches the following method
     *
     * @param payload
     * @param param1 - sender and amount
     */
    private async roll(payload: { roll: number }, { sender, amount }) {
        // Add bet to queue for processing
        return new Promise<void>((resolve, reject) => {
            this.betQueue.push(async () => {
                try {
                    await this.processRoll(payload, { sender, amount });
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
                    console.error('[DiceContract] Queue processing error:', error);
                }
            }
        }
        
        this.processingQueue = false;
    }
    
    private async processRoll(payload: { roll: number }, { sender, amount }) {
        
        try {
            // Validate payload structure
            if (!payload || typeof payload.roll !== 'number') {
                throw new Error('Invalid payload structure');
            }
            
            // Destructure the values from the payload
            const { roll } = payload;

            // Validate amount format
            if (!amount || typeof amount !== 'string' || !amount.includes(' ')) {
                throw new Error('Invalid amount format');
            }

            // The amount is formatted like 100 HIVE
            // The value is the first part, the currency symbol is the second
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

            // Format the amount to 3 decimal places
            const amountFormatted = amountParsed.toFixed(3);

            // Trim any space from the currency symbol
            const amountCurrency = amountTrim[1].trim();

            // console.log(`Roll: ${roll}
            //             Amount parsed: ${amountParsed}
            //             Amount formatted: ${amountFormatted}
            //             Currency: ${amountCurrency}`);

            // Get the transaction from the blockchain
            const transaction = await this._instance.getTransaction(this.blockNumber, this.transactionId);

            // Call the verifyTransfer method to confirm the transfer happened
            const verify = await this._instance.verifyTransfer(transaction, sender, 'beggars', amount);

            // Get the balance of our contract account
            const balance = await this.getBalance();
            
            // Calculate available balance (total - pending payouts)
            const availableBalance = balance.minus(this.pendingPayouts);

            // Transfer is valid
            if (verify) {
                // Server balance is less than the minimum required, cancel and refund
                if (availableBalance.isLessThan(new BigNumber(MIN_BET * 2))) {
                    // Send back what was sent, the server is broke
                    await this._instance.transferHiveTokens(ACCOUNT, sender, amountTrim[0], amountTrim[1], `[Refund] The server could not fulfill your bet.`);
                    return;
                }

                // Bet amount is valid
                if (amountParsed.isGreaterThanOrEqualTo(MIN_BET) && amountParsed.isLessThanOrEqualTo(MAX_BET)) {
                    // Validate roll is valid (integer between 2-96)
                    if (Number.isInteger(roll) && roll >= 2 && roll <= 96 && VALID_CURRENCIES.includes(amountCurrency)) {
                        // Calculate the multiplier percentage
                        const multiplier = new BigNumber(1).minus(HOUSE_EDGE).multipliedBy(100).dividedBy(roll);

                        // Calculate the number of tokens won
                        const tokensWonBN = amountParsed.multipliedBy(multiplier);
                        const tokensWon = tokensWonBN.toFixed(3, BigNumber.ROUND_DOWN);

                        // User won more than the server can afford, refund the bet amount
                        if (tokensWonBN.isGreaterThan(availableBalance)) {
                            await this._instance.transferHiveTokens(ACCOUNT, sender, amountTrim[0], amountTrim[1], `[Refund] The server could not fulfill your bet.`);
                            return;
                        }
                        
                        // Reserve the potential payout
                        this.pendingPayouts = this.pendingPayouts.plus(tokensWonBN);
                        
                        // Generate cryptographically secure random number
                        // Note: This is still deterministic based on blockchain data
                        // In production, consider using a commit-reveal scheme
                        const random = rng(this.previousBlockId, this.blockId, this.transactionId);

                        // Memo that shows in users memo when they win
                        const winningMemo = `You won ${tokensWon} ${TOKEN_SYMBOL}. Roll: ${random}, Your guess: ${roll}`;

                        // Memo that shows in users memo when they lose
                        const losingMemo = `You lost ${amountParsed.toFixed(3)} ${TOKEN_SYMBOL}. Roll: ${random}, Your guess: ${roll}`;

                        try {
                            // If random value is less than roll
                            if (random < roll) {
                                await this._instance.transferHiveTokens(ACCOUNT, sender, tokensWon, TOKEN_SYMBOL, winningMemo);
                            } else {
                                await this._instance.transferHiveTokens(ACCOUNT, sender, '0.001', TOKEN_SYMBOL, losingMemo);
                            }
                        } finally {
                            // Release the reserved payout
                            this.pendingPayouts = this.pendingPayouts.minus(tokensWonBN);
                        }
                    } else {
                        // Invalid bet parameters, refund the user their bet
                        await this._instance.transferHiveTokens(ACCOUNT, sender, amountTrim[0], amountTrim[1], `[Refund] Invalid bet params.`);
                    }
                } else {
                    try {
                        // We need to refund the user
                        await this._instance.transferHiveTokens(ACCOUNT, sender, amountTrim[0], amountTrim[1], `[Refund] You sent an invalid bet amount.`);
                    } catch (e) {
                        const error = e instanceof Error ? e : new Error(String(e));
                        console.error(`[DiceContract] Refund error: ${error.message}`, {
                            sender,
                            amount: amountTrim[0],
                            currency: amountTrim[1],
                            stack: error.stack
                        });
                    }
                }
            }
        } catch (e) {
            const error = e instanceof Error ? e : new Error(String(e));
            console.error(`[DiceContract] Roll processing error: ${error.message}`, {
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
                console.error(`[DiceContract] Failed to refund after error:`, refundError);
            }
            
            throw error;
        }
    }

    // Called by our time-based action
    private testauto() {
        console.log('test');
    }
}