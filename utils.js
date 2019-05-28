const steem = require('steem');

const MAX_PAYLOAD_SIZE = 2000;
const MAX_ACCOUNTS_CHECK = 999;

module.exports = {

    // https://flaviocopes.com/javascript-sleep/
    sleep(milliseconds) {
        return new Promise(resolve => setTimeout(resolve, milliseconds));
    },

    jsonParse(string) {
        let obj;
    
        try {
            obj = JSON.parse(string);
        } catch {
    
        }
    
        return obj;
    },

    transferSteemTokens(config, from, to, amount, symbol, memo = '') {   
        return steem.broadcast.transferAsync(config.ACTIVE_KEY, from, to, `${parseFloat(amount).toFixed(3)} ${symbol}`, memo);
    },
    
    transferSteemEngineTokens(config, from, to, symbol, quantity, memo = '') {    
        const payload = {
            'contractName': 'tokens',
            'contractAction': 'transfer',
            'contractPayload': {
                symbol: `${symbol.toUpperCase()}`,
                to,
                quantity,
                memo
            }
        };
    
        return steem.broadcast.customJsonAsync(config.ACTIVE_KEY, [from], [], config.CHAIN_ID, JSON.stringify(payload));
    },

    async transferSteemEngineTokensMultiple(config, from, accounts, symbol, memo, amount = '0') {
        const payloads = [[]];
        const completed = 0;

        for (const user of accounts) {
            const account = user.account.replace('@', '');
            const quantity = user.amount ? parseFloat(user.amount.replace(',', '.')) : parseFloat(amount);

            // 0 means no quantity supplied (either in accounts or default)
            if (quantity > 0) {
                const payload = {
                    'contractName': 'tokens',
                    'contractAction': 'transfer',
                    'contractPayload': {
                        symbol: `${symbol.toUpperCase()}`,
                        account,
                        quantity,
                        memo
                    }
                };

                const lastPayloadSize = JSON.stringify(payloads[payloads.length - 1]).length;
                const payloadSize = JSON.stringify(payload).length;

                if (payloadSize + lastPayloadSize > MAX_PAYLOAD_SIZE) {
                    payloads.push([payload]);
                } else {
                    payloads[payloads.length - 1].push(payload);
                }  
            }
        }

        for (let payload of payloads) {
            const required_auths = [from];
            const required_posting_auths = [];

            await steem.broadcast.customJsonAsync(config.ACTIVE_KEY, required_auths, required_posting_auths, config.CHAIN_ID, JSON.stringify(payload));

            completed++;

            if (completed !== (payloads.length) && completed !== 0) {
                await this.sleep(3000);
            }
        }
    },

    issueSteemEngineTokens(config, from, to, symbol, quantity, memo = '') {     
        const payload = {
          contractName:'tokens',
          contractAction:'issue',
          contractPayload: {
              symbol: `${symbol.toUpperCase()}`,
              to,
              quantity,
              memo
          }
        };
      
        return steem.broadcast.customJsonAsync(config.ACTIVE_KEY, [from], [], config.CHAIN_ID, JSON.stringify(payload));
    },

    async issueSteemEngineTokensMultiple(config, from, accounts, symbol, memo, amount = '0') {
        const payloads = [[]];
        const completed = 0;

        for (const user of accounts) {
            const account = user.account.replace('@', '');
            const quantity = user.amount ? parseFloat(user.amount.replace(',', '.')) : parseFloat(amount);

            // 0 means no quantity supplied (either in accounts or default)
            if (quantity > 0) {
                const payload = {
                    'contractName': 'tokens',
                    'contractAction': 'issue',
                    'contractPayload': {
                        symbol: `${symbol.toUpperCase()}`,
                        account,
                        quantity,
                        memo
                    }
                };

                const lastPayloadSize = JSON.stringify(payloads[payloads.length - 1]).length;
                const payloadSize = JSON.stringify(payload).length;

                if (payloadSize + lastPayloadSize > MAX_PAYLOAD_SIZE) {
                    payloads.push([payload]);
                } else {
                    payloads[payloads.length - 1].push(payload);
                }  
            }
        }

        for (let payload of payloads) {
            const required_auths = [from];
            const required_posting_auths = [];

            await steem.broadcast.customJsonAsync(config.ACTIVE_KEY, required_auths, required_posting_auths, config.CHAIN_ID, JSON.stringify(payload));

            completed++;

            if (completed !== (payloads.length) && completed !== 0) {
                await this.sleep(3000);
            }
        }
    },

    upvote(config, from, votePercentage = 100.0, username, permlink) {
        votePercentage = parseFloat(votePercentage);

        if (votePercentage < 0) {
            throw new Error('Negative voting values are for downvotes, not upvotes');
        }

        const weight = this.votingWeight(votePercentage);

        return steem.broadcast.voteAsync(
            config.POSTING_KEY,
            from,
            username,
            permlink,
            weight
        );
    },

    downvote(config, from, votePercentage = 100.0, username, permlink) {
        votePercentage = parseFloat(votePercentage);

        const weight = this.votingWeight(votePercentage) * -1;

        return steem.broadcast.voteAsync(
            config.POSTING_KEY,
            from,
            username,
            permlink,
            weight
        );
    },

    votingWeight(votePercentage) {
        return Math.min(Math.floor(votePercentage.toFixed(2) * 100), 10000);
    }

};