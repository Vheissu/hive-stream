import { Streamer, createPollContract } from 'hive-stream';
import { SqliteAdapter } from 'hive-stream';

async function main() {
    const streamer = new Streamer({
        JSON_ID: 'hivestream',
        PAYLOAD_IDENTIFIER: 'hive_stream'
    });

    await streamer.registerAdapter(new SqliteAdapter());
    await streamer.registerContract(createPollContract());

    streamer.start();

    // Create poll:
    // {"hive_stream": {"contract":"polls","action":"createPoll","payload":{"pollId":"launch","question":"Ship it?","options":["yes","no"],"durationHours":24}}}
    // Vote:
    // {"hive_stream": {"contract":"polls","action":"vote","payload":{"pollId":"launch","option":0}}}
}

main();
