import { Streamer } from './streamer';

const streamer = new Streamer();

streamer.onPost((op: any) => {
    console.log(op);
});