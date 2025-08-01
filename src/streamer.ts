import { AdapterBase } from './adapters/base.adapter';
import { Api } from './api';
import { SqliteAdapter } from './adapters/sqlite.adapter';
import { sleep } from '@hiveio/dhive/lib/utils';
import { TimeAction } from './actions';
import { Client } from '@hiveio/dhive';
import { Utils } from './utils';
import { Config, ConfigInterface } from './config';
import { 
    StreamerContract, 
    ContractInstance,
    SubscriptionCallback,
    TransferSubscription,
    CustomJsonIdSubscription,
} from './types/hive-stream';

import hivejs from 'sscjs';


interface ProcessingAction {
    when: number;
    what: string;
    params: any;
    pending: boolean;
}

export class Streamer {
    private customJsonSubscriptions: SubscriptionCallback[] = [];
    private customJsonIdSubscriptions: CustomJsonIdSubscription[] = [];
    private customJsonHiveEngineSubscriptions: SubscriptionCallback[] = [];
    private commentSubscriptions: SubscriptionCallback[] = [];
    private postSubscriptions: SubscriptionCallback[] = [];
    private transferSubscriptions: TransferSubscription[] = [];

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

    private contracts: StreamerContract[] = [];
    private adapter;
    private actions: TimeAction[] = [];

    // Performance optimization properties
    private lastStateSave = Date.now();
    private stateSaveInterval = 5000; // Save state every 5 seconds instead of every block
    private blockProcessingQueue: Array<() => Promise<void>> = [];
    private isProcessingQueue = false;
    
    // Memory management
    private readonly maxSubscriptions = 1000;
    private subscriptionCleanupInterval: NodeJS.Timeout | null = null;
    
    // Action processing optimization
    private actionFrequencyMap = new Map([
        ['3s', 3], ['block', 3], ['10s', 10], ['30s', 30],
        ['1m', 60], ['5m', 300], ['minute', 60], ['15m', 900], ['quarter', 900],
        ['30m', 1800], ['halfhour', 1800], ['hourly', 3600], ['1h', 3600],
        ['12h', 43200], ['halfday', 43200], ['24h', 86400], ['day', 86400], ['daily', 86400],
        ['week', 604800], ['weekly', 604800]
    ]);
    private contractCache = new Map<string, StreamerContract>();
    
    // Data caching for performance
    private blockCache = new Map<number, any>();
    private transactionCache = new Map<string, any>();
    private accountCache = new Map<string, { data: any, timestamp: number }>();
    private readonly cacheTimeout = 300000; // 5 minutes
    private readonly maxCacheSize = 1000;

    private utils = Utils;

    constructor(userConfig: Partial<ConfigInterface> = {}) {
        this.config = Object.assign(Config, userConfig);

        this.lastBlockNumber = this.config.LAST_BLOCK_NUMBER;

        this.username = this.config.USERNAME;
        this.postingKey = this.config.POSTING_KEY;
        this.activeKey = this.config.ACTIVE_KEY;

        this.hive = new hivejs(this.config.HIVE_ENGINE_API);

        this.client = new Client(this.config.API_NODES);

        if (process?.env?.NODE_ENV !== 'test') {
            this._initializeAdapter(new SqliteAdapter());
            new Api(this);
        }
        
        // Start subscription cleanup interval
        this.subscriptionCleanupInterval = setInterval(() => {
            this.cleanupSubscriptions();
        }, 60000); // Cleanup every minute
    }

    private _initializeAdapter(adapter: AdapterBase) {
        this.adapter = adapter;

        if (this?.adapter?.create) {
            this.adapter.create();
        }
    }

    public async registerAdapter(adapter: AdapterBase) {
        if (this.adapter && this.adapter.destroy) {
            try {
                await this.adapter.destroy();
            } catch (error) {
                console.warn('[Streamer] Error destroying existing adapter:', error);
            }
        }
        
        this.adapter = adapter;

        if (this?.adapter?.create) {
            await this.adapter.create();
        }
    }

    public getAdapter(): AdapterBase {
        return this.adapter;
    }

