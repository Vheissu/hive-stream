import steem from 'steem';
import fs from 'fs';
import { Utils } from './utils';
import { Config, ConfigInterface } from './config';

export class Streamer {
    private customJsonSubscriptions: any[] = [];
    private sscJsonSubscriptions: any[] = [];
    private commentSubscriptions: any[] = [];
    private postSubscriptions: any[] = [];
    private transferSubscriptions: any[] = [];

    private config: ConfigInterface = Config;

    private username: string;
    private postingKey: string;
    private activeKey: string;

    private blockNumberTimeout: NodeJS.Timeout = null;
    private lastBlockNumber: number = 0;

    private blockNumber: number;
    private transactionId: string;
    private refBlockNumber: number;

    constructor(userConfig: Partial<ConfigInterface> = {}) {

        this.config = Object.assign(Config, userConfig);

        this.lastBlockNumber = this.config.LAST_BLOCK_NUMBER;

        this.username = this.config.USERNAME;
        this.postingKey = this.config.POSTING_KEY;
        this.activeKey = this.config.ACTIVE_KEY;
    }

    // Allow configuration options to be overloaded
    public setConfig(config: Partial<ConfigInterface>) {
        Object.assign(this.config, config);

        // Set keys and username incase they have changed
        this.username = this.config.USERNAME;
        this.postingKey = this.config.POSTING_KEY;
        this.activeKey = this.config.ACTIVE_KEY;
    }

