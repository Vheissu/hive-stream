import { Streamer } from 'hive-stream';

async function main() {
    const streamer = new Streamer({ env: true });

    streamer.flows.autoForwardIncomingTransfers({
        to: 'treasury',
        percentage: 100,
        memo: ({ transaction }) => `Forwarded from ${transaction.id}`
    });

    await streamer.start();
}

main().catch(console.error);
