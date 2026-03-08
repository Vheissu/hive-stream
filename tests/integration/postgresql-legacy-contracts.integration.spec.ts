import {
    Streamer,
    SqliteAdapter,
    PostgreSQLAdapter,
    createTokenContract,
    createPollContract,
    createTipJarContract,
    createExchangeContract,
    createNFTContract
} from '../../src';
import { createIsolatedPostgresDatabase, isPostgresTestAvailable } from '../helpers/external-adapters';

const describeIfPostgres = isPostgresTestAvailable() ? describe : describe.skip;

describeIfPostgres('PostgreSQL legacy contract parity', () => {
    const customJsonOp = (sender: string, contract: string, actionName: string, payload: Record<string, any>, active = true) => ([
        'custom_json',
        {
            id: 'hivestream',
            json: JSON.stringify({
                hive_stream: {
                    contract,
                    action: actionName,
                    payload
                }
            }),
            required_auths: active ? [sender] : [],
            required_posting_auths: active ? [] : [sender]
        }
    ] as [string, any]);

    const transferOp = (sender: string, to: string, amount: string, contract: string, actionName: string, payload: Record<string, any>) => ([
        'transfer',
        {
            from: sender,
            to,
            amount,
            memo: JSON.stringify({
                hive_stream: {
                    contract,
                    action: actionName,
                    payload
                }
            })
        }
    ] as [string, any]);

    const buildStreamer = async (adapter: SqliteAdapter | PostgreSQLAdapter) => {
        const streamer = new Streamer({
            JSON_ID: 'hivestream',
            PAYLOAD_IDENTIFIER: 'hive_stream'
        });

        await streamer.registerAdapter(adapter);
        const contracts = {
            token: createTokenContract(),
            polls: createPollContract(),
            tipjar: createTipJarContract(),
            exchange: createExchangeContract(),
            nft: createNFTContract()
        };

        await streamer.registerContract(contracts.token);
        await streamer.registerContract(contracts.polls);
        await streamer.registerContract(contracts.tipjar);
        await streamer.registerContract(contracts.exchange);
        await streamer.registerContract(contracts.nft);

        streamer.transferHiveTokens = jest.fn().mockResolvedValue(true) as any;

        return {
            streamer,
            contracts
        };
    };

    const createTimeContext = (streamer: Streamer, adapter: SqliteAdapter | PostgreSQLAdapter) => ({
        trigger: 'time' as const,
        streamer,
        adapter,
        config: streamer['config'],
        block: {
            number: 999,
            id: 'block-time',
            previousId: 'block-prev',
            time: new Date('2026-03-08T01:00:00.000Z')
        },
        transaction: {
            id: 'trx-time'
        },
        sender: 'system'
    });

    const collectSummary = async (adapter: SqliteAdapter | PostgreSQLAdapter) => {
        const normalizeRows = (rows: any[] | null, mapper: (row: any) => any) => (rows || []).map(mapper);

        return {
            tokens: normalizeRows(
                await adapter.query('SELECT symbol, current_supply, creator FROM tokens ORDER BY symbol ASC'),
                (row) => ({
                    symbol: row.symbol,
                    current_supply: String(row.current_supply),
                    creator: row.creator
                })
            ),
            tokenBalances: normalizeRows(
                await adapter.query('SELECT account, symbol, balance FROM token_balances ORDER BY account ASC, symbol ASC'),
                (row) => ({
                    account: row.account,
                    symbol: row.symbol,
                    balance: String(row.balance)
                })
            ),
            tokenTransfers: normalizeRows(
                await adapter.query('SELECT from_account, to_account, amount, symbol FROM token_transfers ORDER BY id ASC'),
                (row) => ({
                    from_account: row.from_account,
                    to_account: row.to_account,
                    amount: String(row.amount),
                    symbol: row.symbol
                })
            ),
            polls: normalizeRows(
                await adapter.query('SELECT poll_id, creator FROM polls ORDER BY poll_id ASC'),
                (row) => ({
                    poll_id: row.poll_id,
                    creator: row.creator
                })
            ),
            pollVotes: normalizeRows(
                await adapter.query('SELECT poll_id, voter, option_index FROM poll_votes ORDER BY id ASC'),
                (row) => ({
                    poll_id: row.poll_id,
                    voter: row.voter,
                    option_index: Number(row.option_index)
                })
            ),
            tips: normalizeRows(
                await adapter.query('SELECT from_account, amount, asset, message FROM tipjar_tips ORDER BY id ASC'),
                (row) => ({
                    from_account: row.from_account,
                    amount: String(row.amount),
                    asset: row.asset,
                    message: row.message
                })
            ),
            exchangePairs: normalizeRows(
                await adapter.query('SELECT base_asset, quote_asset, active FROM exchange_pairs ORDER BY base_asset ASC, quote_asset ASC'),
                (row) => ({
                    base_asset: row.base_asset,
                    quote_asset: row.quote_asset,
                    active: Number(row.active)
                })
            ),
            exchangeBalances: normalizeRows(
                await adapter.query('SELECT account, asset, available, locked FROM exchange_balances ORDER BY account ASC, asset ASC'),
                (row) => ({
                    account: row.account,
                    asset: row.asset,
                    available: String(row.available),
                    locked: String(row.locked)
                })
            ),
            exchangeDeposits: normalizeRows(
                await adapter.query('SELECT account, asset, amount FROM exchange_deposits ORDER BY id ASC'),
                (row) => ({
                    account: row.account,
                    asset: row.asset,
                    amount: String(row.amount)
                })
            ),
            exchangeOrders: normalizeRows(
                await adapter.query('SELECT account, side, base_asset, quote_asset, status, remaining FROM exchange_orders ORDER BY side ASC, account ASC'),
                (row) => ({
                    account: row.account,
                    side: row.side,
                    base_asset: row.base_asset,
                    quote_asset: row.quote_asset,
                    status: row.status,
                    remaining: String(row.remaining)
                })
            ),
            exchangeTrades: normalizeRows(
                await adapter.query('SELECT buyer, seller, price, amount, base_asset, quote_asset FROM exchange_trades ORDER BY id ASC'),
                (row) => ({
                    buyer: row.buyer,
                    seller: row.seller,
                    price: String(row.price),
                    amount: String(row.amount),
                    base_asset: row.base_asset,
                    quote_asset: row.quote_asset
                })
            ),
            exchangeWithdrawals: normalizeRows(
                await adapter.query('SELECT account, asset, amount, status FROM exchange_withdrawals ORDER BY id ASC'),
                (row) => ({
                    account: row.account,
                    asset: row.asset,
                    amount: String(row.amount),
                    status: row.status
                })
            ),
            nftCollections: normalizeRows(
                await adapter.query('SELECT symbol, creator, current_supply FROM nft_collections ORDER BY symbol ASC'),
                (row) => ({
                    symbol: row.symbol,
                    creator: row.creator,
                    current_supply: Number(row.current_supply)
                })
            ),
            nftTokens: normalizeRows(
                await adapter.query('SELECT token_id, collection_symbol, owner FROM nft_tokens ORDER BY collection_symbol ASC, token_id ASC'),
                (row) => ({
                    token_id: row.token_id,
                    collection_symbol: row.collection_symbol,
                    owner: row.owner
                })
            ),
            transferCount: (await adapter.getTransfers())?.length || 0,
            customJsonCount: (await adapter.getJson())?.length || 0,
            eventCount: (await adapter.getEvents())?.length || 0
        };
    };

    const runScenario = async (adapter: SqliteAdapter | PostgreSQLAdapter) => {
        const { streamer, contracts } = await buildStreamer(adapter);
        let blockNumber = 1;

        const runOperation = async (op: [string, any]) => {
            await streamer.processOperation(
                op,
                blockNumber,
                `block-${blockNumber}`,
                `block-${blockNumber - 1}`,
                `trx-${blockNumber}`,
                new Date('2026-03-08T00:00:00.000Z')
            );
            blockNumber += 1;
        };

        try {
            await runOperation(customJsonOp('alice', 'hivetoken', 'createToken', {
                symbol: 'LEG',
                name: 'Legacy Token',
                precision: 3,
                maxSupply: '1000'
            }));
            await runOperation(customJsonOp('alice', 'hivetoken', 'issueTokens', {
                symbol: 'LEG',
                to: 'bob',
                amount: '100',
                memo: 'seed'
            }));
            await runOperation(customJsonOp('bob', 'hivetoken', 'transferTokens', {
                symbol: 'LEG',
                to: 'carol',
                amount: '40',
                memo: 'payment'
            }));

            await runOperation(customJsonOp('alice', 'polls', 'createPoll', {
                pollId: 'roadmap',
                question: 'What next?',
                options: ['Bots', 'Games']
            }));
            await runOperation(customJsonOp('bob', 'polls', 'vote', {
                pollId: 'roadmap',
                option: 1
            }));

            await runOperation(transferOp('fan', 'tip.jar', '2.500 HBD', 'tipjar', 'tip', {
                message: 'ship it'
            }));

            await runOperation(customJsonOp('alice', 'exchange', 'createPair', {
                base: 'LEG',
                quote: 'HBD'
            }));
            await runOperation(transferOp('bob', 'beggars', '50.000 HBD', 'exchange', 'deposit', {}));
            await runOperation(transferOp('carol', 'beggars', '20.000 LEG', 'exchange', 'deposit', {}));
            await runOperation(customJsonOp('bob', 'exchange', 'placeOrder', {
                side: 'buy',
                base: 'LEG',
                quote: 'HBD',
                price: '2.000',
                amount: '5.000'
            }));
            await runOperation(customJsonOp('carol', 'exchange', 'placeOrder', {
                side: 'sell',
                base: 'LEG',
                quote: 'HBD',
                price: '2.000',
                amount: '5.000'
            }));
            await contracts.exchange.actions.matchOrders.handler({
                base: 'LEG',
                quote: 'HBD',
                limit: 5,
                snapshot: true,
                depth: 10
            }, createTimeContext(streamer, adapter));
            await runOperation(customJsonOp('bob', 'exchange', 'withdraw', {
                asset: 'HBD',
                amount: '5.000'
            }));

            await runOperation(customJsonOp('alice', 'hivenft', 'createCollection', {
                symbol: 'ART',
                name: 'Legacy Art',
                description: 'Test collection'
            }));
            await runOperation(customJsonOp('alice', 'hivenft', 'mintNFT', {
                collectionSymbol: 'ART',
                tokenId: 'art-1',
                to: 'bob',
                metadata: '{"rarity":"common"}'
            }));

            const summary = await collectSummary(adapter);

            await streamer.stop();

            return summary;
        } catch (error) {
            await streamer.stop();
            throw error;
        }
    };

    test('matches SQLite behavior for legacy SQL-backed contract workflows', async () => {
        const sqliteAdapter = new SqliteAdapter(':memory:');
        const postgresDb = await createIsolatedPostgresDatabase('hive_stream_legacy');
        const postgresAdapter = new PostgreSQLAdapter(postgresDb.adapterConfig);

        try {
            const sqliteSummary = await runScenario(sqliteAdapter);
            const postgresSummary = await runScenario(postgresAdapter);

            expect(postgresSummary).toEqual(sqliteSummary);

            const reopenedAdapter = new PostgreSQLAdapter(postgresDb.adapterConfig);
            await reopenedAdapter.create();

            expect(await collectSummary(reopenedAdapter)).toEqual(postgresSummary);

            await reopenedAdapter.destroy();
        } finally {
            await postgresDb.cleanup();
        }
    });
});
