import { Client } from 'dsteem';
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

    transferHiveTokens(client: Client, config: ConfigInterface, from: string, to: string, amount: string, symbol: string, memo: string = '') {
        return client.broadcast.transfer({from, to,
            amount: `${parseFloat(amount).toFixed(3)} ${symbol}`, memo}, config.ACTIVE_KEY as any);
    },

    randomNumber(previousBlockId, blockId, transactionId) {
        const random = seedrandom(`${previousBlockId}${blockId}${transactionId}`).double();
        const randomRoll = Math.floor(random * 100) + 1;
        return randomRoll;
    },

    upvote(client: Client, config: ConfigInterface, voter: string, votePercentage: string = '100.0',
           author: string, permlink: string) {
        const percentage = parseFloat(votePercentage);

        if (percentage < 0) {
            throw new Error('Negative voting values are for downvotes, not upvotes');
        }

        const weight = this.votingWeight(percentage);

        return client.broadcast.vote({voter, author, permlink, weight}, config.POSTING_KEY as any);
    },

    downvote(client: Client, config: ConfigInterface, voter: string, votePercentage: string = '100.0',
             author: string, permlink: string) {
        const weight = this.votingWeight(parseFloat(votePercentage)) * -1;

        return client.broadcast.vote({voter, author, permlink, weight}, config.POSTING_KEY as any);
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