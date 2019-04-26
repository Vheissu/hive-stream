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
    
    transferSteemEngineTokens(from, to, amount, token, memo) {    
        const json = {
            'contractName': 'tokens',
            'contractAction': 'transfer',
            'contractPayload': {
                'symbol': token,
                'to': to,
                'quantity': amount,
                'memo': memo
            }
        };
    
        return steem.broadcast.customJsonAsync(config.ACTIVE_KEY, from, [], 'ssc-mainnet1', json);
    }

};