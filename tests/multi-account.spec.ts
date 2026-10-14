import { z } from 'zod';
import { PrivateKey } from '@hiveio/dhive';
import { createTestStreamer, TestStreamer } from '../src/testing';
import { defineContract, action } from '../src/contracts/contract';
import { createConfig, ConfigValidationError } from '../src/config';
import { Utils } from '../src/utils';

const quiet = () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
};

const primaryActive = PrivateKey.fromSeed('primary-active').toString();
const primaryPosting = PrivateKey.fromSeed('primary-posting').toString();
const vaultActive = PrivateKey.fromSeed('vault-active').toString();
const vaultPosting = PrivateKey.fromSeed('vault-posting').toString();

function paidContract(name: string, handler: jest.Mock) {
    return defineContract({
        name,
        actions: {
            pay: action(async (payload, ctx) => {
                handler(payload, ctx);
            }, {
                trigger: 'transfer',
                schema: z.object({ note: z.string().max(10).optional() })
            })
        }
    });
}

describe('Multiple app accounts', () => {
    let ts: TestStreamer;

    beforeEach(quiet);

    afterEach(async () => {
        await ts?.stop();
        jest.restoreAllMocks();
    });

    const create = (extra: Record<string, any> = {}) => createTestStreamer({
        username: 'myapp',
        activeKey: primaryActive,
        postingKey: primaryPosting,
        accounts: [{ name: 'vault', activeKey: vaultActive, postingKey: vaultPosting }, { name: 'escrow-agent' }],
        ...extra
    });

    test('lists the username first, then the configured accounts', async () => {
        ts = await create();

        expect(ts.streamer.getAppAccounts()).toEqual(['myapp', 'vault', 'escrow-agent']);
        expect(ts.streamer.isAppAccount('vault')).toBe(true);
        expect(ts.streamer.isAppAccount('alice')).toBe(false);

        ts.streamer.addAccount({ name: 'treasury', activeKey: vaultActive });
        expect(ts.streamer.getAppAccounts()).toContain('treasury');
        expect(ts.streamer.removeAccount('treasury')).toBe(true);
        expect(ts.streamer.getAppAccounts()).not.toContain('treasury');
    });

    test('transfers to any app account run paid actions', async () => {
        const handler = jest.fn();
        ts = await create();
        await ts.streamer.registerContract(paidContract('shop', handler));

        await ts.contractTransfer({ from: 'alice', to: 'vault', amount: '1.000 HIVE', contract: 'shop', action: 'pay' });
        await ts.contractTransfer({ from: 'alice', to: 'myapp', amount: '1.000 HIVE', contract: 'shop', action: 'pay' });
        await ts.contractTransfer({ from: 'alice', to: 'someone-else', amount: '1.000 HIVE', contract: 'shop', action: 'pay' });

        expect(handler).toHaveBeenCalledTimes(2);
        expect(handler.mock.calls.map((call) => call[1].transfer.to)).toEqual(['vault', 'myapp']);
    });

    test('broadcasts from a registered account are signed with its own keys', async () => {
        ts = await create();
        const transfer = jest.spyOn(Utils, 'transferHiveTokens');
        const follow = jest.spyOn(Utils, 'follow');

        await ts.streamer.transferHiveTokens('vault', 'alice', '1.000', 'HIVE', 'from the vault');
        await ts.streamer.transferHiveTokens('myapp', 'alice', '1.000', 'HIVE', 'from the app');
        await ts.streamer.transferHiveTokens('escrow-agent', 'alice', '1.000', 'HIVE', 'falls back to the default key');
        await ts.streamer.follow('vault', 'alice');

        expect(transfer.mock.calls[0][1].ACTIVE_KEY).toBe(vaultActive);
        expect(transfer.mock.calls[1][1].ACTIVE_KEY).toBe(primaryActive);
        expect(transfer.mock.calls[2][1].ACTIVE_KEY).toBe(primaryActive);
        expect(follow.mock.calls[0][1].POSTING_KEY).toBe(vaultPosting);
    });

    test('a batch with operations from several accounts is signed with every key it needs', async () => {
        ts = await create();
        const broadcast = jest.spyOn(Utils, 'broadcastOperations');

        await ts.streamer.broadcastOperations([
            ['transfer', { from: 'vault', to: 'alice', amount: '1.000 HIVE', memo: '' }],
            ['transfer', { from: 'myapp', to: 'alice', amount: '1.000 HIVE', memo: '' }],
            ['custom_json', { id: 'log', json: '{}', required_auths: [], required_posting_auths: ['vault'] }]
        ]);

        const keys = broadcast.mock.calls[0][2];
        expect(Array.isArray(keys) ? keys : [keys]).toEqual([vaultActive, primaryActive, vaultPosting]);

        broadcast.mockClear();
        await ts.streamer.broadcastOperations([
            ['transfer', { from: 'myapp', to: 'alice', amount: '1.000 HIVE', memo: '' }]
        ]);
        expect(broadcast.mock.calls[0][2]).toBe(primaryActive);
    });

    test('rejected transfers are refunded from the account that received them', async () => {
        ts = await create({ refundRejectedTransfers: true });
        const transfer = jest.spyOn(Utils, 'transferHiveTokens');
        await ts.streamer.registerContract(paidContract('shop', jest.fn()));

        await ts.contractTransfer({ from: 'alice', to: 'vault', amount: '2.000 HIVE', contract: 'shop', action: 'pay', payload: { note: 'far too long a note' } });
        await ts.contractTransfer({ from: 'myapp', to: 'vault', amount: '2.000 HIVE', contract: 'shop', action: 'pay', payload: { note: 'far too long a note' } });

        expect(ts.outgoingTransfers).toHaveLength(1);
        expect(ts.outgoingTransfers[0]).toMatchObject({ from: 'vault', to: 'alice', amount: '2.000 HIVE' });
        expect(transfer.mock.calls[0][1].ACTIVE_KEY).toBe(vaultActive);
    });

    test('onTransfer accepts several accounts', async () => {
        ts = await create();
        const seen = jest.fn();
        ts.streamer.onTransfer(['myapp', 'vault'], (op) => seen(op.to));

        await ts.transfer('alice', 'vault', '1.000 HIVE', 'hi');
        await ts.transfer('alice', 'myapp', '1.000 HIVE', 'hi');
        await ts.transfer('alice', 'other', '1.000 HIVE', 'hi');

        expect(seen.mock.calls.map((call) => call[0])).toEqual(['vault', 'myapp']);
    });

    test('setConfig replaces the registered accounts', async () => {
        ts = await create();
        ts.streamer.setConfig({ accounts: [{ name: 'other', activeKey: vaultActive }] });

        expect(ts.streamer.getAppAccounts()).toEqual(['myapp', 'other']);
    });
});

describe('Accounts configuration', () => {
    const saved = { ...process.env };

    afterEach(() => {
        process.env = { ...saved };
    });

    test('reads HIVE_ACCOUNTS as JSON', () => {
        process.env.HIVE_ACCOUNTS = JSON.stringify([{ name: 'vault', activeKey: vaultActive }]);

        const config = createConfig({ env: { path: '/nonexistent/.env' } });

        expect(config.ACCOUNTS).toEqual([{ name: 'vault', activeKey: vaultActive }]);
    });

    test('rejects malformed entries', () => {
        expect(() => createConfig({ accounts: [{ name: '' }] as any })).toThrow(ConfigValidationError);
        expect(() => createConfig({ accounts: [{ name: 'a' }, { name: 'a' }] })).toThrow(/more than once/);
        expect(() => createConfig({ accounts: 'vault' as any })).toThrow(/ACCOUNTS must be an array/);

        process.env.HIVE_ACCOUNTS = 'not json';
        expect(() => createConfig({ env: { path: '/nonexistent/.env' } })).toThrow(/ACCOUNTS must be an array/);
    });
});
