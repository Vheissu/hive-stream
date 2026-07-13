export type TemplateId = 'minimal' | 'game' | 'exchange' | 'social' | 'blog' | 'token' | 'assets';
export type AdapterId = 'sqlite' | 'mongodb' | 'postgresql';

export interface UsageExample {
    title: string;
    description: string;
    payload: string;
}

export interface TemplateDefinition {
    id: TemplateId;
    label: string;
    description: string;
    imports: string[];
    registrations: string[];
    setup: string[];
    usage: UsageExample[];
}

export interface AdapterDefinition {
    id: AdapterId;
    label: string;
    description: string;
    importName: string;
    construct: string;
    envLines: string[];
}

const wrap = (contract: string, actionName: string, payload: string): string => {
    return `{"hive_stream":{"contract":"${contract}","action":"${actionName}","payload":${payload}}}`;
};

export const TEMPLATES: TemplateDefinition[] = [
    {
        id: 'minimal',
        label: 'Minimal',
        description: 'A bare streamer with subscriptions and a custom contract to build on.',
        imports: [],
        registrations: [],
        setup: [
            `streamer.onTransfer(HIVE_USERNAME, (op, blockNumber) => {`,
            `    console.log(\`Received \${op.amount} from @\${op.from} in block \${blockNumber}\`);`,
            `});`,
            ``,
            `streamer.onPost((op, blockNumber) => {`,
            `    console.log(\`New post by @\${op.author} in block \${blockNumber}\`);`,
            `});`
        ],
        usage: [
            {
                title: 'Call the greeting contract',
                description: 'Broadcast a custom_json operation with id `hivestream`:',
                payload: wrap('greeting', 'greet', '{"name":"Hive"}')
            }
        ]
    },
    {
        id: 'game',
        label: 'Game',
        description: 'Provably-fair games of chance: dice, coinflip, roulette, and rock-paper-scissors.',
        imports: [
            'createCoinflipContract',
            'createDiceContract',
            'createRouletteContract',
            'createRpsContract'
        ],
        registrations: [
            `await streamer.registerContract(createDiceContract({ account: HIVE_USERNAME }));`,
            `await streamer.registerContract(createCoinflipContract({ account: HIVE_USERNAME }));`,
            `await streamer.registerContract(createRouletteContract({ account: HIVE_USERNAME }));`,
            `await streamer.registerContract(createRpsContract({ account: HIVE_USERNAME }));`
        ],
        setup: [],
        usage: [
            {
                title: 'Roll the dice',
                description: 'Send HIVE to your app account with this transfer memo:',
                payload: wrap('dice', 'roll', '{"roll":50}')
            },
            {
                title: 'Flip a coin',
                description: 'Send HIVE with this transfer memo:',
                payload: wrap('coinflip', 'flip', '{"guess":"heads"}')
            },
            {
                title: 'Spin the roulette wheel',
                description: 'Send HIVE with this transfer memo:',
                payload: wrap('roulette', 'spin', '{"betType":"color","value":"red"}')
            },
            {
                title: 'Play rock-paper-scissors',
                description: 'Send HIVE with this transfer memo:',
                payload: wrap('rps', 'play', '{"move":"rock"}')
            }
        ]
    },
    {
        id: 'exchange',
        label: 'Exchange',
        description: 'An on-chain order book exchange with deposits, orders, and a matching engine.',
        imports: ['createExchangeContract', 'TimeAction'],
        registrations: [
            `await streamer.registerContract(createExchangeContract({`,
            `    account: HIVE_USERNAME,`,
            `    feeAccount: HIVE_USERNAME,`,
            `    makerFeeBps: 10,`,
            `    takerFeeBps: 20`,
            `}));`
        ],
        setup: [
            `// Run the order matcher every 30 seconds and snapshot the order book`,
            `await streamer.registerAction(new TimeAction('30s', 'exchange-matcher', 'exchange', 'matchOrders', { limit: 50, snapshot: true, depth: 20 }));`
        ],
        usage: [
            {
                title: 'Create a trading pair',
                description: 'Broadcast a custom_json operation with id `hivestream`:',
                payload: wrap('exchange', 'createPair', '{"base":"HIVE","quote":"HBD"}')
            },
            {
                title: 'Deposit funds',
                description: 'Send HIVE or HBD to your app account with this transfer memo:',
                payload: wrap('exchange', 'deposit', '{}')
            },
            {
                title: 'Place an order',
                description: 'Broadcast a custom_json operation with id `hivestream`:',
                payload: wrap('exchange', 'placeOrder', '{"side":"buy","base":"HIVE","quote":"HBD","price":"2","amount":"5"}')
            }
        ]
    },
    {
        id: 'social',
        label: 'Social',
        description: 'A social platform backend: fan clubs, subscriptions, tips, and post streaming.',
        imports: [
            'createFanClubContract',
            'createSubscriptionContract',
            'createTipJarContract'
        ],
        registrations: [
            `await streamer.registerContract(createFanClubContract());`,
            `await streamer.registerContract(createSubscriptionContract());`,
            `await streamer.registerContract(createTipJarContract());`
        ],
        setup: [
            `streamer.onPost((op, blockNumber) => {`,
            `    console.log(\`New post by @\${op.author}: \${op.permlink} (block \${blockNumber})\`);`,
            `});`,
            ``,
            `streamer.onComment((op, blockNumber) => {`,
            `    console.log(\`New comment by @\${op.author} on @\${op.parent_author}/\${op.parent_permlink} (block \${blockNumber})\`);`,
            `});`
        ],
        usage: [
            {
                title: 'Create a fan club',
                description: 'Broadcast a custom_json operation with id `hivestream`:',
                payload: wrap('fanclub', 'createClub', '{"clubId":"my-club","title":"My Club","joinPrice":"1.000","asset":"HIVE"}')
            },
            {
                title: 'Join a fan club',
                description: 'Send the join price to your app account with this transfer memo:',
                payload: wrap('fanclub', 'joinClub', '{"clubId":"my-club"}')
            },
            {
                title: 'Create a subscription plan',
                description: 'Broadcast a custom_json operation with id `hivestream`:',
                payload: wrap('subscription', 'createPlan', '{"planId":"monthly","title":"Monthly Supporter","price":"5.000","asset":"HIVE","intervalDays":30}')
            },
            {
                title: 'Leave a tip',
                description: 'Send any amount to your app account with this transfer memo:',
                payload: wrap('tipjar', 'tip', '{"message":"Great work!"}')
            }
        ]
    },
    {
        id: 'blog',
        label: 'Blog',
        description: 'A blogging backend: paywalled content, tips, and post/comment streaming.',
        imports: ['createPaywallContract', 'createTipJarContract'],
        registrations: [
            `await streamer.registerContract(createPaywallContract());`,
            `await streamer.registerContract(createTipJarContract());`
        ],
        setup: [
            `streamer.onPost((op, blockNumber) => {`,
            `    console.log(\`New post by @\${op.author}: \${op.permlink} (block \${blockNumber})\`);`,
            `});`,
            ``,
            `streamer.onComment((op, blockNumber) => {`,
            `    console.log(\`New comment by @\${op.author} on @\${op.parent_author}/\${op.parent_permlink} (block \${blockNumber})\`);`,
            `});`
        ],
        usage: [
            {
                title: 'Create a paywalled resource',
                description: 'Broadcast a custom_json operation with id `hivestream`:',
                payload: wrap('paywall', 'createResource', '{"resourceId":"premium-post","title":"Premium Post","price":"1.000","asset":"HBD","accessDays":30}')
            },
            {
                title: 'Buy access',
                description: 'Send the price to your app account with this transfer memo:',
                payload: wrap('paywall', 'grantAccess', '{"resourceId":"premium-post"}')
            },
            {
                title: 'Leave a tip',
                description: 'Send any amount to your app account with this transfer memo:',
                payload: wrap('tipjar', 'tip', '{"message":"Loved this post!"}')
            }
        ]
    },
    {
        id: 'token',
        label: 'Token & NFT',
        description: 'Custom tokens and NFT collections with minting, transfers, and a marketplace.',
        imports: ['createNFTContract', 'createTokenContract'],
        registrations: [
            `await streamer.registerContract(createTokenContract());`,
            `await streamer.registerContract(createNFTContract({ name: 'nft' }));`
        ],
        setup: [],
        usage: [
            {
                title: 'Create a token',
                description: 'Broadcast a custom_json operation with id `hivestream`:',
                payload: wrap('token', 'createToken', '{"symbol":"MYTOKEN","name":"My Token","maxSupply":"1000000","precision":3}')
            },
            {
                title: 'Issue tokens',
                description: 'Broadcast a custom_json operation with id `hivestream` (token creator only):',
                payload: wrap('token', 'issueTokens', '{"symbol":"MYTOKEN","to":"some-account","amount":"100"}')
            },
            {
                title: 'Create an NFT collection',
                description: 'Broadcast a custom_json operation with id `hivestream`:',
                payload: wrap('nft', 'createCollection', '{"symbol":"MYNFT","name":"My Collection"}')
            }
        ]
    },
    {
        id: 'assets',
        label: 'Assets & Tickets',
        description: 'Non-custodial NFTs and event tickets: batch minting, direct peer-to-peer sales, and on-chain state checkpoints.',
        imports: [
            'createCheckpointContract',
            'createNFTContract',
            'createTicketingContract',
            'TimeAction'
        ],
        registrations: [
            `await streamer.registerContract(createNFTContract({ name: 'nft' }));`,
            `await streamer.registerContract(createTicketingContract());`,
            `await streamer.registerContract(createCheckpointContract({`,
            `    account: HIVE_USERNAME,`,
            `    tables: ['nft_collections', 'nft_tokens', 'nft_listings', 'ticket_events', 'tickets', 'ticket_listings']`,
            `}));`
        ],
        setup: [
            `// Publish a verifiable state hash on-chain every hour so anyone running`,
            `// this open-source app can confirm they derive the same state`,
            `await streamer.registerAction(new TimeAction('1h', 'state-checkpoint', 'checkpoint', 'publishCheckpoint', {}));`
        ],
        usage: [
            {
                title: 'Create an NFT collection',
                description: 'Broadcast a custom_json operation with id `hivestream`:',
                payload: wrap('nft', 'createCollection', '{"symbol":"TICKETS","name":"Event Tickets","maxSupply":1000}')
            },
            {
                title: 'Batch mint numbered editions',
                description: 'Broadcast a custom_json operation with id `hivestream` (collection creator only):',
                payload: wrap('nft', 'mintBatchNFT', '{"collectionSymbol":"TICKETS","to":"some-account","editions":{"baseTokenId":"GA","count":100}}')
            },
            {
                title: 'List an NFT for sale',
                description: 'Broadcast a custom_json operation with id `hivestream` (token owner only):',
                payload: wrap('nft', 'listNFT', '{"collectionSymbol":"TICKETS","tokenId":"GA-1","price":"5.000","currency":"HIVE"}')
            },
            {
                title: 'Buy an NFT non-custodially',
                description: 'Send the exact price directly to the seller with this transfer memo (funds never touch the app account):',
                payload: wrap('nft', 'buyNFTDirect', '{"collectionSymbol":"TICKETS","tokenId":"GA-1"}')
            },
            {
                title: 'Create a ticketed event',
                description: 'Broadcast a custom_json operation with id `hivestream`:',
                payload: wrap('ticketing', 'createEvent', '{"eventId":"launch-party","title":"Launch Party","venue":"Online","startsAt":"2026-12-01T18:00:00Z","ticketPrice":"2.000","asset":"HBD","capacity":500}')
            },
            {
                title: 'Buy a ticket',
                description: 'Send the ticket price to your app account with this transfer memo:',
                payload: wrap('ticketing', 'purchaseTicket', '{"eventId":"launch-party","ticketId":"launch-party:1"}')
            },
            {
                title: 'Transfer a ticket',
                description: 'Broadcast a custom_json operation with id `hivestream` (ticket owner only):',
                payload: wrap('ticketing', 'transferTicket', '{"ticketId":"launch-party:1","to":"friend-account"}')
            },
            {
                title: 'List a ticket for resale',
                description: 'Broadcast a custom_json operation with id `hivestream` (ticket owner only):',
                payload: wrap('ticketing', 'listTicket', '{"ticketId":"launch-party:1","price":"3.000"}')
            },
            {
                title: 'Buy a resale ticket non-custodially',
                description: 'Send the resale price directly to the seller with this transfer memo (funds never touch the app account):',
                payload: wrap('ticketing', 'buyTicketDirect', '{"ticketId":"launch-party:1"}')
            }
        ]
    }
];

