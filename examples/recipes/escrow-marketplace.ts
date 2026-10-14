// A peer-to-peer marketplace settled through Hive's native escrow. The app
// account (@mymarket) is the escrow agent: it ratifies valid purchases and
// settles disputes, but never holds the buyer's funds.
import {
    Streamer,
    TimeAction,
    createContractCustomJsonOperation,
    createContractPayload,
    createEscrowMarketplaceContract
} from 'hive-stream';

const AGENT = 'mymarket';

const streamer = new Streamer({ env: true, username: AGENT });

async function main() {
    await streamer.registerContract(createEscrowMarketplaceContract({
        agentFeeBps: 100,       // buyers include a 1% agent fee in the escrow
        ratificationHours: 24,
        expirationDays: 30
    }));

    // Marks unratified and expired escrows.
    await streamer.registerAction(new TimeAction('1h', 'escrow-expiry', 'escrowmarket', 'expireTrades'));

    streamer.enableGracefulShutdown();
    await streamer.start();
}

// Buyer side (their own key): lock the price plus the agent fee in escrow,
// with the purchase in json_meta. The seller approves on chain; the agent
// approves automatically when the escrow matches the listing.
export async function buy(buyer: Streamer, from: string, seller: string, listingId: string) {
    const now = Date.now();

    await buyer.escrowTransfer({
        from,
        to: seller,
        agent: AGENT,
        escrow_id: Math.floor(now / 1000),
        hive_amount: '100.000 HIVE',
        fee: '1.000 HIVE',
        ratification_deadline: new Date(now + 12 * 60 * 60 * 1000),
        escrow_expiration: new Date(now + 31 * 24 * 60 * 60 * 1000),
        json_meta: createContractPayload({ contract: 'escrowmarket', action: 'openTrade', payload: { listingId } })
    });
}

// Happy path: once the item arrives the buyer releases the escrow to the
// seller themselves (escrow_release from the buyer); the contract sees the
// release on chain and marks the trade completed.

// After either party disputes, only the agent can release. Settle it with an
// active-key custom_json; the contract broadcasts escrow_release as the agent.
export async function refundBuyer(tradeId: string) {
    const operation = createContractCustomJsonOperation({
        contract: 'escrowmarket',
        action: 'resolveDispute',
        payload: { tradeId, receiver: 'buyer' }
    }, { sender: AGENT, authority: 'active' });

    await streamer.broadcastOperations([operation]);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
