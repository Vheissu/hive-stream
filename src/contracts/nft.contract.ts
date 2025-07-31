import { Streamer } from '../streamer';
import { Utils } from '../utils';
import BigNumber from 'bignumber.js';

const CONTRACT_NAME = 'hivenft';

interface NFTCollection {
    symbol: string;
    name: string;
    description?: string;
    creator: string;
    maxSupply?: number;
    royalty?: number;
    baseUri?: string;
    allowUpdates?: boolean;
    updateableByOwner?: boolean;
    createdAt: Date;
}

interface NFTToken {
    tokenId: string;
    collectionSymbol: string;
    owner: string;
    metadata?: string;
    attributes?: string;
    mintedAt: Date;
    mintedBy: string;
}

interface NFTListing {
    tokenId: string;
    collectionSymbol: string;
    seller: string;
    price: string;
    currency: string;
    listedAt: Date;
    active: boolean;
}

interface NFTTransfer {
    tokenId: string;
    collectionSymbol: string;
    from: string;
    to: string;
    timestamp: Date;
    blockNumber: number;
    transactionId: string;
    transferType: 'mint' | 'transfer' | 'burn' | 'sale';
    price?: string;
    currency?: string;
}

export class NFTContract {
    public _instance: Streamer;
    private adapter;

    private blockNumber: number;
    private blockId: string;
    private previousBlockId: string;
    private transactionId: string;

    public async create() {
        this.adapter = this._instance.getAdapter();
        await this.initializeNFTTables();
    }

    public destroy() {
        // Cleanup logic if needed
    }

    public updateBlockInfo(blockNumber: number, blockId: string, previousBlockId: string, transactionId: string) {
        this.blockNumber = blockNumber;
        this.blockId = blockId;
        this.previousBlockId = previousBlockId;
        this.transactionId = transactionId;
    }

    private async initializeNFTTables() {
        try {
            await this.adapter.query(`
                CREATE TABLE IF NOT EXISTS nft_collections (
                    symbol TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    description TEXT,
                    creator TEXT NOT NULL,
                    max_supply INTEGER,
                    current_supply INTEGER NOT NULL DEFAULT 0,
                    royalty REAL DEFAULT 0,
                    base_uri TEXT,
                    allow_updates BOOLEAN DEFAULT TRUE,
                    updateable_by_owner BOOLEAN DEFAULT FALSE,
                    created_at DATETIME NOT NULL
                )
            `);

            await this.adapter.query(`
                CREATE TABLE IF NOT EXISTS nft_tokens (
                    token_id TEXT NOT NULL,
                    collection_symbol TEXT NOT NULL,
                    owner TEXT NOT NULL,
                    metadata TEXT,
                    attributes TEXT,
                    minted_at DATETIME NOT NULL,
                    minted_by TEXT NOT NULL,
                    burned BOOLEAN DEFAULT FALSE,
                    PRIMARY KEY (token_id, collection_symbol),
                    FOREIGN KEY (collection_symbol) REFERENCES nft_collections(symbol)
                )
            `);

            await this.adapter.query(`
                CREATE TABLE IF NOT EXISTS nft_listings (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    token_id TEXT NOT NULL,
                    collection_symbol TEXT NOT NULL,
                    seller TEXT NOT NULL,
                    price TEXT NOT NULL,
                    currency TEXT NOT NULL DEFAULT 'HIVE',
                    listed_at DATETIME NOT NULL,
                    active BOOLEAN DEFAULT TRUE,
                    FOREIGN KEY (token_id, collection_symbol) REFERENCES nft_tokens(token_id, collection_symbol)
                )
            `);

            await this.adapter.query(`
                CREATE TABLE IF NOT EXISTS nft_transfers (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    token_id TEXT NOT NULL,
                    collection_symbol TEXT NOT NULL,
                    from_account TEXT NOT NULL,
                    to_account TEXT NOT NULL,
                    transfer_type TEXT NOT NULL,
                    price TEXT,
                    currency TEXT,
                    block_number INTEGER NOT NULL,
                    transaction_id TEXT NOT NULL,
                    timestamp DATETIME NOT NULL,
                    FOREIGN KEY (token_id, collection_symbol) REFERENCES nft_tokens(token_id, collection_symbol)
                )
            `);

            await this.adapter.query(`
                CREATE INDEX IF NOT EXISTS idx_nft_tokens_owner ON nft_tokens(owner);
            `);

            await this.adapter.query(`
                CREATE INDEX IF NOT EXISTS idx_nft_tokens_collection ON nft_tokens(collection_symbol);
            `);

            await this.adapter.query(`
                CREATE INDEX IF NOT EXISTS idx_nft_listings_active ON nft_listings(active, collection_symbol);
            `);

        } catch (error) {
            console.error('[NFTContract] Error initializing tables:', error);
        }
    }

