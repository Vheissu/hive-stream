import { Streamer } from 'hive-stream';

async function main() {
    const streamer = new Streamer({ env: true });

    streamer.flows.autoSplitIncomingTransfers({
        recipients: [
            { account: 'null', percentage: 69, memo: 'Feel the burn' },
            { account: 'treasury' }
        ]
    });

    await streamer.start();
}

main().catch(console.error);
