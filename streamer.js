const steem = require('steem');
const fs = require('fs');

steem.api.setOptions({ url: 'https://api.steemit.com' });

class Streamer {
    constructor(lastBlockNumber = 0) {
        this.customJsonSubscriptions = [];
        this.sscJsonSubscriptions = [];
        this.commentSubscriptions = [];
        this.transferSubscriptions = [];

        this.blockNumberInterval = null;

        this.lastBlockNumber = lastBlockNumber;

        this.blockNumber;
        this.transactionId;
        this.refBlockNumber;
    }

    // Starts the streaming process
    init() {
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
        }, 3000)
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
        
                    console.log(`Saved block ${blockNumber} ${block.timestamp}`);

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
            await sleep(300);

            this.loadBlock(blockNumber);
        }
    }

    // Takes the block from Steem and allows us to work with it
    processBlock(block, blockNumber) {
        return new Promise((resolve, reject) => {
            for (let tx of block.transactions) {
                for (let op of tx.operations) {
                    if (op[0] === 'transfer') {
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
                        this.customJsonSubscriptions.forEach(sub => {
                            sub.callback(op[1], tx, block, blockNumber);
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
                            const json = jsonParse(op[1].json);

                            // SSC JSON operation
                            if (id === 'ssc-mainnet1') {
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
    
        return blockNumber > 0 ? blockNumber : 0;
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


// https://flaviocopes.com/javascript-sleep/
function sleep(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function jsonParse(string) {
    let obj;

    try {
        obj = JSON.parse(string);
    } catch {

    }

    return obj;
}

module.exports = Streamer;