    private async createCollection(payload: {
        symbol: string;
        name: string;
        description?: string;
        maxSupply?: number;
        royalty?: number;
        baseUri?: string;
        allowUpdates?: boolean;
        updateableByOwner?: boolean;
    }, { sender }) {
        try {
            const { symbol, name, description = '', maxSupply, royalty = 0, baseUri = '', allowUpdates = true, updateableByOwner = false } = payload;

            if (!symbol.match(/^[A-Z0-9]{1,20}$/)) {
                throw new Error('Symbol must be 1-20 uppercase alphanumeric characters');
            }

            if (!name || name.length > 100) {
                throw new Error('Name is required and must be 100 characters or less');
            }

            if (description && description.length > 500) {
                throw new Error('Description must be 500 characters or less');
            }

            if (maxSupply && (maxSupply < 1 || maxSupply > 1000000)) {
                throw new Error('Maximum supply must be between 1 and 1,000,000');
            }

            if (royalty < 0 || royalty > 0.25) {
                throw new Error('Royalty must be between 0 and 25%');
            }

            if (baseUri && baseUri.length > 500) {
                throw new Error('Base URI must be 500 characters or less');
            }

            const existingCollection = await this.adapter.query(
                'SELECT symbol FROM nft_collections WHERE symbol = ?',
                [symbol]
            );

            if (existingCollection && existingCollection.length > 0) {
                throw new Error(`Collection with symbol ${symbol} already exists`);
            }

            await this.adapter.query(`
                INSERT INTO nft_collections (symbol, name, description, creator, max_supply, royalty, base_uri, allow_updates, updateable_by_owner, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [symbol, name, description, sender, maxSupply, royalty, baseUri, allowUpdates, updateableByOwner, new Date()]);

            await this.adapter.addEvent(new Date(), CONTRACT_NAME, 'createCollection', payload, {
                action: 'collection_created',
                data: {
                    symbol,
                    name,
                    creator: sender,
                    maxSupply,
                    royalty
                }
            });

            console.log(`[NFTContract] Collection ${symbol} created by ${sender}`);

        } catch (error) {
            console.error('[NFTContract] Error creating collection:', error);
            throw error;
        }
    }

    private async mintNFT(payload: {
        collectionSymbol: string;
        tokenId: string;
        to: string;
        metadata?: string;
        attributes?: string;
    }, { sender }) {
        try {
            const { collectionSymbol, tokenId, to, metadata = '', attributes = '' } = payload;

            const collection = await this.adapter.query(
                'SELECT * FROM nft_collections WHERE symbol = ?',
                [collectionSymbol]
            );

            if (!collection || collection.length === 0) {
                throw new Error(`Collection ${collectionSymbol} does not exist`);
            }

            const collectionData = collection[0];

            if (collectionData.creator !== sender) {
                throw new Error('Only the collection creator can mint NFTs');
            }

            if (!tokenId.match(/^[A-Za-z0-9_-]{1,50}$/)) {
                throw new Error('Token ID must be 1-50 alphanumeric characters (including _ and -)');
            }

            if (metadata && metadata.length > 2000) {
                throw new Error('Metadata must be 2000 characters or less');
            }

            if (attributes && attributes.length > 1000) {
                throw new Error('Attributes must be 1000 characters or less');
            }

            if (collectionData.max_supply && collectionData.current_supply >= collectionData.max_supply) {
                throw new Error('Collection has reached maximum supply');
            }

            const existingToken = await this.adapter.query(
                'SELECT token_id FROM nft_tokens WHERE token_id = ? AND collection_symbol = ?',
                [tokenId, collectionSymbol]
            );

            if (existingToken && existingToken.length > 0) {
                throw new Error(`Token ${tokenId} already exists in collection ${collectionSymbol}`);
            }

            await this.adapter.query(`
                INSERT INTO nft_tokens (token_id, collection_symbol, owner, metadata, attributes, minted_at, minted_by)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `, [tokenId, collectionSymbol, to, metadata, attributes, new Date(), sender]);

            await this.adapter.query(
                'UPDATE nft_collections SET current_supply = current_supply + 1 WHERE symbol = ?',
                [collectionSymbol]
            );

            await this.adapter.query(`
                INSERT INTO nft_transfers (token_id, collection_symbol, from_account, to_account, transfer_type, block_number, transaction_id, timestamp)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `, [tokenId, collectionSymbol, 'null', to, 'mint', this.blockNumber, this.transactionId, new Date()]);

            await this.adapter.addEvent(new Date(), CONTRACT_NAME, 'mintNFT', payload, {
                action: 'nft_minted',
                data: {
                    tokenId,
                    collectionSymbol,
                    to,
                    mintedBy: sender
                }
            });

            console.log(`[NFTContract] NFT ${tokenId} minted in collection ${collectionSymbol} to ${to}`);

        } catch (error) {
            console.error('[NFTContract] Error minting NFT:', error);
            throw error;
        }
    }

    private async updateNFT(payload: {
        collectionSymbol: string;
        tokenId: string;
        metadata?: string;
        attributes?: string;
    }, { sender }) {
        try {
            const { collectionSymbol, tokenId, metadata, attributes } = payload;

            const tokenQuery = await this.adapter.query(
                'SELECT * FROM nft_tokens WHERE token_id = ? AND collection_symbol = ? AND burned = FALSE',
                [tokenId, collectionSymbol]
            );

            if (!tokenQuery || tokenQuery.length === 0) {
                throw new Error(`Token ${tokenId} does not exist or has been burned`);
            }

            const tokenData = tokenQuery[0];

            const collectionQuery = await this.adapter.query(
                'SELECT * FROM nft_collections WHERE symbol = ?',
                [collectionSymbol]
            );

            if (!collectionQuery || collectionQuery.length === 0) {
                throw new Error(`Collection ${collectionSymbol} does not exist`);
            }

            const collectionData = collectionQuery[0];

            if (!collectionData.allow_updates) {
                throw new Error('Updates are not allowed for this collection');
            }

            let canUpdate = false;
            if (collectionData.creator === sender) {
                canUpdate = true;
            } else if (collectionData.updateable_by_owner && tokenData.owner === sender) {
                canUpdate = true;
            }

            if (!canUpdate) {
                throw new Error('Only the collection creator or token owner (if allowed) can update the NFT');
            }

            if (metadata && metadata.length > 2000) {
                throw new Error('Metadata must be 2000 characters or less');
            }

            if (attributes && attributes.length > 1000) {
                throw new Error('Attributes must be 1000 characters or less');
            }

            let updateFields = [];
            let updateValues = [];

            if (metadata !== undefined) {
                updateFields.push('metadata = ?');
                updateValues.push(metadata);
            }

            if (attributes !== undefined) {
                updateFields.push('attributes = ?');
                updateValues.push(attributes);
            }

            if (updateFields.length === 0) {
                throw new Error('No update fields provided');
            }

            updateValues.push(tokenId, collectionSymbol);

            await this.adapter.query(
                `UPDATE nft_tokens SET ${updateFields.join(', ')} WHERE token_id = ? AND collection_symbol = ?`,
                updateValues
            );

            await this.adapter.addEvent(new Date(), CONTRACT_NAME, 'updateNFT', payload, {
                action: 'nft_updated',
                data: {
                    tokenId,
                    collectionSymbol,
                    updatedBy: sender,
                    metadata: metadata !== undefined ? metadata : 'unchanged',
                    attributes: attributes !== undefined ? attributes : 'unchanged'
                }
            });

            console.log(`[NFTContract] NFT ${tokenId} updated by ${sender}`);

        } catch (error) {
            console.error('[NFTContract] Error updating NFT:', error);
            throw error;
        }
    }

    private async transferNFT(payload: {
        collectionSymbol: string;
        tokenId: string;
        to: string;
    }, { sender }) {
        try {
            const { collectionSymbol, tokenId, to } = payload;

            const token = await this.adapter.query(
                'SELECT * FROM nft_tokens WHERE token_id = ? AND collection_symbol = ? AND burned = FALSE',
                [tokenId, collectionSymbol]
            );

            if (!token || token.length === 0) {
                throw new Error(`Token ${tokenId} does not exist or has been burned`);
            }

            const tokenData = token[0];

            if (tokenData.owner !== sender) {
                throw new Error('Only the token owner can transfer the NFT');
            }

            if (tokenData.owner === to) {
                throw new Error('Cannot transfer to the same address');
            }

            const activeListings = await this.adapter.query(
                'SELECT id FROM nft_listings WHERE token_id = ? AND collection_symbol = ? AND seller = ? AND active = TRUE',
                [tokenId, collectionSymbol, sender]
            );

            if (activeListings && activeListings.length > 0) {
                await this.adapter.query(
                    'UPDATE nft_listings SET active = FALSE WHERE token_id = ? AND collection_symbol = ? AND seller = ?',
                    [tokenId, collectionSymbol, sender]
                );
            }

            await this.adapter.query(
                'UPDATE nft_tokens SET owner = ? WHERE token_id = ? AND collection_symbol = ?',
                [to, tokenId, collectionSymbol]
            );

            await this.adapter.query(`
                INSERT INTO nft_transfers (token_id, collection_symbol, from_account, to_account, transfer_type, block_number, transaction_id, timestamp)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `, [tokenId, collectionSymbol, sender, to, 'transfer', this.blockNumber, this.transactionId, new Date()]);

            await this.adapter.addEvent(new Date(), CONTRACT_NAME, 'transferNFT', payload, {
                action: 'nft_transferred',
                data: {
                    tokenId,
                    collectionSymbol,
                    from: sender,
                    to
                }
            });

            console.log(`[NFTContract] NFT ${tokenId} transferred from ${sender} to ${to}`);

        } catch (error) {
            console.error('[NFTContract] Error transferring NFT:', error);
            throw error;
        }
    }

    private async burnNFT(payload: {
        collectionSymbol: string;
        tokenId: string;
    }, { sender }) {
        try {
            const { collectionSymbol, tokenId } = payload;

            const token = await this.adapter.query(
                'SELECT * FROM nft_tokens WHERE token_id = ? AND collection_symbol = ? AND burned = FALSE',
                [tokenId, collectionSymbol]
            );

            if (!token || token.length === 0) {
                throw new Error(`Token ${tokenId} does not exist or has already been burned`);
            }

            const tokenData = token[0];

            if (tokenData.owner !== sender) {
                throw new Error('Only the token owner can burn the NFT');
            }

            await this.adapter.query(
                'UPDATE nft_listings SET active = FALSE WHERE token_id = ? AND collection_symbol = ?',
                [tokenId, collectionSymbol]
            );

            await this.adapter.query(
                'UPDATE nft_tokens SET burned = TRUE WHERE token_id = ? AND collection_symbol = ?',
                [tokenId, collectionSymbol]
            );

            await this.adapter.query(
                'UPDATE nft_collections SET current_supply = current_supply - 1 WHERE symbol = ?',
                [collectionSymbol]
            );

            await this.adapter.query(`
                INSERT INTO nft_transfers (token_id, collection_symbol, from_account, to_account, transfer_type, block_number, transaction_id, timestamp)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `, [tokenId, collectionSymbol, sender, 'null', 'burn', this.blockNumber, this.transactionId, new Date()]);

            await this.adapter.addEvent(new Date(), CONTRACT_NAME, 'burnNFT', payload, {
                action: 'nft_burned',
                data: {
                    tokenId,
                    collectionSymbol,
                    burnedBy: sender
                }
            });

            console.log(`[NFTContract] NFT ${tokenId} burned by ${sender}`);

        } catch (error) {
            console.error('[NFTContract] Error burning NFT:', error);
            throw error;
        }
    }

    private async listNFT(payload: {
        collectionSymbol: string;
        tokenId: string;
        price: string;
        currency?: string;
    }, { sender }) {
        try {
            const { collectionSymbol, tokenId, price, currency = 'HIVE' } = payload;

            const token = await this.adapter.query(
                'SELECT * FROM nft_tokens WHERE token_id = ? AND collection_symbol = ? AND burned = FALSE',
                [tokenId, collectionSymbol]
            );

            if (!token || token.length === 0) {
                throw new Error(`Token ${tokenId} does not exist or has been burned`);
            }

            const tokenData = token[0];

            if (tokenData.owner !== sender) {
                throw new Error('Only the token owner can list the NFT');
            }

            const priceBN = new BigNumber(price);
            if (priceBN.isNaN() || priceBN.lte(0)) {
                throw new Error('Price must be a positive number');
            }

            if (!['HIVE', 'HBD'].includes(currency)) {
                throw new Error('Currency must be HIVE or HBD');
            }

            await this.adapter.query(
                'UPDATE nft_listings SET active = FALSE WHERE token_id = ? AND collection_symbol = ? AND seller = ?',
                [tokenId, collectionSymbol, sender]
            );

            await this.adapter.query(`
                INSERT INTO nft_listings (token_id, collection_symbol, seller, price, currency, listed_at)
                VALUES (?, ?, ?, ?, ?, ?)
            `, [tokenId, collectionSymbol, sender, price, currency, new Date()]);

            await this.adapter.addEvent(new Date(), CONTRACT_NAME, 'listNFT', payload, {
                action: 'nft_listed',
                data: {
                    tokenId,
                    collectionSymbol,
                    seller: sender,
                    price,
                    currency
                }
            });

            console.log(`[NFTContract] NFT ${tokenId} listed by ${sender} for ${price} ${currency}`);

        } catch (error) {
            console.error('[NFTContract] Error listing NFT:', error);
            throw error;
        }
    }

    private async unlistNFT(payload: {
        collectionSymbol: string;
        tokenId: string;
    }, { sender }) {
        try {
            const { collectionSymbol, tokenId } = payload;

            const listing = await this.adapter.query(
                'SELECT * FROM nft_listings WHERE token_id = ? AND collection_symbol = ? AND seller = ? AND active = TRUE',
                [tokenId, collectionSymbol, sender]
            );

            if (!listing || listing.length === 0) {
                throw new Error(`No active listing found for token ${tokenId}`);
            }

            await this.adapter.query(
                'UPDATE nft_listings SET active = FALSE WHERE token_id = ? AND collection_symbol = ? AND seller = ?',
                [tokenId, collectionSymbol, sender]
            );

            await this.adapter.addEvent(new Date(), CONTRACT_NAME, 'unlistNFT', payload, {
                action: 'nft_unlisted',
                data: {
                    tokenId,
                    collectionSymbol,
                    seller: sender
                }
            });

            console.log(`[NFTContract] NFT ${tokenId} unlisted by ${sender}`);

        } catch (error) {
            console.error('[NFTContract] Error unlisting NFT:', error);
            throw error;
        }
    }

    private async buyNFT(payload: {
        collectionSymbol: string;
        tokenId: string;
    }, { sender, amount, asset }) {
        try {
            const { collectionSymbol, tokenId } = payload;

            const listing = await this.adapter.query(
                'SELECT * FROM nft_listings WHERE token_id = ? AND collection_symbol = ? AND active = TRUE',
                [tokenId, collectionSymbol]
            );

            if (!listing || listing.length === 0) {
                throw new Error(`No active listing found for token ${tokenId}`);
            }

            const listingData = listing[0];

            if (listingData.seller === sender) {
                throw new Error('Cannot buy your own NFT');
            }

            const requiredPrice = new BigNumber(listingData.price);
            const paidAmount = new BigNumber(amount);

            if (!paidAmount.eq(requiredPrice)) {
                throw new Error(`Incorrect payment amount. Required: ${listingData.price} ${listingData.currency}`);
            }

            if (asset !== listingData.currency) {
                throw new Error(`Incorrect currency. Required: ${listingData.currency}`);
            }

            const collection = await this.adapter.query(
                'SELECT royalty, creator FROM nft_collections WHERE symbol = ?',
                [collectionSymbol]
            );

            let royaltyAmount = new BigNumber(0);
            let sellerAmount = paidAmount;

            if (collection && collection.length > 0 && collection[0].royalty > 0) {
                royaltyAmount = paidAmount.multipliedBy(collection[0].royalty);
                sellerAmount = paidAmount.minus(royaltyAmount);

                if (royaltyAmount.gt(0) && collection[0].creator !== listingData.seller) {
                    console.log(`[NFTContract] Royalty payment: ${royaltyAmount.toFixed(3)} ${asset} to ${collection[0].creator}`);
                }
            }

            await this.adapter.query(
                'UPDATE nft_tokens SET owner = ? WHERE token_id = ? AND collection_symbol = ?',
                [sender, tokenId, collectionSymbol]
            );

            await this.adapter.query(
                'UPDATE nft_listings SET active = FALSE WHERE token_id = ? AND collection_symbol = ?',
                [tokenId, collectionSymbol]
            );

            await this.adapter.query(`
                INSERT INTO nft_transfers (token_id, collection_symbol, from_account, to_account, transfer_type, price, currency, block_number, transaction_id, timestamp)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [tokenId, collectionSymbol, listingData.seller, sender, 'sale', amount, asset, this.blockNumber, this.transactionId, new Date()]);

            await this.adapter.addEvent(new Date(), CONTRACT_NAME, 'buyNFT', payload, {
                action: 'nft_sold',
                data: {
                    tokenId,
                    collectionSymbol,
                    seller: listingData.seller,
                    buyer: sender,
                    price: amount,
                    currency: asset,
                    royaltyAmount: royaltyAmount.toFixed(3),
                    sellerAmount: sellerAmount.toFixed(3)
                }
            });

            console.log(`[NFTContract] NFT ${tokenId} sold to ${sender} for ${amount} ${asset}`);

        } catch (error) {
            console.error('[NFTContract] Error buying NFT:', error);
            throw error;
        }
    }

