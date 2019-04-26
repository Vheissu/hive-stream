const steem = require('steem');

module.exports = {

    // https://flaviocopes.com/javascript-sleep/
    sleep(milliseconds) {
        return new Promise(resolve => setTimeout(resolve, milliseconds));
    },

    transferSteemTokens(from, to, amount, symbol, memo) {
        const wif = process.env.PRIVATE_KEY;
    
        return steem.broadcast.transferAsync(wif, from, to, `${parseFloat(amount).toFixed(3)} ${symbol}`, memo);
    },
    
    transferSteemEngineTokens(from, to, amount, token, memo) {
        const wif = process.env.PRIVATE_KEY;
    
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
    
        return steem.broadcast.customJsonAsync(wif, from, [], 'ssc-mainnet', json);
    }

};