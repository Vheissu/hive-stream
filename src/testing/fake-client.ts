import type { Client } from '@hiveio/dhive';

export type BroadcastType = 'transfer' | 'custom_json' | 'vote' | 'operations';

export interface BroadcastResult {
    id: string;
    block_num: number;
    trx_num: number;
    expired: boolean;
}

export interface RecordedBroadcast {
    type: BroadcastType;
    data: any;
    result: BroadcastResult;
}

type CallResponder = any | ((params: any[]) => any);

function defaultAccount(name: string): any {
    return {
        name,
        balance: '0.000 HIVE',
        hbd_balance: '0.000 HBD',
        savings_balance: '0.000 HIVE',
        savings_hbd_balance: '0.000 HBD',
        vesting_shares: '0.000000 VESTS',
        delegated_vesting_shares: '0.000000 VESTS',
        received_vesting_shares: '0.000000 VESTS',
        reward_hive_balance: '0.000 HIVE',
        reward_hbd_balance: '0.000 HBD',
        reward_vesting_balance: '0.000000 VESTS',
        memo_key: '',
        json_metadata: '',
        posting_json_metadata: '',
        posting: { weight_threshold: 1, account_auths: [], key_auths: [] },
        active: { weight_threshold: 1, account_auths: [], key_auths: [] },
        owner: { weight_threshold: 1, account_auths: [], key_auths: [] }
    };
}

/**
 * A stand-in for the dhive Client that records every broadcast instead of
 * sending it to the blockchain, and answers read calls from configurable
 * fixtures. Use `asClient()` to pass it wherever a dhive Client is expected.
 */
export class FakeHiveClient {
    public broadcasts: RecordedBroadcast[] = [];

    private callResponses = new Map<string, CallResponder>();
    private accounts = new Map<string, any>();
    private trxCounter = 0;

    public readonly broadcast = {
        transfer: async (data: any, key?: any): Promise<BroadcastResult> => this.record('transfer', data),
        json: async (data: any, key?: any): Promise<BroadcastResult> => this.record('custom_json', data),
        vote: async (data: any, key?: any): Promise<BroadcastResult> => this.record('vote', data),
        sendOperations: async (operations: any[], keys?: any): Promise<BroadcastResult> => this.record('operations', operations)
    };

    public readonly database = {
        getAccounts: async (names: string[]): Promise<any[]> => {
            return names.map((name) => this.accounts.get(name) ?? defaultAccount(name));
        },
        getBlock: async (blockNumber: number): Promise<any> => {
            return this.resolveCall('condenser_api.get_block', [blockNumber]) ?? null;
        },
        getAccountHistory: async (...params: any[]): Promise<any[]> => {
            return this.resolveCall('condenser_api.get_account_history', params) ?? [];
        },
        getDiscussions: async (by: string, query: any): Promise<any[]> => {
            return this.resolveCall(`condenser_api.get_discussions_by_${by}`, [query]) ?? [];
        },
        getDynamicGlobalProperties: async (): Promise<any> => {
            return this.resolveCall('condenser_api.get_dynamic_global_properties', []) ?? {};
        },
        getConfig: async (): Promise<any> => {
            return this.resolveCall('condenser_api.get_config', []) ?? {};
        },
        call: async (method: string, params: any[] = []): Promise<any> => {
            return this.resolveCall(`condenser_api.${method}`, params) ?? null;
        }
    };

    public async call(api: string, method: string, params: any[] = []): Promise<any> {
        return this.resolveCall(`${api}.${method}`, params) ?? null;
    }

    /**
     * Registers a canned response for a read call. The key can be either
     * `method` or `api.method` (for example `get_order_book` or
     * `condenser_api.get_order_book`). Pass a function to compute the
     * response from the call parameters.
     */
    public onCall(method: string, response: CallResponder): this {
        this.callResponses.set(method, response);
        return this;
    }

    /**
     * Registers a fixture account returned by `database.getAccounts`.
     * Fields are merged over a minimal default account object.
     */
    public setAccount(name: string, account: Partial<any> = {}): this {
        this.accounts.set(name, { ...defaultAccount(name), ...account });
        return this;
    }

    public get transfers(): any[] {
        return this.broadcasts.filter((b) => b.type === 'transfer').map((b) => b.data);
    }

    public get customJsons(): any[] {
        return this.broadcasts.filter((b) => b.type === 'custom_json').map((b) => b.data);
    }

    public get operations(): any[] {
        return this.broadcasts.filter((b) => b.type === 'operations').map((b) => b.data);
    }

    public reset(): void {
        this.broadcasts = [];
        this.trxCounter = 0;
    }

    public asClient(): Client {
        return this as unknown as Client;
    }

    private record(type: BroadcastType, data: any): BroadcastResult {
        this.trxCounter++;

        const result: BroadcastResult = {
            id: `fake-trx-${this.trxCounter.toString().padStart(6, '0')}`,
            block_num: 0,
            trx_num: this.trxCounter,
            expired: false
        };

        this.broadcasts.push({ type, data, result });

        return result;
    }

    private resolveCall(key: string, params: any[]): any {
        const responder = this.callResponses.get(key) ?? this.callResponses.get(key.split('.').pop() as string);

        if (responder === undefined) {
            return undefined;
        }

        return typeof responder === 'function' ? responder(params) : responder;
    }
}
