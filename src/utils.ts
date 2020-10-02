import { HiveRates } from './hive-rates';
import { Client, SignedTransaction, PrivateKey } from '@hiveio/dhive';
import { Config, ConfigInterface } from './config';
import seedrandom from 'seedrandom';

const MAX_PAYLOAD_SIZE = 2000;
const MAX_ACCOUNTS_CHECK = 999;

export const Utils = {

    // https://flaviocopes.com/javascript-sleep/
    sleep(milliseconds: number) {
        return new Promise((resolve) => setTimeout(resolve, milliseconds));
    },

    // Fisher Yates shuffle
    shuffle(array) {
        let currentIndex = array.length; 
        let temporaryValue; 
        let randomIndex;
      
        while (0 !== currentIndex) {
          // Pick a remaining element...
          randomIndex = Math.floor(Math.random() * currentIndex);
          currentIndex -= 1;
      
          temporaryValue = array[currentIndex];
          array[currentIndex] = array[randomIndex];
          array[randomIndex] = temporaryValue;
        }
      
        return array;
    },

    roundPrecision(value, precision) {
        const NUMBER_SIGN = value >= 0 ? 1 : -1;

        return parseFloat((Math.round((value * Math.pow(10, precision)) + (NUMBER_SIGN * 0.0001)) / Math.pow(10, precision)).toFixed(precision));
    },

    randomRange(min = 0, max = 2000) {
        return (!isNaN(min) && !isNaN(max) ? Math.floor(Math.random() * (max - min + 1)) + min : NaN); 
    },

    randomString(length = 12) {
        let str = '';
    
        const characters = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
        const max = characters.length - 1;
    
        for (let i = 0; i < length; i++) {
            str += characters[Utils.randomRange(0, max)];
        }
    
        return str;
    },

    async convertHiveAmount(amount, fiatSymbol, hiveSymbol) {
        if (fiatSymbol === hiveSymbol) {
            return amount;
        }
    
        const rates = new HiveRates();
    
        await rates.fetchRates();
    
        const rate = rates.fiatToHiveRate(fiatSymbol, hiveSymbol);
        const total = amount / rate;
        
        return rate > 0 ? Utils.roundPrecision(total, 3) : 0;
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
        
        return client.broadcast.transfer({from, to, amount: `${parseFloat(amount).toFixed(3)} ${symbol}`, memo}, key);
    },

    async transferHiveTokensMultiple(client: Client, config: ConfigInterface, from: string, accounts: string[], amount: string = '0', symbol: string, memo: string) {
        const key = PrivateKey.fromString(config.ACTIVE_KEY);
        let completed = 0;

        for (const user of accounts) {
            const to: string = user.replace('@', '');

            await client.broadcast.transfer({from, to, amount: `${parseFloat(amount).toFixed(3)} ${symbol}`, memo}, key);

            completed++;

            await this.sleep(3000);
        }

        if (completed === accounts.length) {
            return true;
        }
    },

    async getAccountTransfers(client: Client, account: string, from: number = -1, max: number = 100) {
        const history = await client.call('condenser_api', 'get_account_history', [account, from, max]);
        const transfers = history.filter(tx => tx[1].op[0] === 'transfer');

        const actualTransfers = transfers.reduce((arr, tx) => {
            const transaction = tx[1].op[1];
            const date = new Date(`${tx[1].timestamp}Z`);
    
            transaction.date = date;
    
            arr.push(transaction);
    
            return arr;
        }, []);

        return actualTransfers;
    },

    async getApiJson(client: Client, from: number = -1, limit: number = 500) {
        const history = await client.call('condenser_api', 'get_account_history', ['hiveapi', from, limit]);
        const customJson = history.filter(tx => tx[1].op[0] === 'custom_json');

        const actualJson = customJson.reduce((arr, tx) => {
            const transaction = tx[1].op[1];
            const date = new Date(`${tx[1].timestamp}Z`);
    
            transaction.date = date;
    
            arr.push(transaction);
    
            return arr;
        }, []);

        return actualJson;
    },

    transferHiveEngineTokens(client: Client, config: ConfigInterface, from: string, to: string, quantity: string, symbol: string, memo: string = '') {
        const key = PrivateKey.fromString(config.ACTIVE_KEY);

        const json = {
            contractName: 'tokens',
            contractAction: 'transfer',
            contractPayload: {
                symbol: symbol.toUpperCase(),
                to,
                quantity,
                memo,
            }
        };


        return client.broadcast.json({required_auths: [from], required_posting_auths: [], id: config.HIVE_ENGINE_ID, json: JSON.stringify(json)}, key);
    },

    async transferHiveEngineTokensMultiple(client: Client, config: ConfigInterface, from: string, accounts: any[], symbol: string, memo: string, amount: string = '0') {
        const key = PrivateKey.fromString(config.ACTIVE_KEY);

        const payloads: any[][] = [[]];
        let completed: number = 0;

        for (const user of accounts) {
            const account: string = user.account.replace('@', '');
            const quantity: string = user.amount ? parseFloat(user.amount.replace(',', '.')).toString() : parseFloat(amount).toString();

            // 0 means no quantity supplied (either in accounts or default)	
            if (parseFloat(quantity) > 0) {	
                const json = {
                    contractName: 'tokens',
                    contractAction: 'transfer',
                    contractPayload: {
                        symbol: symbol.toUpperCase(),
                        to: account,
                        quantity,
                        memo,
                    },
                };


                const lastPayloadSize = JSON.stringify(payloads[payloads.length - 1]).length;
                const payloadSize = JSON.stringify(json).length;


                if (payloadSize + lastPayloadSize > MAX_PAYLOAD_SIZE) {
                    payloads.push([json]);
                } else {
                    payloads[payloads.length - 1].push(json);
                }
            }
        }


        for (const payload of payloads) {
            const requiredAuths = [from];
            const requiredPostingAuths: any = [];

            await client.broadcast.json({required_auths: requiredAuths, required_posting_auths: requiredPostingAuths, id: config.HIVE_ENGINE_ID, json: JSON.stringify(payload)}, key);

            completed++;

            if (completed !== (payloads.length) && completed !== 0) {
                await this.sleep(3000);
            }
        }
    },

    issueHiveEngineTokens(client: Client, config: ConfigInterface, from: string, to: string, symbol: string, quantity: string, memo: string = '') {
        const key = PrivateKey.fromString(config.ACTIVE_KEY);

        const json = {
            contractName: 'tokens',
            contractAction: 'issue',
            contractPayload: {
                symbol,
                to,
                quantity,
                memo,
            },
        };

        if (config.DEBUG_MODE) {
            console.log(`Issuing Hive Engine Token: `, json, JSON.stringify(json));
        }

        return client.broadcast.json({required_auths: [from], required_posting_auths: [], id: config.HIVE_ENGINE_ID, json: JSON.stringify(json)}, key);
    },

    async issueHiveEngineTokensMultiple(client: Client, config: ConfigInterface, from: string, accounts: any[], symbol: string, memo: string, amount: string = '0') {
        const key = PrivateKey.fromString(config.ACTIVE_KEY);

        const payloads: any[][] = [[]];
        
        let completed = 0;

        for (const user of accounts) {
            const to = user.account.replace('@', '');
            const quantity: string = user.amount ? parseFloat(user.amount.replace(',', '.')).toString() : parseFloat(amount).toString();

            // 0 means no quantity supplied (either in accounts or default)
            if (parseFloat(quantity) > 0) {
                const json = {
                    contractName: 'tokens',
                    contractAction: 'issue',
                    contractPayload: {
                        symbol: symbol.toUpperCase(),
                        to,
                        quantity,
                        memo,
                    },
                };

                const lastPayloadSize = JSON.stringify(payloads[payloads.length - 1]).length;
                const payloadSize = JSON.stringify(json).length;

                if (payloadSize + lastPayloadSize > MAX_PAYLOAD_SIZE) {
                    payloads.push([json]);
                } else {
                    payloads[payloads.length - 1].push(json);
                }
            }
        }

        for (const payload of payloads) {
            const requiredAuths = [from];
            const requiredPostingAuths: any = null;

            await client.broadcast.json({required_auths: requiredAuths, required_posting_auths: requiredPostingAuths, id: config.HIVE_ENGINE_ID, json: JSON.stringify(payload)}, key);

            completed++;

            if (completed !== (payloads.length) && completed !== 0) {
                await this.sleep(3000);
            }
        }
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
    },

    getTransferUrl(to: string, memo: string, amount: string, redirectUri: string) {
        return `https://hivesigner.com/sign/transfer?to=${to}&memo=${memo}&amount=${amount}&redirect_uri=${redirectUri}`;
    }

};