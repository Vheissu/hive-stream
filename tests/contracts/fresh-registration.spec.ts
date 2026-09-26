import * as hiveStream from '../../src';
import { createTestStreamer } from '../../src/testing';

// Every built-in contract must register on a brand-new SQLite database: no
// pre-created tables, only the options a factory genuinely requires.
const requiredOptions: Record<string, Record<string, unknown>> = {
    createBridgeContract: { custodyAccount: 'testaccount', operators: ['op1'] },
    createCheckpointContract: { tables: ['events'] },
    createLimboContract: { account: 'testaccount' },
    createStakingPoolContract: { account: 'testaccount' },
    createTournamentContract: { account: 'testaccount' }
};

const factories = Object.keys(hiveStream)
    .filter((name) => /^create\w+Contract$/.test(name) && typeof (hiveStream as any)[name] === 'function')
    .sort();

describe('built-in contracts on a fresh SQLite database', () => {
    test('discovers the built-in factories', () => {
        expect(factories.length).toBeGreaterThan(40);
    });

    test.each(factories)('%s registers with minimal options', async (name) => {
        const ts = await createTestStreamer();

        try {
            const factory = (hiveStream as any)[name];
            await expect(ts.streamer.registerContract(factory(requiredOptions[name] ?? {}))).resolves.toBeUndefined();
        } finally {
            await ts.stop();
        }
    });
});
