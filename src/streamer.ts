import { Api } from './api';
import { SqliteAdapter } from './adapters/sqlite.adapter';
import { sleep } from '@hiveio/dhive/lib/utils';
import { TimeAction } from './actions';
import { Client } from '@hiveio/dhive';
import { Utils } from './utils';
import { Config, ConfigInterface } from './config';

import moment from 'moment';
import hivejs from 'sscjs';

interface Contract {
    name: string;
    contract: any;
}

interface Action {
    when: number;
    what: string;
    params: any;
    pending: boolean;
}

export class Streamer {
    private customJsonSubscriptions: any[] = [];
    private customJsonIdSubscriptions: any[] = [];
    private customJsonHiveEngineSubscriptions: any[] = [];
    private commentSubscriptions: any[] = [];
    private postSubscriptions: any[] = [];
    private transferSubscriptions: any[] = [];

    private attempts = 0;

    private config: ConfigInterface = Config;
    private client: Client;
    private hive;

    private username: string;
    private postingKey: string;
    private activeKey: string;

    private blockNumberTimeout: NodeJS.Timeout = null;
    private latestBlockTimer: NodeJS.Timeout = null;
    private lastBlockNumber: number = 0;

    private blockId: string;
    private previousBlockId: string;
    private transactionId: string;
    private blockTime: Date;
    private latestBlockchainTime: Date;
    private disableAllProcessing = false;

    private contracts: Contract[] = [];
    private adapter;
    private actions: TimeAction[] = [];

    private utils = Utils;

    constructor(userConfig: Partial<ConfigInterface> = {}) {
        this.config = Object.assign(Config, userConfig);

        this.lastBlockNumber = this.config.LAST_BLOCK_NUMBER;

        this.username = this.config.USERNAME;
        this.postingKey = this.config.POSTING_KEY;
        this.activeKey = this.config.ACTIVE_KEY;

        this.hive = new hivejs(this.config.HIVE_ENGINE_API);

        this.client = new Client(this.config.API_NODES);

        this.registerAdapter(new SqliteAdapter());

        new Api(this);
    }

    public registerAdapter(adapter: any) {
        this.adapter = adapter;

        if (this?.adapter?.create) {
            this.adapter.create();
        }
    }

    public getAdapter() {
        return this.adapter;
    }

    /**
     * Register a new action
     * 
     */
    public async registerAction(action: TimeAction) {
        const loadedActions: TimeAction[] = await this.adapter.loadActions() as TimeAction[];

        for (const a of loadedActions) {
            const exists = this.actions.find(i => i.id === a.id);

            if (!exists) {
                this.actions.push(new TimeAction(a.timeValue, a.id, a.contractName, a.contractMethod, a.date));
            }
        }

        const exists = this.actions.find(a => a.id === action.id);

        if (!exists) {
            this.actions.push(action);
        }
    }

    /**
     * Resets a specific action time value
     * 
     * @param id 
     * 
     */
    public resetAction(id: string) {
        const action = this.actions.find(i => i.id === id);

        if (action) {
            action.reset();
        }
    }

    public registerContract(name: string, contract: any) {
        // Store an instance of the streamer
        contract['_instance'] = this;

        // Call the contract create lifecycle method if it exists
        if (contract && typeof contract['create'] !== 'undefined') {
            contract.create();
        }

        const storedReference: Contract = { name, contract };

        // Push the contract reference to be called later on
        this.contracts.push(storedReference);

        return this;
    }

    public unregisterContract(name: string) {
        // Find the registered contract by it's ID
        const contractIndex = this.contracts.findIndex(c => c.name === name);

        if (contractIndex >= 0) {
            // Get the contract itself
            const contract = this.contracts.find(c => c.name === name);

            // Call the contract destroy lifecycle method if it exists
            if (contract && typeof contract.contract['destroy'] !== 'undefined') {
                contract.contract.destroy();
            }

            // Remove the contract
            this.contracts.splice(contractIndex, 1);
        }
    }

