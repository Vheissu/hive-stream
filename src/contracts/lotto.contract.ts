import { sleep } from '@hivechain/dhive/lib/utils';
import { SqliteAdapter } from './../adapters/sqlite.adapter';
import { MongodbAdapter } from './../adapters/mongodb.adapter';
import { Streamer } from '../streamer';
import seedrandom from 'seedrandom';
import BigNumber from 'bignumber.js';
import { Db } from 'mongodb';

const CONTRACT_NAME = 'hivelotto';

const ACCOUNT = 'beggars';
const TOKEN_SYMBOL = 'HIVE';
const VALID_CURRENCIES = ['HIVE'];

const COST = 10;
const MAX_ENTRIES = 50;
const PERCENTAGE_FEE = 25; // 5% of 500 total = 25 HIVE

const COLLECTION_LOTTERY = 'lottery';
const COLLECTION_WINNERS = 'winners';

function rng(previousBlockId, blockId, transactionId, maximum = 100) {
    const random = seedrandom(`${previousBlockId}${blockId}${transactionId}`).double();
    const randomRoll = Math.floor(random * maximum) + 1;

    return randomRoll;
}

export class LottoContract {
    // tslint:disable-next-line: variable-name
    private _instance: Streamer;
    private adapter: MongodbAdapter | SqliteAdapter;

    private blockNumber;
    private blockId;
    private previousBlockId;
    private transactionId;

    private create() {
        this.adapter = this._instance.getAdapter();
    }

    private destroy() {
        // Runs every time unregister is run for this contract
        // Close database connections, write to a database with state, etc
    }

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

    async buy(payload, { sender, amount }) {
        const amountTrim = amount.split(' ');
        const amountParsed = parseFloat(amountTrim[0]);
        const amountFormatted = parseFloat(amountTrim[0]).toFixed(3);
        const amountCurrency = amountTrim[1].trim();

        const transaction = await this._instance.getTransaction(this.blockNumber, this.transactionId);
        const verify = await this._instance.verifyTransfer(transaction, sender, ACCOUNT, amount);

        const balance = await this.getBalance();

        if (verify) {
            // User sent an invalid currency
            if (!VALID_CURRENCIES.includes(amountFormatted)) {
                await this._instance.transferHiveTokens(ACCOUNT, sender, amountTrim[0], amountTrim[1], `[Refund] You sent an invalid currency.`);
            }

            // User sent too much
            if (amountParsed > COST) {
                await this._instance.transferHiveTokens(ACCOUNT, sender, amountTrim[0], amountTrim[1], `[Refund] A ticket costs ${COST} HIVE. You sent ${amount}`);
                return;
            }

            // Get database reference from adapter
            const db: Db = this.adapter['db'];

            const collection = db.collection(COLLECTION_LOTTERY);
            const lotto = await collection.find().sort({'_id': -1}).limit(1).toArray();

            // We have a lotto
            if (lotto.length) {
                const total = lotto.entries.length + 1;

                const balance = await this.getBalance();
                const payout = new BigNumber(balance).minus(PERCENTAGE_FEE).toPrecision(3);

                

                // Total number of entries including this one hits the limit
                // Lets pay out the lottery
                if (total === MAX_ENTRIES) {
                    collection

                    const entrant1 = lotto.entries[rng(this.previousBlockId, this.blockId, this.transactionId, total)];

                    await sleep(3000);

                    const entrant2 = lotto.entries[rng(this.previousBlockId, this.blockId, this.transactionId, total)];

                    await sleep(3000);
                    
                    const entrant3 = lotto.entries[rng(this.previousBlockId, this.blockId, this.transactionId, total)];

                    await sleep(3000);

                    const entrant4 = lotto.entries[rng(this.previousBlockId, this.blockId, this.transactionId, total)];

                    await sleep(3000);

                    const entrant5 = lotto.entries[rng(this.previousBlockId, this.blockId, this.transactionId, total)];
                } else {

                }
            }
        }
    }
}