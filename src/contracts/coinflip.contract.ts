import { Streamer } from '../streamer';
import seedrandom from 'seedrandom';
import { v4 as uuidv4 } from 'uuid';

const CONTRACT_NAME = 'coinflip';

const ACCOUNT = 'beggars';
const TOKEN_SYMBOL = 'HIVE';
const VALID_CURRENCIES = ['HIVE'];
const MAX_AMOUNT = 25;

function rng(previousBlockId, blockId, transactionId, serverSeed, clientSeed = ''): 'heads' | 'tails' {
    const random = seedrandom(`${previousBlockId}${blockId}${transactionId}${clientSeed}`).double();
    const randomRoll = Math.floor(random * 2) + 1;
    console.log(randomRoll);

    return randomRoll === 1 ? 'heads' : 'tails';
}

export class CoinflipContract {
    // tslint:disable-next-line: variable-name
    private _instance: Streamer;
    private adapter;

    private blockNumber;
    private blockId;
    private previousBlockId;
    private transactionId;

    private updateBlockInfo(blockNumber, blockId, previousBlockId, transactionId) {
        // Lifecycle method which sets block info 
        this.blockNumber = blockNumber;
        this.blockId = blockId;
        this.previousBlockId = previousBlockId;
        this.transactionId = transactionId;
    }

    private async getBalance(): Promise<number> {
        const account = await this._instance['client'].database.getAccounts([ACCOUNT]);

        if (account?.[0]) {
            const balance = (account[0].balance as string).split(' ');
            const amount = balance[0];

            return parseFloat(amount);
        }

        return null;
    }

    async flip(payload, { sender, amount }) {
        const { guess, seed } = payload;

        const VALID_GUESSES = ['heads', 'tails'];

        const amountTrim = amount.split(' ');
        const amountParsed = parseFloat(amountTrim[0]);
        const amountCurrency = amountTrim[1].trim();

        const transaction = await this._instance.getTransaction(this.blockNumber, this.transactionId);
        const verify = await this._instance.verifyTransfer(transaction, sender, ACCOUNT, amount);

        if (verify) {
            // User sent an invalid currency
            if (!VALID_CURRENCIES.includes(amountCurrency)) {
                await this._instance.transferHiveTokens(ACCOUNT, sender, amountTrim[0], amountTrim[1], `[Refund] You sent an invalid currency.`);
                return;
            }

            // User sent too much, refund the difference
            if (amountParsed > MAX_AMOUNT) {
                await this._instance.transferHiveTokens(ACCOUNT, sender, amountTrim[0], amountTrim[1], `[Refund] You sent too much.`);
                return;
            }

            // Invalid guess
            if (!VALID_GUESSES.includes(guess)) {
                await this._instance.transferHiveTokens(ACCOUNT, sender, amountTrim[0], amountTrim[1], `[Refund] Invalid guess. Please only send heads or tails.`);
                return;
            }

            const serverSeed = uuidv4();
            const generatedGuess = rng(this.previousBlockId, this.blockId, this.transactionId, serverSeed, seed ?? '');

            if (generatedGuess === guess) {
                await this._instance.transferHiveTokens(ACCOUNT, sender, (amountParsed * 2).toFixed(3), amountTrim[1], `[Winner] You won. Previous block id: ${this.previousBlockId} BlockID: ${this.blockId} Trx ID: ${this.transactionId} Server Seed: ${serverSeed}`);
                return;
            }

            await this._instance.transferHiveTokens(ACCOUNT, sender, '0.001', amountTrim[1], `[Lost] You lost. Previous block id: ${this.previousBlockId} BlockID: ${this.blockId} Trx ID: ${this.transactionId} Server Seed: ${serverSeed}`);
        }
    }
}