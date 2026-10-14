import { createTestStreamer, TestStreamer } from '../../src/testing';
import { createExchangeContract } from '../../src/contracts/exchange.contract';
import { createTokenContract } from '../../src/contracts/token.contract';
import { createNFTContract } from '../../src/contracts/nft.contract';
import { createMultisigTreasuryContract } from '../../src/contracts/multisigtreasury.contract';
import { createPredictionMarketContract } from '../../src/contracts/predictionmarket.contract';
import { createAuctionHouseContract } from '../../src/contracts/auctionhouse.contract';
import { createLaunchpadContract } from '../../src/contracts/launchpad.contract';
import { makeContext } from '../helpers/contract-context';

const quiet = () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
};

const later = (ts: TestStreamer, ms: number) => new Date(ts.currentTime.getTime() + ms).toISOString();

describe('Value-moving custom_json actions need the active key', () => {
    let ts: TestStreamer;

    beforeEach(quiet);

    afterEach(async () => {
        await ts?.stop();
        jest.restoreAllMocks();
    });

    test.each([
        ['exchange', 'transfer', { to: 'bob', asset: 'HIVE', amount: '1' }],
        ['exchange', 'placeOrder', { side: 'buy', base: 'HIVE', quote: 'HBD', price: '1', amount: '1' }],
        ['exchange', 'cancelOrder', { orderId: 'order-1' }],
        ['hivetoken', 'transferTokens', { symbol: 'TKN', to: 'bob', amount: '1' }],
        ['hivenft', 'transferNFT', { collectionSymbol: 'ART', tokenId: 'one', to: 'bob' }],
        ['hivenft', 'listNFT', { collectionSymbol: 'ART', tokenId: 'one', price: '1.000' }],
        ['hivenft', 'burnNFT', { collectionSymbol: 'ART', tokenId: 'one' }],
        ['multisigtreasury', 'approveProposal', { proposalId: 'p-1' }],
        ['multisigtreasury', 'markExecuted', { proposalId: 'p-1' }]
    ])('%s.%s signed with the posting key is rejected', async (contract, actionName, payload) => {
        ts = await createTestStreamer({ username: 'myapp' });
        await ts.streamer.registerContract(createExchangeContract());
        await ts.streamer.registerContract(createTokenContract());
        await ts.streamer.registerContract(createNFTContract());
        await ts.streamer.registerContract(createMultisigTreasuryContract());

        const rejected = jest.fn();
        ts.streamer.hook('onActionRejected', rejected);

        await ts.contractJson('alice', { contract, action: actionName, payload });

        expect(rejected).toHaveBeenCalledWith(expect.objectContaining({ contract, action: actionName, reason: 'active_key_required' }));
    });
});