    private async getTokenInfo(payload: {
        collectionSymbol: string;
        tokenId: string;
    }, { sender }) {
        try {
            const { collectionSymbol, tokenId } = payload;

            const token = await this.adapter.query(
                'SELECT * FROM nft_tokens WHERE token_id = ? AND collection_symbol = ?',
                [tokenId, collectionSymbol]
            );

            if (!token || token.length === 0) {
                throw new Error(`Token ${tokenId} does not exist in collection ${collectionSymbol}`);
            }

            const tokenData = token[0];

            const listing = await this.adapter.query(
                'SELECT * FROM nft_listings WHERE token_id = ? AND collection_symbol = ? AND active = TRUE',
                [tokenId, collectionSymbol]
            );

            const listingData = listing && listing.length > 0 ? listing[0] : null;

            await this.adapter.addEvent(new Date(), CONTRACT_NAME, 'getTokenInfo', payload, {
                action: 'token_info_query',
                data: {
                    tokenId,
                    collectionSymbol,
                    queried_by: sender,
                    token_info: tokenData,
                    listing_info: listingData
                }
            });

            console.log(`[NFTContract] Token info query for ${tokenId} by ${sender}`);

        } catch (error) {
            console.error('[NFTContract] Error getting token info:', error);
            throw error;
        }
    }

