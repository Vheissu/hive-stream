import dotenv from 'dotenv';
dotenv.config();

import { Streamer } from './streamer';
import { createDiceContract } from './contracts/dice.contract';
import { createCoinflipContract } from './contracts/coinflip.contract';
import { SqliteAdapter } from './adapters/sqlite.adapter';

const streamer = new Streamer({
    JSON_ID: 'hivestream',
    PAYLOAD_IDENTIFIER: 'hive_stream'
});

async function boot() {
    await streamer.registerAdapter(new SqliteAdapter());

    // Register contracts
    await streamer.registerContract(createDiceContract());
    await streamer.registerContract(createCoinflipContract());

    // Start streaming
    streamer.start();
}

boot();