describe('Exchange withdrawals', () => {
    let ts: TestStreamer;

    beforeEach(quiet);

    afterEach(async () => {
        await ts?.stop();
        jest.restoreAllMocks();
    });

    const setup = async () => {
        ts = await createTestStreamer({ username: 'exchange' });
        const contract = createExchangeContract();
        await ts.streamer.registerContract(contract);
        await ts.contractTransfer({ from: 'alice', amount: '10.000 HIVE', contract: 'exchange', action: 'deposit' });
        return contract;
    };

    const balance = async () => (await ts.adapter.query('SELECT available FROM exchange_balances WHERE account = ? AND asset = ?', ['alice', 'HIVE']))[0].available;

    test('leaves the balance debited when the broadcast was attempted and failed', async () => {
        const contract = await setup();
        jest.spyOn(ts.client.broadcast, 'transfer').mockRejectedValueOnce(new Error('rpc timeout'));

        await expect(contract.actions.withdraw.handler(
            { asset: 'HIVE', amount: '4.000' },
            makeContext(ts.streamer, { sender: 'alice' })
        )).rejects.toThrow('rpc timeout');

        expect(await balance()).toBe('6.000');
        const withdrawals = await ts.adapter.query('SELECT status FROM exchange_withdrawals');
        expect(withdrawals).toEqual([{ status: 'unconfirmed' }]);
    });

    test('a later failure after the transfer landed does not credit the balance back', async () => {
        const contract = await setup();
        const query = ts.adapter.query;
        // A plain function keeps `this`, so queries inside a transaction stay on it.
        jest.spyOn(ts.adapter, 'query').mockImplementation(async function (this: any, sql: string, params?: any[]) {
            if (sql.startsWith('UPDATE exchange_withdrawals') && params?.[0] === 'completed') {
                throw new Error('database went away');
            }
            return query.call(this, sql, params);
        });

        await expect(contract.actions.withdraw.handler(
            { asset: 'HIVE', amount: '4.000' },
            makeContext(ts.streamer, { sender: 'alice' })
        )).rejects.toThrow('database went away');

        expect(ts.outgoingTransfers).toEqual([expect.objectContaining({ from: 'exchange', to: 'alice', amount: '4.000 HIVE' })]);
        expect(await balance()).toBe('6.000');
    });

    test('a successful withdrawal is marked completed after the broadcast', async () => {
        const contract = await setup();

        await contract.actions.withdraw.handler({ asset: 'HIVE', amount: '4.000' }, makeContext(ts.streamer, { sender: 'alice' }));

        expect(await balance()).toBe('6.000');
        expect(await ts.adapter.query('SELECT status FROM exchange_withdrawals')).toEqual([{ status: 'completed' }]);
    });
});

describe('Token precision', () => {
    let ts: TestStreamer;

    beforeEach(quiet);

    afterEach(async () => {
        await ts?.stop();
        jest.restoreAllMocks();
    });

    test('rejects issue and transfer amounts with more decimals than the token allows', async () => {
        ts = await createTestStreamer({ username: 'myapp' });
        const contract = createTokenContract();
        await ts.streamer.registerContract(contract);
        const alice = () => makeContext(ts.streamer, { sender: 'alice' });

        await contract.actions.createToken.handler({ symbol: 'TKN', name: 'Token', precision: 2, maxSupply: '1000' }, alice());
        await expect(contract.actions.issueTokens.handler({ symbol: 'TKN', to: 'alice', amount: '1.234' }, alice()))
            .rejects.toThrow('TKN supports at most 2 decimal places');

        await contract.actions.issueTokens.handler({ symbol: 'TKN', to: 'alice', amount: '10.50' }, alice());
        await expect(contract.actions.transferTokens.handler({ symbol: 'TKN', to: 'bob', amount: '0.001' }, alice()))
            .rejects.toThrow('TKN supports at most 2 decimal places');

        await contract.actions.transferTokens.handler({ symbol: 'TKN', to: 'bob', amount: '0.25' }, alice());
        const rows = await ts.adapter.query('SELECT account, balance FROM token_balances ORDER BY account');
        expect(rows).toEqual([{ account: 'alice', balance: '10.25' }, { account: 'bob', balance: '0.25' }]);
    });
});

