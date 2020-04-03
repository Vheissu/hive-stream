import { Client } from '@hivechain/dsteem';
// import { Streamer, Utils } from 'hive-stream';
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

const rng = (previousBlockId, blockId, transactionId) => {
    const random = seedrandom(`${previousBlockId}${blockId}${transactionId}`).double();
    const randomRoll = Math.floor(random * 100) + 1;

    return randomRoll;
};

const VALID_CURRENCIES = ['HIVE', 'HBD'];

class DiceContract {
    private _client: Client;
    private _config: any;

    private blockNumber: number;
    private blockId;
    private previousBlockId;
    private transactionId;

    create() {
        // Runs every time register is called on this contract
    }

    destroy() {
        // Runs every time unregister is run for this contract
    }

    updateBlockInfo(blockNumber, blockId, previousBlockId, transactionId) {
        // Lifecycle method which sets block info 
        this.blockNumber = blockNumber;
        this.blockId = blockId;
        this.previousBlockId = previousBlockId;
        this.transactionId = transactionId;
    }

    async roll(payload: { roll: number, direction: string }, { sender, amount }) {
        const { roll, direction } = payload;

        const amountTrim = amount.split(' ');

        const amountParsed = parseInt(amountTrim[0]);
        const amountFormatted = parseInt(amountTrim[0]).toFixed(3);
        const amountCurrency = amountTrim[1].trim();

        console.log(`Roll: ${roll} 
                     Direction: ${direction} 
                     Amount parsed: ${amountParsed} 
                     Amount formatted: ${amountFormatted} 
                     Currency: ${amountCurrency}`);

        const transaction = await Utils.getTransaction(this._client, this.blockNumber, this.transactionId);
        const verify = await Utils.verifyTransfer(transaction, sender, 'beggars', amount);

        // Transfer is valid
        if (verify) {
            // Bet amount is valid
            if (amountParsed >= MIN_BET && amountParsed <= MAX_BET) {
                // Validate roll is valid
                if ((roll >= 2 && roll <= 96) && (direction === 'lesserThan' || direction === 'greaterThan') && VALID_CURRENCIES.includes(amountCurrency)) {
                    const random = rng(this.previousBlockId, this.blockId, this.transactionId);

                    const multiplier = new BigNumber(1).minus(HOUSE_EDGE).multipliedBy(100).dividedBy(roll);
                    const tokensWon = new BigNumber(amountParsed).multipliedBy(multiplier).toFixed(3, BigNumber.ROUND_DOWN);
                    const winningMemo = `You won ${tokensWon} ${TOKEN_SYMBOL}. Roll: ${random}, Your guess: ${roll}`;
                    const losingMemo = `You lost ${amountParsed} ${TOKEN_SYMBOL}. Roll: ${random}, Your guess: ${roll}`;

                    if (direction === 'lesserThan') {
                        if (roll < random) {                            
                            await Utils.transferHiveTokens(this._client, this._config, ACCOUNT, sender, tokensWon, TOKEN_SYMBOL, winningMemo);
                        } else {
                            await Utils.transferHiveTokens(this._client, this._config, ACCOUNT, sender, '0.001', TOKEN_SYMBOL, losingMemo);
                        }
                    } else if (direction === 'greaterThan') {
                        if (roll > random) {
                            await Utils.transferHiveTokens(this._client, this._config, ACCOUNT, sender, tokensWon, TOKEN_SYMBOL, winningMemo);
                        } else {
                            await Utils.transferHiveTokens(this._client, this._config, ACCOUNT, sender, '0.001', TOKEN_SYMBOL, losingMemo);
                        }
                    }
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