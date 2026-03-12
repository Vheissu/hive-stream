import { Streamer } from 'hive-stream';

async function main() {
    const streamer = new Streamer({ env: true });

    streamer.flows.autoRefundIncomingTransfers({
        memo: ({ transfer }) => `Refunded ${transfer.rawAmount} to ${transfer.from}`
    });

    await streamer.start();
}

main().catch(console.error);
