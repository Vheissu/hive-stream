// Tips for a community account, with a public thank-you reply for each tip
// and metrics from streamer hooks.
import { Streamer, createTipJarContract, defineHooks } from 'hive-stream';

const APP = 'mycommunity';
const THANKS_PERMLINK = 'tip-jar';   // a post by @mycommunity that collects the replies

const streamer = new Streamer({ env: true, username: APP });

const tipMetrics = defineHooks({
    afterContractAction: ({ contract, action, durationMs }) => {
        console.log(`[metrics] ${contract}.${action} took ${durationMs}ms`);
    },
    onError: ({ error, phase, fatal }) => {
        console.error(`[alert] ${phase}${fatal ? ' (fatal)' : ''}: ${error.message}`);
    }
});

async function main() {
    await streamer.registerContract(createTipJarContract());
    streamer.use(tipMetrics);

    // Thank tippers in public instead of sending dust transfers back.
    streamer.hook('afterContractAction', async ({ contract, action, context }) => {
        if (contract !== 'tipjar' || action !== 'tip' || context.transfer?.to !== APP) {
            return;
        }

        const { from, amount, asset } = context.transfer;

        await streamer.ops.post()
            .author(APP)
            .parentAuthor(APP)
            .parentPermlink(THANKS_PERMLINK)
            .body(`Thanks @${from} for the ${amount} ${asset} tip!`)
            .send();
    });

    // Plain subscriptions still work alongside contracts, e.g. to index
    // replies in your community's threads.
    streamer.onComment((comment) => {
        if (comment.parent_author === APP) {
            console.log(`@${comment.author} replied to ${comment.parent_permlink}`);
        }
    });

    streamer.enableGracefulShutdown();
    await streamer.start();
}

// Tip memo: {"hive_stream":{"contract":"tipjar","action":"tip","payload":{"message":"great stream"}}}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
