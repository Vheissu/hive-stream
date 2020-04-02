# Hive Stream

A Node.js layer for Hive that allows you to watch for specific actions on the Hive blockchain.

## Install

```shell
npm install hive-stream
```

## Quick Usage

```javascript
const { Streamer } = require('hive-stream');

const ss = new Streamer();

// Watch for all custom JSON operations
ss.onCustomJson((op, { sender, isSignedWithActiveKey }, blockNumber, blockId, prevBlockId, trxId, blockTime) => {
  // React to custom JSON operations
});
```

## Configuration

The `Streamer` object can accept an object of configuration values which are all optional. However, some operations like transfering Hive Engine tokens or other operations on the blockchain that are not READ ONLY, will require the active key and/or posting keys supplied as well as a username.

The `BLOCK_CHECK_INTERVAL` value is how often to check for new blocks or in cases of error or falling behind, to poll for new blocks. It is advisable you keep this as the default 1000ms value which is one second. This allows you to account for situations where blocks fall behind the main block.

The `BLOCKS_BEHIND_WARNING` value is a numeric value of the number of blocks your API will fall behind from the master before warning to the console.

The `API_URL` is the Hive API. If you want to enable debug mode, set to `DEBUG_MODE` to `true`. The configuration values and their defaults can be found [here](https://github.com/Vheissu/hive-stream/blob/master/config.js).

```
const options = {
  ACTIVE_KEY: '',
  POSTING_KEY: '',
  APP_NAME: 'hive-stream',
  USERNAME: '',
  LAST_BLOCK_NUMBER: 0,
  BLOCK_CHECK_INTERVAL: 1000,
  BLOCKS_BEHIND_WARNING: 25,
  API_URL: 'https://api.hiveit.com',
  DEBUG_MODE: false
}

const ss = new Streamer(options);
```

The configuration itself can also be overloaded using the `setConfig` method which allows you to pass one or more of the above configuration options, useful in situations where multiple keys might be used for issuing.

```
ss.setConfig({
  ACTIVE_KEY: 'newactivekey',
  USERNAME: 'newusername'
});
```

## Streamer

The following subscription methods are read only methods, they allow you to react to certain Hive and Hive Engine events on the blockchain. You do not need to pass in any keys to use these methods as they're purely read only.

**The following actions DO require calling the `start` method first to watch the blockchain**

#### Watch for transfers

```javascript
ss.onTransfer((op, blockNumber, blockId, prevBlockId, trxId, blockTime) => {

})
```

#### Watch for custom JSON operations
```javascript
ss.onCustomJson((op, { sender, isSignedWithActiveKey }, blockNumber, blockId, prevBlockId, trxId, blockTime) => {
  
})
```

#### Watch for custom JSON operations (with a specific ID)
```javascript
ss.onCustomJsonId((op, { sender, isSignedWithActiveKey }, blockNumber, blockId, prevBlockId, trxId, blockTime) => {
  
})
```

#### Watch for post operations
```javascript
ss.onPost((op, blockNumber, blockId, prevBlockId, trxId, blockTime) => {

});
```

#### Watch for comment operations
```javascript
ss.onComment((op, blockNumber, blockId, prevBlockId, trxId, blockTime) => {

});
```

## Actions (active key)

All of the below methods require an active key has been supplied in the constructor above called `ACTIVE_KEY`. The methods below are all promised based, so you can `await` them or use `then` to confirm a successful result.

**The following actions do NOT require calling the `start` method first to watch the blockchain**

```javascript
const ss = new Streamer({
  ACTIVE_KEY: 'youractivekey'
});
```

### Transfer Hive (HIVE or HBD)
```javascript
transferHiveTokens(from, to, amount, symbol, memo = '') {

}
```

## Contracts

Hive Stream allows you to write contracts which get executed when a custom JSON operation matches. The only requirement is sending a payload which contains `hiveContract` inside of it.

The payload consists of:

`name` the name of the smart contract you registered.

`action` matches the name of a function defined inside of your contract

`payload` an object of data which will be provided to the action

### Writing contracts

Really, a contract is nothing more than a bunch of functions which get matched to values inside of JSON payloads.

### Register a contract

Register a file containing contract code which will be executed.

```javascript
import contract from './my-contract';

registerContract('mycontract', Contract);
```

### Unregister a contract

Unregister a contract that has been registered.

```javascript
unregisterContract('mycontract');
```

### Example Payload

```javascript
JSON.stringify({ hiveContract: { name: 'hivedice', action: 'roll', payload: { roll: 22, amount: '1'} } })
```

This will match a registered contract called `hivedice` and inside of the contract code, a function called `roll` and finally, the payload is sent to the function as an argument, allowing you to access the values inside of it. See the example file `dice.contract.ts` in the `src/contracts` folder in the repository.

## Permanently running with PM2

Simply copy the `ecosystem.config.js` file from this repository into your application, globally install `pm2` via `npm install pm2 -g` and change the `script` value below to reflect the main file of your application.

**ecosystem.config.js**

```
module.exports = {
  apps: [
    {
      name: 'hive-stream',
      script: 'index.js',
      ignore_watch: ['node_modules'],
      env: {
        NODE_ENV: 'development'
      },
      env_production: {
        NODE_ENV: 'production'
      }
    }
  ]
```
