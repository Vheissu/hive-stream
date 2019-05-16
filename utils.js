const steem = require('steem');

// https://stackoverflow.com/questions/23318037/size-of-json-object-in-kbs-mbs
function memorySizeOf(obj) {
    var bytes = 0;

    function sizeOf(obj) {
        if(obj !== null && obj !== undefined) {
            switch(typeof obj) {
            case 'number':
                bytes += 8;
                break;
            case 'string':
                bytes += obj.length * 2;
                break;
            case 'boolean':
                bytes += 4;
                break;
            case 'object':
                var objClass = Object.prototype.toString.call(obj).slice(8, -1);
                if(objClass === 'Object' || objClass === 'Array') {
                    for(var key in obj) {
                        if(!obj.hasOwnProperty(key)) continue;
                        sizeOf(obj[key]);
                    }
                } else bytes += obj.toString().length * 2;
                break;
            }
        }
        return bytes;
    };

    return sizeOf(obj);
};

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