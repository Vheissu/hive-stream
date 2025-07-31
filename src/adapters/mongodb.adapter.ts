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

    public async query(sql: string, params?: any[]): Promise<any[]> {
        throw new Error('Raw SQL queries are not supported in MongoDB adapter');
    }

    public async addEvent(date: string, contract: string, action: string, payload: ContractPayload, data: unknown): Promise<boolean> {
        try {
            if (!this.db) {
                await this.getDbInstance();
            }

            const collection = this.db.collection('events');
            await collection.insertOne({
                date,
                contract,
                action,
                payload,
                data
            });
            
            return true;
        } catch (error) {
            console.error('[MongodbAdapter] Error adding event:', error);
            throw error;
        }
    }

    public async getEvents(): Promise<any[]> {
        try {
            if (!this.db) {
                await this.getDbInstance();
            }

            const collection = this.db.collection('events');
            const events = await collection.find({}).toArray();
            
            return events.length ? events : null;
        } catch (error) {
            console.error('[MongodbAdapter] Error getting events:', error);
            throw error;
        }
    }

    public async getEventsByContract(contract: string): Promise<any[]> {
        try {
            if (!this.db) {
                await this.getDbInstance();
            }

            const collection = this.db.collection('events');
            const events = await collection.find({ contract }).toArray();
            
            return events.length ? events : null;
        } catch (error) {
            console.error('[MongodbAdapter] Error getting events by contract:', error);
            throw error;
        }
    }

    public async getEventsByAccount(account: string): Promise<any[]> {
        try {
            if (!this.db) {
                await this.getDbInstance();
            }

            const collection = this.db.collection('events');
            const events = await collection.find({
                $or: [
                    { 'data.sender': account },
                    { 'data.account': account },
                    { 'payload.sender': account },
                    { 'payload.account': account }
                ]
            }).toArray();
            
            return events.length ? events : null;
        } catch (error) {
            console.error('[MongodbAdapter] Error getting events by account:', error);
            throw error;
        }
    }

    public async getTransfers(): Promise<any[]> {
        try {
            if (!this.db) {
                await this.getDbInstance();
            }

            const collection = this.db.collection('transfers');
            const transfers = await collection.find({}).toArray();
            
            return transfers.length ? transfers : null;
        } catch (error) {
            console.error('[MongodbAdapter] Error getting transfers:', error);
            throw error;
        }
    }

    public async getTransfersByContract(contract: string): Promise<any[]> {
        try {
            if (!this.db) {
                await this.getDbInstance();
            }

            const collection = this.db.collection('transfers');
            const transfers = await collection.find({ contractName: contract }).toArray();
            
            return transfers.length ? transfers : null;
        } catch (error) {
            console.error('[MongodbAdapter] Error getting transfers by contract:', error);
            throw error;
        }
    }

    public async getTransfersByAccount(account: string): Promise<any[]> {
        try {
            if (!this.db) {
                await this.getDbInstance();
            }

            const collection = this.db.collection('transfers');
            const transfers = await collection.find({ sender: account }).toArray();
            
            return transfers.length ? transfers : null;
        } catch (error) {
            console.error('[MongodbAdapter] Error getting transfers by account:', error);
            throw error;
        }
    }

    public async getTransfersByBlockid(blockId: string): Promise<any[]> {
        try {
            if (!this.db) {
                await this.getDbInstance();
            }

            const collection = this.db.collection('transfers');
            const transfers = await collection.find({ blockId }).toArray();
            
            return transfers.length ? transfers : null;
        } catch (error) {
            console.error('[MongodbAdapter] Error getting transfers by block ID:', error);
            throw error;
        }
    }

    public async getJson(): Promise<any[]> {
        try {
            if (!this.db) {
                await this.getDbInstance();
            }

            const collection = this.db.collection('customJson');
            const jsons = await collection.find({}).toArray();
            
            return jsons.length ? jsons : null;
        } catch (error) {
            console.error('[MongodbAdapter] Error getting JSON:', error);
            throw error;
        }
    }

    public async getJsonByContract(contract: string): Promise<any[]> {
        try {
            if (!this.db) {
                await this.getDbInstance();
            }

            const collection = this.db.collection('customJson');
            const jsons = await collection.find({ contractName: contract }).toArray();
            
            return jsons.length ? jsons : null;
        } catch (error) {
            console.error('[MongodbAdapter] Error getting JSON by contract:', error);
            throw error;
        }
    }

    public async getJsonByAccount(account: string): Promise<any[]> {
        try {
            if (!this.db) {
                await this.getDbInstance();
            }

            const collection = this.db.collection('customJson');
            const jsons = await collection.find({ sender: account }).toArray();
            
            return jsons.length ? jsons : null;
        } catch (error) {
            console.error('[MongodbAdapter] Error getting JSON by account:', error);
            throw error;
        }
    }

    public async getJsonByBlockid(blockId: string): Promise<any[]> {
        try {
            if (!this.db) {
                await this.getDbInstance();
            }

            const collection = this.db.collection('customJson');
            const jsons = await collection.find({ blockId }).toArray();
            
            return jsons.length ? jsons : null;
        } catch (error) {
            console.error('[MongodbAdapter] Error getting JSON by block ID:', error);
            throw error;
        }
    }
}