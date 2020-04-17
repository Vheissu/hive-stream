import { MongodbAdapter } from './adapters/mongodb.adapter';
import dotenv from 'dotenv';
dotenv.config();

import { Streamer } from './streamer';
import { DiceContract } from './contracts/dice.contract';

import { SqliteAdapter } from './adapters/sqlite.adapter';
import { TimeAction } from './actions';
import { Utils } from './utils';
import { LottoContract } from './contracts/lotto.contract';

(global as any).fetch = require('node-fetch');

const streamer = new Streamer({
    JSON_ID: 'testdice',
    PAYLOAD_IDENTIFIER: 'hiveContract'
});

//streamer.registerAdapter(new SqliteAdapter());
streamer.registerAdapter(new MongodbAdapter('mongodb://127.0.0.1:27017', 'hivestream'));

// Register contract
streamer.registerContract('hivedice', new DiceContract());
streamer.registerContract('hivelotto', new LottoContract());

const testAction = new TimeAction('hourly', 'testhourly', 'hivedice', 'testauto');
const testAction2 = new TimeAction('1m', 'test1m', 'hivedice', 'testauto');

streamer.registerAction(testAction);
streamer.registerAction(testAction2);

// Start streaming
streamer.start();

streamer.onHiveEngine((contractName, contractAction, contractPayload, sender, op, blockNumber, blockId, prevBlockId, trxId, blockTime) => {
    console.log(contractName, contractAction, contractPayload, sender, op, blockNumber, blockId, prevBlockId, trxId, blockTime);
});

// streamer.onPost((op: any) => {
//     console.log(op);
// });