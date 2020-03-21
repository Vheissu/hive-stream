import { Streamer } from './streamer';

const streamer = new Streamer();

// Start streaming
streamer.start();

streamer.onPost((op: any) => {
    console.log(op);
});