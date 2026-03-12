import { Streamer } from 'hive-stream';

async function main() {
    const streamer = new Streamer({ env: true });

    streamer.flows
        .incomingTransfers()
        .burn(69, 'Feel the burn')
        .remainderTo('treasury', 'Treasury remainder')
        .start();

    await streamer.start();
}

main().catch(console.error);
