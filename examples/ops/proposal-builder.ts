import { Streamer } from 'hive-stream';

async function main() {
    const streamer = new Streamer({ env: true });

    await streamer.ops
        .createProposal()
        .creator(process.env.HIVE_ACCOUNT || 'your-account')
        .receiver('treasury')
        .startDate(new Date('2026-04-01T00:00:00.000Z'))
        .endDate(new Date('2026-05-01T00:00:00.000Z'))
        .dailyHbd(12.5)
        .subject('Builder proposal example')
        .permlink('builder-proposal-example')
        .send();
}

main().catch(console.error);
