// The custody side of a bridge: deposits to @mybridge are held until two of
// three operators attest that they were minted on the other chain.
import { Streamer, TimeAction, createBridgeContract } from 'hive-stream';
import { CUSTODY, bridgeRules } from './bridge-config';

const streamer = new Streamer({
    env: true,
    username: CUSTODY,
    streamMode: 'irreversible',   // the default; never credit a deposit that can be reverted
    errorPolicy: 'halt'
});

async function main() {
    await streamer.registerContract(createBridgeContract(bridgeRules));

    // Releases withdrawals that were queued by a pause or the daily limit.
    await streamer.registerAction(new TimeAction('1m', 'bridge-queue', 'bridge', 'processQueue'));

    streamer.enableGracefulShutdown();
    await streamer.start();
}

// Users deposit with a transfer to @mybridge and this memo:
// {"hive_stream":{"contract":"bridge","action":"deposit","payload":{"chain":"eth","address":"0x..."}}}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
