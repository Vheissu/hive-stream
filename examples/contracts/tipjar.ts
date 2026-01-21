import { Streamer, createTipJarContract } from 'hive-stream';
import { SqliteAdapter } from 'hive-stream';

async function main() {
    const streamer = new Streamer({
        JSON_ID: 'hivestream',
        PAYLOAD_IDENTIFIER: 'hive_stream'
    });

    await streamer.registerAdapter(new SqliteAdapter());
    await streamer.registerContract(createTipJarContract({ name: 'tipjar' }));

    streamer.start();

    // User sends transfer with memo:
    // {"hive_stream": {"contract":"tipjar","action":"tip","payload":{"message":"Great project!"}}}
}

main();