    /**
     * Register a new action with improved validation and persistence
     */
    public async registerAction(action: TimeAction): Promise<void> {
        if (!action || !(action instanceof TimeAction)) {
            throw new Error('Invalid action: must be an instance of TimeAction');
        }

        const loadedActions: TimeAction[] = await this.adapter.loadActions() as TimeAction[];

        for (const a of loadedActions) {
            const exists = this.actions.find(i => i.id === a.id);

            if (!exists) {
                try {
                    const restoredAction = TimeAction.fromJSON(a);
                    this.actions.push(restoredAction);
                } catch (error) {
                    console.warn(`[Streamer] Failed to restore action ${a.id}:`, error);
                }
            }
        }

        const exists = this.actions.find(a => a.id === action.id);

        if (!exists) {
            this.validateActionContract(action);
            this.actions.push(action);
            
            await this.saveActionsToDisk();
            
            if (this.config.DEBUG_MODE) {
                console.log(`[Streamer] Registered time-based action: ${action.id} (${action.timeValue})`);
            }
        } else {
            if (this.config.DEBUG_MODE) {
                console.warn(`[Streamer] Action with ID ${action.id} already exists, skipping registration`);
            }
        }
    }

    /**
     * Validate that the contract and method exist for the action
     */
    private validateActionContract(action: TimeAction): void {
        const contract = this.contractCache.get(action.contractName) || 
                        this.contracts.find(c => c.name === action.contractName);
        
        if (!contract) {
            throw new Error(`Contract '${action.contractName}' not found for action '${action.id}'`);
        }
        
        if (!contract.contract[action.contractMethod] || typeof contract.contract[action.contractMethod] !== 'function') {
            throw new Error(`Method '${action.contractMethod}' not found in contract '${action.contractName}' for action '${action.id}'`);
        }
    }

    /**
     * Remove an action by ID
     */
    public async removeAction(actionId: string): Promise<boolean> {
        const index = this.actions.findIndex(a => a.id === actionId);
        
        if (index >= 0) {
            const removedAction = this.actions.splice(index, 1)[0];
            await this.saveActionsToDisk();
            
            if (this.config.DEBUG_MODE) {
                console.log(`[Streamer] Removed time-based action: ${actionId}`);
            }
            
            return true;
        }
        
        return false;
    }

    /**
     * Get all registered actions
     */
    public getActions(): TimeAction[] {
        return [...this.actions];
    }

    /**
     * Get action by ID
     */
    public getAction(actionId: string): TimeAction | undefined {
        return this.actions.find(a => a.id === actionId);
    }

    /**
     * Enable/disable an action
     */
    public async setActionEnabled(actionId: string, enabled: boolean): Promise<boolean> {
        const action = this.actions.find(a => a.id === actionId);
        
        if (action) {
            if (enabled) {
                action.enable();
            } else {
                action.disable();
            }
            
            await this.saveActionsToDisk();
            
            if (this.config.DEBUG_MODE) {
                console.log(`[Streamer] Action ${actionId} ${enabled ? 'enabled' : 'disabled'}`);
            }
            
            return true;
        }
        
        return false;
    }

    /**
     * Save actions to disk asynchronously
     */
    private async saveActionsToDisk(): Promise<void> {
        try {
            if (this.adapter?.saveState) {
                await this.adapter.saveState({
                    lastBlockNumber: this.lastBlockNumber,
                    actions: this.actions.map(a => a.toJSON())
                });
            }
        } catch (error) {
            if (error?.code !== 'SQLITE_MISUSE') {
                console.error('[Streamer] Failed to save actions to disk:', error);
            }
        }
    }

    /**
     * Resets a specific action time value
     */
    public async resetAction(id: string): Promise<boolean> {
        const action = this.actions.find(i => i.id === id);

        if (action) {
            action.reset();
            await this.saveActionsToDisk();
            
            if (this.config.DEBUG_MODE) {
                console.log(`[Streamer] Reset action: ${id}`);
            }
            
            return true;
        }
        
        return false;
    }

