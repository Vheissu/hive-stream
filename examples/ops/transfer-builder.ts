import { Streamer } from 'hive-stream';

async function main() {
    const streamer = new Streamer({ env: true });

    await streamer.ops
        .transfer()
        .from(process.env.HIVE_ACCOUNT || 'your-account')
        .to('treasury')
        .hive(1.25)
        .memo('Builder transfer example')
        .send();
}

main().catch(console.error);
