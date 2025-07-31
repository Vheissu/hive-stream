import { AdapterBase } from '../../src/adapters/base.adapter';

export class MockAdapter extends AdapterBase {
    public queries: string[] = [];
    public events: any[] = [];
    private queryResults: any[][] = [];
    private currentQueryIndex = 0;
    private testContext: any = {};
    public async create(): Promise<boolean> {
        return true;
    }

    public async destroy(): Promise<boolean> {
        return true;
    }

    public async loadActions() {
        return [];
    }

    public async loadState() {
        return { lastBlockNumber: 0, actions: [] };
    }

    public async saveState(data: any): Promise<boolean> {
        return true;
    }

    public async processBlock(block: any): Promise<any> {
        return true;
    }

    public async processOperation(op: any, blockNumber: number, blockId: string, prevBlockId: string, trxId: string, blockTime: Date): Promise<any> {
        return true;
    }

    public async processTransfer(operation: any, payload: any, metadata: any): Promise<boolean> {
        return true;
    }

    public async processCustomJson(operation: any, payload: any, metadata: any): Promise<boolean> {
        return true;
    }

    public async find(table: string, queryObject: Record<string, any>): Promise<any> {
        return [];
    }

    public async findOne(table: string, queryObject: Record<string, any>): Promise<any> {
        return null;
    }

    public async insert(table: string, data: any): Promise<any> {
        return true;
    }

    public async replace(table: string, queryObject: Record<string, any>, data: any): Promise<any> {
        return data;
    }

    public async addEvent(date: string | Date, contract: string, action: string, payload: any, data: any): Promise<boolean> {
        this.events.push({ date, contract, action, payload, data });
        return true;
    }

    public async query(sql: string, params?: any[]): Promise<any[]> {
        this.queries.push(sql);
        
        // Handle specific queries with predetermined responses
        if (sql.includes('CREATE TABLE')) {
            return [];
        }
        
        if (sql.includes('SELECT precision FROM tokens WHERE symbol = ?')) {
            const symbol = params?.[0];
            if (this.testContext.nonExistentToken === symbol) {
                return [];
            }
            return [{ precision: 3 }];
        }
        
        if (sql.includes('SELECT balance FROM token_balances WHERE account = ? AND symbol = ?')) {
            const account = params?.[0];
            const symbol = params?.[1];
            
            // Handle test scenarios
            if (this.testContext.insufficientBalance && account === 'alice') {
                return [{ balance: '50' }];
            }
            if (this.testContext.zeroBalance && account === 'alice') {
                return [];
            }
            if (this.testContext.noExistingBalance) {
                return [];
            }
            
            // Default balances
            if (account === 'alice') {
                return [{ balance: '1000' }];
            } else if (account === 'bob') {
                return [{ balance: '50' }];
            }
            return [];
        }
        
        if (sql.includes('SELECT * FROM tokens WHERE symbol = ?')) {
            const symbol = params?.[0];
            if (this.testContext.nonExistentToken === symbol) {
                return [];
            }
            
            // Handle max supply exceeded test
            if (this.testContext.maxSupplyExceeded) {
                return [{
                    symbol: 'TEST',
                    name: 'Test Token',
                    creator: 'alice',
                    precision: 3,
                    max_supply: '1000000',
                    current_supply: '999999'
                }];
            }
            
            // Return token info for existing tokens
            return [{
                symbol: 'TEST',
                name: 'Test Token',
                url: 'https://example.com/token',
                precision: 3,
                max_supply: '1000000',
                current_supply: '500000',
                creator: 'alice',
                created_at: new Date()
            }];
        }
        
        if (sql.includes('SELECT symbol FROM tokens WHERE symbol = ?')) {
            const symbol = params?.[0];
            if (this.testContext.existingToken === symbol) {
                return [{ symbol }];
            }
            return [];
        }
        
        // Use sequential results for other queries
        if (this.queryResults.length > this.currentQueryIndex) {
            return this.queryResults[this.currentQueryIndex++];
        }
        return [];
    }

    public setQueryResult(result: any[], index?: number): void {
        if (index !== undefined) {
            this.queryResults[index] = result;
        } else {
            this.queryResults.push(result);
        }
    }

    public setQueryResults(results: any[][]): void {
        this.queryResults = results;
        this.currentQueryIndex = 0;
    }

    public reset(): void {
        this.queries = [];
        this.events = [];
        this.queryResults = [];
        this.currentQueryIndex = 0;
        this.testContext = {};
    }

    public setTestContext(context: any): void {
        this.testContext = context;
    }

    public async getTransfers() {
        return [];
    }

    public async getEvents() {
        return [];
    }

    public async getJson() {
        return [];
    }

    public async getTransfersByContract(contract: string) {
        return [];
    }

    public async getTransfersByAccount(account: string) {
        return [];
    }

    public async getTransfersByBlockid(blockId: any) {
        return [];
    }

    public async getJsonByContract(contract: string) {
        return [];
    }

    public async getJsonByAccount(account: string) {
        return [];
    }

    public async getJsonByBlockid(blockId: any) {
        return [];
    }
}

export const createMockAdapter = () => new MockAdapter();