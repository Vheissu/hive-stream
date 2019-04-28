const DEBUG_MODE_ENV = Boolean(process.env.DEBUG_MODE);

module.exports = {

    ACTIVE_KEY: process.env.ACTIVE_KEY,
    POSTING_KEY: process.env.POSTING_KEY,

    APP_NAME: process.env.APP_NAME || 'steem-stream',

    USERNAME: process.env.USERNAME ? process.env.USERNAME : '',

    LAST_BLOCK_NUMBER: process.env.LAST_BLOCK_NUMBER ? parseInt(process.env.LAST_BLOCK_NUMBER) : 0,

    BLOCK_CHECK_INTERVAL: process.env.BLOCK_CHECK_INTERVAL ? parseInt(process.env.BLOCK_CHECK_INTERVAL) : 3000,
    BLOCK_CHECK_WAIT: process.env.BLOCK_CHECK_WAIT ? parseInt(process.env.BLOCK_CHECK_WAIT) : 300,

    CHAIN_ID: process.env.CHAIN_ID ? process.env.CHAIN_ID : 'ssc-mainnet1',
    API_URL: process.env.API_URL ? process.env.API_URL : 'https://api.steemit.com',

    DEBUG_MODE: (DEBUG_MODE_ENV === true || DEBUG_MODE_ENV === false) ? DEBUG_MODE_ENV : false

};