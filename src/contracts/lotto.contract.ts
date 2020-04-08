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
const VALID_DRAW_TYPES = ['hourly', 'daily'];

const COST = 10;

const MIN_ENTRIES_HOURLY = 25;
const MAX_ENTRIES_HOURLY = 50;
const MIN_ENTRIES_DAILY = 100;
const MAX_ENTRIES_DAILY = 500;

const PERCENTAGE = 5;

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
        const { type } = payload;

        const amountTrim = amount.split(' ');
        const amountParsed = parseFloat(amountTrim[0]);
        const amountFormatted = parseFloat(amountTrim[0]).toFixed(3);
        const amountCurrency = amountTrim[1].trim();

        const transaction = await this._instance.getTransaction(this.blockNumber, this.transactionId);
        const verify = await this._instance.verifyTransfer(transaction, sender, ACCOUNT, amount);

        const balance = await this.getBalance();

        if (verify) {
            // User sent an invalid currency
            if (!VALID_CURRENCIES.includes(amountCurrency)) {
                await this._instance.transferHiveTokens(ACCOUNT, sender, amountTrim[0], amountTrim[1], `[Refund] You sent an invalid currency.`);
                return;
            }

            // User sent too much
            if (amountParsed > COST) {
                await this._instance.transferHiveTokens(ACCOUNT, sender, amountTrim[0], amountTrim[1], `[Refund] A ticket costs ${COST} HIVE. You sent ${amount}`);
                return;
            }

            // User did not specify a valid entry type, refund them
            if (!VALID_DRAW_TYPES.includes(type)) {
                await this._instance.transferHiveTokens(ACCOUNT, sender, amountTrim[0], amountTrim[1], `[Refund] You specified an invalid draw type`);
                return;
            }

            // Get database reference from adapter
            const db: Db = this.adapter['db'];

            console.log(db);

            const collection = db.collection(COLLECTION_LOTTERY);
            console.log(collection);
            const lotto = await collection.find().sort({'_id': -1}).limit(1).toArray();

            console.log('Lotto', lotto);

            // We have a lotto
            if (lotto.length) {
                const item = lotto[0];

                const total = item.entries.length + 1;

                const balance = await this.getBalance();

                // Calculate how much the account gets to keep
                const percentageFee = new BigNumber(balance).dividedBy(100).multipliedBy(PERCENTAGE);

                // The amount minus the percentage to pay out to winners
                const payout = new BigNumber(balance).minus(percentageFee).toPrecision(3);

                if (type === 'hourly') {
                    // Total number of entries including this one hits the limit
                    // Lets pay out the lottery
                    if (total === MAX_ENTRIES_HOURLY) {
                        const entrant1 = item.entries[rng(this.previousBlockId, this.blockId, this.transactionId, total)];

                        await sleep(3000);

                        const entrant2 = item.entries[rng(this.previousBlockId, this.blockId, this.transactionId, total)];

                        await sleep(3000);
                        
                        const entrant3 = item.entries[rng(this.previousBlockId, this.blockId, this.transactionId, total)];

                        await sleep(3000);

                        const entrant4 = item.entries[rng(this.previousBlockId, this.blockId, this.transactionId, total)];

                        await sleep(3000);

                        const entrant5 = item.entries[rng(this.previousBlockId, this.blockId, this.transactionId, total)];
                    } else {

                    }
                } else if (type === 'daily') {

                }
            }
        }
    }
}