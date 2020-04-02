import { Streamer } from './streamer';

const streamer = new Streamer();

// Start streaming
streamer.start();

streamer.onCustomJsonId((op) => {
    console.log(op);
}, 'notify');

// streamer.onPost((op: any) => {
//     console.log(op);
// });