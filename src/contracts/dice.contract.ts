import { Client } from '@hivechain/dhive';
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

class DiceContract {
    private _client: Client;
    private _config: any;

    private blockNumber: number;
    private blockId;
    private previousBlockId;
    private transactionId;

    create() {
        // Runs every time register is called on this contract
        // Do setup logic and code in here (creating a database, etc)
    }

    destroy() {
        // Runs every time unregister is run for this contract
        // Close database connections, write to a database with state, etc
    }

    // Updates the contract with information about the current block
    // This is a method automatically called if it exists
    updateBlockInfo(blockNumber, blockId, previousBlockId, transactionId) {
        // Lifecycle method which sets block info 
        this.blockNumber = blockNumber;
        this.blockId = blockId;
        this.previousBlockId = previousBlockId;
        this.transactionId = transactionId;
    }

    /**
     * Get Balance
     * 
     * Helper method for getting the contract account balance. In the case of our dice contract
     * we want to make sure the account has enough money to pay out any bets
     * 
     * @returns number
     */
    async getBalance(): Promise<number> {
        const account = await this._client.database.getAccounts([ACCOUNT]);

        if (account?.[0]) {
            const balance = (account[0].balance as string).split(' ');
            const amount = balance[0];

            return parseFloat(amount);
        }
    }

    /**
     * Roll
     * 
     * Automatically called when a custom JSON action matches the following method
     * 
     * @param payload 
     * @param param1 - sender and amount
     */
    async roll(payload: { roll: number, direction: string }, { sender, amount }) {
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

        console.log(`Roll: ${roll} 
                     Amount parsed: ${amountParsed} 
                     Amount formatted: ${amountFormatted} 
                     Currency: ${amountCurrency}`);

        // Get the transaction from the blockchain
        const transaction = await Utils.getTransaction(this._client, this.blockNumber, this.transactionId);

        // Call the verifyTransfer method to confirm the transfer happened
        const verify = await Utils.verifyTransfer(transaction, sender, 'beggars', amount);

        // Get the balance of our contract account
        const balance = await this.getBalance();

        // Transfer is valid
        if (verify) {
            // Server balance is less than the max bet, cancel and refund
            if (balance < MAX_BET) {
                // Send back what was sent, the server is broke
                await Utils.transferHiveTokens(this._client, this._config, ACCOUNT, sender, amountTrim[0], amountTrim[1], `[Refund] The server could not fufill your bet.`);

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
                        await Utils.transferHiveTokens(this._client, this._config, ACCOUNT, sender, amountTrim[0], amountTrim[1], `[Refund] The server could not fufill your bet.`);

                        return;
                    }

                    // If random value is less than roll
                    if (random < roll) {                            
                        await Utils.transferHiveTokens(this._client, this._config, ACCOUNT, sender, tokensWon, TOKEN_SYMBOL, winningMemo);
                    } else {
                        await Utils.transferHiveTokens(this._client, this._config, ACCOUNT, sender, '0.001', TOKEN_SYMBOL, losingMemo);
                    }
                } else {
                    // Invalid bet parameters, refund the user their bet
                    await Utils.transferHiveTokens(this._client, this._config, ACCOUNT, sender, amountTrim[0], amountTrim[1], `[Refund] Invalid bet params.`);
                }
            } else {
                try {
                    // We need to refund the user
                    const transfer = await Utils.transferHiveTokens(this._client, this._config, ACCOUNT, sender, amountTrim[0], amountTrim[1], `[Refund] You sent an invalid bet amount.`);

                    console.log(transfer);
                } catch (e) {
                    console.log(e);
                }
            }
        }
    }
}

export default new DiceContract();