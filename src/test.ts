import dotenv from 'dotenv';
dotenv.config();

import { Streamer } from './streamer';
import diceContract from './contracts/dice.contract';

const streamer = new Streamer({
    JSON_ID: 'testdice'
});

// Register contract
streamer.registerContract('hivedice', diceContract);

// Start streaming
streamer.start();

// streamer.onPost((op: any) => {
//     console.log(op);
// });