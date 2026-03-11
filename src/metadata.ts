import { TimeAction } from './actions';
import { Config, ConfigInput, ConfigInterface } from './config';
import type { ContractTrigger } from './types/hive-stream';

export type MetadataPrimitive = string | number | boolean | null;

export interface ConfigOptionMetadata {
    key: keyof ConfigInterface;
    builderKey?: keyof ConfigInput;
    type: 'string' | 'number' | 'boolean' | 'string[]';
    defaultValue: MetadataPrimitive | string[];
    description: string;
    envVar?: string;
}

export interface EventHandlerMetadata {
    method: string;
    signature: string;
    callbackSignature: string;
    description: string;
    requiresStart: boolean;
    accountFilterBuiltIn?: boolean;
    idFilterBuiltIn?: boolean;
}

export interface WriteOperationMetadata {
    method: string;
    signature: string;
    description: string;
    requiresActiveKey: boolean;
    requiresStart: boolean;
}

export interface AdapterMetadata {
    name: string;
    exportName: string;
    constructorSignature: string;
    description: string;
}

export interface ContractPayloadMetadata {
    jsonIdDefault: string;
    payloadIdentifierDefault: string;
    shape: {
        contract: string;
        action: string;
        payload: string;
        meta: string;
    };
    supportedTriggers: ContractTrigger[];
    supportedOperations: string[];
}

export interface ProviderMetadata {
    name: string;
    exportName: string;
    constructorSignature: string;
    description: string;
}

export interface HiveStreamMetadata {
    schemaVersion: number;
    config: {
        options: ConfigOptionMetadata[];
    };
    subscriptions: EventHandlerMetadata[];
    writeOperations: WriteOperationMetadata[];
    contracts: {
        payload: ContractPayloadMetadata;
        helperExports: string[];
    };
    timeAction: {
        validValues: string[];
    };
    adapters: AdapterMetadata[];
    providers: ProviderMetadata[];
}

function deepFreeze<T>(value: T): Readonly<T> {
    if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
        return value as Readonly<T>;
    }

    Object.freeze(value);

    Object.getOwnPropertyNames(value).forEach((property) => {
        const child = (value as Record<string, unknown>)[property];

        if (child !== null && (typeof child === 'object' || typeof child === 'function')) {
            deepFreeze(child);
        }
    });

    return value as Readonly<T>;
}

const contractTriggers: ContractTrigger[] = [
    'custom_json',
    'transfer',
    'time',
    'escrow_transfer',
    'escrow_approve',
    'escrow_dispute',
    'escrow_release',
    'recurrent_transfer'
];