    /**
     * setConfig
     *
     * Allows specific configuration settings to be overridden
     *
     * @param config
     */
    public setConfig(config: Partial<ConfigInterface>) {
        Object.assign(this.config, config);

        // Set keys and username incase they have changed
        this.username = this.config.USERNAME;
        this.postingKey = this.config.POSTING_KEY;
        this.activeKey = this.config.ACTIVE_KEY;

        return this;
    }

    /**
     * Start
     *
     * Starts the streamer bot to get blocks from the Hive API
     *
     */
    public async start(): Promise<Streamer> {
        if (this.config.DEBUG_MODE) {
            console.log('Starting to stream the Hive blockchain');
        }

        this.disableAllProcessing = false;

        const state = await this.adapter.loadState();

        if (this.config.DEBUG_MODE) {
            console.log(`Restoring state from file`);
        }

        if (state?.lastBlockNumber) {
            if (state.lastBlockNumber) {
                this.lastBlockNumber = state.lastBlockNumber;
            }
        }

        // Kicks off the blockchain streaming and operation parsing
        this.getBlock();

        this.latestBlockTimer = setInterval(() => { this.getLatestBlock(); }, this.config.BLOCK_CHECK_INTERVAL);

        return this;
    }

    /**
     * Stop
     *
     * Stops the streamer from running
     */
    public async stop(): Promise<void> {
        this.disableAllProcessing = true;

        if (this.blockNumberTimeout) {
            clearTimeout(this.blockNumberTimeout);
        }

        if (this.latestBlockTimer) {
            clearInterval(this.latestBlockTimer);
        }

        if (this?.adapter?.destroy) {
            this.adapter.destroy();
        }

        await sleep(800);
    }

    private async getLatestBlock() {
        const props = await this.client.database.getDynamicGlobalProperties();

        if (props) {
            this.latestBlockchainTime = new Date(`${props.time}Z`);
        }
    }

    private async getBlock(): Promise<void> {
        try {
            // Load global properties from the Hive API
            const props = await this.client.database.getDynamicGlobalProperties();

            // We have no props, so try loading them again.
            if (!props && !this.disableAllProcessing) {
                this.blockNumberTimeout = setTimeout(() => {
                    this.getBlock();
                }, this.config.BLOCK_CHECK_INTERVAL);
                return;
            }

            // If the block number we've got is zero
            // set it to the last irreversible block number
            if (this.lastBlockNumber === 0) {
                this.lastBlockNumber = props.head_block_number - 1;
            }

            if (this.config.DEBUG_MODE) {
                console.log(`Head block number: `, props.head_block_number);
                console.log(`Last block number: `, this.lastBlockNumber);
            }

            const BLOCKS_BEHIND = parseInt(this.config.BLOCKS_BEHIND_WARNING as any, 10);

            // We are more than 25 blocks behind, uh oh, we gotta catch up
            if (props.head_block_number >= (this.lastBlockNumber + BLOCKS_BEHIND) && this.config.DEBUG_MODE) {
                console.log(`We are more than ${BLOCKS_BEHIND} blocks behind ${props.head_block_number}, ${(this.lastBlockNumber + BLOCKS_BEHIND)}`);
            }

            if (!this.disableAllProcessing) {
                await this.loadBlock(this.lastBlockNumber + 1);
            }

            // Storing timeout allows us to clear it, as this just calls itself
            if (!this.disableAllProcessing) {
                this.blockNumberTimeout = setTimeout(() => { this.getBlock(); }, this.config.BLOCK_CHECK_INTERVAL);
            }
        } catch (e) {
            const message = e.message.toLowerCase();

            console.error(message);
        }
    }

