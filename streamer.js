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

        this.blockNumberTimeout = null;

        this.lastBlockNumber = this.config.LAST_BLOCK_NUMBER;

        this.username = this.config.USERNAME;
        this.postingKey = this.config.POSTING_KEY;
        this.activeKey = this.config.ACTIVE_KEY;

        this.blockNumber;
        this.transactionId;
        this.refBlockNumber;
    }

    // Allow configuration options to be overloaded
    setConfig(config) {
        Object.assign(this.config, config);

        // Set keys and username incase they have changed
        this.username = this.config.USERNAME;
        this.postingKey = this.config.POSTING_KEY;
        this.activeKey = this.config.ACTIVE_KEY;
    }

    // Starts the streaming process
    async start() {
        console.log('Starting to stream the Steem blockchain');

        // Set the Steem API endpoint
        steem.api.setOptions({ url: this.config.API_URL });

        // Do we have a state file?
        if (fs.existsSync('steem-stream.json')) {
            var state = JSON.parse(fs.readFileSync('steem-stream.json'));
    
            if (state.lastBlockNumber) {
                this.lastBlockNumber = state.lastBlockNumber;
            }

            if (state.transactionId) {
                this.transactionId = state.transactionId;
            }

            if (state.refBlockNumber) {
                this.refBlockNumber = state.refBlockNumber;
            }
    
            if (this.config.DEBUG_MODE) {
                console.debug(`Restoring state from file: ${JSON.stringify(state)}`);
            }
        }

        // Kicks off the blockchain streaming and operation parsing
        this.getBlock();
    }

    stop() {
        if (this.blockNumberTimeout) {
            clearTimeout(this.blockNumberTimeout);
        }
    }

    async getBlock() {
        const props = await steem.api.getDynamicGlobalPropertiesAsync();

        // We have no props, try again
        if (!props) {
            setTimeout(this.getBlock, this.config.BLOCK_CHECK_INTERVAL);
            return;
        }

        // If the block number we've got is zero
        // set it to the last irreversible block number
        if (this.lastBlockNumber === 0) {
            last_block = props.last_irreversible_block_num - 1;
        }

        // We are more than 25 blocks behind, uh oh, we gotta catch up
        if (props.head_block_number >= (this.lastBlockNumber + this.config.BLOCKS_BEHIND_WARNING)) {
            console.log(`We are more than 25 blocks behind: ${props.head_block_number - this.lastBlockNumber}`);

            while (props.head_block_number > this.lastBlockNumber) {
                await this.loadBlock(this.lastBlockNumber + 1);
            }
        }

        this.blockNumberTimeout = setTimeout(this.getBlock, this.config.BLOCK_CHECK_INTERVAL);
    }

    // Takes the block from Steem and allows us to work with it
    async loadBlock(blockNumber) {
        const block = await steem.api.getBlockAsync(blockNumber);

        // Block most likely does not exist
        if (!block) {
            await utils.sleep(this.config.BLOCK_CHECK_INTERVAL);
            return;
        }

        // Get the block date and time
        const blockTime = new Date(`${block.timestamp}`);

        // Loop over all transactions in the block
        for (let i = 0; i < block.transactions.length; i++) {
            // Get specific transaction
            const transaction = block.transactions[i];
            
            // Loop over operations in the block
            for (let opIndex = 0; opIndex < transaction.operations.length; opIndex++) {
                let op = transaction.operations[opIndex];

                // For every operation, process it
                await this.processOperation(op, blockNumber, block.block_id, block.previous, block.transaction_ids[i], blockTime);

                // So users can query the latest details about the transaction
                this.transactionId = transaction.transaction_id;
                this.refBlockNumber = transaction.ref_block_num;
                this.blockNumber = transaction.block_num;
            }
        }

        this.lastBlockNumber = blockNumber;
        this.saveStateToDisk();
    }

    processOperation(op, blockNumber, blockId, prevBlockId, trxId, blockTime) {
        if (op[0] === 'comment') {
            // This is a post
            if (op[1].parent_author === '') {
                this.postSubscriptions.forEach(sub => {
                    sub.callback(op[1], blockNumber, blockId, prevBlockId, trxId, blockTime);
                });
            } 
            // It's a comment
            else {
                this.commentSubscriptions.forEach(sub => {
                    sub.callback(op[1], blockNumber, blockId, prevBlockId, trxId, blockTime);
                });
            }
        }

        if (op[0] === 'transfer') {
            this.transferSubscriptions.forEach(sub => {
                if (!Array.isArray(sub.account)) {
                    if (sub.account === op[1].to) {
                        sub.callback(op[1], blockNumber, blockId, prevBlockId, trxId, blockTime);
                    }
                } else {
                    if (sub.account.includes(op[1].to)) {
                        sub.callback(op[1], blockNumber, blockId, prevBlockId, trxId, blockTime);
                    }
                }
            })
        }

        if (op[0] === 'custom_json') {                        
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

                sub.callback(op[1], { sender, isSignedWithActiveKey }, blockNumber, blockId, prevBlockId, trxId, blockTime);
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

                    sub.callback(contractName, contractAction, contractPayload, sender, op[1], blockNumber, blockId, prevBlockId, trxId, blockTime);
                }
            });
        }
    }

    async saveStateToDisk() {
        const state = {
            lastBlockNumber: this.lastBlockNumber,
            transactionId: this.transactionId,
            refBlockNumber: this.refBlockNumber
        };
    
      fs.writeFile('steem-stream.json', JSON.stringify(state), (err) => {
        if (err) {
            console.error(err);
        }
      });
    }

    transferSteemTokens(from, to, amount, symbol, memo = '') {
        return utils.transferSteemTokens(this.config, from, to, amount, symbol, memo);
    }

    transferSteemEngineTokens(from, to, symbol, quantity, memo = '') {
        return utils.transferSteemEngineTokens(this.config, from, to, symbol, quantity, memo);
    }

    transferSteemEngineTokensMultiple(from, accounts = [], symbol, memo = '', amount = '0') {
        return utils.transferSteemEngineTokensMultiple(this.config, from, accounts, symbol, memo, amount);
    }

    issueSteemEngineTokens(from, to, symbol, quantity, memo = '') {
        return utils.issueSteemEngineTokens(this.config, from, to, symbol, quantity, memo);
    }

    issueSteemEngineTokensMultiple(from, to, symbol, quantity, memo = '', amount = '0') {
        return utils.issueSteemEngineTokensMultiple(this.config, from, to, symbol, quantity, memo, amount);
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

    getTransactionId() {
        return this.transactionId;
    }

    getBlockNumber() {
        return this.blockNumber;
    }

    getRefBlockNumber() {
        return this.refBlockNumber;
    }
}

module.exports = Streamer;