export const HIVE_STREAM_METADATA: Readonly<HiveStreamMetadata> = deepFreeze({
    schemaVersion: 1,
    config: {
        options: [
            {
                key: 'ACTIVE_KEY',
                builderKey: 'activeKey',
                type: 'string',
                defaultValue: Config.ACTIVE_KEY ?? null,
                description: 'Active private key used for active-authority write operations.',
                envVar: 'ACTIVE_KEY'
            },
            {
                key: 'POSTING_KEY',
                builderKey: 'postingKey',
                type: 'string',
                defaultValue: Config.POSTING_KEY ?? null,
                description: 'Posting private key used for posting-authority operations.',
                envVar: 'POSTING_KEY'
            },
            {
                key: 'USERNAME',
                builderKey: 'username',
                type: 'string',
                defaultValue: Config.USERNAME,
                description: 'Hive account name used for signing and authoring actions.',
                envVar: 'USERNAME'
            },
            {
                key: 'APP_NAME',
                builderKey: 'appName',
                type: 'string',
                defaultValue: Config.APP_NAME,
                description: 'Application identifier used in blockchain metadata.'
            },
            {
                key: 'JSON_ID',
                builderKey: 'jsonId',
                type: 'string',
                defaultValue: Config.JSON_ID,
                description: 'Custom JSON id used for contract payload dispatch.'
            },
            {
                key: 'PAYLOAD_IDENTIFIER',
                builderKey: 'payloadIdentifier',
                type: 'string',
                defaultValue: Config.PAYLOAD_IDENTIFIER,
                description: 'Wrapper key where contract payloads are expected in operation JSON.'
            },
            {
                key: 'HIVE_ENGINE_API',
                builderKey: 'hiveEngineApi',
                type: 'string',
                defaultValue: Config.HIVE_ENGINE_API,
                description: 'Hive Engine API endpoint used for sidechain operations.'
            },
            {
                key: 'HIVE_ENGINE_ID',
                builderKey: 'hiveEngineId',
                type: 'string',
                defaultValue: Config.HIVE_ENGINE_ID,
                description: 'Custom JSON id treated as Hive Engine sidechain payloads.'
            },
            {
                key: 'LAST_BLOCK_NUMBER',
                builderKey: 'lastBlockNumber',
                type: 'number',
                defaultValue: Config.LAST_BLOCK_NUMBER,
                description: 'Initial block number. 0 means start from latest block.'
            },
            {
                key: 'BLOCK_CHECK_INTERVAL',
                builderKey: 'blockCheckInterval',
                type: 'number',
                defaultValue: Config.BLOCK_CHECK_INTERVAL,
                description: 'Polling interval (ms) for checking new blocks.'
            },
            {
                key: 'BLOCKS_BEHIND_WARNING',
                builderKey: 'blocksBehindWarning',
                type: 'number',
                defaultValue: Config.BLOCKS_BEHIND_WARNING,
                description: 'Warn when this many blocks behind head block.'
            },
            {
                key: 'RESUME_FROM_STATE',
                builderKey: 'resumeFromState',
                type: 'boolean',
                defaultValue: Config.RESUME_FROM_STATE,
                description: 'Resume from adapter-saved state when available.'
            },
            {
                key: 'CATCH_UP_BATCH_SIZE',
                builderKey: 'catchUpBatchSize',
                type: 'number',
                defaultValue: Config.CATCH_UP_BATCH_SIZE,
                description: 'Number of blocks processed per catch-up cycle.'
            },
            {
                key: 'CATCH_UP_DELAY_MS',
                builderKey: 'catchUpDelayMs',
                type: 'number',
                defaultValue: Config.CATCH_UP_DELAY_MS,
                description: 'Delay between catch-up batches in milliseconds.'
            },
            {
                key: 'API_NODES',
                builderKey: 'apiNodes',
                type: 'string[]',
                defaultValue: Config.API_NODES,
                description: 'Ordered Hive API node list used for failover.'
            },
            {
                key: 'API_ENABLED',
                builderKey: 'apiEnabled',
                type: 'boolean',
                defaultValue: Config.API_ENABLED,
                description: 'Enable the built-in HTTP API server when the streamer starts.'
            },
            {
                key: 'API_PORT',
                builderKey: 'apiPort',
                type: 'number',
                defaultValue: Config.API_PORT,
                description: 'Port used by the built-in HTTP API server.'
            },
            {
                key: 'DEBUG_MODE',
                builderKey: 'debugMode',
                type: 'boolean',
                defaultValue: Config.DEBUG_MODE,
                description: 'Enable verbose internal logging.'
            }
        ]
    },
    subscriptions: [
        {
            method: 'onTransfer',
            signature: 'onTransfer(account: string, callback)',
            callbackSignature: '(op, blockNumber, blockId, prevBlockId, trxId, blockTime) => void',
            description: 'Fires when transfer recipient matches account.',
            requiresStart: true,
            accountFilterBuiltIn: true
        },
        {
            method: 'onCustomJson',
            signature: 'onCustomJson(callback)',
            callbackSignature: '(op, { sender, isSignedWithActiveKey }, blockNumber, blockId, prevBlockId, trxId, blockTime) => void',
            description: 'Fires for all custom_json operations.',
            requiresStart: true
        },
        {
            method: 'onCustomJsonId',
            signature: 'onCustomJsonId(callback, id: string)',
            callbackSignature: '(op, { sender, isSignedWithActiveKey }, blockNumber, blockId, prevBlockId, trxId, blockTime) => void',
            description: 'Fires for custom_json operations matching id.',
            requiresStart: true,
            idFilterBuiltIn: true
        },
        {
            method: 'onHiveEngine',
            signature: 'onHiveEngine(callback)',
            callbackSignature: '(contractName, contractAction, contractPayload, sender, op, blockNumber, blockId, prevBlockId, trxId, blockTime) => void',
            description: 'Fires for Hive Engine custom_json payloads without sidechain errors.',
            requiresStart: true
        },
        {
            method: 'onPost',
            signature: 'onPost(callback)',
            callbackSignature: '(op, blockNumber, blockId, prevBlockId, trxId, blockTime) => void',
            description: 'Fires for top-level posts.',
            requiresStart: true
        },
        {
            method: 'onComment',
            signature: 'onComment(callback)',
            callbackSignature: '(op, blockNumber, blockId, prevBlockId, trxId, blockTime) => void',
            description: 'Fires for comments.',
            requiresStart: true
        },
        {
            method: 'onEscrowTransfer',
            signature: 'onEscrowTransfer(callback)',
            callbackSignature: '(op, blockNumber, blockId, prevBlockId, trxId, blockTime) => void',
            description: 'Fires for escrow_transfer operations.',
            requiresStart: true
        },
        {
            method: 'onEscrowApprove',
            signature: 'onEscrowApprove(callback)',
            callbackSignature: '(op, blockNumber, blockId, prevBlockId, trxId, blockTime) => void',
            description: 'Fires for escrow_approve operations.',
            requiresStart: true
        },
        {
            method: 'onEscrowDispute',
            signature: 'onEscrowDispute(callback)',
            callbackSignature: '(op, blockNumber, blockId, prevBlockId, trxId, blockTime) => void',
            description: 'Fires for escrow_dispute operations.',
            requiresStart: true
        },
        {
            method: 'onEscrowRelease',
            signature: 'onEscrowRelease(callback)',
            callbackSignature: '(op, blockNumber, blockId, prevBlockId, trxId, blockTime) => void',
            description: 'Fires for escrow_release operations.',
            requiresStart: true
        }
    ],
    writeOperations: [
        {
            method: 'transferHiveTokens',
            signature: 'transferHiveTokens(from, to, amount, symbol, memo?)',
            description: 'Transfer HIVE or HBD.',
            requiresActiveKey: true,
            requiresStart: false
        },
        {
            method: 'transferHiveEngineTokens',
            signature: 'transferHiveEngineTokens(from, to, symbol, quantity, memo?)',
            description: 'Transfer Hive Engine tokens.',
            requiresActiveKey: true,
            requiresStart: false
        },
        {
            method: 'transferHiveEngineTokensMultiple',
            signature: 'transferHiveEngineTokensMultiple(from, accounts[], symbol, memo?, amount?)',
            description: 'Bulk transfer Hive Engine tokens.',
            requiresActiveKey: true,
            requiresStart: false
        },
        {
            method: 'issueHiveEngineTokens',
            signature: 'issueHiveEngineTokens(from, to, symbol, quantity, memo?)',
            description: 'Issue Hive Engine tokens.',
            requiresActiveKey: true,
            requiresStart: false
        },
        {
            method: 'issueHiveEngineTokensMultiple',
            signature: 'issueHiveEngineTokensMultiple(from, accounts[], symbol, memo?, amount?)',
            description: 'Bulk issue Hive Engine tokens.',
            requiresActiveKey: true,
            requiresStart: false
        },
        {
            method: 'upvote',
            signature: 'upvote(votePercentage?, username, permlink)',
            description: 'Upvote a post (uses configured USERNAME as voter).',
            requiresActiveKey: true,
            requiresStart: false
        },
        {
            method: 'downvote',
            signature: 'downvote(votePercentage?, username, permlink)',
            description: 'Downvote a post (uses configured USERNAME as voter).',
            requiresActiveKey: true,
            requiresStart: false
        },
        {
            method: 'escrowTransfer',
            signature: 'escrowTransfer(options, signingKeys?)',
            description: 'Create escrow transfer.',
            requiresActiveKey: true,
            requiresStart: false
        },
        {
            method: 'escrowApprove',
            signature: 'escrowApprove(options, signingKeys?)',
            description: 'Approve escrow transfer.',
            requiresActiveKey: true,
            requiresStart: false
        },
        {
            method: 'escrowDispute',
            signature: 'escrowDispute(options, signingKeys?)',
            description: 'Dispute escrow transfer.',
            requiresActiveKey: true,
            requiresStart: false
        },
        {
            method: 'escrowRelease',
            signature: 'escrowRelease(options, signingKeys?)',
            description: 'Release escrow funds.',
            requiresActiveKey: true,
            requiresStart: false
        },
        {
            method: 'recurrentTransfer',
            signature: 'recurrentTransfer(options, signingKeys?)',
            description: 'Create recurrent transfer.',
            requiresActiveKey: true,
            requiresStart: false
        },
        {
            method: 'createProposal',
            signature: 'createProposal(options, signingKeys?)',
            description: 'Create a DHF proposal.',
            requiresActiveKey: true,
            requiresStart: false
        },
        {
            method: 'updateProposalVotes',
            signature: 'updateProposalVotes(options, signingKeys?)',
            description: 'Vote for proposals.',
            requiresActiveKey: true,
            requiresStart: false
        },
        {
            method: 'removeProposals',
            signature: 'removeProposals(options, signingKeys?)',
            description: 'Remove proposals.',
            requiresActiveKey: true,
            requiresStart: false
        },
        {
            method: 'broadcastOperations',
            signature: 'broadcastOperations(operations, signingKeys?)',
            description: 'Broadcast raw operations payload.',
            requiresActiveKey: true,
            requiresStart: false
        },
        {
            method: 'broadcastMultiSigOperations',
            signature: 'broadcastMultiSigOperations(operations, signingKeys)',
            description: 'Broadcast multisig operations payload.',
            requiresActiveKey: true,
            requiresStart: false
        },
        {
            method: 'updateAccountAuthorities',
            signature: 'updateAccountAuthorities(account, authorityUpdate, signingKeys?)',
            description: 'Update account authorities and metadata.',
            requiresActiveKey: true,
            requiresStart: false
        }
    ],
    contracts: {
        payload: {
            jsonIdDefault: Config.JSON_ID,
            payloadIdentifierDefault: Config.PAYLOAD_IDENTIFIER,
            shape: {
                contract: 'string',
                action: 'string',
                payload: 'object',
                meta: 'object'
            },
            supportedTriggers: contractTriggers,
            supportedOperations: ['transfer', 'custom_json', 'escrow_transfer', 'recurrent_transfer']
        },
        helperExports: [
            'defineContract',
            'action',
            'createDiceContract',
            'createLottoContract',
            'createCoinflipContract',
            'createTokenContract',
            'createNFTContract',
            'createRpsContract',
            'createPollContract',
            'createTipJarContract',
            'createExchangeContract',
            'createAuctionHouseContract',
            'createSubscriptionContract',
            'createCrowdfundContract',
            'createBountyBoardContract',
            'createInvoiceContract',
            'createSavingsContract',
            'createBookingContract',
            'createGiftCardContract',
            'createGroupBuyContract',
            'createSweepstakesContract',
            'createDcaBotContract',
            'createMultisigTreasuryContract',
            'createRevenueSplitContract',
            'createPaywallContract',
            'createDomainRegistryContract',
            'createRentalContract',
            'createLaunchpadContract',
            'createPredictionMarketContract',
            'createQuestPassContract',
            'createCharityMatchContract',
            'createReferralContract',
            'createInsurancePoolContract',
            'createOracleBountyContract',
            'createGrantRoundsContract',
            'createPayrollContract',
            'createProposalTimelockContract',
            'createBundleMarketplaceContract',
            'createTicketingContract',
            'createFanClubContract'
        ]
    },
    timeAction: {
        validValues: TimeAction.getValidTimeValues()
    },
    adapters: [
        {
            name: 'SQLite Adapter',
            exportName: 'SqliteAdapter',
            constructorSignature: 'new SqliteAdapter(dbPath?)',
            description: 'Default local adapter. Auto-registered in Streamer constructor.'
        },
        {
            name: 'MongoDB Adapter',
            exportName: 'MongodbAdapter',
            constructorSignature: 'new MongodbAdapter(uri, dbName)',
            description: 'Mongo-backed adapter for state and event persistence.'
        },
        {
            name: 'PostgreSQL Adapter',
            exportName: 'PostgreSQLAdapter',
            constructorSignature: 'new PostgreSQLAdapter(config)',
            description: 'PostgreSQL adapter for state, event, and SQL-backed contract data.'
        }
    ],
    providers: [
        {
            name: 'Hive Provider',
            exportName: 'HiveProvider',
            constructorSignature: 'new HiveProvider({ apiNodes })',
            description: 'Default block provider wrapping @hiveio/dhive JSON-RPC calls.'
        },
        {
            name: 'HAF Provider',
            exportName: 'HafProvider',
            constructorSignature: 'new HafProvider(config?)',
            description: 'HAF/HafSQL PostgreSQL block provider for high-performance block fetching.'
        },
        {
            name: 'HAF Client',
            exportName: 'HafClient',
            constructorSignature: 'new HafClient(config?)',
            description: 'Standalone HAF query helper for direct analytics queries.'
        }
    ]
});

export function getHiveStreamMetadata(): Readonly<HiveStreamMetadata> {
    return HIVE_STREAM_METADATA;
}