    private async getCollectionInfo(payload: {
        symbol: string;
    }, { sender }) {
        try {
            const { symbol } = payload;

            const collection = await this.adapter.query(
                'SELECT * FROM nft_collections WHERE symbol = ?',
                [symbol]
            );

            if (!collection || collection.length === 0) {
                throw new Error(`Collection ${symbol} does not exist`);
            }

            const collectionData = collection[0];

            await this.adapter.addEvent(new Date(), CONTRACT_NAME, 'getCollectionInfo', payload, {
                action: 'collection_info_query',
                data: {
                    symbol,
                    queried_by: sender,
                    collection_info: collectionData
                }
            });

            console.log(`[NFTContract] Collection info query for ${symbol} by ${sender}`);

        } catch (error) {
            console.error('[NFTContract] Error getting collection info:', error);
            throw error;
        }
    }

    private async getUserTokens(payload: {
        account: string;
        collectionSymbol?: string;
    }, { sender }) {
        try {
            const { account, collectionSymbol } = payload;

            let query = 'SELECT * FROM nft_tokens WHERE owner = ? AND burned = FALSE';
            let params = [account];

            if (collectionSymbol) {
                query += ' AND collection_symbol = ?';
                params.push(collectionSymbol);
            }

            const tokens = await this.adapter.query(query, params);

            await this.adapter.addEvent(new Date(), CONTRACT_NAME, 'getUserTokens', payload, {
                action: 'user_tokens_query',
                data: {
                    account,
                    collectionSymbol,
                    queried_by: sender,
                    token_count: tokens ? tokens.length : 0
                }
            });

            console.log(`[NFTContract] User tokens query for ${account} by ${sender}`);

        } catch (error) {
            console.error('[NFTContract] Error getting user tokens:', error);
            throw error;
        }
    }
}