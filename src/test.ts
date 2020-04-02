import { Streamer } from './streamer';
import diceContract from './contracts/dice.contract';

const streamer = new Streamer();

// Register contract
streamer.registerContract('hivedice', diceContract);

// Start streaming
streamer.start();

streamer.onCustomJsonId((op) => {
    //console.log(op);
}, 'hivedice');

// streamer.onPost((op: any) => {
//     console.log(op);
// });