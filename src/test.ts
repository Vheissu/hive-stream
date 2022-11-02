import { CoinflipContract } from './contracts/coinflip.contract';
import dotenv from 'dotenv';
dotenv.config();

import { Streamer } from './streamer';
import { DiceContract } from './contracts/dice.contract';

import { SqliteAdapter } from './adapters/sqlite.adapter';
import { TimeAction } from './actions';
import { Utils } from './utils';
import { LottoContract } from './contracts/lotto.contract';

const streamer = new Streamer({
    JSON_ID: 'hivestream',
    PAYLOAD_IDENTIFIER: 'hivePayload'
});

//streamer.registerAdapter(new SqliteAdapter());
//streamer.registerAdapter(new MongodbAdapter('mongodb://127.0.0.1:27017', 'hivestream'));

// Register contract
streamer.registerContract('hivedice', new DiceContract());
streamer.registerContract('hiveflip', new CoinflipContract())

// Start streaming
streamer.start();

// streamer.onPost((op: any) => {
//     console.log(op);
// });