    // Takes the block from Hive and allows us to work with it
    private async loadBlock(blockNumber: number): Promise<void> {
        // Load the block itself from the Hive API
        const block = await this.client.database.getBlock(blockNumber);

        // The block doesn't exist, wait and try again
        if (!block) {
            await Utils.sleep(this.config.BLOCK_CHECK_INTERVAL);
            return;
        }

        // Get the block date and time
        const blockTime = new Date(`${block.timestamp}Z`);

        if (this.lastBlockNumber !== blockNumber) {
            this.processActions();
        }

        this.blockId = block.block_id;
        this.previousBlockId = block.previous;
        this.transactionId = block.transaction_ids[1];
        this.blockTime = blockTime;

        if (this.adapter?.processBlock) {
            this.adapter.processBlock(block);
        }

        // Loop over all transactions in the block
        for (const [i, transaction] of Object.entries(block.transactions)) {
            // Loop over operations in the block
            for (const [opIndex, op] of Object.entries(transaction.operations)) {
                // For every operation, process it
                await this.processOperation(
                    op,
                    blockNumber,
                    block.block_id,
                    block.previous,
                    block.transaction_ids[i],
                    blockTime
                );
            }
        }

        this.lastBlockNumber = blockNumber;
        this.saveStateToDisk();
    }

    public processOperation(op: any, blockNumber: number, blockId: string, prevBlockId: string, trxId: string, blockTime: Date): void {
        if (this.adapter?.processOperation) {
            this.adapter.processOperation(op, blockNumber, blockId, prevBlockId, trxId, blockTime);
        }

        // Operation is a "comment" which could either be a post or comment
        if (op[0] === 'comment') {
            // This is a post
            if (op[1].parent_author === '') {
                this.postSubscriptions.forEach(sub => {
                    sub.callback(
                        op[1],
                        blockNumber,
                        blockId,
                        prevBlockId,
                        trxId,
                        blockTime
                    );
                });
                // This is a comment
            } else {
                this.commentSubscriptions.forEach(sub => {
                    sub.callback(
                        op[1],
                        blockNumber,
                        blockId,
                        prevBlockId,
                        trxId,
                        blockTime
                    );
                });
            }
        }

        // This is a transfer
        if (op[0] === 'transfer') {
            const sender = op[1]?.from;
            const amount = op[1]?.amount;

            const json = Utils.jsonParse(op[1].memo);

            if (json?.[this.config.PAYLOAD_IDENTIFIER] && json?.[this.config.PAYLOAD_IDENTIFIER]?.id === this.config.JSON_ID) {
                // Pull out details of contract
                const { name, action, payload } = json[this.config.PAYLOAD_IDENTIFIER];

                // Do we have a contract that matches the name in the payload?
                const contract = this.contracts.find(c => c.name === name);

                if (contract) {
                    if (this?.adapter?.processTransfer) {
                        this.adapter.processTransfer(op[1], { name, action, payload }, { sender, amount });
                    }

                    if (contract?.contract?.updateBlockInfo) {
                        contract.contract.updateBlockInfo(blockNumber, blockId, prevBlockId, trxId);
                    }

                    if (contract?.contract[action]) {
                        contract.contract[action](payload, { sender, amount });
                    }
                }
            }

            this.transferSubscriptions.forEach(sub => {
                if (sub.account === op[1].to) {
                    sub.callback(
                        op[1],
                        blockNumber,
                        blockId,
                        prevBlockId,
                        trxId,
                        blockTime
                    );
                }
            });
        }

        // This is a custom JSON operation
        if (op[0] === 'custom_json') {
            let isSignedWithActiveKey = false;
            let sender;

            const id = op[1]?.id;

            if (op[1]?.required_auths?.length > 0) {
                sender = op[1].required_auths[0];
                isSignedWithActiveKey = true;
            } else if (op[1]?.required_posting_auths?.length > 0) {
                sender = op[1].required_posting_auths[0];
                isSignedWithActiveKey = false;
            }

            const json = Utils.jsonParse(op[1].json);

            if (json && json?.[this.config.PAYLOAD_IDENTIFIER]  && id === this.config.JSON_ID) {
                // Pull out details of contract
                const { name, action, payload } = json[this.config.PAYLOAD_IDENTIFIER];

                // Do we have a contract that matches the name in the payload?
                const contract = this.contracts.find(c => c.name === name);

                if (contract) {
                    this.adapter.processCustomJson(op[1], { name, action, payload }, { sender, isSignedWithActiveKey });

                    if (contract?.contract?.updateBlockInfo) {
                        contract.contract.updateBlockInfo(blockNumber, blockId, prevBlockId, trxId);
                    }

                    if (contract?.contract[action]) {
                        contract.contract[action](payload, { sender, isSignedWithActiveKey }, id);
                    }
                }
            }

            this.customJsonSubscriptions.forEach(sub => {
                sub.callback(
                    op[1],
                    { sender, isSignedWithActiveKey },
                    blockNumber,
                    blockId,
                    prevBlockId,
                    trxId,
                    blockTime
                );
            });

            this.customJsonIdSubscriptions.forEach(sub => {
                const byId = this.customJsonIdSubscriptions.find(s => s.id === op[1].id);

                if (byId) {
                    sub.callback(
                        op[1],
                        { sender, isSignedWithActiveKey },
                        blockNumber,
                        blockId,
                        prevBlockId,
                        trxId,
                        blockTime
                    ); 
                }
            });

            Utils.asyncForEach(this.customJsonHiveEngineSubscriptions, async (sub: any) => {
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

                // Hive Engine JSON operation
                if (id === this.config.HIVE_ENGINE_ID) {
                    const { contractName, contractAction, contractPayload } = json;

                    try {
                        // Attempt to get the transaction from Hive Engine itself
                        const txInfo = await this.hive.getTransactionInfo(trxId);

                        const logs = txInfo && txInfo.logs ? Utils.jsonParse(txInfo.logs) : null;

                        // Do we have a valid transaction and are there no errors? It's a real transaction
                        if (txInfo && logs && typeof logs.errors === 'undefined') {
                            sub.callback(contractName, contractAction, contractPayload, sender,
                                op[1], blockNumber, blockId, prevBlockId, trxId, blockTime);
                        }
                    } catch(e) {
                        console.error(e);
                        return;
                    }
                }
            });
        }
    }

