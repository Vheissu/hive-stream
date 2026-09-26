import {
    Streamer,
    SqliteAdapter,
    createCheckpointContract,
    createNFTContract,
    createTicketingContract
} from '../../src';
import type { ContractContext } from '../../src/types/hive-stream';

describe('Non-custodial asset features', () => {
    let streamer: Streamer;
    let adapter: SqliteAdapter;
    let transferSpy: jest.SpyInstance;

    const createContext = (
        trigger: 'custom_json' | 'transfer' | 'time',
        sender: string,
        overrides: Record<string, any> = {}
    ): ContractContext => ({
        trigger,
        streamer,
        adapter,
        config: streamer['config'],
        block: { number: 300, id: 'block-300', previousId: 'block-299', time: new Date() },
        transaction: { id: `trx-${trigger}-${sender}-${Math.random()}` },
        sender,
        customJson: trigger === 'custom_json' ? { id: 'hivestream', json: {}, isSignedWithActiveKey: true } : undefined,
        transfer: trigger === 'transfer'
            ? { from: sender, to: 'contract', rawAmount: '0.000 HIVE', amount: '0.000', asset: 'HIVE', memo: '' }
            : undefined,
        ...overrides
    });

    const paymentContext = (sender: string, to: string, amount: string, asset: string): ContractContext => {
        const context = createContext('transfer', sender);
        context.transfer = {
            from: sender,
            to,
            rawAmount: `${amount} ${asset}`,
            amount,
            asset,
            memo: ''
        };
        return context;
    };

    beforeEach(async () => {
        streamer = new Streamer({
            JSON_ID: 'hivestream',
            PAYLOAD_IDENTIFIER: 'hive_stream'
        });
        adapter = new SqliteAdapter(':memory:');
        await streamer.registerAdapter(adapter);

        transferSpy = jest.spyOn(streamer, 'transferHiveTokens').mockResolvedValue(true as any);
    });

    afterEach(async () => {
        await streamer.stop();
    });

    describe('NFT batch minting', () => {
        const setupCollection = async (maxSupply?: number) => {
            const contract = createNFTContract({ account: 'nftmarket', name: 'nft' });
            await streamer.registerContract(contract);

            await contract.actions.createCollection.handler({
                symbol: 'TICKETS',
                name: 'Event Tickets',
                maxSupply
            }, createContext('custom_json', 'alice'));

            return contract;
        };

        test('mints numbered editions in a single operation', async () => {
            const contract = await setupCollection(1000);

            await contract.actions.mintBatchNFT.handler({
                collectionSymbol: 'TICKETS',
                to: 'bob',
                editions: { baseTokenId: 'GA', count: 5 }
            }, createContext('custom_json', 'alice'));

            const tokens = await adapter.query(
                'SELECT token_id, owner FROM nft_tokens WHERE collection_symbol = ? ORDER BY token_id ASC',
                ['TICKETS']
            );
            const collection = await adapter.query('SELECT current_supply FROM nft_collections WHERE symbol = ?', ['TICKETS']);

            expect(tokens.map((row: any) => row.token_id)).toEqual(['GA-1', 'GA-2', 'GA-3', 'GA-4', 'GA-5']);
            expect(tokens.every((row: any) => row.owner === 'bob')).toBe(true);
            expect(collection[0].current_supply).toBe(5);
        });

        test('mints an explicit token list with per-token metadata', async () => {
            const contract = await setupCollection();

            await contract.actions.mintBatchNFT.handler({
                collectionSymbol: 'TICKETS',
                to: 'carol',
                tokens: [
                    { tokenId: 'VIP-1', metadata: '{"tier":"vip"}' },
                    { tokenId: 'VIP-2' }
                ],
                metadata: '{"tier":"standard"}'
            }, createContext('custom_json', 'alice'));

            const tokens = await adapter.query(
                'SELECT token_id, metadata FROM nft_tokens WHERE collection_symbol = ? ORDER BY token_id ASC',
                ['TICKETS']
            );

            expect(tokens[0].metadata).toBe('{"tier":"vip"}');
            expect(tokens[1].metadata).toBe('{"tier":"standard"}');
        });

        test('rejects a batch that would exceed maximum supply', async () => {
            const contract = await setupCollection(3);

            await expect(contract.actions.mintBatchNFT.handler({
                collectionSymbol: 'TICKETS',
                to: 'bob',
                editions: { baseTokenId: 'GA', count: 4 }
            }, createContext('custom_json', 'alice'))).rejects.toThrow('maximum supply');
        });

        test('rejects duplicate token IDs and non-creator minting', async () => {
            const contract = await setupCollection();

            await expect(contract.actions.mintBatchNFT.handler({
                collectionSymbol: 'TICKETS',
                to: 'bob',
                tokens: [{ tokenId: 'GA-1' }, { tokenId: 'GA-1' }]
            }, createContext('custom_json', 'alice'))).rejects.toThrow('Duplicate token ID');

            await expect(contract.actions.mintBatchNFT.handler({
                collectionSymbol: 'TICKETS',
                to: 'bob',
                tokens: [{ tokenId: 'GA-1' }]
            }, createContext('custom_json', 'mallory'))).rejects.toThrow('Only the collection creator');
        });
    });

    describe('NFT non-custodial direct sales', () => {
        const setupListing = async () => {
            const contract = createNFTContract({ account: 'nftmarket', name: 'nft' });
            await streamer.registerContract(contract);

            await contract.actions.createCollection.handler({
                symbol: 'ART',
                name: 'Art Collection',
                royalty: 0.1
            }, createContext('custom_json', 'alice'));

            await contract.actions.mintNFT.handler({
                collectionSymbol: 'ART',
                tokenId: 'piece-1',
                to: 'seller'
            }, createContext('custom_json', 'alice'));

            await contract.actions.listNFT.handler({
                collectionSymbol: 'ART',
                tokenId: 'piece-1',
                price: '10.000',
                currency: 'HIVE'
            }, createContext('custom_json', 'seller'));

            return contract;
        };

        test('flips ownership when the buyer pays the seller directly', async () => {
            const contract = await setupListing();

            await contract.actions.buyNFTDirect.handler({
                collectionSymbol: 'ART',
                tokenId: 'piece-1'
            }, paymentContext('buyer', 'seller', '10.000', 'HIVE'));

            const token = await adapter.query(
                'SELECT owner FROM nft_tokens WHERE token_id = ? AND collection_symbol = ?',
                ['piece-1', 'ART']
            );
            const listings = await adapter.query(
                'SELECT active FROM nft_listings WHERE token_id = ? AND collection_symbol = ?',
                ['piece-1', 'ART']
            );

            expect(token[0].owner).toBe('buyer');
            expect(Boolean(listings[0].active)).toBe(false);
            // Non-custodial: the app account must never move funds
            expect(transferSpy).not.toHaveBeenCalled();
        });

        test('records advisory royalty details on direct sales', async () => {
            const contract = await setupListing();

            await contract.actions.buyNFTDirect.handler({
                collectionSymbol: 'ART',
                tokenId: 'piece-1'
            }, paymentContext('buyer', 'seller', '10.000', 'HIVE'));

            const events = await adapter.query(
                `SELECT data FROM events WHERE contract = 'hivenft' AND action = 'buyNFTDirect'`
            );
            const data = JSON.parse(events[0].data).data;

            expect(data.royaltyDue).toBe('1.000');
            expect(data.royaltyRecipient).toBe('alice');
        });

        test('rejects payment sent to anyone but the seller', async () => {
            const contract = await setupListing();

            await expect(contract.actions.buyNFTDirect.handler({
                collectionSymbol: 'ART',
                tokenId: 'piece-1'
            }, paymentContext('buyer', 'contract', '10.000', 'HIVE'))).rejects.toThrow('directly to the seller');
        });

        test('rejects wrong amounts and currencies', async () => {
            const contract = await setupListing();

            await expect(contract.actions.buyNFTDirect.handler({
                collectionSymbol: 'ART',
                tokenId: 'piece-1'
            }, paymentContext('buyer', 'seller', '9.000', 'HIVE'))).rejects.toThrow('Incorrect payment amount');

            await expect(contract.actions.buyNFTDirect.handler({
                collectionSymbol: 'ART',
                tokenId: 'piece-1'
            }, paymentContext('buyer', 'seller', '10.000', 'HBD'))).rejects.toThrow('Incorrect currency');
        });
    });

    describe('Ticket transfers and peer-to-peer resale', () => {
        const setupTicket = async () => {
            const contract = createTicketingContract();
            await streamer.registerContract(contract);

            await contract.actions.createEvent.handler({
                eventId: 'launch-party',
                title: 'Launch Party',
                venue: 'Online',
                startsAt: new Date(Date.now() + 24 * 3600_000).toISOString(),
                ticketPrice: '2.000',
                asset: 'HBD',
                capacity: 100
            }, createContext('custom_json', 'organiser'));

            await contract.actions.purchaseTicket.handler({
                eventId: 'launch-party',
                ticketId: 'ticket-1'
            }, paymentContext('bob', 'organiser', '2.000', 'HBD'));

            return contract;
        };

        test('owners can transfer tickets to other accounts', async () => {
            const contract = await setupTicket();

            await contract.actions.transferTicket.handler({
                ticketId: 'ticket-1',
                to: 'carol'
            }, createContext('custom_json', 'bob'));

            const tickets = await adapter.query('SELECT owner FROM tickets WHERE ticket_id = ?', ['ticket-1']);
            expect(tickets[0].owner).toBe('carol');
        });

        test('rejects transfers by non-owners and to yourself', async () => {
            const contract = await setupTicket();

            await expect(contract.actions.transferTicket.handler({
                ticketId: 'ticket-1',
                to: 'carol'
            }, createContext('custom_json', 'mallory'))).rejects.toThrow('Only the ticket owner');

            await expect(contract.actions.transferTicket.handler({
                ticketId: 'ticket-1',
                to: 'bob'
            }, createContext('custom_json', 'bob'))).rejects.toThrow('to yourself');
        });

        test('supports listing, unlisting, and direct peer-to-peer purchase', async () => {
            const contract = await setupTicket();

            await contract.actions.listTicket.handler({
                ticketId: 'ticket-1',
                price: '3.000'
            }, createContext('custom_json', 'bob'));

            await contract.actions.unlistTicket.handler({
                ticketId: 'ticket-1'
            }, createContext('custom_json', 'bob'));

            await expect(contract.actions.buyTicketDirect.handler({
                ticketId: 'ticket-1'
            }, paymentContext('carol', 'bob', '3.000', 'HBD'))).rejects.toThrow('No active listing');

            await contract.actions.listTicket.handler({
                ticketId: 'ticket-1',
                price: '3.000'
            }, createContext('custom_json', 'bob'));

            await contract.actions.buyTicketDirect.handler({
                ticketId: 'ticket-1'
            }, paymentContext('carol', 'bob', '3.000', 'HBD'));

            const tickets = await adapter.query('SELECT owner FROM tickets WHERE ticket_id = ?', ['ticket-1']);
            const listings = await adapter.query('SELECT active FROM ticket_listings WHERE ticket_id = ?', ['ticket-1']);

            expect(tickets[0].owner).toBe('carol');
            expect(listings[0].active).toBe(0);
            expect(transferSpy).not.toHaveBeenCalled();
        });

        test('rejects resale payments that do not go to the seller', async () => {
            const contract = await setupTicket();

            await contract.actions.listTicket.handler({
                ticketId: 'ticket-1',
                price: '3.000'
            }, createContext('custom_json', 'bob'));

            await expect(contract.actions.buyTicketDirect.handler({
                ticketId: 'ticket-1'
            }, paymentContext('carol', 'organiser', '3.000', 'HBD'))).rejects.toThrow('directly to the seller');

            await expect(contract.actions.buyTicketDirect.handler({
                ticketId: 'ticket-1'
            }, paymentContext('carol', 'bob', '1.000', 'HBD'))).rejects.toThrow('resale price');
        });

        test('transferring a listed ticket deactivates the listing', async () => {
            const contract = await setupTicket();

            await contract.actions.listTicket.handler({
                ticketId: 'ticket-1',
                price: '3.000'
            }, createContext('custom_json', 'bob'));

            await contract.actions.transferTicket.handler({
                ticketId: 'ticket-1',
                to: 'carol'
            }, createContext('custom_json', 'bob'));

            const listings = await adapter.query('SELECT active FROM ticket_listings WHERE ticket_id = ?', ['ticket-1']);
            expect(listings[0].active).toBe(0);
        });
    });

    describe('On-chain state checkpoints', () => {
        const setupCheckpoint = async () => {
            const nftContract = createNFTContract({ account: 'nftmarket', name: 'nft' });
            await streamer.registerContract(nftContract);

            const contract = createCheckpointContract({
                account: 'checkpointer',
                tables: ['nft_collections', 'nft_tokens']
            });
            await streamer.registerContract(contract);

            const broadcastSpy = jest.spyOn(streamer, 'broadcastOperations').mockResolvedValue(true as any);

            await nftContract.actions.createCollection.handler({
                symbol: 'ART',
                name: 'Art Collection'
            }, createContext('custom_json', 'alice'));

            return { contract, nftContract, broadcastSpy };
        };

        test('publishes a state hash as a wrapped custom_json operation', async () => {
            const { contract, broadcastSpy } = await setupCheckpoint();

            await contract.actions.publishCheckpoint.handler({}, createContext('time', 'system'));

            expect(broadcastSpy).toHaveBeenCalledTimes(1);
            const [operations] = broadcastSpy.mock.calls[0];
            const [opType, opData] = operations[0];

            expect(opType).toBe('custom_json');
            expect(opData.id).toBe('hivestream');
            expect(opData.required_posting_auths).toEqual(['checkpointer']);

            const wrapped = JSON.parse(opData.json).hive_stream;
            expect(wrapped.contract).toBe('checkpoint');
            expect(wrapped.action).toBe('recordCheckpoint');
            expect(wrapped.payload.stateHash).toMatch(/^[a-f0-9]{64}$/);
            expect(wrapped.payload.tables).toEqual(['nft_collections', 'nft_tokens']);

            const local = await adapter.query(`SELECT * FROM state_checkpoints WHERE source = 'local'`);
            expect(local).toHaveLength(1);
            expect(local[0].state_hash).toBe(wrapped.payload.stateHash);
        });

        test('confirms matching checkpoints from other operators', async () => {
            const { contract, broadcastSpy } = await setupCheckpoint();

            await contract.actions.publishCheckpoint.handler({}, createContext('time', 'system'));
            const wrapped = JSON.parse(broadcastSpy.mock.calls[0][0][0][1].json).hive_stream;

            await contract.actions.recordCheckpoint.handler(
                wrapped.payload,
                createContext('custom_json', 'other-node')
            );

            const remote = await adapter.query(`SELECT matched FROM state_checkpoints WHERE source = 'remote'`);
            expect(remote[0].matched).toBe(1);
        });

        test('flags diverging checkpoints', async () => {
            const { contract } = await setupCheckpoint();

            await contract.actions.recordCheckpoint.handler({
                checkpointId: 'rogue-node:299',
                blockNumber: 299,
                stateHash: 'a'.repeat(64),
                tables: ['nft_collections', 'nft_tokens']
            }, createContext('custom_json', 'rogue-node'));

            const remote = await adapter.query(`SELECT matched FROM state_checkpoints WHERE source = 'remote'`);
            expect(remote[0].matched).toBe(0);
        });

        test('only the checkpoint account can trigger publishing on demand', async () => {
            const { contract } = await setupCheckpoint();

            await expect(contract.actions.publishCheckpoint.handler(
                {},
                createContext('custom_json', 'mallory')
            )).rejects.toThrow('Only the checkpoint account');
        });

        test('requires at least one valid table name', () => {
            expect(() => createCheckpointContract({ account: 'a', tables: [] })).toThrow('at least one table');
            expect(() => createCheckpointContract({ account: 'a', tables: ['bad;table'] })).toThrow('Invalid table name');
        });
    });
});