describe('NFT marketplace payments', () => {
    let ts: TestStreamer;

    beforeEach(quiet);

    afterEach(async () => {
        await ts?.stop();
        jest.restoreAllMocks();
    });

    const setup = async (royalty: number, owner: string, price: string) => {
        ts = await createTestStreamer({ username: 'marketplace' });
        await ts.streamer.registerContract(createNFTContract());

        await ts.contractJson('alice', { contract: 'hivenft', action: 'createCollection', payload: { symbol: 'ART', name: 'Art', maxSupply: 10, royalty }, activeKey: true });
        await ts.contractJson('alice', { contract: 'hivenft', action: 'mintNFT', payload: { collectionSymbol: 'ART', tokenId: 'one', to: owner }, activeKey: true });
        await ts.contractJson(owner, { contract: 'hivenft', action: 'listNFT', payload: { collectionSymbol: 'ART', tokenId: 'one', price, currency: 'HIVE' }, activeKey: true });
    };

    const owner = async () => (await ts.adapter.query('SELECT owner FROM nft_tokens WHERE token_id = ?', ['one']))[0].owner;

    test('the creator selling their own NFT is paid the full price', async () => {
        await setup(0.1, 'alice', '10.000');

        await ts.contractTransfer({ from: 'bob', amount: '10.000 HIVE', contract: 'hivenft', action: 'buyNFT', payload: { collectionSymbol: 'ART', tokenId: 'one' } });

        expect(await owner()).toBe('bob');
        expect(ts.outgoingTransfers).toEqual([expect.objectContaining({ from: 'marketplace', to: 'alice', amount: '10.000 HIVE' })]);
    });

    test('royalty and seller payouts round down and never exceed the price', async () => {
        await setup(0.25, 'carol', '0.010');

        await ts.contractTransfer({ from: 'bob', amount: '0.010 HIVE', contract: 'hivenft', action: 'buyNFT', payload: { collectionSymbol: 'ART', tokenId: 'one' } });

        expect(ts.outgoingTransfers).toEqual([
            expect.objectContaining({ to: 'carol', amount: '0.008 HIVE' }),
            expect.objectContaining({ to: 'alice', amount: '0.002 HIVE' })
        ]);
    });

    test('verifies the payment operation by its index, not the first operation in the transaction', async () => {
        await setup(0, 'alice', '5.000');
        const memo = ts.contractMemo('hivenft', 'buyNFT', { collectionSymbol: 'ART', tokenId: 'one' });

        await ts.sendOperations([
            ['transfer', { from: 'bob', to: 'someone', amount: '0.001 HIVE', memo: '' }],
            ['transfer', { from: 'bob', to: 'marketplace', amount: '5.000 HIVE', memo }]
        ]);

        expect(await owner()).toBe('bob');
    });

    test('a direct purchase paid to the seller works while the app account is the marketplace', async () => {
        await setup(0.1, 'carol', '3.000');

        await ts.contractTransfer({ from: 'bob', to: 'carol', amount: '3.000 HIVE', contract: 'hivenft', action: 'buyNFTDirect', payload: { collectionSymbol: 'ART', tokenId: 'one' } });

        expect(await owner()).toBe('bob');
        expect(ts.outgoingTransfers).toHaveLength(0);
    });
});

describe('Prediction market resolution', () => {
    let ts: TestStreamer;
    let contract: ReturnType<typeof createPredictionMarketContract>;

    beforeEach(quiet);

    afterEach(async () => {
        await ts?.stop();
        jest.restoreAllMocks();
    });

    const setup = async (stakes: Array<[string, number, string]>) => {
        ts = await createTestStreamer({ username: 'markets' });
        contract = createPredictionMarketContract();
        await ts.streamer.registerContract(contract);

        await contract.actions.createMarket.handler({
            marketId: 'm1',
            title: 'Will it rain?',
            asset: 'HIVE',
            options: ['yes', 'no'],
            closesAt: '2026-01-02T00:00:00Z'
        }, makeContext(ts.streamer, { sender: 'alice', time: '2026-01-01T00:00:00Z' }));

        for (const [account, option, amount] of stakes) {
            await contract.actions.buyPosition.handler({ marketId: 'm1', option }, makeContext(ts.streamer, { sender: account, amount, to: 'markets', time: '2026-01-01T01:00:00Z' }));
        }
    };

    const afterClose = (sender: string) => makeContext(ts.streamer, { sender, time: '2026-01-03T00:00:00Z' });

    test('a market cannot be resolved twice', async () => {
        await setup([['bob', 0, '10.000 HIVE'], ['carol', 1, '5.000 HIVE']]);

        await contract.actions.resolveMarket.handler({ marketId: 'm1', winningOption: 0 }, afterClose('alice'));
        await expect(contract.actions.resolveMarket.handler({ marketId: 'm1', winningOption: 1 }, afterClose('alice')))
            .rejects.toThrow('Market has already been resolved');

        await contract.actions.claimWinnings.handler({ marketId: 'm1' }, afterClose('bob'));
        const events = await ts.getEvents();
        const claim = events.find((event) => event.data.action === 'prediction_winnings_claim_requested');
        expect(claim.data.data.payout).toBe('15');
    });

    test('a market nobody backed the winner of is voided and every staker can reclaim their stake', async () => {
        await setup([['bob', 1, '10.000 HIVE'], ['bob', 1, '2.500 HIVE'], ['carol', 1, '5.000 HIVE']]);

        await contract.actions.resolveMarket.handler({ marketId: 'm1', winningOption: 0 }, afterClose('alice'));
        expect((await ts.adapter.query('SELECT status FROM prediction_markets'))[0].status).toBe('void');

        await contract.actions.claimWinnings.handler({ marketId: 'm1' }, afterClose('bob'));
        await contract.actions.claimWinnings.handler({ marketId: 'm1' }, afterClose('carol'));
        await expect(contract.actions.claimWinnings.handler({ marketId: 'm1' }, afterClose('bob')))
            .rejects.toThrow('No refundable stake found');

        const refunds = (await ts.getEvents())
            .filter((event) => event.data.action === 'prediction_refund_claim_requested')
            .map((event) => [event.data.data.account, event.data.data.payout]);
        expect(refunds).toEqual([['bob', '12.5'], ['carol', '5']]);
    });
});

