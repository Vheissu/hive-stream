import { Streamer, createRouletteContract } from 'hive-stream';
import { SqliteAdapter } from 'hive-stream';

async function main() {
    const streamer = new Streamer({
        JSON_ID: 'hivestream',
        PAYLOAD_IDENTIFIER: 'hive_stream'
    });

    await streamer.registerAdapter(new SqliteAdapter());
    await streamer.registerContract(createRouletteContract({ account: 'my-roulette-bank' }));

    streamer.start();

    // User sends transfer with memo:
    // {"hive_stream":{"contract":"roulette","action":"spin","payload":{"betType":"color","value":"red","seed":"optional"}}}
}

main();
