import { Streamer } from './streamer';

const streamer = new Streamer();

streamer.start();

streamer.onPost((op: any) => {
    console.log(op);
});