    private processActions() {
        const blockDate = moment.utc(this.latestBlockchainTime);

        for (const action of this.actions) {
            const date = moment.utc(action.date);
            const frequency = action.timeValue;

            const contract = this.contracts.find(c => c.name === action.contractName);

            // Contract doesn't exist or action doesn't exist, carry on
            if (!contract || !contract?.contract?.[action.contractMethod]) {
                continue;
            }

            let difference = 0;

            switch (frequency) {
                case '3s':
                case 'block':
                    difference = date.diff(blockDate, 's');

                    // 3 seconds or more has passed
                    if (difference >= 3) {
                        contract.contract[action.contractMethod](action.payload);

                        action.reset();
                    }
                break;

                case '10s':
                    difference = blockDate.diff(date, 's');

                    // 10 seconds or more has passed
                    if (difference >= 10) {
                        contract.contract[action.contractMethod](action.payload);
                        
                        action.reset();
                    }
                break;
                
                case '30s':
                    difference = blockDate.diff(date, 's');

                    // 30 seconds or more has passed
                    if (difference >= 30) {
                        contract.contract[action.contractMethod](action.payload);
                        
                        action.reset();
                    }
                break;

                case '1m':
                case 'minute':
                    difference = blockDate.diff(date, 'm');

                    // One minute has passed
                    if (difference >= 1) {
                        contract.contract[action.contractMethod](action.payload);
                        
                        action.reset();
                    }
                break;

                case '15m':
                case 'quarter':
                    difference = blockDate.diff(date, 'm');

                    // 15 minutes has passed
                    if (difference >= 15) {
                        contract.contract[action.contractMethod](action.payload);
                        
                        action.reset();
                    }
                break;

                case '30m':
                case 'halfhour':
                    difference = blockDate.diff(date, 'm');

                    // 30 minutes has passed
                    if (difference >= 30) {
                        contract.contract[action.contractMethod](action.payload);
                        
                        action.reset();
                    }
                break;

                case 'hourly':
                case '1h':
                    difference = blockDate.diff(date, 'h');

                    // One our or more has passed
                    if (difference >= 1) {
                        contract.contract[action.contractMethod](action.payload);
                        
                        action.reset();
                    }
                break;

                case '12h':
                case 'halfday':
                    difference = blockDate.diff(date, 'h');

                    // Twelve hours or more has passed
                    if (difference >= 12) {
                        contract.contract[action.contractMethod](action.payload);
                        
                        action.reset();
                    }
                break;

                case '24h':
                case 'day':
                    difference = blockDate.diff(date, 'd');

                    // One day (24 hours) has passed
                    if (difference >= 1) {
                        contract.contract[action.contractMethod](action.payload);
                        
                        action.reset();
                    }
                break;

                case 'week':
                    difference = blockDate.diff(date, 'w');

                    // One week has passed
                    if (difference >= 1) {
                        contract.contract[action.contractMethod](action.payload);
                        
                        action.reset();
                    }
                break;
            }
        }
    }

