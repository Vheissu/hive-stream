import { Streamer } from 'hive-stream';

async function main() {
    const streamer = new Streamer({ env: true });

    const flow = streamer.flows
        .incomingTransfers('tweet-backup')
        .forwardTo('tweet-catcher', 20, 'Tweet watcher share')
        .forwardGroup([{ account: 'node-1' }, { account: 'node-2' }], 4, { memo: 'Node operator share' })
        .remainderToGroup([{ account: 'wit-1' }, { account: 'wit-2' }], { memo: 'Witness share' })
        .burn(70, 'Burn share')
        .donateOnTop('platform-op', 8, 'Optional platform donation');

    const plan = flow.plan({
        from: 'buyer',
        to: 'tweet-backup',
        amount: '1.080 HBD',
        memo: 'Archive this tweet'
    });

    console.log(plan.baseAmount, plan.onTopAmount, plan.routes);

    flow.start();
    await streamer.start();
}

main().catch(console.error);
