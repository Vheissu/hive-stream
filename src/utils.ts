import { Config, ConfigInterface } from './config';
import hive from 'steem';

const MAX_PAYLOAD_SIZE = 2000;
const MAX_ACCOUNTS_CHECK = 999;

export const Utils = {

    // https://flaviocopes.com/javascript-sleep/
    sleep(milliseconds: number) {
        return new Promise((resolve) => setTimeout(resolve, milliseconds));
    },

    jsonParse(str: string) {
        let obj;

        try {
            obj = JSON.parse(str);
        } catch {
            // We don't do anything
        }

        return obj;
    },

    transferHiveTokens(config: ConfigInterface, from: string, to: string, amount: string,
                        symbol: string, memo: string = '') {
        return hive.broadcast.transferAsync(config.ACTIVE_KEY, from, to,
            `${parseFloat(amount).toFixed(3)} ${symbol}`, memo);
    },

    // transferSteemEngineTokens(config: ConfigInterface, from: string, to: string, quantity: string,
    //                           symbol: string, memo: string = '') {
    //     const json = {
    //         contractName: 'tokens',
    //         contractAction: 'transfer',
    //         contractPayload: {
    //             symbol: symbol.toUpperCase(),
    //             to,
    //             quantity,
    //             memo,
    //         },
    //     };

    //     return hive.broadcast.customJsonAsync(config.ACTIVE_KEY, [from], null, config.CHAIN_ID, JSON.stringify(json));
    // },

    // async transferSteemEngineTokensMultiple(config: ConfigInterface, from: string, accounts: any[],
    //                                         symbol: string, memo: string, amount: string = '0') {
    //     const payloads: any[][] = [[]];
    //     let completed: number = 0;

    //     for (const user of accounts) {
    //         const account: string = user.account.replace('@', '');
    //         const quantity: string = user.amount ?
    //                                  parseFloat(user.amount.replace(',', '.')).toString() :
    //                                  parseFloat(amount).toString();

    //         // 0 means no quantity supplied (either in accounts or default)
    //         if (parseFloat(quantity) > 0) {
    //             const json = {
    //                 contractName: 'tokens',
    //                 contractAction: 'transfer',
    //                 contractPayload: {
    //                     symbol: symbol.toUpperCase(),
    //                     to: account,
    //                     quantity,
    //                     memo,
    //                 },
    //             };

    //             const lastPayloadSize = JSON.stringify(payloads[payloads.length - 1]).length;
    //             const payloadSize = JSON.stringify(json).length;

    //             if (payloadSize + lastPayloadSize > MAX_PAYLOAD_SIZE) {
    //                 payloads.push([json]);
    //             } else {
    //                 payloads[payloads.length - 1].push(json);
    //             }
    //         }
    //     }

    //     for (const payload of payloads) {
    //         const requiredAuths = [from];
    //         const requiredPostingAuths: any = null;

    //         await steem.broadcast.customJsonAsync(config.ACTIVE_KEY, requiredAuths,
    //             requiredPostingAuths, config.CHAIN_ID, JSON.stringify(payload));

    //         completed++;

    //         if (completed !== (payloads.length) && completed !== 0) {
    //             await this.sleep(3000);
    //         }
    //     }
    // },

    // issueSteemEngineTokens(config: ConfigInterface, from: string, to: string,
    //                        symbol: string, quantity: string, memo: string = '') {
    //     const json = {
    //         contractName: 'tokens',
    //         contractAction: 'issue',
    //         contractPayload: {
    //             symbol,
    //             to,
    //             quantity,
    //             memo,
    //         },
    //     };

    //     if (config.DEBUG_MODE) {
    //         console.log(`Issuing Steem Engine Token: `, json, JSON.stringify(json));
    //     }

    //     return steem.broadcast.customJsonAsync(config.ACTIVE_KEY, [from], null, config.CHAIN_ID, JSON.stringify(json));
    // },

    // async issueSteemEngineTokensMultiple(config: ConfigInterface, from: string, accounts: any[],
    //                                      symbol: string, memo: string, amount: string = '0') {
    //     const payloads: any[][] = [[]];
    //     let completed = 0;

    //     for (const user of accounts) {
    //         const to = user.account.replace('@', '');
    //         const quantity: string = user.amount ?
    //                                  parseFloat(user.amount.replace(',', '.')).toString() :
    //                                  parseFloat(amount).toString();

    //         // 0 means no quantity supplied (either in accounts or default)
    //         if (parseFloat(quantity) > 0) {
    //             const json = {
    //                 contractName: 'tokens',
    //                 contractAction: 'issue',
    //                 contractPayload: {
    //                     symbol: symbol.toUpperCase(),
    //                     to,
    //                     quantity,
    //                     memo,
    //                 },
    //             };

    //             const lastPayloadSize = JSON.stringify(payloads[payloads.length - 1]).length;
    //             const payloadSize = JSON.stringify(json).length;

    //             if (payloadSize + lastPayloadSize > MAX_PAYLOAD_SIZE) {
    //                 payloads.push([json]);
    //             } else {
    //                 payloads[payloads.length - 1].push(json);
    //             }
    //         }
    //     }

    //     for (const payload of payloads) {
    //         const requiredAuths = [from];
    //         const requiredPostingAuths: any = null;

    //         await steem.broadcast.customJsonAsync(config.ACTIVE_KEY, requiredAuths, requiredPostingAuths,
    //             config.CHAIN_ID, JSON.stringify(payload));

    //         completed++;

    //         if (completed !== (payloads.length) && completed !== 0) {
    //             await this.sleep(3000);
    //         }
    //     }
    // },

    upvote(config: ConfigInterface, from: string, votePercentage: string = '100.0',
           username: string, permlink: string) {
        const percentage = parseFloat(votePercentage);

        if (percentage < 0) {
            throw new Error('Negative voting values are for downvotes, not upvotes');
        }

        const weight = this.votingWeight(percentage);

        return hive.broadcast.voteAsync(
            config.POSTING_KEY,
            from,
            username,
            permlink,
            weight,
        );
    },

    downvote(config: ConfigInterface, from: string, votePercentage: string = '100.0',
             username: string, permlink: string) {
        const weight = this.votingWeight(parseFloat(votePercentage)) * -1;

        return hive.broadcast.voteAsync(
            config.POSTING_KEY,
            from,
            username,
            permlink,
            weight,
        );
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