export const ADAPTERS: AdapterDefinition[] = [
    {
        id: 'sqlite',
        label: 'SQLite',
        description: 'Zero-config local database. Great for development and single-node apps.',
        importName: 'SqliteAdapter',
        construct: `new SqliteAdapter()`,
        envLines: []
    },
    {
        id: 'mongodb',
        label: 'MongoDB',
        description: 'Document database for apps that need external or shared persistence.',
        importName: 'MongodbAdapter',
        construct: `new MongodbAdapter(process.env.MONGODB_URI ?? 'mongodb://localhost:27017', process.env.MONGODB_DATABASE ?? 'APP_NAME_PLACEHOLDER')`,
        envLines: [
            '# MongoDB connection',
            'MONGODB_URI=mongodb://localhost:27017',
            'MONGODB_DATABASE=APP_NAME_PLACEHOLDER'
        ]
    },
    {
        id: 'postgresql',
        label: 'PostgreSQL',
        description: 'SQL database with support for SQL-backed contract state.',
        importName: 'PostgreSQLAdapter',
        construct: `new PostgreSQLAdapter({ connectionString: process.env.DATABASE_URL ?? 'postgres://localhost:5432/APP_NAME_PLACEHOLDER' })`,
        envLines: [
            '# PostgreSQL connection',
            'DATABASE_URL=postgres://localhost:5432/APP_NAME_PLACEHOLDER'
        ]
    }
];

export function getTemplate(id: string): TemplateDefinition | undefined {
    return TEMPLATES.find((template) => template.id === id);
}

export function getAdapter(id: string): AdapterDefinition | undefined {
    return ADAPTERS.find((adapter) => adapter.id === id);
}