    public async saveStateToDisk(): Promise<void> {
        if (this.adapter?.saveState) {
            this.adapter.saveState({lastBlockNumber: this.lastBlockNumber, actions: this.actions});
        }
    }

    public saveToHiveApi(from: string, data: string) {
        return Utils.transferHiveTokens(
            this.client,
            this.config,
            from,
            'hiveapi',
            '0.001',
            'HIVE',
            data);
        }
            
    public getAccountTransfers(account: string, from = -1, limit = 100) {
        return Utils.getAccountTransfers(this.client, account, from, limit);
    }

    public transferHiveTokens(from: string, to: string, amount: string, symbol: string, memo: string = '') {
        return Utils.transferHiveTokens(
            this.client,
            this.config,
            from,
            to,
            amount,
            symbol,
            memo
        );
    }

    public transferHiveTokensMultiple(from: string, accounts: string[] = [], amount: string = '0', symbol: string, memo: string = '') {
        return Utils.transferHiveTokensMultiple(this.client, this.config, from, accounts, amount, symbol, memo);
    }

    public transferHiveEngineTokens(from: string, to: string, symbol: string, quantity: string, memo: string = '') {
        return Utils.transferHiveEngineTokens(this.client, this.config, from, to, symbol, quantity, memo);
    }

    public transferHiveEngineTokensMultiple(from: string, accounts: any[] = [], symbol: string, memo: string = '', amount: string = '0') {
        return Utils.transferHiveEngineTokensMultiple(this.client, this.config, from, accounts, symbol, memo, amount);
    }

    public issueHiveEngineTokens(from: string, to: string, symbol: string, quantity: string, memo: string = '') {
        return Utils.issueHiveEngineTokens(this.client, this.config, from, to, symbol, quantity, memo);
    }

    public issueHiveEngineTokensMultiple(from: string, accounts: any[] = [], symbol: string, memo: string = '', amount: string = '0') {
        return Utils.issueHiveEngineTokensMultiple(this.client, this.config, from, accounts, symbol, memo, amount);
    }

    public upvote(votePercentage: string = '100.0', username: string, permlink: string) {
        return Utils.upvote(
            this.client,
            this.config,
            this.username,
            votePercentage,
            username,
            permlink
        );
    }

    public downvote(votePercentage: string = '100.0', username: string, permlink: string) {
        return Utils.downvote(
            this.client,
            this.config,
            this.username,
            votePercentage,
            username,
            permlink
        );
    }

    public getTransaction(blockNumber: number, transactionId: string) {
        return Utils.getTransaction(this.client, blockNumber, transactionId);
    }

    public verifyTransfer(transaction, from: string, to: string, amount: string) {
        return Utils.verifyTransfer(transaction, from, to, amount);
    }

    public onComment(callback: any): void {
        this.commentSubscriptions.push({
            callback
        });
    }

    public onPost(callback: any): void {
        this.postSubscriptions.push({
            callback
        });
    }

    public onTransfer(account: string, callback: () => void): void {
        this.transferSubscriptions.push({
            account,
            callback
        });
    }

    public onCustomJson(callback: any): void {
        this.customJsonSubscriptions.push({ callback }); 
    }

    public onCustomJsonId(callback: any, id: string): void {
        this.customJsonIdSubscriptions.push({ callback, id });
    }

    public onHiveEngine(callback: any): void {
        this.customJsonHiveEngineSubscriptions.push({ callback });
    }
}
