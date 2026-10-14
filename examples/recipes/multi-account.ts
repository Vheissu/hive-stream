// One process, several Hive accounts: a storefront that takes payments, a
// treasury that holds the float, and an agent account used for escrow trades.
// Each account signs with its own keys; transfers to any of them run contract
// actions; a rejected payment is refunded by the account that received it.
import { Streamer, defineContract, action } from 'hive-stream';
import { z } from 'zod';

const streamer = new Streamer({
    env: true,                                    // HIVE_ACCOUNT=shop, HIVE_ACTIVE_KEY, HIVE_POSTING_KEY
    refundRejectedTransfers: true,
    accounts: [
        { name: 'shop-treasury', activeKey: process.env.TREASURY_ACTIVE_KEY },
        { name: 'shop-agent', activeKey: process.env.AGENT_ACTIVE_KEY, postingKey: process.env.AGENT_POSTING_KEY }
    ]
});

const storefront = defineContract({
    name: 'storefront',
    guards: { allowedAssets: ['HIVE', 'HBD'] },
    actions: {
        // Sent to `shop` or `shop-treasury`; ctx.transfer.to says which.
        buy: action(async (payload, ctx) => {
            if (!ctx.transfer) {
                return;   // only transfer-triggered, but keep the types honest
            }

            const paidTo = ctx.transfer.to;

            // Sweep storefront takings to the treasury; the transfer is signed
            // with the storefront's key because that is the account it's from.
            if (paidTo === 'shop') {
                await ctx.streamer.transferHiveTokens('shop', 'shop-treasury', ctx.transfer.amount, ctx.transfer.asset, `order ${payload.orderId}`);
            }

            // A thank-you reply is signed with the agent's posting key.
            await ctx.streamer.broadcastOperations([
                ['custom_json', {
                    id: 'shop-receipts',
                    json: JSON.stringify({ orderId: payload.orderId, buyer: ctx.sender, paidTo }),
                    required_auths: [],
                    required_posting_auths: ['shop-agent']
                }]
            ]);
        }, {
            trigger: 'transfer',
            schema: z.object({ orderId: z.string().min(1).max(40) }),
            guards: { minAmount: '1.000' }
        })
    }
});

export async function main() {
    await streamer.registerContract(storefront);

    streamer.onTransfer(['shop', 'shop-treasury'], (op, blockNumber, blockId, prevBlockId, trxId, blockTime, operationIndex) => {
        console.log(`${op.from} paid ${op.amount} to ${op.to} (${trxId}:${operationIndex})`);
    });

    console.log('acting as', streamer.getAppAccounts());   // ['shop', 'shop-treasury', 'shop-agent']
    streamer.enableGracefulShutdown();
    await streamer.start();
}