    public registerContract(name: string, contract: ContractInstance) {
        // Store an instance of the streamer
        contract['_instance'] = this;

        // Call the contract create lifecycle method if it exists
        if (contract && typeof contract['create'] !== 'undefined') {
            contract.create();
        }

        const storedReference: StreamerContract = { name, contract };

        // Push the contract reference to be called later on
        this.contracts.push(storedReference);
        
        // Cache the contract for faster lookups
        this.contractCache.set(name, storedReference);

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
            
            // Remove from cache
            this.contractCache.delete(name);
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

        if (!this.config.LAST_BLOCK_NUMBER && state?.lastBlockNumber) {
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
        
        if (this.subscriptionCleanupInterval) {
            clearInterval(this.subscriptionCleanupInterval);
        }

        if (this?.adapter?.destroy) {
            this.adapter.destroy();
        }

        await sleep(800);
    }

    private async getLatestBlock() {
        try {
            const props = await this.client.database.getDynamicGlobalProperties();

            if (props) {
                this.latestBlockchainTime = new Date(`${props.time}Z`);
            }
        } catch (error) {
            console.error('[Streamer] Error getting latest block:', error);
            // Continue with cached time if available
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

            if (!this.disableAllProcessing) {
                await this.loadBlock(this.lastBlockNumber + 1);
            }

            // We are more than 25 blocks behind, uh oh, we gotta catch up
            if (props.head_block_number >= (this.lastBlockNumber + BLOCKS_BEHIND) && this.config.DEBUG_MODE) {
                console.log(`We are more than ${BLOCKS_BEHIND} blocks behind ${props.head_block_number}, ${(this.lastBlockNumber + BLOCKS_BEHIND)}`);

                if (!this.disableAllProcessing) {
                    this.getBlock();
                    return;
                }
            }

            // Storing timeout allows us to clear it, as this just calls itself
            if (!this.disableAllProcessing) {
                this.blockNumberTimeout = setTimeout(() => { this.getBlock(); }, this.config.BLOCK_CHECK_INTERVAL);
            }
        } catch (e) {
            const error = e instanceof Error ? e : new Error(String(e));
            console.error(`[Streamer] Block processing error: ${error.message}`, {
                stack: error.stack,
                blockNumber: this.lastBlockNumber + 1
            });
            
            // Retry after a longer delay on error
            if (!this.disableAllProcessing) {
                this.blockNumberTimeout = setTimeout(() => { this.getBlock(); }, this.config.BLOCK_CHECK_INTERVAL * 2);
            }
        }
    }

    // Takes the block from Hive and allows us to work with it
    private async loadBlock(blockNumber: number): Promise<void> {
        // Check cache first
        let block = this.blockCache.get(blockNumber);
        
        if (!block) {
            // Load the block itself from the Hive API
            block = await this.client.database.getBlock(blockNumber);
            
            // Cache the block for potential reuse
            if (block) {
                this.blockCache.set(blockNumber, block);
                
                // Cleanup old cache entries
                if (this.blockCache.size > this.maxCacheSize) {
                    const oldestKey = this.blockCache.keys().next().value;
                    this.blockCache.delete(oldestKey);
                }
            }
        }

        // The block doesn't exist, wait and try again
        if (!block) {
            await Utils.sleep(this.config.BLOCK_CHECK_INTERVAL);
            return;
        }

        // Get the block date and time
        const blockTime = new Date(`${block.timestamp}Z`);

        if (this.lastBlockNumber !== blockNumber) {
            this.processActions().catch(error => {
                console.error('[Streamer] Error processing actions:', error);
            });
        }

        this.blockId = block.block_id;
        this.previousBlockId = block.previous;
        this.transactionId = block.transaction_ids[1];
        this.blockTime = blockTime;

        if (this.adapter?.processBlock) {
            this.adapter.processBlock(block);
        }

        // Process transactions with improved concurrency
        const transactions = block.transactions as any[];
        const transactionIds = block.transaction_ids;
        
        // Create operation processing promises for better concurrency
        const operationPromises: Promise<void>[] = [];
        
        for (let i = 0; i < transactions.length; i++) {
            const transaction = transactions[i];
            const operations = transaction.operations;
            
            // Process operations in batch for better performance
            for (let opIndex = 0; opIndex < operations.length; opIndex++) {
                const op = operations[opIndex];
                
                // Create promise for each operation (but don't await yet)
                const operationPromise = this.processOperation(
                    op as [string, any],
                    blockNumber,
                    block.block_id,
                    block.previous,
                    transactionIds[i],
                    blockTime
                ).catch(error => {
                    console.error('[Streamer] Operation processing error:', error, {
                        blockNumber,
                        transactionIndex: i,
                        operationIndex: opIndex
                    });
                });
                
                operationPromises.push(operationPromise);
                
                // Process in batches to avoid overwhelming the system
                if (operationPromises.length >= 50) {
                    await Promise.all(operationPromises);
                    operationPromises.length = 0; // Clear array
                }
            }
        }
        
        // Process any remaining operations
        if (operationPromises.length > 0) {
            await Promise.all(operationPromises);
        }

        this.lastBlockNumber = blockNumber;
        this.saveStateThrottled();
    }

    public async processOperation(op: [string, any], blockNumber: number, blockId: string, prevBlockId: string, trxId: string, blockTime: Date): Promise<void> {
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

    private async processActions(): Promise<void> {
        if (!this.latestBlockchainTime || this.actions.length === 0) {
            return;
        }
        
        const currentTime = this.latestBlockchainTime.getTime();
        const executedActions: string[] = [];
        
        // Process actions in batch with optimized time calculations
        for (let i = 0; i < this.actions.length; i++) {
            const action = this.actions[i];
            
            // Skip disabled actions or actions that have reached max executions
            if (!action.enabled || action.hasReachedMaxExecutions()) {
                continue;
            }
            
            // Get contract from cache or find and cache it
            let contract = this.contractCache.get(action.contractName);
            if (!contract) {
                contract = this.contracts.find(c => c.name === action.contractName);
                if (contract) {
                    this.contractCache.set(action.contractName, contract);
                }
            }

            // Contract doesn't exist or method doesn't exist, log warning and skip
            if (!contract) {
                console.warn(`[Streamer] Contract '${action.contractName}' not found for action '${action.id}'`);
                continue;
            }
            
            if (!contract?.contract?.[action.contractMethod] || typeof contract.contract[action.contractMethod] !== 'function') {
                console.warn(`[Streamer] Method '${action.contractMethod}' not found in contract '${action.contractName}' for action '${action.id}'`);
                continue;
            }

            // Get frequency in seconds from optimized map
            const frequencySeconds = this.actionFrequencyMap.get(action.timeValue);
            if (!frequencySeconds) {
                console.warn(`[Streamer] Invalid time value '${action.timeValue}' for action '${action.id}'`);
                continue;
            }

            // Optimized time difference calculation using timestamps
            const actionTime = action.date.getTime();
            const differenceSeconds = (currentTime - actionTime) / 1000;

            // Check if enough time has passed
            if (differenceSeconds >= frequencySeconds) {
                try {
                    // Execute the action with error isolation
                    await this.executeAction(action, contract);
                    
                    // Reset the action timer and increment execution count
                    action.reset();
                    action.incrementExecutionCount();
                    executedActions.push(action.id);
                    
                    if (this.config.DEBUG_MODE) {
                        console.log(`[Streamer] Executed action: ${action.id} (execution #${action.executionCount})`);
                    }
                } catch (error) {
                    const err = error instanceof Error ? error : new Error(String(error));
                    console.error(`[Streamer] Action execution error for ${action.contractName}.${action.contractMethod}:`, {
                        actionId: action.id,
                        error: err.message,
                        stack: err.stack,
                        payload: action.payload
                    });
                    
                    // Optionally disable action after repeated failures
                    // This could be configurable in the future
                }
            }
        }
        
        // Save state if any actions were executed
        if (executedActions.length > 0) {
            await this.saveActionsToDisk();
        }
        
        // Clean up disabled or completed actions periodically
        this.cleanupActions();
    }
    
    /**
     * Execute a single action with proper isolation
     */
    private async executeAction(action: TimeAction, contract: StreamerContract): Promise<void> {
        const method = contract.contract[action.contractMethod];
        
        if (method.constructor.name === 'AsyncFunction') {
            await method.call(contract.contract, action.payload);
        } else {
            method.call(contract.contract, action.payload);
        }
    }
    
    /**
     * Clean up completed or disabled actions to prevent memory leaks
     */
    private cleanupActions(): void {
        const beforeCount = this.actions.length;
        
        // Remove actions that have reached their max executions
        this.actions = this.actions.filter(action => {
            if (action.hasReachedMaxExecutions()) {
                if (this.config.DEBUG_MODE) {
                    console.log(`[Streamer] Removing completed action: ${action.id} (${action.executionCount}/${action.maxExecutions} executions)`);
                }
                return false;
            }
            return true;
        });
        
        const afterCount = this.actions.length;
        
        if (beforeCount !== afterCount) {
            // Save state if we removed any actions
            this.saveActionsToDisk().catch(error => {
                console.error('[Streamer] Failed to save state after action cleanup:', error);
            });
        }
    }

    public async saveStateToDisk(): Promise<void> {
        if (this.adapter?.saveState) {
            await this.adapter.saveState({lastBlockNumber: this.lastBlockNumber, actions: this.actions});
        }
    }

    // Throttled state saving for performance
    private saveStateThrottled(): void {
        const now = Date.now();
        if (now - this.lastStateSave > this.stateSaveInterval) {
            this.lastStateSave = now;
            // Save state asynchronously without blocking block processing
            this.saveStateToDisk().catch(error => {
                console.error('[Streamer] State save error:', error);
            });
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
    
    // Memory management: cleanup subscriptions
    private cleanupSubscriptions(): void {
        // Limit subscription arrays to prevent memory leaks
        if (this.customJsonSubscriptions.length > this.maxSubscriptions) {
            this.customJsonSubscriptions = this.customJsonSubscriptions.slice(-this.maxSubscriptions);
            console.warn(`[Streamer] Trimmed customJsonSubscriptions to ${this.maxSubscriptions} items`);
        }
        
        if (this.customJsonIdSubscriptions.length > this.maxSubscriptions) {
            this.customJsonIdSubscriptions = this.customJsonIdSubscriptions.slice(-this.maxSubscriptions);
            console.warn(`[Streamer] Trimmed customJsonIdSubscriptions to ${this.maxSubscriptions} items`);
        }
        
        if (this.customJsonHiveEngineSubscriptions.length > this.maxSubscriptions) {
            this.customJsonHiveEngineSubscriptions = this.customJsonHiveEngineSubscriptions.slice(-this.maxSubscriptions);
            console.warn(`[Streamer] Trimmed customJsonHiveEngineSubscriptions to ${this.maxSubscriptions} items`);
        }
        
        if (this.commentSubscriptions.length > this.maxSubscriptions) {
            this.commentSubscriptions = this.commentSubscriptions.slice(-this.maxSubscriptions);
            console.warn(`[Streamer] Trimmed commentSubscriptions to ${this.maxSubscriptions} items`);
        }
        
        if (this.postSubscriptions.length > this.maxSubscriptions) {
            this.postSubscriptions = this.postSubscriptions.slice(-this.maxSubscriptions);
            console.warn(`[Streamer] Trimmed postSubscriptions to ${this.maxSubscriptions} items`);
        }
        
        if (this.transferSubscriptions.length > this.maxSubscriptions) {
            this.transferSubscriptions = this.transferSubscriptions.slice(-this.maxSubscriptions);
            console.warn(`[Streamer] Trimmed transferSubscriptions to ${this.maxSubscriptions} items`);
        }
    }
    
    // Add method to remove specific subscriptions
    public removeTransferSubscription(account: string): void {
        this.transferSubscriptions = this.transferSubscriptions.filter(sub => sub.account !== account);
    }
    
    public removeCustomJsonIdSubscription(id: string): void {
        this.customJsonIdSubscriptions = this.customJsonIdSubscriptions.filter(sub => sub.id !== id);
    }
}
