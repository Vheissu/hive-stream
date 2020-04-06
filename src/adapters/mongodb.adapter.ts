import { ContractPayload } from './../types/hive-stream';
import { AdapterBase } from './base.adapter';

import { MongoClient, Db } from 'mongodb';

export class MongodbAdapter extends AdapterBase {
    private client: MongoClient;
    private db: Db;

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

    protected async create(): Promise<boolean> {
        try {
            this.client = await MongoClient.connect(this.mongo.uri, this.mongo.options);
            this.db = this.client.db(this.mongo.database);

            return true;
        } catch (e) {
            throw e;
        }
    }

    protected async loadState(): Promise<any> {
        try {
            const collection = this.db.collection('params');
            const params = await collection.findOne({});

            if (params) {
                return params;
            }
        } catch (e) {
            throw e;
        }
    }

    protected async saveState(data: any): Promise<boolean> {
        try {
            const collection = this.db.collection('params');

            await collection.replaceOne({}, data, {  upsert: true});

            return true;
        } catch (e) {
            throw e;
        }
    }

    protected async processOperation(op: any, blockNumber: number, blockId: string, prevBlockId: string, trxId: string, blockTime: Date) {
        this.blockNumber = blockNumber;
        this.blockId = blockId;
        this.prevBlockId = prevBlockId;
        this.transactionId = trxId;
    }

    protected async processTransfer(operation, payload: ContractPayload, metadata: { sender: string, amount: string }): Promise<boolean> {
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

    protected async processCustomJson(operation, payload: ContractPayload, metadata: { sender: string, isSignedWithActiveKey: boolean }): Promise<boolean> {
        const collection = this.db.collection('transfers');

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

    protected async destroy(): Promise<boolean> {
        await this.client.close();

        return true;
    }
}