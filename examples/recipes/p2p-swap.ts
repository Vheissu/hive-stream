// A peer-to-peer swap desk run by @swapdesk.
//
// HIVE <-> HBD offers never touch the desk's balance: the taker locks the
// buy side in a Hive escrow to the maker with @swapdesk as agent, the maker
// pays the sell side straight to the taker, and the desk then approves the
// escrow. Offers involving a Hive Engine token settle through @swapdesk:
// the maker deposits the sell side, the taker pays the buy side, and the
// desk pays both out. Offers are all-or-nothing.
import { Streamer, TimeAction, createP2PSwapContract } from 'hive-stream';
import {
    createContractCustomJsonOperation,
    createContractMemo,
    createContractPayload,
    createContractTransferOperation
} from 'hive-stream/client';

const DESK = 'swapdesk';

const streamer = new Streamer({
    env: true,
    username: DESK,
    streamMode: 'irreversible',
    errorPolicy: 'halt'
});

async function main() {
    await streamer.registerContract(createP2PSwapContract({
        feeBps: 50,
        allowedTokens: ['BEE', 'SWAP.HIVE'],
        offerTtlHours: 48
    }));

    // Expires untaken offers (refunding token deposits) and hands escrows
    // back to takers whose maker did not pay in time.
    await streamer.registerAction(new TimeAction('1m', 'p2pswap-expire', 'p2pswap', 'expireOffers'));

    streamer.enableGracefulShutdown();
    await streamer.start();
}

// ─── Client side: the operations makers and takers sign ─────────────────

/** Maker: post an offer (posting authority is enough; no funds move). */
export function postOffer(maker: string, offerId: string, sell: { asset: string; amount: string }, buy: { asset: string; amount: string }) {
    return createContractCustomJsonOperation(
        { contract: 'p2pswap', action: 'createOffer', payload: { offerId, sell, buy } },
        { sender: maker }
    );
}

/** Taker of a HIVE/HBD offer: lock the buy side in escrow to the maker, with the desk as agent. */
export function takeEscrowOffer(taker: string, maker: string, offerId: string, buy: { asset: 'HIVE' | 'HBD'; amount: string }, escrowId: number, now = new Date()): ['escrow_transfer', Record<string, unknown>] {
    const hours = (count: number) => new Date(now.getTime() + count * 60 * 60 * 1000).toISOString().slice(0, 19);
    // With feeBps set, the agent fee must be at least feeBps of the buy amount, in the buy asset.
    const fee = (Number(buy.amount) * 50 / 10000).toFixed(3);

    return ['escrow_transfer', {
        from: taker,
        to: maker,
        agent: DESK,
        escrow_id: escrowId,
        hive_amount: buy.asset === 'HIVE' ? `${buy.amount} HIVE` : '0.000 HIVE',
        hbd_amount: buy.asset === 'HBD' ? `${buy.amount} HBD` : '0.000 HBD',
        fee: `${fee} ${buy.asset}`,
        // The maker must pay before this deadline (minus a 5 minute margin).
        ratification_deadline: hours(2),
        escrow_expiration: hours(72),
        json_meta: JSON.stringify(createContractPayload({ contract: 'p2pswap', action: 'takeOffer', payload: { offerId } }))
    }];
}

/** Maker of a HIVE/HBD offer: pay the sell side straight to the taker. */
export function settleEscrowOffer(maker: string, taker: string, offerId: string, sellAmount: string) {
    return createContractTransferOperation(
        { contract: 'p2pswap', action: 'settle', payload: { offerId } },
        { from: maker, to: taker, amount: sellAmount }
    );
}

/** Maker of a token offer: deposit the tokens with the desk (active authority). */
export function fundTokenOffer(maker: string, offerId: string, symbol: string, quantity: string): ['custom_json', Record<string, unknown>] {
    return ['custom_json', {
        required_auths: [maker],
        required_posting_auths: [],
        id: 'ssc-mainnet-hive',
        json: JSON.stringify({
            contractName: 'tokens',
            contractAction: 'transfer',
            contractPayload: {
                symbol,
                to: DESK,
                quantity,
                memo: createContractMemo({ contract: 'p2pswap', action: 'fundOffer', payload: { offerId } })
            }
        })
    }];
}

/** Taker of a token offer: pay the HIVE/HBD side to the desk. */
export function takeTokenOffer(taker: string, offerId: string, buyAmount: string) {
    return createContractTransferOperation(
        { contract: 'p2pswap', action: 'takeOffer', payload: { offerId } },
        { from: taker, to: DESK, amount: buyAmount }
    );
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
