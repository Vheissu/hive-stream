# steem-stream

A Node.js layer for Steem that allows you to watch for specific actions on the Steem blockchain.

## Install

```shell
npm install steem-stream
```

## Quick Usage

```javascript
const Streamer = require('steem-stream');

const ss = new Streamer();

// Kickstart the streamer
ss.init();

// Watch for all custom JSON operations
ss.onCustomJson((op, { sender, isSignedWithActiveKey }, tx, block, blockNumber) => {
  // React to custom JSON operations
});
```

## Configuration

The `Streamer` object can accept an object of configuration values which are all optional. However, some operations like transfering Steem Engine tokens or other operations on the blockchain that are not READ ONLY, will require the active key and/or posting keys supplied as well as a username.

Many of these values can be left as the defaults. The `BLOCK_CHECK_INTERVAL` configuration value is how often a new block is checked, because Steem is a 3 second blockchain, this accounts for new blocks being created. The `BLOCK_CHECK_WAIT` value is how long to wait if the block returned is the same as the current block. By default, this is 300 milliseconds, and works, but can be adjusted accordingly.

The `CHAIN_ID` value is only for Steem Engine related operations. The `API_URL` is the Steem API. If you want to enable debug mode, set to `DEBUG_MODE` to `true`. The configuration values and their defaults can be found [here](https://github.com/Vheissu/steem-stream/blob/master/config.js).

```
const options = {
  ACTIVE_KEY: '',
  POSTING_KEY: '',
  APP_NAME: 'steem-stream',
  USERNAME: '',
  LAST_BLOCK_NUMBER: 0,
  BLOCK_CHECK_INTERVAL: 3000,
  BLOCK_CHECK_WAIT: 300,
  CHAIN_ID: 'ssc-mainnet1',
  API_URL: 'https://api.steemit.com',
  DEBUG_MODE: false
}

const ss = new Streamer(options);
```

## Subscriptions

React to certain Steem and Steem Engine events on the blockchain.

### Watch for transfers

```javascript
ss.onTransfer((op, tx, block, blockNumber) => {

})
```

### Watch for custom JSON operations
```javascript
ss.onCustomJson((op, { sender, isSignedWithActiveKey }, tx, block, blockNumber) => {
  
})
```

### Watch for Steem Engine JSON operations
```javascript
ss.onSscJson((contractName, contractAction, contractPayload, sender, op, tx, block, blockNumber) => {
  
})
```

### Watch for post operations
```javascript
ss.onPost((op, tx, block, blockNumber) => {

});
```

### Watch for comment operations
```javascript
ss.onComment((op, tx, block, blockNumber) => {

});
```

## Permanently running with PM2

Simply copy the `ecosystem.config.js` file from this repository into your application, globally install `pm2` via `npm install pm2 -g` and change the `script` value below to reflect the main file of your application.

**ecosystem.config.js**

```
module.exports = {
  apps: [
    {
      name: 'steem-stream',
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

## Roadmap

This package currently only works for one-way READ ONLY operations, however, will support transfers, comments, posts and other functionality very shortly (including the ability to transfer and issue Steem Engine tokens).