import { sleep } from '@hivechain/dhive/lib/utils';
import { SqliteAdapter } from './../adapters/sqlite.adapter';
import { MongodbAdapter } from './../adapters/mongodb.adapter';
import { Utils } from './../utils';
import { Streamer } from '../streamer';
import seedrandom from 'seedrandom';
import BigNumber from 'bignumber.js';
import { Db } from 'mongodb';

const CONTRACT_NAME = 'hivelotto';

const ACCOUNT = 'beggars';
const TOKEN_SYMBOL = 'HIVE';
const VALID_CURRENCIES = ['HIVE'];
const VALID_DRAW_TYPES = ['hourly', 'daily'];

// How much does a ticket cost?
const COST = 10;

// Minimum number of entries required for draws to payout
const MIN_ENTRIES_HOURLY = 25;
const MIN_ENTRIES_DAILY = 100;

// How many winners to pick for the hourly draw
const HOURLY_WINNERS_PICK = 3;

// How many winners to pick for the daily draw
const DAILY_WINNERS_PICK = 10;

// The percentage the site keeps (5%)
const PERCENTAGE = 5;

const COLLECTION_LOTTERY = 'lottery';
const COLLECTION_SETTINGS = 'settings';
const COLLECTION_WINNERS = 'winners';

function rng(previousBlockId, blockId, transactionId, entropy, maximum = 100) {
    const random = seedrandom(`${previousBlockId}${blockId}${transactionId}${entropy}`).double();
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

    private async create() {
        this.adapter = this._instance.getAdapter();

        const db: Db = this.adapter['db'];

        const collection = db.collection(COLLECTION_SETTINGS);
        const settings = await collection.findOne({});

        if (!settings) {
            collection.insertOne({
                contractInitiated: new Date(),
                enabled: true
            });
        }
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

            // User did not specify a valid entry type, refund them
            if (!VALID_DRAW_TYPES.includes(type)) {
                await this._instance.transferHiveTokens(ACCOUNT, sender, amountTrim[0], amountTrim[1], `[Refund] You specified an invalid draw type`);
                return;
            }

            // User sent too much, refund the difference
            if (amountParsed > COST) {
                const difference = new BigNumber(amountParsed).minus(COST).toFixed(3);
                await this._instance.transferHiveTokens(ACCOUNT, sender, difference, amountTrim[1], `[Refund] A ticket costs ${COST} HIVE. You sent ${amount}. You were refunded ${difference} HIVE.`);
            }

            // Get database reference from adapter
            const db: Db = this.adapter['db'];

            const collection = db.collection(COLLECTION_LOTTERY);
            const lotto = await collection.find({ status: 'active', type: type }).limit(1).toArray();

            // We have a lotto
            if (lotto.length) {
                const draw = lotto[0];

                const balance = await this.getBalance();

                // Calculate how much the account gets to keep
                const percentageFee = new BigNumber(balance).dividedBy(100).multipliedBy(PERCENTAGE);

                // The amount minus the percentage to pay out to winners
                const payout = new BigNumber(balance).minus(percentageFee).toFixed(3);

                draw.entries.push({
                    account: sender,
                    transactionId: this.transactionId,
                    date: new Date()
                });

                await collection.replaceOne({ _id: draw._id }, draw, { upsert: true });
            }
        }
    }

    async drawHourlyLottery() {
        const db: Db = this.adapter['db'];

        const collection = db.collection(COLLECTION_LOTTERY);
        const lotto = await collection.find({ status: 'active', type: 'hourly' }).limit(1).toArray();

        // We found an hourly draw
        if (lotto.length) {
            const draw = lotto[0];

            const total = draw.entries.length;

            const balance = await this.getBalance();

            // Number of entrants multiplied by the entry cost is the total for this draw
            const winningsAmount = new BigNumber(total).multipliedBy(COST).toNumber();

            // Calculate how much the account gets to keep
            const percentageFee = new BigNumber(winningsAmount).dividedBy(100).multipliedBy(PERCENTAGE);

            // The amount minus the percentage to pay out to winners
            const payoutTotal = new BigNumber(winningsAmount).minus(percentageFee);

            // Amount each winner gets
            const amountPerWinner = new BigNumber(payoutTotal).dividedBy(HOURLY_WINNERS_PICK).toFixed(3);

            const winners = await this.getWinners(HOURLY_WINNERS_PICK, draw.entries);

            if (winners) {
                for (const winner of winners) {
                    await this._instance.transferHiveTokens(ACCOUNT, winner.account, amountPerWinner, TOKEN_SYMBOL, `Congratulations you won the hourly lottery. You won ${amountPerWinner} ${TOKEN_SYMBOL}`);
                }
            }

            return winners;
        }
    }

    async getWinners(count: number, entries: any[]) {
        let winners = [];

        let shuffledEntries = Utils.shuffle(entries);

        for (const entry of entries) {
            if (winners.length < count) {
                const winner = entries[rng(this.previousBlockId + `${seedrandom().double()}`, this.blockId+ `${seedrandom().double()}`, this.transactionId+ `${seedrandom().double()}`, seedrandom().double(), entries.length - 1)];

                winners.push(winner);

                await sleep(300);
            } else {
                break;
            }
        }

        return winners;
    }
}