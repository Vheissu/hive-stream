import { NFTContract } from '../../src/contracts/nft.contract';
import { MockAdapter } from '../helpers/mock-adapter';

describe('NFTContract', () => {
    let nftContract: NFTContract;
    let mockAdapter: MockAdapter;
    let mockStreamer: any;

    beforeEach(() => {
        mockAdapter = new MockAdapter();
        mockStreamer = {
            getAdapter: () => mockAdapter
        };

        nftContract = new NFTContract();
        nftContract._instance = mockStreamer;
        nftContract.updateBlockInfo(12345, 'block123', 'prevblock123', 'txn123');
    });

    describe('Contract Lifecycle', () => {
        it('should initialize NFT tables on create', async () => {
            mockAdapter.reset();
            await nftContract.create();

            // Wait for async table creation to complete
            await new Promise(resolve => setTimeout(resolve, 10));

            const createTableQueries = mockAdapter.queries.filter(q => q.includes('CREATE TABLE'));
            expect(createTableQueries.length).toBeGreaterThanOrEqual(4);
            expect(createTableQueries.some(q => q.includes('nft_collections'))).toBe(true);
            expect(createTableQueries.some(q => q.includes('nft_tokens'))).toBe(true);
            expect(createTableQueries.some(q => q.includes('nft_listings'))).toBe(true);
            expect(createTableQueries.some(q => q.includes('nft_transfers'))).toBe(true);
        });

        it('should handle destroy method', () => {
            expect(() => nftContract.destroy()).not.toThrow();
        });

        it('should update block information', () => {
            nftContract.updateBlockInfo(54321, 'newblock', 'prevnewblock', 'newtxn');
            expect((nftContract as any).blockNumber).toBe(54321);
            expect((nftContract as any).blockId).toBe('newblock');
        });
    });

    describe('createCollection', () => {
        beforeEach(() => {
            mockAdapter.reset();
            nftContract.create();
        });

        it('should create a new collection successfully', async () => {
            mockAdapter.setQueryResult([]); // No existing collection with same symbol

            const payload = {
                symbol: 'TESTNFT',
                name: 'Test NFT Collection',
                description: 'A test NFT collection',
                maxSupply: 1000,
                royalty: 0.05,
                allowUpdates: true,
                updateableByOwner: false
            };

            await (nftContract as any).createCollection(payload, { sender: 'alice' });

            const insertQuery = mockAdapter.queries.find(q => q.includes('INSERT INTO nft_collections'));
            expect(insertQuery).toBeDefined();
            expect(mockAdapter.events.length).toBe(1);
            expect(mockAdapter.events[0].action).toBe('createCollection');
            expect(mockAdapter.events[0].data.action).toBe('collection_created');
        });

        it('should reject invalid collection symbol', async () => {
            const payload = {
                symbol: 'invalid-symbol-too-long',
                name: 'Test Collection',
                maxSupply: 1000
            };

            await expect((nftContract as any).createCollection(payload, { sender: 'alice' }))
                .rejects.toThrow('Symbol must be 1-20 uppercase alphanumeric characters');
        });

        it('should reject empty collection name', async () => {
            const payload = {
                symbol: 'TESTNFT',
                name: '',
                maxSupply: 1000
            };

            await expect((nftContract as any).createCollection(payload, { sender: 'alice' }))
                .rejects.toThrow('Name is required and must be 100 characters or less');
        });

        it('should reject excessive royalty', async () => {
            const payload = {
                symbol: 'TESTNFT',
                name: 'Test Collection',
                royalty: 0.3
            };

            await expect((nftContract as any).createCollection(payload, { sender: 'alice' }))
                .rejects.toThrow('Royalty must be between 0 and 25%');
        });

        it('should reject duplicate collection symbol', async () => {
            mockAdapter.setQueryResult([{ symbol: 'TESTNFT' }]); // Existing collection

            const payload = {
                symbol: 'TESTNFT',
                name: 'Test Collection',
                maxSupply: 1000
            };

            await expect((nftContract as any).createCollection(payload, { sender: 'alice' }))
                .rejects.toThrow('Collection with symbol TESTNFT already exists');
        });
    });

    describe('mintNFT', () => {
        beforeEach(() => {
            mockAdapter.reset();
            nftContract.create();
        });

        it('should mint NFT successfully', async () => {
            // Mock collection exists and creator matches sender
            mockAdapter.setQueryResults([
                [{ symbol: 'TESTNFT', creator: 'alice', max_supply: 1000, current_supply: 0 }],
                [] // No existing token with same ID
            ]);

            const payload = {
                collectionSymbol: 'TESTNFT',
                tokenId: 'token001',
                to: 'bob',
                metadata: '{"name": "Test NFT", "image": "https://example.com/nft.jpg"}',
                attributes: '{"rarity": "common", "power": 10}'
            };

            await (nftContract as any).mintNFT(payload, { sender: 'alice' });

            const insertTokenQuery = mockAdapter.queries.find(q => q.includes('INSERT INTO nft_tokens'));
            const updateSupplyQuery = mockAdapter.queries.find(q => q.includes('UPDATE nft_collections SET current_supply'));
            const insertTransferQuery = mockAdapter.queries.find(q => q.includes('INSERT INTO nft_transfers'));

            expect(insertTokenQuery).toBeDefined();
            expect(updateSupplyQuery).toBeDefined();
            expect(insertTransferQuery).toBeDefined();
            expect(mockAdapter.events.length).toBe(1);
            expect(mockAdapter.events[0].action).toBe('mintNFT');
            expect(mockAdapter.events[0].data.action).toBe('nft_minted');
        });

        it('should reject minting for non-existent collection', async () => {
            mockAdapter.setQueryResult([]); // No collection found

            const payload = {
                collectionSymbol: 'NONEXISTENT',
                tokenId: 'token001',
                to: 'bob'
            };

            await expect((nftContract as any).mintNFT(payload, { sender: 'alice' }))
                .rejects.toThrow('Collection NONEXISTENT does not exist');
        });

        it('should reject minting by non-creator', async () => {
            mockAdapter.setQueryResult([{ symbol: 'TESTNFT', creator: 'alice', max_supply: 1000, current_supply: 0 }]);

            const payload = {
                collectionSymbol: 'TESTNFT',
                tokenId: 'token001',
                to: 'bob'
            };

            await expect((nftContract as any).mintNFT(payload, { sender: 'charlie' }))
                .rejects.toThrow('Only the collection creator can mint NFTs');
        });

        it('should reject minting when max supply reached', async () => {
            mockAdapter.setQueryResult([{ symbol: 'TESTNFT', creator: 'alice', max_supply: 1000, current_supply: 1000 }]);

            const payload = {
                collectionSymbol: 'TESTNFT',
                tokenId: 'token001',
                to: 'bob'
            };

            await expect((nftContract as any).mintNFT(payload, { sender: 'alice' }))
                .rejects.toThrow('Collection has reached maximum supply');
        });

        it('should reject duplicate token ID', async () => {
            mockAdapter.setQueryResults([
                [{ symbol: 'TESTNFT', creator: 'alice', max_supply: 1000, current_supply: 0 }],
                [{ token_id: 'token001' }] // Existing token
            ]);

            const payload = {
                collectionSymbol: 'TESTNFT',
                tokenId: 'token001',
                to: 'bob'
            };

            await expect((nftContract as any).mintNFT(payload, { sender: 'alice' }))
                .rejects.toThrow('Token token001 already exists in collection TESTNFT');
        });
    });

    describe('transferNFT', () => {
        beforeEach(() => {
            mockAdapter.reset();
            nftContract.create();
        });

        it('should transfer NFT successfully', async () => {
            mockAdapter.setQueryResults([
                [{ token_id: 'token001', collection_symbol: 'TESTNFT', owner: 'alice', burned: false }],
                [] // No active listings
            ]);

            const payload = {
                collectionSymbol: 'TESTNFT',
                tokenId: 'token001',
                to: 'bob'
            };

            await (nftContract as any).transferNFT(payload, { sender: 'alice' });

            const updateOwnerQuery = mockAdapter.queries.find(q => q.includes('UPDATE nft_tokens SET owner'));
            const insertTransferQuery = mockAdapter.queries.find(q => q.includes('INSERT INTO nft_transfers'));

            expect(updateOwnerQuery).toBeDefined();
            expect(insertTransferQuery).toBeDefined();
            expect(mockAdapter.events.length).toBe(1);
            expect(mockAdapter.events[0].action).toBe('transferNFT');
            expect(mockAdapter.events[0].data.action).toBe('nft_transferred');
        });

        it('should reject transfer of non-existent token', async () => {
            mockAdapter.setQueryResult([]); // No token found

            const payload = {
                collectionSymbol: 'TESTNFT',
                tokenId: 'nonexistent',
                to: 'bob'
            };

            await expect((nftContract as any).transferNFT(payload, { sender: 'alice' }))
                .rejects.toThrow('Token nonexistent does not exist or has been burned');
        });

        it('should reject transfer by non-owner', async () => {
            mockAdapter.setQueryResult([{ token_id: 'token001', collection_symbol: 'TESTNFT', owner: 'alice', burned: false }]);

            const payload = {
                collectionSymbol: 'TESTNFT',
                tokenId: 'token001',
                to: 'bob'
            };

            await expect((nftContract as any).transferNFT(payload, { sender: 'charlie' }))
                .rejects.toThrow('Only the token owner can transfer the NFT');
        });

        it('should reject transfer to same address', async () => {
            mockAdapter.setQueryResult([{ token_id: 'token001', collection_symbol: 'TESTNFT', owner: 'alice', burned: false }]);

            const payload = {
                collectionSymbol: 'TESTNFT',
                tokenId: 'token001',
                to: 'alice'
            };

            await expect((nftContract as any).transferNFT(payload, { sender: 'alice' }))
                .rejects.toThrow('Cannot transfer to the same address');
        });

        it('should cancel active listings when transferring', async () => {
            mockAdapter.setQueryResults([
                [{ token_id: 'token001', collection_symbol: 'TESTNFT', owner: 'alice', burned: false }],
                [{ id: 1 }] // Active listing exists
            ]);

            const payload = {
                collectionSymbol: 'TESTNFT',
                tokenId: 'token001',
                to: 'bob'
            };

            await (nftContract as any).transferNFT(payload, { sender: 'alice' });

            const cancelListingQuery = mockAdapter.queries.find(q => q.includes('UPDATE nft_listings SET active = FALSE'));
            expect(cancelListingQuery).toBeDefined();
        });
    });

    describe('updateNFT', () => {
        beforeEach(() => {
            mockAdapter.reset();
            nftContract.create();
        });

        it('should update NFT metadata successfully by collection creator', async () => {
            mockAdapter.setQueryResults([
                [{ token_id: 'token001', collection_symbol: 'TESTNFT', owner: 'bob', burned: false }],
                [{ symbol: 'TESTNFT', creator: 'alice', allow_updates: true, updateable_by_owner: false }]
            ]);

            const payload = {
                collectionSymbol: 'TESTNFT',
                tokenId: 'token001',
                metadata: '{"name": "Updated NFT", "image": "https://example.com/updated.jpg"}',
                attributes: '{"rarity": "rare", "power": 20}'
            };

            await (nftContract as any).updateNFT(payload, { sender: 'alice' });

            const updateQuery = mockAdapter.queries.find(q => q.includes('UPDATE nft_tokens SET'));
            expect(updateQuery).toBeDefined();
            expect(mockAdapter.events.length).toBe(1);
            expect(mockAdapter.events[0].action).toBe('updateNFT');
            expect(mockAdapter.events[0].data.action).toBe('nft_updated');
        });

        it('should update NFT successfully by token owner when allowed', async () => {
            mockAdapter.setQueryResults([
                [{ token_id: 'token001', collection_symbol: 'TESTNFT', owner: 'bob', burned: false }],
                [{ symbol: 'TESTNFT', creator: 'alice', allow_updates: true, updateable_by_owner: true }]
            ]);

            const payload = {
                collectionSymbol: 'TESTNFT',
                tokenId: 'token001',
                metadata: '{"name": "Owner Updated NFT"}'
            };

            await (nftContract as any).updateNFT(payload, { sender: 'bob' });

            const updateQuery = mockAdapter.queries.find(q => q.includes('UPDATE nft_tokens SET'));
            expect(updateQuery).toBeDefined();
            expect(mockAdapter.events.length).toBe(1);
            expect(mockAdapter.events[0].data.data.updatedBy).toBe('bob');
        });

        it('should update only metadata when attributes not provided', async () => {
            mockAdapter.setQueryResults([
                [{ token_id: 'token001', collection_symbol: 'TESTNFT', owner: 'bob', burned: false }],
                [{ symbol: 'TESTNFT', creator: 'alice', allow_updates: true, updateable_by_owner: false }]
            ]);

            const payload = {
                collectionSymbol: 'TESTNFT',
                tokenId: 'token001',
                metadata: '{"name": "Only Metadata Update"}'
            };

            await (nftContract as any).updateNFT(payload, { sender: 'alice' });

            const updateQuery = mockAdapter.queries.find(q => q.includes('UPDATE nft_tokens SET metadata = ?'));
            expect(updateQuery).toBeDefined();
            expect(mockAdapter.events[0].data.data.attributes).toBe('unchanged');
        });

        it('should update only attributes when metadata not provided', async () => {
            mockAdapter.setQueryResults([
                [{ token_id: 'token001', collection_symbol: 'TESTNFT', owner: 'bob', burned: false }],
                [{ symbol: 'TESTNFT', creator: 'alice', allow_updates: true, updateable_by_owner: false }]
            ]);

            const payload = {
                collectionSymbol: 'TESTNFT',
                tokenId: 'token001',
                attributes: '{"power": 50}'
            };

            await (nftContract as any).updateNFT(payload, { sender: 'alice' });

            const updateQuery = mockAdapter.queries.find(q => q.includes('UPDATE nft_tokens SET attributes = ?'));
            expect(updateQuery).toBeDefined();
            expect(mockAdapter.events[0].data.data.metadata).toBe('unchanged');
        });

        it('should reject updating non-existent token', async () => {
            mockAdapter.setQueryResult([]); // No token found

            const payload = {
                collectionSymbol: 'TESTNFT',
                tokenId: 'nonexistent',
                metadata: '{"name": "Test"}'
            };

            await expect((nftContract as any).updateNFT(payload, { sender: 'alice' }))
                .rejects.toThrow('Token nonexistent does not exist or has been burned');
        });

        it('should reject updating when collection does not exist', async () => {
            mockAdapter.setQueryResults([
                [{ token_id: 'token001', collection_symbol: 'TESTNFT', owner: 'bob', burned: false }],
                [] // No collection found
            ]);

            const payload = {
                collectionSymbol: 'TESTNFT',
                tokenId: 'token001',
                metadata: '{"name": "Test"}'
            };

            await expect((nftContract as any).updateNFT(payload, { sender: 'alice' }))
                .rejects.toThrow('Collection TESTNFT does not exist');
        });

        it('should reject updating when updates are disabled for collection', async () => {
            mockAdapter.setQueryResults([
                [{ token_id: 'token001', collection_symbol: 'TESTNFT', owner: 'bob', burned: false }],
                [{ symbol: 'TESTNFT', creator: 'alice', allow_updates: false, updateable_by_owner: false }]
            ]);

            const payload = {
                collectionSymbol: 'TESTNFT',
                tokenId: 'token001',
                metadata: '{"name": "Test"}'
            };

            await expect((nftContract as any).updateNFT(payload, { sender: 'alice' }))
                .rejects.toThrow('Updates are not allowed for this collection');
        });

        it('should reject updating by token owner when not allowed', async () => {
            mockAdapter.setQueryResults([
                [{ token_id: 'token001', collection_symbol: 'TESTNFT', owner: 'bob', burned: false }],
                [{ symbol: 'TESTNFT', creator: 'alice', allow_updates: true, updateable_by_owner: false }]
            ]);

            const payload = {
                collectionSymbol: 'TESTNFT',
                tokenId: 'token001',
                metadata: '{"name": "Test"}'
            };

            await expect((nftContract as any).updateNFT(payload, { sender: 'bob' }))
                .rejects.toThrow('Only the collection creator or token owner (if allowed) can update the NFT');
        });

        it('should reject updating by unauthorized user', async () => {
            mockAdapter.setQueryResults([
                [{ token_id: 'token001', collection_symbol: 'TESTNFT', owner: 'bob', burned: false }],
                [{ symbol: 'TESTNFT', creator: 'alice', allow_updates: true, updateable_by_owner: true }]
            ]);

            const payload = {
                collectionSymbol: 'TESTNFT',
                tokenId: 'token001',
                metadata: '{"name": "Test"}'
            };

            await expect((nftContract as any).updateNFT(payload, { sender: 'charlie' }))
                .rejects.toThrow('Only the collection creator or token owner (if allowed) can update the NFT');
        });

        it('should reject metadata that is too long', async () => {
            mockAdapter.setQueryResults([
                [{ token_id: 'token001', collection_symbol: 'TESTNFT', owner: 'bob', burned: false }],
                [{ symbol: 'TESTNFT', creator: 'alice', allow_updates: true, updateable_by_owner: false }]
            ]);

            const longMetadata = 'x'.repeat(2001);
            const payload = {
                collectionSymbol: 'TESTNFT',
                tokenId: 'token001',
                metadata: longMetadata
            };

            await expect((nftContract as any).updateNFT(payload, { sender: 'alice' }))
                .rejects.toThrow('Metadata must be 2000 characters or less');
        });

        it('should reject attributes that are too long', async () => {
            mockAdapter.setQueryResults([
                [{ token_id: 'token001', collection_symbol: 'TESTNFT', owner: 'bob', burned: false }],
                [{ symbol: 'TESTNFT', creator: 'alice', allow_updates: true, updateable_by_owner: false }]
            ]);

            const longAttributes = 'x'.repeat(1001);
            const payload = {
                collectionSymbol: 'TESTNFT',
                tokenId: 'token001',
                attributes: longAttributes
            };

            await expect((nftContract as any).updateNFT(payload, { sender: 'alice' }))
                .rejects.toThrow('Attributes must be 1000 characters or less');
        });

        it('should reject update with no fields provided', async () => {
            mockAdapter.setQueryResults([
                [{ token_id: 'token001', collection_symbol: 'TESTNFT', owner: 'bob', burned: false }],
                [{ symbol: 'TESTNFT', creator: 'alice', allow_updates: true, updateable_by_owner: false }]
            ]);

            const payload = {
                collectionSymbol: 'TESTNFT',
                tokenId: 'token001'
            };

            await expect((nftContract as any).updateNFT(payload, { sender: 'alice' }))
                .rejects.toThrow('No update fields provided');
        });
    });

    describe('burnNFT', () => {
        beforeEach(() => {
            mockAdapter.reset();
            nftContract.create();
        });

        it('should burn NFT successfully', async () => {
            mockAdapter.setQueryResult([{ token_id: 'token001', collection_symbol: 'TESTNFT', owner: 'alice', burned: false }]);

            const payload = {
                collectionSymbol: 'TESTNFT',
                tokenId: 'token001'
            };

            await (nftContract as any).burnNFT(payload, { sender: 'alice' });

            const cancelListingsQuery = mockAdapter.queries.find(q => q.includes('UPDATE nft_listings SET active = FALSE'));
            const burnTokenQuery = mockAdapter.queries.find(q => q.includes('UPDATE nft_tokens SET burned = TRUE'));
            const updateSupplyQuery = mockAdapter.queries.find(q => q.includes('UPDATE nft_collections SET current_supply = current_supply - 1'));
            const insertTransferQuery = mockAdapter.queries.find(q => q.includes('INSERT INTO nft_transfers'));

            expect(cancelListingsQuery).toBeDefined();
            expect(burnTokenQuery).toBeDefined();
            expect(updateSupplyQuery).toBeDefined();
            expect(insertTransferQuery).toBeDefined();
            expect(mockAdapter.events.length).toBe(1);
            expect(mockAdapter.events[0].action).toBe('burnNFT');
            expect(mockAdapter.events[0].data.action).toBe('nft_burned');
        });

        it('should reject burning non-existent token', async () => {
            mockAdapter.setQueryResult([]); // No token found

            const payload = {
                collectionSymbol: 'TESTNFT',
                tokenId: 'nonexistent'
            };

            await expect((nftContract as any).burnNFT(payload, { sender: 'alice' }))
                .rejects.toThrow('Token nonexistent does not exist or has already been burned');
        });

        it('should reject burning by non-owner', async () => {
            mockAdapter.setQueryResult([{ token_id: 'token001', collection_symbol: 'TESTNFT', owner: 'alice', burned: false }]);

            const payload = {
                collectionSymbol: 'TESTNFT',
                tokenId: 'token001'
            };

            await expect((nftContract as any).burnNFT(payload, { sender: 'charlie' }))
                .rejects.toThrow('Only the token owner can burn the NFT');
        });
    });

    describe('listNFT', () => {
        beforeEach(() => {
            mockAdapter.reset();
            nftContract.create();
        });

        it('should list NFT successfully', async () => {
            mockAdapter.setQueryResult([{ token_id: 'token001', collection_symbol: 'TESTNFT', owner: 'alice', burned: false }]);

            const payload = {
                collectionSymbol: 'TESTNFT',
                tokenId: 'token001',
                price: '10.000',
                currency: 'HIVE'
            };

            await (nftContract as any).listNFT(payload, { sender: 'alice' });

            const cancelPreviousListingsQuery = mockAdapter.queries.find(q => 
                q.includes('UPDATE nft_listings SET active = FALSE') && 
                q.includes('seller = ?')
            );
            const insertListingQuery = mockAdapter.queries.find(q => q.includes('INSERT INTO nft_listings'));

            expect(cancelPreviousListingsQuery).toBeDefined();
            expect(insertListingQuery).toBeDefined();
            expect(mockAdapter.events.length).toBe(1);
            expect(mockAdapter.events[0].action).toBe('listNFT');
            expect(mockAdapter.events[0].data.action).toBe('nft_listed');
        });

        it('should reject listing non-existent token', async () => {
            mockAdapter.setQueryResult([]); // No token found

            const payload = {
                collectionSymbol: 'TESTNFT',
                tokenId: 'nonexistent',
                price: '10.000'
            };

            await expect((nftContract as any).listNFT(payload, { sender: 'alice' }))
                .rejects.toThrow('Token nonexistent does not exist or has been burned');
        });

        it('should reject listing by non-owner', async () => {
            mockAdapter.setQueryResult([{ token_id: 'token001', collection_symbol: 'TESTNFT', owner: 'alice', burned: false }]);

            const payload = {
                collectionSymbol: 'TESTNFT',
                tokenId: 'token001',
                price: '10.000'
            };

            await expect((nftContract as any).listNFT(payload, { sender: 'charlie' }))
                .rejects.toThrow('Only the token owner can list the NFT');
        });

        it('should reject invalid price', async () => {
            mockAdapter.setQueryResult([{ token_id: 'token001', collection_symbol: 'TESTNFT', owner: 'alice', burned: false }]);

            const payload = {
                collectionSymbol: 'TESTNFT',
                tokenId: 'token001',
                price: '0'
            };

            await expect((nftContract as any).listNFT(payload, { sender: 'alice' }))
                .rejects.toThrow('Price must be a positive number');
        });

        it('should reject invalid currency', async () => {
            mockAdapter.setQueryResult([{ token_id: 'token001', collection_symbol: 'TESTNFT', owner: 'alice', burned: false }]);

            const payload = {
                collectionSymbol: 'TESTNFT',
                tokenId: 'token001',
                price: '10.000',
                currency: 'INVALID'
            };

            await expect((nftContract as any).listNFT(payload, { sender: 'alice' }))
                .rejects.toThrow('Currency must be HIVE or HBD');
        });
    });

    describe('unlistNFT', () => {
        beforeEach(() => {
            mockAdapter.reset();
            nftContract.create();
        });

        it('should unlist NFT successfully', async () => {
            mockAdapter.setQueryResult([{ id: 1, token_id: 'token001', collection_symbol: 'TESTNFT', seller: 'alice', active: true }]);

            const payload = {
                collectionSymbol: 'TESTNFT',
                tokenId: 'token001'
            };

            await (nftContract as any).unlistNFT(payload, { sender: 'alice' });

            const updateListingQuery = mockAdapter.queries.find(q => q.includes('UPDATE nft_listings SET active = FALSE'));
            expect(updateListingQuery).toBeDefined();
            expect(mockAdapter.events.length).toBe(1);
            expect(mockAdapter.events[0].action).toBe('unlistNFT');
            expect(mockAdapter.events[0].data.action).toBe('nft_unlisted');
        });

        it('should reject unlisting non-existent listing', async () => {
            mockAdapter.setQueryResult([]); // No active listing found

            const payload = {
                collectionSymbol: 'TESTNFT',
                tokenId: 'token001'
            };

            await expect((nftContract as any).unlistNFT(payload, { sender: 'alice' }))
                .rejects.toThrow('No active listing found for token token001');
        });
    });

    describe('buyNFT', () => {
        beforeEach(() => {
            mockAdapter.reset();
            nftContract.create();
        });

        it('should buy NFT successfully without royalty', async () => {
            mockAdapter.setQueryResults([
                [{ id: 1, token_id: 'token001', collection_symbol: 'TESTNFT', seller: 'alice', price: '10.000', currency: 'HIVE', active: true }],
                [{ royalty: 0, creator: 'alice' }] // Collection with no royalty
            ]);

            const payload = {
                collectionSymbol: 'TESTNFT',
                tokenId: 'token001'
            };

            await (nftContract as any).buyNFT(payload, { sender: 'bob', amount: '10.000', asset: 'HIVE' });

            const updateOwnerQuery = mockAdapter.queries.find(q => q.includes('UPDATE nft_tokens SET owner'));
            const deactivateListingQuery = mockAdapter.queries.find(q => q.includes('UPDATE nft_listings SET active = FALSE'));
            const insertTransferQuery = mockAdapter.queries.find(q => q.includes('INSERT INTO nft_transfers'));

            expect(updateOwnerQuery).toBeDefined();
            expect(deactivateListingQuery).toBeDefined();
            expect(insertTransferQuery).toBeDefined();
            expect(mockAdapter.events.length).toBe(1);
            expect(mockAdapter.events[0].action).toBe('buyNFT');
            expect(mockAdapter.events[0].data.action).toBe('nft_sold');
        });

        it('should buy NFT successfully with royalty', async () => {
            mockAdapter.setQueryResults([
                [{ id: 1, token_id: 'token001', collection_symbol: 'TESTNFT', seller: 'alice', price: '10.000', currency: 'HIVE', active: true }],
                [{ royalty: 0.05, creator: 'charlie' }] // Collection with 5% royalty to different creator
            ]);

            const payload = {
                collectionSymbol: 'TESTNFT',
                tokenId: 'token001'
            };

            await (nftContract as any).buyNFT(payload, { sender: 'bob', amount: '10.000', asset: 'HIVE' });

            expect(mockAdapter.events[0].data.data.royaltyAmount).toBe('0.500');
            expect(mockAdapter.events[0].data.data.sellerAmount).toBe('9.500');
        });

        it('should reject buying non-existent listing', async () => {
            mockAdapter.setQueryResult([]); // No active listing found

            const payload = {
                collectionSymbol: 'TESTNFT',
                tokenId: 'token001'
            };

            await expect((nftContract as any).buyNFT(payload, { sender: 'bob', amount: '10.000', asset: 'HIVE' }))
                .rejects.toThrow('No active listing found for token token001');
        });

        it('should reject buying own NFT', async () => {
            mockAdapter.setQueryResult([{ id: 1, token_id: 'token001', collection_symbol: 'TESTNFT', seller: 'alice', price: '10.000', currency: 'HIVE', active: true }]);

            const payload = {
                collectionSymbol: 'TESTNFT',
                tokenId: 'token001'
            };

            await expect((nftContract as any).buyNFT(payload, { sender: 'alice', amount: '10.000', asset: 'HIVE' }))
                .rejects.toThrow('Cannot buy your own NFT');
        });

        it('should reject incorrect payment amount', async () => {
            mockAdapter.setQueryResult([{ id: 1, token_id: 'token001', collection_symbol: 'TESTNFT', seller: 'alice', price: '10.000', currency: 'HIVE', active: true }]);

            const payload = {
                collectionSymbol: 'TESTNFT',
                tokenId: 'token001'
            };

            await expect((nftContract as any).buyNFT(payload, { sender: 'bob', amount: '5.000', asset: 'HIVE' }))
                .rejects.toThrow('Incorrect payment amount. Required: 10.000 HIVE');
        });

        it('should reject incorrect currency', async () => {
            mockAdapter.setQueryResult([{ id: 1, token_id: 'token001', collection_symbol: 'TESTNFT', seller: 'alice', price: '10.000', currency: 'HIVE', active: true }]);

            const payload = {
                collectionSymbol: 'TESTNFT',
                tokenId: 'token001'
            };

            await expect((nftContract as any).buyNFT(payload, { sender: 'bob', amount: '10.000', asset: 'HBD' }))
                .rejects.toThrow('Incorrect currency. Required: HIVE');
        });
    });

    describe('Query Methods', () => {
        beforeEach(() => {
            mockAdapter.reset();
            nftContract.create();
        });

        it('should get token info successfully', async () => {
            const tokenData = {
                token_id: 'token001',
                collection_symbol: 'TESTNFT',
                owner: 'alice',
                metadata: '{"name": "Test NFT"}',
                burned: false
            };
            const listingData = {
                id: 1,
                price: '10.000',
                currency: 'HIVE',
                active: true
            };

            mockAdapter.setQueryResults([
                [tokenData],
                [listingData]
            ]);

            const payload = {
                collectionSymbol: 'TESTNFT',
                tokenId: 'token001'
            };

            await (nftContract as any).getTokenInfo(payload, { sender: 'bob' });

            expect(mockAdapter.events.length).toBe(1);
            expect(mockAdapter.events[0].action).toBe('getTokenInfo');
            expect(mockAdapter.events[0].data.action).toBe('token_info_query');
            expect(mockAdapter.events[0].data.data.token_info).toEqual(tokenData);
            expect(mockAdapter.events[0].data.data.listing_info).toEqual(listingData);
        });

        it('should reject getting info for non-existent token', async () => {
            mockAdapter.setQueryResult([]); // No token found

            const payload = {
                collectionSymbol: 'TESTNFT',
                tokenId: 'nonexistent'
            };

            await expect((nftContract as any).getTokenInfo(payload, { sender: 'bob' }))
                .rejects.toThrow('Token nonexistent does not exist in collection TESTNFT');
        });

        it('should get collection info successfully', async () => {
            const collectionData = {
                symbol: 'TESTNFT',
                name: 'Test Collection',
                creator: 'alice',
                max_supply: 1000,
                current_supply: 50
            };

            mockAdapter.setQueryResult([collectionData]);

            const payload = {
                symbol: 'TESTNFT'
            };

            await (nftContract as any).getCollectionInfo(payload, { sender: 'bob' });

            expect(mockAdapter.events.length).toBe(1);
            expect(mockAdapter.events[0].action).toBe('getCollectionInfo');
            expect(mockAdapter.events[0].data.action).toBe('collection_info_query');
            expect(mockAdapter.events[0].data.data.collection_info).toEqual(collectionData);
        });

        it('should reject getting info for non-existent collection', async () => {
            mockAdapter.setQueryResult([]); // No collection found

            const payload = {
                symbol: 'NONEXISTENT'
            };

            await expect((nftContract as any).getCollectionInfo(payload, { sender: 'bob' }))
                .rejects.toThrow('Collection NONEXISTENT does not exist');
        });

        it('should get user tokens successfully', async () => {
            const userTokens = [
                { token_id: 'token001', collection_symbol: 'TESTNFT', owner: 'alice' },
                { token_id: 'token002', collection_symbol: 'TESTNFT', owner: 'alice' }
            ];

            mockAdapter.setQueryResult(userTokens);

            const payload = {
                account: 'alice',
                collectionSymbol: 'TESTNFT'
            };

            await (nftContract as any).getUserTokens(payload, { sender: 'bob' });

            expect(mockAdapter.events.length).toBe(1);
            expect(mockAdapter.events[0].action).toBe('getUserTokens');
            expect(mockAdapter.events[0].data.action).toBe('user_tokens_query');
            expect(mockAdapter.events[0].data.data.token_count).toBe(2);
        });

        it('should get all user tokens when no collection specified', async () => {
            const userTokens = [
                { token_id: 'token001', collection_symbol: 'TESTNFT', owner: 'alice' },
                { token_id: 'token003', collection_symbol: 'ANOTHERNFT', owner: 'alice' }
            ];

            mockAdapter.setQueryResult(userTokens);

            const payload = {
                account: 'alice'
            };

            await (nftContract as any).getUserTokens(payload, { sender: 'bob' });

            expect(mockAdapter.events.length).toBe(1);
            expect(mockAdapter.events[0].data.data.token_count).toBe(2);
        });
    });

    describe('Error Handling', () => {
        beforeEach(() => {
            mockAdapter.reset();
            nftContract.create();
        });

        it('should handle database errors gracefully during table initialization', async () => {
            const originalQuery = mockAdapter.query;
            mockAdapter.query = jest.fn().mockRejectedValue(new Error('Database error'));

            const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
            
            await nftContract.create();

            // Wait for async operations to complete
            await new Promise(resolve => setTimeout(resolve, 10));

            expect(consoleSpy).toHaveBeenCalledWith('[NFTContract] Error initializing tables:', expect.any(Error));
            
            consoleSpy.mockRestore();
            mockAdapter.query = originalQuery;
        });

        it('should propagate errors from contract methods', async () => {
            mockAdapter.query = jest.fn().mockRejectedValue(new Error('Database connection failed'));

            const payload = {
                symbol: 'TESTNFT',
                name: 'Test Collection'
            };

            await expect((nftContract as any).createCollection(payload, { sender: 'alice' }))
                .rejects.toThrow('Database connection failed');
        });
    });
});