# steem-stream

A Node.js layer for Steem that allows you to watch for specific actions on the Steem blockchain.

## Install

```shell
npm install steem-stream
```

## Quick Usage

```javascript
const ss = require('steem-stream');

ss.onCustomJson((op, tx, block, blockNumer) => {
  // React to custom JSON operations
});
```

## Subscriptions

React to certain Steem and Steem Engine events on the blockchain.

```javascript
ss.onTransfer((op, tx, block, blockNumber) => {

})
```

```javascript
ss.onCustomJson((op, tx, block, blockNumber) => {
  
})
```

```javascript
ss.onSscJson((contractName, contractAction, contractPayload, sender, op, tx, block, blockNumber) => {
  
})
```

## Permanently running with PM2

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