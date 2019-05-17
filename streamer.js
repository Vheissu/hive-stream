const steem = require('steem');
const fs = require('fs');
const utils = require('./utils');

let config = require('./config');

class Streamer {
    constructor(userConfig = {}) {
        this.customJsonSubscriptions = [];
        this.sscJsonSubscriptions = [];
        this.commentSubscriptions = [];
        this.postSubscriptions = [];
        this.transferSubscriptions = [];

        this.config = Object.assign(config, userConfig);

        this.blockNumberInterval = null;

        this.lastBlockNumber = this.config.LAST_BLOCK_NUMBER;

        this.username = this.config.USERNAME;
        this.postingKey = this.config.POSTING_KEY;
        this.activeKey = this.config.ACTIVE_KEY;

        this.blockNumber;
        this.transactionId;
        this.refBlockNumber;
    }

    // Starts the streaming process
    init() {
        // Set the Steem API endpoint
        steem.api.setOptions({ url: this.config.API_URL });

        // Streams the latest irreversible block number
        this.streamBlockNumber();

        // Get the last stored block number in our text file
        this.getSavedBlockNumber().then(blockNumber => {
            // Increment the block number
            const nextBlockNumber = blockNumber ? blockNumber + 1 : 1;
            
            // Attempt to load the block
            this.loadBlock(nextBlockNumber);
        });
    }

    // Resets the entire streamer
    reset() {
        setTimeout(() => {
            this.init();
        }, 5000);
    }

    getTransactionId() {
        return this.transactionId;
    }

    getBlockNumber() {
        return this.blockNumber;
    }

    getRefBlockNumber() {
        return this.refBlockNumber;
    }

    // Watches the stream blockchain and gets the latest irreversible block number
    streamBlockNumber() {
        // Prevent duplicate intervals
        if (this.blockNumberInterval) {
            clearInterval(this.blockNumberInterval);
        }

        // Three second block time
        this.blockNumberInterval = setInterval(() => {
            steem.api.getDynamicGlobalPropertiesAsync().then(props => {
                this.lastBlockNumber = parseInt(props.last_irreversible_block_num);
            });
        }, this.config.BLOCK_CHECK_INTERVAL)
    }

    // Attempt to load the block from Steem itself
    async loadBlock(blockNumber) {
        if (this.lastBlockNumber >= blockNumber) {
            try {
                const block = await steem.api.getBlockAsync(blockNumber);
                
                // Did we get a valid block back?
                if (block) {
                    // Process the block
                    await this.processBlock(block, blockNumber);

                    // Save the block number to our text file cache
                    await this.saveBlock(blockNumber);
                    
                    if (this.config.DEBUG_MODE) {
                        console.log(`Saved block ${blockNumber} ${block.timestamp}`);
                    }

                    // Get the next block
                    this.loadBlock(blockNumber + 1);
                }
            } catch (e) {
                // Something went wrong, attempt to get the block again
                console.error(`Failed to getBlock from Steem blockchain. Block number: ${blockNumber}`);
                this.loadBlock(blockNumber);
            }
        } else {
            // The latest block number is less than the supplied block number, retry
            await utils.sleep(this.config.BLOCK_CHECK_WAIT);

            this.loadBlock(blockNumber);
        }
    }

