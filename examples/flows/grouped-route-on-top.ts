import { Streamer } from 'hive-stream';

async function main() {
    const streamer = new Streamer({ env: true });

    streamer.flows.autoRouteIncomingTransfers({
        account: 'tweet-backup',
        routes: [
            { to: 'tweet-catcher', percentage: 20, memo: 'Tweet watcher share' },
            { group: [{ account: 'node-1' }, { account: 'node-2' }], percentage: 4, memo: 'Node operator share' },
            { group: [{ account: 'wit-1' }, { account: 'wit-2' }], percentage: 6, memo: 'Witness share' },
            { type: 'burn', percentage: 70, memo: 'Burn share' },
            { to: 'platform-op', mode: 'onTop', percentage: 8, memo: 'Optional platform donation' }
        ]
    });

    await streamer.start();
}

main().catch(console.error);