describe('Auction house custody', () => {
    let ts: TestStreamer;

    beforeEach(quiet);

    afterEach(async () => {
        await ts?.stop();
        jest.restoreAllMocks();
    });

    const setup = async (reservePrice: string) => {
        ts = await createTestStreamer({ username: 'auctions' });
        await ts.streamer.registerContract(createAuctionHouseContract());
        await ts.contractJson('alice', {
            contract: 'auctionhouse',
            action: 'createAuction',
            payload: { auctionId: 'a1', title: 'Painting', assetRef: 'nft:1', paymentAsset: 'HBD', reservePrice, endsAt: later(ts, 60_000) }
        });
    };

    const bid = (from: string, amount: string) => ts.contractTransfer({ from, amount, contract: 'auctionhouse', action: 'placeBid', payload: { auctionId: 'a1' } });
    const settle = () => ts.contractJson('alice', { contract: 'auctionhouse', action: 'settleAuction', payload: { auctionId: 'a1' } });
    const payouts = () => ts.outgoingTransfers.map((transfer) => [transfer.to, transfer.amount]);

    test('refunds the previous high bidder when outbid and pays the seller only on settlement', async () => {
        await setup('10.000');

        await bid('bob', '12.000 HBD');
        await bid('carol', '15.000 HBD');
        expect(payouts()).toEqual([['bob', '12.000 HBD']]);

        await ts.advanceTime('2m');
        await settle();

        expect(payouts()).toEqual([['bob', '12.000 HBD'], ['alice', '15.000 HBD']]);
        const rows = await ts.adapter.query('SELECT kind, status FROM auction_house_payouts ORDER BY id');
        expect(rows).toEqual([{ kind: 'outbid_refund', status: 'paid' }, { kind: 'sale', status: 'paid' }]);
    });

    test('refunds the high bidder when the reserve is not met', async () => {
        await setup('10.000');

        await bid('bob', '5.000 HBD');
        await ts.advanceTime('2m');
        await settle();

        expect(payouts()).toEqual([['bob', '5.000 HBD']]);
        expect((await ts.adapter.query('SELECT status FROM auction_house_auctions'))[0].status).toBe('ended');
    });

    test('refunds bids that do not beat the current bid or arrive after the end', async () => {
        await setup('1.000');

        await bid('bob', '5.000 HBD');
        await bid('carol', '5.000 HBD');
        await bid('dave', '3.000 HIVE');
        await ts.advanceTime('2m');
        await bid('erin', '50.000 HBD');

        expect(payouts()).toEqual([['carol', '5.000 HBD'], ['dave', '3.000 HIVE'], ['erin', '50.000 HBD']]);
        expect((await ts.adapter.query('SELECT highest_bidder FROM auction_house_auctions'))[0].highest_bidder).toBe('bob');
    });

    test('a failed payout stays pending and a later settle call retries it', async () => {
        await setup('1.000');

        await bid('bob', '5.000 HBD');
        await ts.advanceTime('2m');
        jest.spyOn(ts.client.broadcast, 'transfer').mockRejectedValueOnce(new Error('node down'));
        await settle();

        expect(await ts.adapter.query('SELECT kind, status FROM auction_house_payouts')).toEqual([{ kind: 'sale', status: 'pending' }]);

        await settle();

        expect(await ts.adapter.query('SELECT kind, status FROM auction_house_payouts')).toEqual([{ kind: 'sale', status: 'paid' }]);
        expect(payouts()).toEqual([['alice', '5.000 HBD']]);
    });
});

