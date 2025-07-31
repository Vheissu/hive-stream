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

// Random Number Generator
const rng = (previousBlockId, blockId, transactionId) => {
    const random = seedrandom(`${previousBlockId}${blockId}${transactionId}`).double();
    const randomRoll = Math.floor(random * 100) + 1;

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
    private balanceCache: { balance: number, timestamp: number } | null = null;
    private readonly balanceCacheTimeout = 30000; // 30 seconds

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
    private async getBalance(): Promise<number> {
        const now = Date.now();
        
        // Return cached balance if still valid
        if (this.balanceCache && (now - this.balanceCache.timestamp) < this.balanceCacheTimeout) {
            return this.balanceCache.balance;
        }
        
        try {
            const account = await this._instance['client'].database.getAccounts([ACCOUNT]);

            if (account?.[0]) {
                const balance = (account[0].balance as string).split(' ');
                const amount = parseFloat(balance[0]);
                
                // Cache the balance
                this.balanceCache = {
                    balance: amount,
                    timestamp: now
                };
                
                return amount;
            }
        } catch (error) {
            console.error('[DiceContract] Error fetching balance:', error);
            // Return cached balance if available, even if expired
            if (this.balanceCache) {
                return this.balanceCache.balance;
            }
        }

        return 0;
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
        try {
            // Destructure the values from the payload
            const { roll } = payload;

            // The amount is formatted like 100 HIVE
            // The value is the first part, the currency symbol is the second
            const amountTrim = amount.split(' ');

            // Parse the numeric value as a real value
            const amountParsed = parseFloat(amountTrim[0]);

            // Format the amount to 3 decimal places
            const amountFormatted = parseFloat(amountTrim[0]).toFixed(3);

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

            // Transfer is valid
            if (verify) {
                // Server balance is less than the max bet, cancel and refund
                if (balance < MAX_BET) {
                    // Send back what was sent, the server is broke
                    await this._instance.transferHiveTokens(ACCOUNT, sender, amountTrim[0], amountTrim[1], `[Refund] The server could not fufill your bet.`);

                    return;
                }

                // Bet amount is valid
                if (amountParsed >= MIN_BET && amountParsed <= MAX_BET) {
                    // Validate roll is valid
                    if ((roll >= 2 && roll <= 96) && VALID_CURRENCIES.includes(amountCurrency)) {
                        // Roll a random value
                        const random = rng(this.previousBlockId, this.blockId, this.transactionId);

                        // Calculate the multiplier percentage
                        const multiplier = new BigNumber(1).minus(HOUSE_EDGE).multipliedBy(100).dividedBy(roll);

                        // Calculate the number of tokens won
                        const tokensWon = new BigNumber(amountParsed).multipliedBy(multiplier).toFixed(3, BigNumber.ROUND_DOWN);

                        // Memo that shows in users memo when they win
                        const winningMemo = `You won ${tokensWon} ${TOKEN_SYMBOL}. Roll: ${random}, Your guess: ${roll}`;

                        // Memo that shows in users memo when they lose
                        const losingMemo = `You lost ${amountParsed} ${TOKEN_SYMBOL}. Roll: ${random}, Your guess: ${roll}`;

                        // User won more than the server can afford, refund the bet amount
                        if (parseFloat(tokensWon) > balance) {
                            await this._instance.transferHiveTokens(ACCOUNT, sender, amountTrim[0], amountTrim[1], `[Refund] The server could not fufill your bet.`);

                            return;
                        }

                        // If random value is less than roll
                        if (random < roll) {
                            await this._instance.transferHiveTokens(ACCOUNT, sender, tokensWon, TOKEN_SYMBOL, winningMemo);
                        } else {
                            await this._instance.transferHiveTokens(ACCOUNT, sender, '0.001', TOKEN_SYMBOL, losingMemo);
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
            throw error;
        }
    }

    // Called by our time-based action
    private testauto() {
        console.log('test');
    }
}