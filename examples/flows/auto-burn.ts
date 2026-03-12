import { Streamer } from 'hive-stream';

async function main() {
    const streamer = new Streamer({ env: true });

    streamer.flows.autoBurnIncomingTransfers({
        percentage: 67,
        memo: ({ transaction }) => `Auto-burn 67% of ${transaction.id}`
    });

    await streamer.start();
}

main().catch(console.error);
