import { Client, SignedTransaction, PrivateKey } from '@hivechain/dsteem';
import { Config, ConfigInterface } from './config';
import seedrandom from 'seedrandom';

const MAX_PAYLOAD_SIZE = 2000;
const MAX_ACCOUNTS_CHECK = 999;

export const Utils = {

    // https://flaviocopes.com/javascript-sleep/
    sleep(milliseconds: number) {
        return new Promise((resolve) => setTimeout(resolve, milliseconds));
    },

    jsonParse(str: string) {
        let obj = null;

        try {
            obj = JSON.parse(str);
        } catch {
            // We don't do anything
        }

        return obj;
    },

    async getTransaction(client: Client, blockNumber: number, transactionId): Promise<SignedTransaction> {
        const block = await client.database.getBlock(blockNumber);

        const exists = block.transaction_ids.includes(transactionId);
        const index = block.transaction_ids.indexOf(transactionId);

        if (!exists) {
            throw new Error(`Unable to find transaction ${ transactionId } in block ${ blockNumber }`)
        }

        return block.transactions[index] as SignedTransaction;
    },

    async verifyTransfer(transaction: SignedTransaction, from: string, to: string, amount: string) {
        const operation = transaction.operations[0][1];

        return (operation.from === from && operation.to === to && operation.amount === amount);
    },

    transferHiveTokens(client: Client, config: Partial<ConfigInterface>, from: string, to: string, amount: string, symbol: string, memo: string = '') {
        const key = PrivateKey.fromString(config.ACTIVE_KEY);
        
        return client.broadcast.transfer({from, to,
            amount: `${parseInt(amount).toFixed(3)} ${symbol}`, memo}, key);
    },

    randomNumber(previousBlockId, blockId, transactionId) {
        const random = seedrandom(`${previousBlockId}${blockId}${transactionId}`).double();
        const randomRoll = Math.floor(random * 100) + 1;
        return randomRoll;
    },

    upvote(client: Client, config: Partial<ConfigInterface>, voter: string, votePercentage: string = '100.0',
           author: string, permlink: string) {
        const percentage = parseFloat(votePercentage);

        const key = PrivateKey.fromString(config.POSTING_KEY);

        if (percentage < 0) {
            throw new Error('Negative voting values are for downvotes, not upvotes');
        }

        const weight = this.votingWeight(percentage);

        return client.broadcast.vote({voter, author, permlink, weight}, key);
    },

    downvote(client: Client, config: Partial<ConfigInterface>, voter: string, votePercentage: string = '100.0',
             author: string, permlink: string) {
        const weight = this.votingWeight(parseFloat(votePercentage)) * -1;
        const key = PrivateKey.fromString(config.POSTING_KEY);

        return client.broadcast.vote({voter, author, permlink, weight}, key);
    },

    votingWeight(votePercentage: number) {
        return Math.min(Math.floor(parseFloat(votePercentage.toFixed(2)) * 100), 10000);
    },

    async asyncForEach(array: any[], callback: any) {
        for (let index = 0; index < array.length; index++) {
          await callback(array[index], index, array);
        }
    }

};