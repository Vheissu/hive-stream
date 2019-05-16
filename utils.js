const steem = require('steem');
const config = require('./config');

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

    transferSteemTokens(from, to, amount, symbol, memo) {   
        return steem.broadcast.transferAsync(config.ACTIVE_KEY, from, to, `${parseFloat(amount).toFixed(3)} ${symbol}`, memo);
    },
    
    transferSteemEngineTokens(from, to, symbol, quantity, memo) {    
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

    issueTokens(from, to, symbol, quantity, memo) {     
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

    upvote(votePercentage = 100.0, username, permlink) {
        votePercentage = parseFloat(votePercentage);

        if (votePercentage < 0) {
            throw new Error('Negative voting values are for downvotes, not upvotes');
        }

        const weight = this.votingWeight(votePercentage);

        return steem.broadcast.voteAsync(
            config.ACTIVE_KEY,
            config.USERNAME,
            username,
            permlink,
            weight
        );
    },

    downvote(votePercentage = 100.0, username, permlink) {
        votePercentage = parseFloat(votePercentage);

        const weight = this.votingWeight(votePercentage) * -1;

        return steem.broadcast.voteAsync(
            config.ACTIVE_KEY,
            config.USERNAME,
            username,
            permlink,
            weight
        );
    },

    votingWeight(votePercentage) {
        return Math.min(Math.floor(votePercentage.toFixed(2) * 100), 10000);
    }

};