describe('Launchpad refunds', () => {
    let ts: TestStreamer;

    beforeEach(quiet);

    afterEach(async () => {
        await ts?.stop();
        jest.restoreAllMocks();
    });

    const setup = async (extra: Record<string, any> = {}) => {
        ts = await createTestStreamer({ username: 'launchpad' });
        await ts.streamer.registerContract(createLaunchpadContract());
        await ts.contractJson('alice', {
            contract: 'launchpad',
            action: 'createSale',
            payload: { saleId: 's1', title: 'Token sale', tokenSymbol: 'NEW', purchaseAsset: 'HIVE', unitPrice: '1.000', totalUnits: 10, closesAt: later(ts, 60_000), ...extra }
        });
    };

    const contribute = (from: string, amount: string) => ts.contractTransfer({ from, amount, contract: 'launchpad', action: 'contribute', payload: { saleId: 's1' } });
    const finalize = () => ts.contractJson('alice', { contract: 'launchpad', action: 'finalizeSale', payload: { saleId: 's1' } });
    const payouts = () => ts.outgoingTransfers.map((transfer) => [transfer.to, transfer.amount]);
    const allocations = async () => (await ts.adapter.query('SELECT buyer, units, amount_paid FROM launchpad_allocations ORDER BY buyer'))
        .map((row: any) => [row.buyer, Number(row.units), row.amount_paid]);

    test('fills what remains and refunds the rest, or the whole payment when nothing is left', async () => {
        await setup();

        await contribute('bob', '8.000 HIVE');
        await contribute('carol', '5.000 HIVE');
        await contribute('dave', '1.000 HIVE');

        expect(await allocations()).toEqual([['bob', 8, '8'], ['carol', 2, '2']]);
        expect(payouts()).toEqual([['carol', '3.000 HIVE'], ['dave', '1.000 HIVE']]);
        expect((await ts.adapter.query('SELECT units_sold FROM launchpad_sales'))[0].units_sold).toBe(10);
    });

    test('refunds the part of a payment that is not a whole unit', async () => {
        await setup();

        await contribute('bob', '2.500 HIVE');

        expect(await allocations()).toEqual([['bob', 2, '2']]);
        expect(payouts()).toEqual([['bob', '0.500 HIVE']]);
    });

    test('a sale that ends below its soft cap fails and refunds every contribution', async () => {
        await setup({ softCap: 5 });

        await contribute('bob', '3.000 HIVE');
        await contribute('carol', '1.000 HIVE');
        await ts.advanceTime('2m');
        await finalize();

        expect((await ts.adapter.query('SELECT status FROM launchpad_sales'))[0].status).toBe('failed');
        expect(payouts()).toEqual([['bob', '3.000 HIVE'], ['carol', '1.000 HIVE']]);
    });

    test('without a soft cap a sale with any units sold succeeds', async () => {
        await setup();

        await contribute('bob', '1.000 HIVE');
        await ts.advanceTime('2m');
        await finalize();

        expect((await ts.adapter.query('SELECT status FROM launchpad_sales'))[0].status).toBe('successful');
        expect(payouts()).toEqual([]);
    });
});
