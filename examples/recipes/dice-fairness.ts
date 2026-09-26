// A provably-fair dice game with bet limits, rate limiting and refunds for
// rejected bets. Run with ACTIVE_KEY, POSTING_KEY and USERNAME in .env.
import { Streamer, TimeAction, createDiceContract } from 'hive-stream';

const HOUSE = 'myhouse';

const streamer = new Streamer({
    env: true,
    username: HOUSE,
    // Stop at the failing block instead of skipping it: a payout bug should
    // page someone, not quietly move on.
    errorPolicy: 'halt'
});

const dice = createDiceContract({
    account: HOUSE,
    minBet: 1,
    maxBet: 50,
    fairness: {
        rotateAfter: 1000,
        // Publish each new commitment before anyone bets against it.
        onRotate: async ({ revealed, commitment }) => {
            await streamer.broadcastOperations([['custom_json', {
                id: 'mydice-fairness',
                required_auths: [],
                required_posting_auths: [HOUSE],
                json: JSON.stringify({ commitment, revealed })
            }]]);
        }
    }
});

async function main() {
    // Guards run before the handler. Bets over 50 HIVE or more than 10 a
    // minute from one account never reach the game.
    await streamer.registerContract({
        ...dice,
        guards: {
            allowedAssets: ['HIVE'],
            maxAmount: 50,
            rateLimit: { max: 10, windowSeconds: 60 }
        }
    });

    // Reveal yesterday's seed and commit to a new one every day.
    await streamer.registerAction(new TimeAction('24h', 'dice-rotate', 'hivedice', 'rotateSeed'));

    // Guards don't refund. Refund rejected bets once, even if the block is
    // replayed after a crash: the ledger key is written before the transfer.
    streamer.hook('onActionRejected', async ({ reason, context }) => {
        const transfer = context.transfer;

        if (!transfer || transfer.to !== HOUSE || reason === 'duplicate') {
            return;
        }

        const adapter = streamer.getAdapter();
        const key = `refund:${context.transaction.id}:${context.transaction.operationIndex ?? 0}`;

        if (await adapter.hasProcessedOperation(key)) {
            return;
        }

        await adapter.markOperationProcessed({
            key,
            blockNumber: context.block.number,
            transactionId: context.transaction.id,
            operationIndex: context.transaction.operationIndex,
            status: 'success'
        });

        await streamer.transferHiveTokens(HOUSE, transfer.from, transfer.amount, transfer.asset, `[Refund] ${reason}`);
    });

    streamer.enableGracefulShutdown();
    await streamer.start();
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