    // Starts the streaming process
    public async start() {
        console.log('Starting to stream the Steem blockchain');

        // Set the Steem API endpoint
        steem.api.setOptions({ url: this.config.API_URL });

        // Do we have a state file?
        if (fs.existsSync('steem-stream.json')) {
            const state = JSON.parse(fs.readFileSync('steem-stream.json') as unknown as string);

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

    public stop() {
        if (this.blockNumberTimeout) {
            clearTimeout(this.blockNumberTimeout);
        }
    }

    private async getBlock() {
        const props = await steem.api.getDynamicGlobalPropertiesAsync();

        // We have no props, try again
        if (!props) {
            setTimeout(() => {
                this.getBlock();
            }, this.config.BLOCK_CHECK_INTERVAL);
            return;
        }

        // If the block number we've got is zero
        // set it to the last irreversible block number
        if (this.lastBlockNumber === 0) {
            this.lastBlockNumber = props.last_irreversible_block_num - 1;
        }

        // We are more than 25 blocks behind, uh oh, we gotta catch up
        if (props.head_block_number >= (this.lastBlockNumber + this.config.BLOCKS_BEHIND_WARNING)) {
            console.log(`We are more than 25 blocks behind: ${props.head_block_number - this.lastBlockNumber}`);

            while (props.head_block_number > this.lastBlockNumber) {
                await this.loadBlock(this.lastBlockNumber + 1);
            }
        }

        // Storing timeout allows us to clear it, as this just calls itself
        this.blockNumberTimeout = setTimeout(() => {
            this.getBlock();
        }, this.config.BLOCK_CHECK_INTERVAL);
    }

    // Takes the block from Steem and allows us to work with it
    private async loadBlock(blockNumber: number) {
        const block = await steem.api.getBlockAsync(blockNumber);

        // Block most likely does not exist
        if (!block) {
            await Utils.sleep(this.config.BLOCK_CHECK_INTERVAL);
            return;
        }

        // Get the block date and time
        const blockTime = new Date(`${block.timestamp}`);

        // Loop over all transactions in the block
        for (const [i, transaction] of block.transactions.entries()) {
            // Loop over operations in the block
            for (const [opIndex, op] of transaction.operations.entries()) {
                // For every operation, process it
                await this.processOperation(op, blockNumber, block.block_id,
                    block.previous, block.transaction_ids[i], blockTime);

                // So users can query the latest details about the transaction
                this.transactionId = transaction.transaction_id;
                this.refBlockNumber = transaction.ref_block_num;
                this.blockNumber = transaction.block_num;
            }
        }

        this.lastBlockNumber = blockNumber;
        this.saveStateToDisk();
    }

    public processOperation(op: any, blockNumber: number, blockId: string,
                            prevBlockId: string, trxId: string, blockTime: Date) {
        if (op[0] === 'comment') {
            // This is a post
            if (op[1].parent_author === '') {
                this.postSubscriptions.forEach((sub) => {
                    sub.callback(op[1], blockNumber, blockId, prevBlockId, trxId, blockTime);
                });
            } else {
                this.commentSubscriptions.forEach((sub) => {
                    sub.callback(op[1], blockNumber, blockId, prevBlockId, trxId, blockTime);
                });
            }
        }

        if (op[0] === 'transfer') {
            this.transferSubscriptions.forEach((sub) => {
                if (!Array.isArray(sub.account)) {
                    if (sub.account === op[1].to) {
                        sub.callback(op[1], blockNumber, blockId, prevBlockId, trxId, blockTime);
                    }
                } else {
                    if (sub.account.includes(op[1].to)) {
                        sub.callback(op[1], blockNumber, blockId, prevBlockId, trxId, blockTime);
                    }
                }
            });
        }

        if (op[0] === 'custom_json') {
            this.customJsonSubscriptions.forEach((sub) => {
                let isSignedWithActiveKey = false;
                let sender;

                if (op[1].required_auths.length > 0) {
                    sender = op[1].required_auths[0];
                    isSignedWithActiveKey = true;
                } else {
                    sender = op[1].required_posting_auths[0];
                    isSignedWithActiveKey = false;
                }

                sub.callback(op[1], { sender, isSignedWithActiveKey },
                    blockNumber, blockId, prevBlockId, trxId, blockTime);
            });

            this.sscJsonSubscriptions.forEach((sub) => {
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
                const json = Utils.jsonParse(op[1].json);

                // SSC JSON operation
                if (id === this.config.CHAIN_ID) {
                    const { contractName, contractAction, contractPayload } = json;

                    sub.callback(contractName, contractAction, contractPayload, sender,
                        op[1], blockNumber, blockId, prevBlockId, trxId, blockTime);
                }
            });
        }
    }

    public async saveStateToDisk() {
        const state = {
            lastBlockNumber: this.lastBlockNumber,
            transactionId: this.transactionId,
            refBlockNumber: this.refBlockNumber,
        };

        fs.writeFile('steem-stream.json', JSON.stringify(state), (err) => {
            if (err) {
                console.error(err);
            }
        });
    }

    public transferSteemTokens(from: string, to: string, amount: string, symbol: string, memo: string = '') {
        return Utils.transferSteemTokens(this.config, from, to, amount, symbol, memo);
    }

    public transferSteemEngineTokens(from: string, to: string, symbol: string, quantity: string, memo: string = '') {
        return Utils.transferSteemEngineTokens(this.config, from, to, symbol, quantity, memo);
    }

    public transferSteemEngineTokensMultiple(from: string, accounts: any[] = [],
                                             symbol: string, memo: string = '', amount: string = '0') {
        return Utils.transferSteemEngineTokensMultiple(this.config, from, accounts, symbol, memo, amount);
    }

    public issueSteemEngineTokens(from: string, to: string, symbol: string, quantity: string, memo: string = '') {
        return Utils.issueSteemEngineTokens(this.config, from, to, symbol, quantity, memo);
    }

    public issueSteemEngineTokensMultiple(from: string, accounts: any[] = [],
                                          symbol: string, memo: string = '', amount: string = '0') {
        return Utils.issueSteemEngineTokensMultiple(this.config, from, accounts, symbol, memo, amount);
    }

    public upvote(votePercentage: string = '100.0', username: string, permlink: string) {
        return Utils.upvote(this.config, this.username, votePercentage, username, permlink);
    }

    public downvote(votePercentage: string = '100.0', username: string, permlink: string) {
        return Utils.downvote(this.config, this.username, votePercentage, username, permlink);
    }

    public onComment(callback: () => void): void {
        this.commentSubscriptions.push({
            callback,
        });
    }

    public onPost(callback: () => void): void {
        this.postSubscriptions.push({
            callback,
        });
    }

    public onTransfer(account: string, callback: () => void): void {
        this.transferSubscriptions.push({
            account,
            callback,
        });
    }

    public onCustomJson(callback: () => void): void {
        this.customJsonSubscriptions.push({ callback });
    }

    public onSscJson(callback: () => void): void {
        this.sscJsonSubscriptions.push({ callback });
    }

    public getTransactionId(): string {
        return this.transactionId;
    }

    public getBlockNumber(): number {
        return this.blockNumber;
    }

    public getRefBlockNumber(): number {
        return this.refBlockNumber;
    }
}
