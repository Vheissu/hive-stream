import { TimeAction, createP2PSwapContract } from '../../src';
import { createTestStreamer, TestStreamer } from '../../src/testing';

const DESK = 'swapdesk';
const HOUR = 60 * 60 * 1000;

const hiveTime = (date: Date) => date.toISOString().slice(0, 19);

describe('p2p swap contract', () => {
    let ts: TestStreamer;

    const offerRow = async (offerId: string) => (await ts.adapter.query('SELECT * FROM p2pswap_offers WHERE offer_id = ?', [offerId]))[0];
    const payoutRow = async (payoutId: string) => (await ts.adapter.query('SELECT * FROM p2pswap_payouts WHERE payout_id = ?', [payoutId]))[0];

    const createOffer = (maker: string, payload: Record<string, any>) =>
        ts.contractJson(maker, { contract: 'p2pswap', action: 'createOffer', payload });

    const engineTransfer = (from: string, symbol: string, quantity: string, memo: string): ['custom_json', any] => [
        'custom_json',
        {
            id: ts.config.HIVE_ENGINE_ID,
            json: JSON.stringify({
                contractName: 'tokens',
                contractAction: 'transfer',
                contractPayload: { symbol, to: DESK, quantity, memo }
            }),
            required_auths: [from],
            required_posting_auths: []
        }
    ];

    const escrowTransfer = (from: string, to: string, escrowId: number, amounts: { hive?: string; hbd?: string }, offerId: string, extra: Record<string, any> = {}): ['escrow_transfer', any] => [
        'escrow_transfer',
        {
            from,
            to,
            agent: DESK,
            escrow_id: escrowId,
            hive_amount: amounts.hive ?? '0.000 HIVE',
            hbd_amount: amounts.hbd ?? '0.000 HBD',
            fee: '0.250 HBD',
            ratification_deadline: hiveTime(new Date(ts.currentTime.getTime() + 2 * HOUR)),
            escrow_expiration: hiveTime(new Date(ts.currentTime.getTime() + 48 * HOUR)),
            json_meta: JSON.stringify(ts.contractPayload('p2pswap', 'takeOffer', { offerId })),
            ...extra
        }
    ];

    const engineTransfersSent = () => ts.client.customJsons
        .filter((op) => op.id === ts.config.HIVE_ENGINE_ID)
        .map((op) => JSON.parse(op.json).contractPayload);

    /** Alice offers 50 BEE for 10 HIVE and deposits the tokens. */
    const fundedTokenOffer = async (offerId = 'bee-1') => {
        await createOffer('alice', { offerId, sell: { asset: 'BEE', amount: '50' }, buy: { asset: 'HIVE', amount: '10.000' } });
        await ts.sendOperations([engineTransfer('alice', 'BEE', '50', ts.contractMemo('p2pswap', 'fundOffer', { offerId }))]);
        expect((await offerRow(offerId)).status).toBe('funded');
    };

    beforeEach(async () => {
        ts = await createTestStreamer({ username: DESK });
        ts.streamer['hiveEngineVerifyDelayMs'] = 0;
        jest.spyOn(ts.streamer['hive'], 'getTransactionInfo').mockResolvedValue({ logs: JSON.stringify({ events: [] }) } as any);
        jest.spyOn(console, 'error').mockImplementation(() => undefined);
        jest.spyOn(console, 'warn').mockImplementation(() => undefined);
        await ts.streamer.registerContract(createP2PSwapContract({ feeBps: 100 }));
    });

    afterEach(async () => {
        await ts.stop();
        jest.restoreAllMocks();
    });

    test('validates options', () => {
        expect(() => createP2PSwapContract({ feeBps: 5000 })).toThrow('feeBps');
        expect(() => createP2PSwapContract({ offerTtlHours: 0 })).toThrow('offerTtlHours');
        expect(() => createP2PSwapContract({ allowedAssets: ['BEE'] })).toThrow('allowedTokens');
        expect(createP2PSwapContract().name).toBe('p2pswap');
    });

    test('escrow mode: the maker pays the taker, the agent approves, a dispute releases to the maker', async () => {
        await createOffer('alice', { offerId: 'hbd-1', sell: { asset: 'HIVE', amount: '100' }, buy: { asset: 'HBD', amount: '25' } });
        expect(await offerRow('hbd-1')).toEqual(expect.objectContaining({ mode: 'escrow', status: 'open', sell_amount: '100.000', buy_amount: '25.000' }));

        await ts.sendOperations([escrowTransfer('bob', 'alice', 7, { hbd: '25.000 HBD' }, 'hbd-1')]);

        // The agent waits for the maker's leg before approving anything.
        expect(ts.broadcasts).toHaveLength(0);
        expect(await offerRow('hbd-1')).toEqual(expect.objectContaining({ status: 'taken', taker: 'bob', escrow_id: 7 }));

        await ts.contractTransfer({ from: 'alice', to: 'bob', amount: '100.000 HIVE', contract: 'p2pswap', action: 'settle', payload: { offerId: 'hbd-1' } });

        expect((await offerRow('hbd-1')).status).toBe('settled');
        expect(ts.outgoingTransfers).toHaveLength(0);
        expect(ts.client.operationsOfType('escrow_approve')).toEqual([
            { from: 'bob', to: 'alice', agent: DESK, who: DESK, escrow_id: 7, approve: true }
        ]);

        await ts.sendOperations([['escrow_dispute', { from: 'bob', to: 'alice', agent: DESK, who: 'bob', escrow_id: 7 }]]);

        expect(ts.client.operationsOfType('escrow_release')).toEqual([
            { from: 'bob', to: 'alice', agent: DESK, who: DESK, receiver: 'alice', escrow_id: 7, hive_amount: '0.000 HIVE', hbd_amount: '25.000 HBD' }
        ]);
    });

    test('escrow mode: a mismatched escrow is rejected and the offer stays open', async () => {
        await createOffer('alice', { offerId: 'hbd-2', sell: { asset: 'HIVE', amount: '100' }, buy: { asset: 'HBD', amount: '25' } });

        await ts.sendOperations([escrowTransfer('bob', 'alice', 8, { hbd: '20.000 HBD' }, 'hbd-2')]);
        await ts.sendOperations([escrowTransfer('carol', 'alice', 9, { hbd: '25.000 HBD' }, 'hbd-2', { fee: '0.001 HBD' })]);

        expect(ts.client.operationsOfType('escrow_approve')).toEqual([
            { from: 'bob', to: 'alice', agent: DESK, who: DESK, escrow_id: 8, approve: false },
            { from: 'carol', to: 'alice', agent: DESK, who: DESK, escrow_id: 9, approve: false }
        ]);
        expect((await offerRow('hbd-2')).status).toBe('open');

        const events = (await ts.getEvents()).filter((event: any) => event.data?.action === 'p2pswap_escrow_rejected');
        expect(events.map((event: any) => event.data.data.reason)).toEqual([
            'The escrow must hold exactly 25.000 HBD',
            'The escrow agent fee must be at least 0.250 HBD'
        ]);
    });

    test('escrow mode: when the maker does not pay in time the escrow goes back to the taker', async () => {
        await ts.streamer.registerAction(new TimeAction('1m', 'p2pswap-expire', 'p2pswap', 'expireOffers'));
        await createOffer('alice', { offerId: 'hbd-3', sell: { asset: 'HIVE', amount: '100' }, buy: { asset: 'HBD', amount: '25' } });
        await ts.sendOperations([escrowTransfer('bob', 'alice', 10, { hbd: '25.000 HBD' }, 'hbd-3')]);

        await ts.advanceTime('116m');

        expect((await offerRow('hbd-3')).status).toBe('lapsed');
        expect(ts.client.operationsOfType('escrow_approve')).toEqual([
            { from: 'bob', to: 'alice', agent: DESK, who: DESK, escrow_id: 10, approve: false }
        ]);

        // A late payment is recorded but can no longer unlock the escrow.
        await ts.contractTransfer({ from: 'alice', to: 'bob', amount: '100.000 HIVE', contract: 'p2pswap', action: 'settle', payload: { offerId: 'hbd-3' } });
        expect(ts.client.operationsOfType('escrow_approve')).toHaveLength(1);
        expect(ts.outgoingTransfers).toHaveLength(0);
    });

    test('custodial mode: deposits tokens, takes HIVE and pays both sides minus the fee', async () => {
        await fundedTokenOffer();

        await ts.contractTransfer({ from: 'bob', amount: '10.000 HIVE', contract: 'p2pswap', action: 'takeOffer', payload: { offerId: 'bee-1' } });

        expect(await offerRow('bee-1')).toEqual(expect.objectContaining({ status: 'filled', taker: 'bob', fee: '0.100 HIVE' }));
        expect(engineTransfersSent()).toEqual([
            { symbol: 'BEE', to: 'bob', quantity: '50', memo: '[P2P swap] Offer bee-1 filled' }
        ]);
        expect(ts.outgoingTransfers).toEqual([
            { from: DESK, to: 'alice', amount: '9.900 HIVE', memo: '[P2P swap] Offer bee-1 filled' }
        ]);
    });

    test('custodial mode: a mismatched taker payment is refunded and the offer stays funded', async () => {
        await fundedTokenOffer();

        await ts.contractTransfer({ from: 'bob', amount: '9.000 HIVE', contract: 'p2pswap', action: 'takeOffer', payload: { offerId: 'bee-1' } });
        await ts.contractTransfer({ from: 'carol', amount: '10.000 HBD', contract: 'p2pswap', action: 'takeOffer', payload: { offerId: 'bee-1' } });
        await ts.contractTransfer({ from: 'dave', amount: '10.000 HIVE', contract: 'p2pswap', action: 'takeOffer', payload: { offerId: 'nope' } });

        expect(ts.outgoingTransfers).toEqual([
            { from: DESK, to: 'bob', amount: '9.000 HIVE', memo: '[P2P swap refund] Offer bee-1 must be taken with exactly 10.000 HIVE' },
            { from: DESK, to: 'carol', amount: '10.000 HBD', memo: '[P2P swap refund] Offer bee-1 must be taken with exactly 10.000 HIVE' },
            { from: DESK, to: 'dave', amount: '10.000 HIVE', memo: '[P2P swap refund] Unknown offer nope' }
        ]);
        expect(engineTransfersSent()).toHaveLength(0);
        expect((await offerRow('bee-1')).status).toBe('funded');
    });

    test('custodial mode: a token deposit from someone other than the maker is refunded in tokens', async () => {
        await createOffer('alice', { offerId: 'bee-2', sell: { asset: 'BEE', amount: '50' }, buy: { asset: 'HIVE', amount: '10.000' } });
        await ts.sendOperations([engineTransfer('mallory', 'BEE', '50', ts.contractMemo('p2pswap', 'fundOffer', { offerId: 'bee-2' }))]);

        expect(engineTransfersSent()).toEqual([
            { symbol: 'BEE', to: 'mallory', quantity: '50', memo: '[P2P swap refund] Only @alice can fund offer bee-2' }
        ]);
        expect((await offerRow('bee-2')).status).toBe('open');
    });

    test('a failed payout is kept and re-sent by retryPayouts from the app account only', async () => {
        await fundedTokenOffer();
        jest.spyOn(ts.streamer, 'transferHiveTokens').mockRejectedValueOnce(new Error('broadcast timeout'));

        await ts.contractTransfer({ from: 'bob', amount: '10.000 HIVE', contract: 'p2pswap', action: 'takeOffer', payload: { offerId: 'bee-1' } });

        expect((await offerRow('bee-1')).status).toBe('filled');
        expect(await payoutRow('bee-1:taker')).toEqual(expect.objectContaining({ status: 'paid', attempts: 1 }));
        expect(await payoutRow('bee-1:maker')).toEqual(expect.objectContaining({ status: 'failed', last_error: 'broadcast timeout' }));
        expect(ts.outgoingTransfers).toHaveLength(0);

        await ts.contractJson('mallory', { contract: 'p2pswap', action: 'retryPayouts', payload: {}, activeKey: true });
        expect((await payoutRow('bee-1:maker')).status).toBe('failed');

        await ts.contractJson(DESK, { contract: 'p2pswap', action: 'retryPayouts', payload: {}, activeKey: true });

        expect(await payoutRow('bee-1:maker')).toEqual(expect.objectContaining({ status: 'paid', attempts: 2 }));
        expect(ts.outgoingTransfers).toEqual([
            { from: DESK, to: 'alice', amount: '9.900 HIVE', memo: '[P2P swap] Offer bee-1 filled' }
        ]);
        // The token leg already landed and is not sent again.
        expect(engineTransfersSent()).toHaveLength(1);
    });

    test('replayed operations are ignored', async () => {
        await createOffer('alice', { offerId: 'bee-3', sell: { asset: 'BEE', amount: '50' }, buy: { asset: 'HIVE', amount: '10.000' } });
        const time = new Date(ts.currentTime.getTime() + 3000);
        const fund = engineTransfer('alice', 'BEE', '50', ts.contractMemo('p2pswap', 'fundOffer', { offerId: 'bee-3' }));

        // No operation index, so the streamer's own ledger cannot catch the replay.
        await ts.streamer.processOperation(fund, 500, 'block-500', 'block-499', 'trx-fund', time);
        await ts.streamer.processOperation(fund, 500, 'block-500', 'block-499', 'trx-fund', time);

        expect((await offerRow('bee-3')).status).toBe('funded');
        expect(engineTransfersSent()).toHaveLength(0);

        const take: ['transfer', any] = ['transfer', {
            from: 'bob',
            to: DESK,
            amount: '10.000 HIVE',
            memo: ts.contractMemo('p2pswap', 'takeOffer', { offerId: 'bee-3' })
        }];

        await ts.streamer.processOperation(take, 501, 'block-501', 'block-500', 'trx-take', time);
        await ts.streamer.processOperation(take, 501, 'block-501', 'block-500', 'trx-take', time);

        expect(engineTransfersSent()).toHaveLength(1);
        expect(ts.outgoingTransfers).toEqual([
            { from: DESK, to: 'alice', amount: '9.900 HIVE', memo: '[P2P swap] Offer bee-3 filled' }
        ]);
    });

    test('only the maker can cancel; cancelling a funded offer refunds the deposit', async () => {
        await fundedTokenOffer();

        await ts.contractJson('mallory', { contract: 'p2pswap', action: 'cancelOffer', payload: { offerId: 'bee-1' } });
        expect((await offerRow('bee-1')).status).toBe('funded');
        expect(engineTransfersSent()).toHaveLength(0);

        await ts.contractJson('alice', { contract: 'p2pswap', action: 'cancelOffer', payload: { offerId: 'bee-1' } });
        expect((await offerRow('bee-1')).status).toBe('cancelled');
        expect(engineTransfersSent()).toEqual([
            { symbol: 'BEE', to: 'alice', quantity: '50', memo: '[P2P swap] Offer bee-1 cancelled' }
        ]);

        // A take after cancellation is refunded.
        await ts.contractTransfer({ from: 'bob', amount: '10.000 HIVE', contract: 'p2pswap', action: 'takeOffer', payload: { offerId: 'bee-1' } });
        expect(ts.outgoingTransfers).toEqual([
            { from: DESK, to: 'bob', amount: '10.000 HIVE', memo: '[P2P swap refund] Offer bee-1 is cancelled' }
        ]);
    });

    test('expired funded offers refund the maker', async () => {
        await ts.streamer.registerAction(new TimeAction('1m', 'p2pswap-expire', 'p2pswap', 'expireOffers'));
        await createOffer('alice', { offerId: 'bee-4', sell: { asset: 'BEE', amount: '50' }, buy: { asset: 'HIVE', amount: '10.000' }, expiresAt: new Date(ts.currentTime.getTime() + HOUR).toISOString() });
        await ts.sendOperations([engineTransfer('alice', 'BEE', '50', ts.contractMemo('p2pswap', 'fundOffer', { offerId: 'bee-4' }))]);

        await ts.advanceTime('61m');

        expect((await offerRow('bee-4')).status).toBe('expired');
        expect(engineTransfersSent()).toEqual([
            { symbol: 'BEE', to: 'alice', quantity: '50', memo: '[P2P swap] Offer bee-4 expired' }
        ]);
    });
});
