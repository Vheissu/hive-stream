import { Streamer } from '../../src/streamer';
import { SqliteAdapter } from '../../src/adapters/sqlite.adapter';
import { createNFTContract } from '../../src/contracts/nft.contract';
import { Utils } from '../../src/utils';

const createCustomJsonContext = (streamer: Streamer, adapter: SqliteAdapter, sender: string, transactionId: string) => ({
    trigger: 'custom_json' as const,
    streamer,
    adapter,
    config: streamer['config'],
    block: { number: 321, id: 'block-321', previousId: 'block-320', time: new Date() },
    transaction: { id: transactionId },
    sender,
    customJson: { id: streamer['config'].JSON_ID, json: {}, isSignedWithActiveKey: true }
});

const createTransferContext = (streamer: Streamer, adapter: SqliteAdapter, sender: string, rawAmount: string, transactionId: string) => ({
    trigger: 'transfer' as const,
    streamer,
    adapter,
    config: streamer['config'],
    block: { number: 322, id: 'block-322', previousId: 'block-321', time: new Date() },
    transaction: { id: transactionId },
    sender,
    transfer: {
        from: sender,
        to: 'hivenft',
        rawAmount,
        amount: rawAmount.split(' ')[0],
        asset: rawAmount.split(' ')[1],
        memo: ''
    }
});

describe('NFT transactional safety', () => {
    test('rolls back minting when the final event write fails', async () => {
        const streamer = new Streamer({ debugMode: false });
        const adapter = new SqliteAdapter(':memory:');
        const contract = createNFTContract();

        await streamer.registerAdapter(adapter);
        await streamer.registerContract(contract);

        const aliceContext = createCustomJsonContext(streamer, adapter, 'alice', 'trx-create-collection');

        await contract.actions.createCollection.handler({
            symbol: 'TESTNFT',
            name: 'Test Collection',
            maxSupply: 10
        }, aliceContext);

        jest.spyOn(adapter, 'addEvent').mockImplementationOnce(async () => {
            throw new Error('event persistence failed');
        });

        await expect(contract.actions.mintNFT.handler({
            collectionSymbol: 'TESTNFT',
            tokenId: 'token001',
            to: 'alice'
        }, createCustomJsonContext(streamer, adapter, 'alice', 'trx-mint-token'))).rejects.toThrow('event persistence failed');

        const collectionRows = await adapter.query(
            'SELECT current_supply FROM nft_collections WHERE symbol = ?',
            ['TESTNFT']
        );
        const tokenRows = await adapter.query(
            'SELECT token_id FROM nft_tokens WHERE token_id = ? AND collection_symbol = ?',
            ['token001', 'TESTNFT']
        );
        const transferRows = await adapter.query(
            'SELECT transfer_type FROM nft_transfers WHERE token_id = ? AND collection_symbol = ?',
            ['token001', 'TESTNFT']
        );

        expect(collectionRows[0].current_supply).toBe(0);
        expect(tokenRows).toHaveLength(0);
        expect(transferRows).toHaveLength(0);

        await streamer.stop();
    });

    test('rolls back NFT sales when the final event write fails', async () => {
        const streamer = new Streamer({ debugMode: false });
        const adapter = new SqliteAdapter(':memory:');
        const contract = createNFTContract();

        await streamer.registerAdapter(adapter);
        await streamer.registerContract(contract);

        await contract.actions.createCollection.handler({
            symbol: 'TESTNFT',
            name: 'Test Collection',
            maxSupply: 10
        }, createCustomJsonContext(streamer, adapter, 'alice', 'trx-create-collection'));

        await contract.actions.mintNFT.handler({
            collectionSymbol: 'TESTNFT',
            tokenId: 'token001',
            to: 'alice'
        }, createCustomJsonContext(streamer, adapter, 'alice', 'trx-mint-token'));

        await contract.actions.listNFT.handler({
            collectionSymbol: 'TESTNFT',
            tokenId: 'token001',
            price: '10.000',
            currency: 'HIVE'
        }, createCustomJsonContext(streamer, adapter, 'alice', 'trx-list-token'));

        // Mock blockchain verification calls that the buyNFT action wrapper now performs
        jest.spyOn(Utils, 'getTransaction').mockResolvedValue({ operations: [] } as any);
        jest.spyOn(Utils, 'verifyTransfer').mockResolvedValue(true);
        jest.spyOn(streamer, 'transferHiveTokens').mockResolvedValue(true as any);

        jest.spyOn(adapter, 'addEvent').mockImplementationOnce(async () => {
            throw new Error('event persistence failed');
        });

        await expect(contract.actions.buyNFT.handler({
            collectionSymbol: 'TESTNFT',
            tokenId: 'token001'
        }, createTransferContext(streamer, adapter, 'bob', '10.000 HIVE', 'trx-buy-token'))).rejects.toThrow('event persistence failed');

        const tokenRows = await adapter.query(
            'SELECT owner FROM nft_tokens WHERE token_id = ? AND collection_symbol = ?',
            ['token001', 'TESTNFT']
        );
        const listingRows = await adapter.query(
            'SELECT active FROM nft_listings WHERE token_id = ? AND collection_symbol = ? ORDER BY id DESC LIMIT 1',
            ['token001', 'TESTNFT']
        );
        const saleTransfers = await adapter.query(
            'SELECT transfer_type FROM nft_transfers WHERE token_id = ? AND collection_symbol = ? AND transfer_type = ?',
            ['token001', 'TESTNFT', 'sale']
        );

        expect(tokenRows[0].owner).toBe('alice');
        expect(listingRows[0].active).toBe(1);
        expect(saleTransfers).toHaveLength(0);

        await streamer.stop();
    });
});
