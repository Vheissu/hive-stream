import { TimeAction, createEscrowMarketplaceContract } from '../../src';
import { createTestStreamer, TestStreamer } from '../../src/testing';

const AGENT = 'market-agent';
const SELLER = 'seller';
const BUYER = 'buyer';
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const hiveTime = (date: Date) => date.toISOString().replace(/\.\d{3}Z$/, '');

describe('escrow marketplace contract', () => {
    let ts: TestStreamer;
    let escrowCounter = 0;

    const setup = async (options: Parameters<typeof createEscrowMarketplaceContract>[0] = {}) => {
        ts = await createTestStreamer({ username: AGENT });
        await ts.streamer.registerContract(createEscrowMarketplaceContract(options));
    };

    afterEach(async () => {
        await ts?.stop();
    });

    const createListing = (sender = SELLER, payload: Record<string, unknown> = {}) => ts.contractJson(sender, {
        contract: 'escrowmarket',
        action: 'createListing',
        payload: { listingId: 'guitar', title: 'Vintage guitar', price: '100.000', asset: 'HIVE', ...payload }
    });

    const escrowTransfer = (overrides: Record<string, any> = {}, listingId = 'guitar', transactionIds?: string[]) => {
        const now = ts.currentTime.getTime();
        escrowCounter++;

        return ts.sendOperations([['escrow_transfer', {
            from: BUYER,
            to: SELLER,
            agent: AGENT,
            escrow_id: escrowCounter,
            hive_amount: '100.000 HIVE',
            hbd_amount: '0.000 HBD',
            fee: '1.000 HIVE',
            ratification_deadline: hiveTime(new Date(now + 12 * HOUR)),
            escrow_expiration: hiveTime(new Date(now + 31 * DAY)),
            json_meta: JSON.stringify(ts.contractPayload('escrowmarket', 'openTrade', { listingId })),
            ...overrides
        }]], transactionIds ? { transactionIds } : {});
    };

    const escrowOp = (type: string, data: Record<string, any>, transactionIds?: string[]) => ts.sendOperations(
        [[type, { from: BUYER, to: SELLER, agent: AGENT, escrow_id: escrowCounter, ...data }]],
        transactionIds ? { transactionIds } : {}
    );

    const trades = () => ts.adapter.query('SELECT * FROM escrowmarket_trades ORDER BY created_at, trade_id');
    const listing = async (id = 'guitar') => (await ts.adapter.query('SELECT * FROM escrowmarket_listings WHERE listing_id = ?', [id]))[0];
    const approvals = () => ts.client.operationsOfType('escrow_approve');
    const releases = () => ts.client.operationsOfType('escrow_release');

    /** Opens a trade and ratifies it on chain (seller and agent approvals). */
    const openActiveTrade = async () => {
        await createListing();
        const opened = await escrowTransfer();
        await escrowOp('escrow_approve', { who: SELLER, approve: true });
        await escrowOp('escrow_approve', { who: AGENT, approve: true });
        return opened.transactionId;
    };

    test('creates and cancels listings; only the seller may cancel', async () => {
        await setup();
        await createListing();

        expect(await listing()).toEqual(expect.objectContaining({ seller: SELLER, price: '100.000', asset: 'HIVE', status: 'open' }));

        // Unsupported asset is refused.
        await createListing(SELLER, { listingId: 'bad', asset: 'BEE' });
        expect(await listing('bad')).toBeUndefined();

        await ts.contractJson('mallory', { contract: 'escrowmarket', action: 'cancelListing', payload: { listingId: 'guitar' } });
        expect((await listing()).status).toBe('open');

        await ts.contractJson(SELLER, { contract: 'escrowmarket', action: 'cancelListing', payload: { listingId: 'guitar' } });
        expect((await listing()).status).toBe('cancelled');
    });

    test('a valid escrow opens a trade, the agent approves it, and the listing is reserved', async () => {
        await setup();
        await createListing();
        const { transactionId } = await escrowTransfer();

        const [trade] = await trades();
        expect(trade).toEqual(expect.objectContaining({
            trade_id: transactionId,
            listing_id: 'guitar',
            buyer: BUYER,
            seller: SELLER,
            agent: AGENT,
            status: 'pending_approval',
            hive_amount: '100.000',
            fee: '1.000 HIVE',
            agent_approval_sent: 1
        }));
        expect(approvals()).toEqual([expect.objectContaining({ from: BUYER, to: SELLER, agent: AGENT, who: AGENT, escrow_id: escrowCounter, approve: true })]);
        expect((await listing()).status).toBe('reserved');

        // A reserved listing cannot be cancelled.
        await ts.contractJson(SELLER, { contract: 'escrowmarket', action: 'cancelListing', payload: { listingId: 'guitar' } });
        expect((await listing()).status).toBe('reserved');

        await escrowOp('escrow_approve', { who: SELLER, approve: true });
        expect((await trades())[0].status).toBe('pending_approval');

        await escrowOp('escrow_approve', { who: AGENT, approve: true });
        expect((await trades())[0]).toEqual(expect.objectContaining({ status: 'active', seller_approved: 1, agent_approved: 1 }));
    });

    test('autoApprove off waits for the agent to call approveTrade', async () => {
        await setup({ autoApprove: false });
        await createListing();
        const { transactionId } = await escrowTransfer();

        expect(approvals()).toHaveLength(0);

        await ts.contractJson('mallory', { contract: 'escrowmarket', action: 'approveTrade', payload: { tradeId: transactionId }, activeKey: true });
        expect(approvals()).toHaveLength(0);

        await ts.contractJson(AGENT, { contract: 'escrowmarket', action: 'approveTrade', payload: { tradeId: transactionId }, activeKey: true });
        expect(approvals()).toHaveLength(1);
    });

    test.each([
        ['the agent is another account', { agent: 'someone-else' }, 'guitar', /agent must be market-agent/],
        ['the amount is below the price', { hive_amount: '99.999 HIVE' }, 'guitar', /at least 100.000 HIVE/],
        ['the asset is wrong', { hive_amount: '0.000 HIVE', hbd_amount: '100.000 HBD' }, 'guitar', /at least 100.000 HIVE/],
        ['the agent fee is too low', { fee: '0.500 HIVE' }, 'guitar', /fee must be at least 1.000 HIVE/],
        ['the escrow is too short', { escrow_expiration: '__short__' }, 'guitar', /at least 30 days/],
        ['the listing does not exist', {}, 'missing', /does not exist/]
    ])('rejects without broadcasting when %s', async (_label, overrides, listingId, reason) => {
        await setup();
        await createListing();

        const patch: Record<string, any> = { ...overrides };

        if (patch.escrow_expiration === '__short__') {
            patch.escrow_expiration = hiveTime(new Date(ts.currentTime.getTime() + 2 * DAY));
        }

        await escrowTransfer(patch, listingId);

        const [trade] = await trades();
        expect(trade.status).toBe('rejected');
        expect(trade.status_reason).toMatch(reason);
        expect(ts.broadcasts).toHaveLength(0);
        expect((await listing()).status).toBe('open');

        const events = await ts.getEvents();
        expect(events.some((event: any) => JSON.stringify(event).includes('escrowmarket_trade_rejected'))).toBe(true);
    });

    test('only the seller can mark shipped; buyer release completes the trade and sells the listing', async () => {
        await setup();
        const tradeId = await openActiveTrade();

        await ts.contractJson(BUYER, { contract: 'escrowmarket', action: 'markShipped', payload: { tradeId } });
        expect((await trades())[0].status).toBe('active');

        await ts.contractJson(SELLER, { contract: 'escrowmarket', action: 'markShipped', payload: { tradeId } });
        expect((await trades())[0].status).toBe('shipped');

        await ts.contractJson(SELLER, { contract: 'escrowmarket', action: 'confirmDelivery', payload: { tradeId } });
        expect((await trades())[0].status).toBe('shipped');

        await ts.contractJson(BUYER, { contract: 'escrowmarket', action: 'confirmDelivery', payload: { tradeId } });
        expect((await trades())[0].status).toBe('delivered');

        await escrowOp('escrow_release', { who: BUYER, receiver: SELLER, hive_amount: '100.000 HIVE', hbd_amount: '0.000 HBD' });

        expect((await trades())[0]).toEqual(expect.objectContaining({ status: 'completed', remaining_hive: '0.000' }));
        expect((await listing()).status).toBe('sold');
    });

    test('a dispute hands control to the agent, who releases to the chosen party', async () => {
        await setup();
        const tradeId = await openActiveTrade();

        await escrowOp('escrow_dispute', { who: BUYER });
        expect((await trades())[0]).toEqual(expect.objectContaining({ status: 'disputed', disputed_by: BUYER }));

        // Not the agent: ignored.
        await ts.contractJson(SELLER, { contract: 'escrowmarket', action: 'resolveDispute', payload: { tradeId, receiver: 'seller' }, activeKey: true });
        expect(releases()).toHaveLength(0);

        await ts.contractJson(AGENT, { contract: 'escrowmarket', action: 'resolveDispute', payload: { tradeId, receiver: 'buyer' }, activeKey: true });

        expect(releases()).toEqual([expect.objectContaining({
            from: BUYER,
            to: SELLER,
            agent: AGENT,
            who: AGENT,
            receiver: BUYER,
            hive_amount: '100.000 HIVE',
            hbd_amount: '0.000 HBD'
        })]);
        expect((await trades())[0]).toEqual(expect.objectContaining({ status: 'resolved', resolution_receiver: BUYER }));
        expect((await listing()).status).toBe('open');

        // A second resolution is refused.
        await ts.contractJson(AGENT, { contract: 'escrowmarket', action: 'resolveDispute', payload: { tradeId, receiver: 'seller' }, activeKey: true });
        expect(releases()).toHaveLength(1);

        // The agent's release landing on chain only settles the balance.
        await escrowOp('escrow_release', { who: AGENT, receiver: BUYER, hive_amount: '100.000 HIVE', hbd_amount: '0.000 HBD' });
        expect((await trades())[0]).toEqual(expect.objectContaining({ status: 'resolved', remaining_hive: '0.000' }));
    });

    test('resolution to the seller with a partial amount keeps the trade disputed', async () => {
        await setup();
        const tradeId = await openActiveTrade();
        await escrowOp('escrow_dispute', { who: SELLER });

        await ts.contractJson(AGENT, { contract: 'escrowmarket', action: 'resolveDispute', payload: { tradeId, receiver: 'seller', hiveAmount: '60.000' }, activeKey: true });

        expect(releases()).toEqual([expect.objectContaining({ receiver: SELLER, hive_amount: '60.000 HIVE', hbd_amount: '0.000 HBD' })]);
        expect((await trades())[0].status).toBe('disputed');

        await escrowOp('escrow_release', { who: AGENT, receiver: SELLER, hive_amount: '60.000 HIVE', hbd_amount: '0.000 HBD' });
        expect((await trades())[0]).toEqual(expect.objectContaining({ status: 'disputed', remaining_hive: '40.000' }));

        await ts.contractJson(AGENT, { contract: 'escrowmarket', action: 'resolveDispute', payload: { tradeId, receiver: 'buyer' }, activeKey: true });
        expect(releases()[1]).toEqual(expect.objectContaining({ receiver: BUYER, hive_amount: '40.000 HIVE' }));
        expect((await trades())[0].status).toBe('resolved');
    });

    test('expires unratified escrows and reopens the listing', async () => {
        await setup();
        await ts.streamer.registerAction(new TimeAction('1h', 'escrow-expiry', 'escrowmarket', 'expireTrades'));
        await createListing();
        await escrowTransfer();

        await ts.advanceTime('2h');
        expect((await trades())[0].status).toBe('pending_approval');

        await ts.advanceTime('11h');
        expect((await trades())[0]).toEqual(expect.objectContaining({ status: 'expired', status_reason: 'not_ratified' }));
        expect((await listing()).status).toBe('open');
    });

    test('a declined escrow closes the trade', async () => {
        await setup();
        await createListing();
        await escrowTransfer();
        await escrowOp('escrow_approve', { who: SELLER, approve: false });

        expect((await trades())[0].status).toBe('declined');
        expect((await listing()).status).toBe('open');
    });

    test('replayed operations are not processed twice', async () => {
        await setup();
        await createListing();

        const trx = 'a'.repeat(40);
        await escrowTransfer({}, 'guitar', [trx]);
        const escrowId = escrowCounter;
        escrowCounter--;
        // Same transaction id in a later block: same trade id, so no second trade or approval.
        await escrowTransfer({ escrow_id: escrowId }, 'guitar', [trx]);

        expect(await trades()).toHaveLength(1);
        expect(approvals()).toHaveLength(1);

        await escrowOp('escrow_approve', { who: SELLER, approve: true });
        await escrowOp('escrow_approve', { who: AGENT, approve: true });

        const releaseTrx = 'b'.repeat(40);
        await escrowOp('escrow_release', { who: BUYER, receiver: SELLER, hive_amount: '50.000 HIVE', hbd_amount: '0.000 HBD' }, [releaseTrx]);
        await escrowOp('escrow_release', { who: BUYER, receiver: SELLER, hive_amount: '50.000 HIVE', hbd_amount: '0.000 HBD' }, [releaseTrx]);

        expect((await trades())[0]).toEqual(expect.objectContaining({ status: 'active', remaining_hive: '50.000' }));
    });

    test('validates options', () => {
        expect(() => createEscrowMarketplaceContract({ agentFeeBps: -1 })).toThrow('agentFeeBps');
        expect(() => createEscrowMarketplaceContract({ allowedAssets: ['BEE'] })).toThrow('allowedAssets');
        expect(() => createEscrowMarketplaceContract({ expirationDays: 0 })).toThrow('expirationDays');
    });
});
