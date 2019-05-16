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

    transferSteemTokens(activeKey, from, to, amount, symbol, memo = '') {   
        return steem.broadcast.transferAsync(activeKey, from, to, `${parseFloat(amount).toFixed(3)} ${symbol}`, memo);
    },
    
    transferSteemEngineTokens(activeKey, from, to, symbol, quantity, memo = '') {    
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
    
        return steem.broadcast.customJsonAsync(activeKey, [from], [], config.CHAIN_ID, JSON.stringify(payload));
    },

    issueSteemEngineTokens(activeKey, from, to, symbol, quantity, memo = '') {     
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
      
        return steem.broadcast.customJsonAsync(activeKey, [from], [], config.CHAIN_ID, JSON.stringify(payload));
    },

    upvote(postingKey, from, votePercentage = 100.0, username, permlink) {
        votePercentage = parseFloat(votePercentage);

        if (votePercentage < 0) {
            throw new Error('Negative voting values are for downvotes, not upvotes');
        }

        const weight = this.votingWeight(votePercentage);

        return steem.broadcast.voteAsync(
            postingKey,
            from,
            username,
            permlink,
            weight
        );
    },

    downvote(postingKey, from, votePercentage = 100.0, username, permlink) {
        votePercentage = parseFloat(votePercentage);

        const weight = this.votingWeight(votePercentage) * -1;

        return steem.broadcast.voteAsync(
            postingKey,
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