import { MongodbAdapter } from './adapters/mongodb.adapter';
import dotenv from 'dotenv';
dotenv.config();

import { Streamer } from './streamer';
import diceContract from './contracts/dice.contract';

import { SqliteAdapter } from './adapters/sqlite.adapter';

const streamer = new Streamer({
    JSON_ID: 'testdice',
    PAYLOAD_IDENTIFIER: 'hiveContract'
});

//streamer.registerAdapter(new SqliteAdapter());
//streamer.registerAdapter(new MongodbAdapter('mongodb://127.0.0.1:27017', 'hivestream'));

// Register contract
streamer.registerContract('hivedice', diceContract);

// Start streaming
streamer.start();

// streamer.onPost((op: any) => {
//     console.log(op);
// });