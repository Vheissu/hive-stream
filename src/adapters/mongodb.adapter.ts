import { TimeAction } from './../actions';
import { ContractPayload } from './../types/hive-stream';
import { AdapterBase } from './base.adapter';

import { MongoClient, Db } from 'mongodb';

export class MongodbAdapter extends AdapterBase {
    protected client: MongoClient = null;
    protected db: Db = null;

    private mongo = {
        uri: '',
        database: '',
        options: {}
    };

    private blockNumber: number;
    private lastBlockNumber: number;
    private blockId: string;
    private prevBlockId;
    private transactionId: string;

    constructor(uri: string, database: string, options = { useNewUrlParser: true,  useUnifiedTopology: true }) {
        super();

        this.mongo.uri = uri;
        this.mongo.database = database;
        this.mongo.options = options;
    }

    public async getDbInstance() {
        try {
            this.client = await MongoClient.connect(this.mongo.uri, this.mongo.options);
            this.db = this.client.db(this.mongo.database);

            return this.db;
        } catch (e) {
            throw e;
        }
    }

    public async create(): Promise<boolean> {
        try {
            this.client = await MongoClient.connect(this.mongo.uri, this.mongo.options);
            this.db = this.client.db(this.mongo.database);

            return true;
        } catch (e) {
            throw e;
        }
    }

    public async loadActions(): Promise<TimeAction[]> {
        if (!this.db) {
            await this.getDbInstance();
        }

        const state = await this.loadState();

        if (state && state.actions) {
            try {
                return state.actions.map((actionData: any) => {
                    try {
                        return TimeAction.fromJSON(actionData);
                    } catch (error) {
                        console.warn(`[MongodbAdapter] Failed to restore action ${actionData?.id || 'unknown'}:`, error);
                        return null;
                    }
                }).filter(Boolean) as TimeAction[];
            } catch (error) {
                console.error('[MongodbAdapter] Error loading actions:', error);
                return [];
            }
        }

        return [];
    }

    public async loadState(): Promise<any> {
        try {
            if (!this.db) {
                await this.getDbInstance();
            }

            const collection = this.db.collection('params');
            const params = await collection.findOne({});

            if (params) {
                return params;
            }
        } catch (e) {
            throw e;
        }
    }

    public async saveState(data: any): Promise<boolean> {
        try {
            if (!this.db) {
                await this.getDbInstance();
            }

            const collection = this.db.collection('params');
            
            // Ensure actions are properly serialized
            const stateData = {
                ...data,
                actions: data.actions || []
            };

            await collection.replaceOne({}, stateData, { upsert: true });

            return true;
        } catch (e) {
            console.error('[MongodbAdapter] Error saving state:', e);
            throw e;
        }
    }

    public async processOperation(op: any, blockNumber: number, blockId: string, prevBlockId: string, trxId: string, blockTime: Date) {
        this.blockNumber = blockNumber;
        this.blockId = blockId;
        this.prevBlockId = prevBlockId;
        this.transactionId = trxId;
    }

    public async processTransfer(operation, payload: ContractPayload, metadata: { sender: string, amount: string }): Promise<boolean> {
        if (!this.db) {
            await this.getDbInstance();
        }

        const collection = this.db.collection('transfers');

        const data = {
            id: this.transactionId,
            blockId: this.blockId,
            blockNumber: this.blockNumber,
            sender: metadata.sender,
            amount: metadata.amount,
            contractName: payload.name,
            contractAction: payload.action,
            ContractPayload: payload.payload
        };

        await collection.insertOne(data);

        return true;
    }

    public async processCustomJson(operation, payload: ContractPayload, metadata: { sender: string, isSignedWithActiveKey: boolean }): Promise<boolean> {
        if (!this.db) {
            await this.getDbInstance();
        }
        
        const collection = this.db.collection('customJson');

        const data = {
            id: this.transactionId,
            blockId: this.blockId,
            blockNumber: this.blockNumber,
            sender: metadata.sender,
            isSignedWithActiveKey: metadata.isSignedWithActiveKey,
            contractName: payload.name,
            contractAction: payload.action,
            ContractPayload: payload.payload
        };

        await collection.insertOne(data);

        return true;
    }

    public async destroy(): Promise<boolean> {
        await this.client.close();

        return true;
    }
    
    public async find(table: string, queryObject: any): Promise<any> {
        if (!this.db) {
            await this.getDbInstance();
        }

        const collection = this.db.collection(table);

        return await collection.find(queryObject).toArray();
    }

    public async findOne(table: string, queryObject: any): Promise<any> {
        if (!this.db) {
            await this.getDbInstance();
        }

        const collection = this.db.collection(table);

        return await collection.find(queryObject).limit(1).toArray();
    }

    public async insert(table: string, data: any) {
        if (!this.db) {
            await this.getDbInstance();
        }

        const collection = this.db.collection(table);

        return await collection.insertOne(data);
    }

    public async replace(table: string, queryObject: any, data: any) {
        if (!this.db) {
            await this.getDbInstance();
        }

        const collection = this.db.collection(table);

        return await collection.replaceOne(queryObject, data, { upsert: true });
    }
}