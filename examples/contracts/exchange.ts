import { Streamer, TimeAction, createExchangeContract } from 'hive-stream';
import { SqliteAdapter } from 'hive-stream';

async function main() {
    const streamer = new Streamer({
        JSON_ID: 'hivestream',
        PAYLOAD_IDENTIFIER: 'hive_stream'
    });

    await streamer.registerAdapter(new SqliteAdapter());
    await streamer.registerContract(createExchangeContract({
        name: 'exchange',
        account: 'my-exchange',
        feeAccount: 'my-exchange-fees',
        makerFeeBps: 10,
        takerFeeBps: 20
    }));

    // Run matcher every 30 seconds (also snapshots orderbook)
    const matcher = new TimeAction('30s', 'exchange-matcher', 'exchange', 'matchOrders', { limit: 50, snapshot: true, depth: 20 });
    await streamer.registerAction(matcher);

    streamer.start();

    // Create pair:
    // {"hive_stream": {"contract":"exchange","action":"createPair","payload":{"base":"HIVE","quote":"HBD"}}}

    // Deposit (transfer to exchange account with memo):
    // {"hive_stream": {"contract":"exchange","action":"deposit","payload":{}}}

    // Place order:
    // {"hive_stream": {"contract":"exchange","action":"placeOrder","payload":{"side":"buy","base":"HIVE","quote":"HBD","price":"2","amount":"5"}}}

    // Snapshot orderbook (optional):
    // {"hive_stream": {"contract":"exchange","action":"snapshotOrderBook","payload":{"base":"HIVE","quote":"HBD","depth":20}}}
}

main();