    // Takes the block from Steem and allows us to work with it
    processBlock(block, blockNumber) {
        return new Promise((resolve, reject) => {
            for (let tx of block.transactions) {
                for (let op of tx.operations) {
                    // Either a comment or a post
                    if (op[0] === 'comment') {
                        // This is a post
                        if (op[1].parent_author === '') {
                            if (this.config.DEBUG_MODE) {
                                console.log('Post found');
                            }
                            this.postSubscriptions.forEach(sub => {
                                sub.callback(op[1], tx, block, blockNumber);
                            });
                        } 
                        // It's a comment
                        else {
                            if (this.config.DEBUG_MODE) {
                                console.log('Comment found');
                            }
                            this.commentSubscriptions.forEach(sub => {
                                sub.callback(op[1], tx, block, blockNumber);
                            });
                        }
                    }

                    if (op[0] === 'transfer') {
                        if (this.config.DEBUG_MODE) {
                            console.log('Transfer found');
                        }

                        this.transferSubscriptions.forEach(sub => {
                            if (!Array.isArray(sub.account)) {
                                if (sub.account === op[1].to) {
                                    sub.callback(op[1], tx, block, blockNumber);
                                }
                            } else {
                                if (sub.account.includes(op[1].to)) {
                                    sub.callback(op[1], tx, block, blockNumber);
                                }
                            }
                        })
                    }

                    if (op[0] === 'custom_json') {
                        if (this.config.DEBUG_MODE) {
                            console.log('Custom JSON found');
                        }
                        
                        this.customJsonSubscriptions.forEach(sub => {
                            let isSignedWithActiveKey = false;
                            let sender;

                            if (op[1].required_auths.length > 0) {
                                sender = op[1].required_auths[0];
                                isSignedWithActiveKey = true;
                            } else {
                                sender = op[1].required_posting_auths[0];
                                isSignedWithActiveKey = false;
                            }

                            sub.callback(op[1], { sender, isSignedWithActiveKey }, tx, block, blockNumber);
                        });

                        this.sscJsonSubscriptions.forEach(sub => {
                            let isSignedWithActiveKey = null;
                            let sender;
                        
                            if (op[1].required_auths.length > 0) {
                                sender = op[1].required_auths[0];
                                isSignedWithActiveKey = true;
                            } else {
                                sender = op[1].required_posting_auths[0];
                                isSignedWithActiveKey = false;
                            }

                            const id = op[1].id;
                            const json = utils.jsonParse(op[1].json);

                            // SSC JSON operation
                            if (id === this.config.CHAIN_ID) {
                                const { contractName, contractAction, contractPayload } = json;

                                sub.callback(contractName, contractAction, contractPayload, sender, op[1], tx, block, blockNumber);
                            }
                        });
                    }
                }

                this.transactionId = tx.transaction_id;
                this.refBlockNumber = tx.ref_block_num;
                this.blockNumber = tx.block_num;
            }
    
            resolve();
        });
    }

    // Save the last block number to a text file
    async saveBlock(blockNumber) {
        return new Promise((resolve, reject) => {
            fs.writeFile('block.txt', blockNumber, (err) => {
                if (err) {
                    return reject(err);
                }
    
                return resolve(true);
            })
        });
    }

    // Get the last saved block number
    async getSavedBlockNumber() {
        const currentBlockNumber = await steem.api.getDynamicGlobalPropertiesAsync().then(props => {
            return parseInt(props.last_irreversible_block_num);
        });

        if (fs.existsSync('block.txt')) {
            const parseValue = parseInt(fs.readFileSync('block.txt'));

            return isNaN(parseValue) ? currentBlockNumber : parseValue;
        }
    
        return currentBlockNumber;
    }

    transferSteemTokens(from, to, amount, symbol, memo = '') {
        return utils.transferSteemTokens(this.config, from, to, amount, symbol, memo);
    }

    transferSteemEngineTokens(from, to, symbol, quantity, memo = '') {
        return utils.transferSteemEngineTokens(this.config, from, to, symbol, quantity, memo);
    }

    transferSteemEngineTokensMultiple(from, accounts = [], symbol, memo = '') {
        return utils.transferSteemEngineTokensMultiple(this.config, from, accounts, symbol, memo);
    }

    issueSteemEngineTokens(from, to, symbol, quantity, memo = '') {
        return utils.issueSteemEngineTokens(this.config, from, to, symbol, quantity, memo);
    }

    issueSteemEngineTokensMultiple(from, to, symbol, quantity, memo = '') {
        return utils.issueSteemEngineTokensMultiple(this.config, from, to, symbol, quantity, memo);
    }

    upvote(votePercentage = 100.0, username, permlink) {
        return utils.upvote(this.config, this.username, votePercentage, username, permlink);
    }

    downvote(votePercentage = 100.0, username, permlink) {
        return utils.downvote(this.config, this.username, votePercentage, username, permlink);
    }

    onComment(callback) {
        this.commentSubscriptions.push({
            callback
        });
    }

    onPost(callback) {
        this.postSubscriptions.push({
            callback
        });
    }

    onTransfer(account, callback) {
        this.transferSubscriptions.push({
            account,
            callback
        });    
    }

    onCustomJson(callback) {
        this.customJsonSubscriptions.push({ callback });
    }

    onSscJson(callback) {
        this.sscJsonSubscriptions.push({ callback });
    }
}

module.exports = Streamer;
