import { Streamer } from './streamer';

const streamer = new Streamer();

streamer.start();

streamer.onSscJson((op: any) => {
    console.log(op);
});