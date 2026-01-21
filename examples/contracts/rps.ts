import { Streamer, createRpsContract } from 'hive-stream';
import { SqliteAdapter } from 'hive-stream';

async function main() {
    const streamer = new Streamer({
        JSON_ID: 'hivestream',
        PAYLOAD_IDENTIFIER: 'hive_stream'
    });

    await streamer.registerAdapter(new SqliteAdapter());
    await streamer.registerContract(createRpsContract({ account: 'my-rps-bank' }));

    streamer.start();

    // User sends transfer with memo:
    // {"hive_stream": {"contract":"rps","action":"play","payload":{"move":"rock","seed":"optional"}}}
}

main();
