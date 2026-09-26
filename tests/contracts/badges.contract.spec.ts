import { SqliteAdapter, Streamer, createBadgesContract } from '../../src';
import { makeContext } from '../helpers/contract-context';

describe('badges contract', () => {
    let streamer: Streamer;
    let adapter: SqliteAdapter;
    let contract: ReturnType<typeof createBadgesContract>;

    const call = (action: keyof typeof contract.actions, sender: string, payload: any, time = '2026-07-01T00:00:00Z') =>
        (contract.actions[action] as any).handler(payload, makeContext(streamer, { sender, time }));

    const awards = () => adapter.query('SELECT badge_id, recipient, issuer, status FROM badge_awards ORDER BY recipient');

    beforeEach(async () => {
        streamer = new Streamer();
        adapter = new SqliteAdapter(':memory:');
        await streamer.registerAdapter(adapter);
        contract = createBadgesContract({ account: 'game' });
        await streamer.registerContract(contract);
    });

    afterEach(async () => {
        await streamer.stop();
    });

    test('issuers award and revoke non-transferable badges', async () => {
        await call('defineBadge', 'studio', { badgeId: 'beta-tester', title: 'Beta Tester', issuers: ['mod'], maxSupply: 2 });
        await expect(call('defineBadge', 'studio', { badgeId: 'beta-tester', title: 'Again' })).rejects.toThrow('already exists');

        await call('issueBadge', 'mod', { badgeId: 'beta-tester', recipient: 'alice', reason: 'Found a bug' });
        await expect(call('issueBadge', 'mod', { badgeId: 'beta-tester', recipient: 'alice' })).rejects.toThrow('already holds');
        await expect(call('issueBadge', 'mallory', { badgeId: 'beta-tester', recipient: 'mallory' })).rejects.toThrow('not an issuer');

        await call('issueBadge', 'studio', { badgeId: 'beta-tester', recipient: 'bob' });
        await expect(call('issueBadge', 'studio', { badgeId: 'beta-tester', recipient: 'carol' })).rejects.toThrow('maximum supply');

        await call('revokeBadge', 'mod', { badgeId: 'beta-tester', recipient: 'bob', reason: 'Cheating' });
        await expect(call('revokeBadge', 'mod', { badgeId: 'beta-tester', recipient: 'bob', reason: 'again' })).rejects.toThrow('does not hold');

        // Revocation frees supply for someone else; the cap still applies to re-issues.
        await call('issueBadge', 'studio', { badgeId: 'beta-tester', recipient: 'carol' });
        await expect(call('issueBadge', 'studio', { badgeId: 'beta-tester', recipient: 'bob' })).rejects.toThrow('maximum supply');

        await call('revokeBadge', 'studio', { badgeId: 'beta-tester', recipient: 'carol', reason: 'Left the program' });
        await call('issueBadge', 'mod', { badgeId: 'beta-tester', recipient: 'bob', reason: 'Appeal upheld' });

        expect(await awards()).toEqual([
            { badge_id: 'beta-tester', recipient: 'alice', issuer: 'mod', status: 'active' },
            { badge_id: 'beta-tester', recipient: 'bob', issuer: 'mod', status: 'active' },
            { badge_id: 'beta-tester', recipient: 'carol', issuer: 'studio', status: 'revoked' }
        ]);

        expect(Object.keys(contract.actions)).not.toContain('transferBadge');
    });

    test('creators manage issuers but can never remove themselves', async () => {
        await call('defineBadge', 'studio', { badgeId: 'mvp', title: 'MVP' });
        await expect(call('updateIssuers', 'mod', { badgeId: 'mvp', add: ['mod'] })).rejects.toThrow('Only the badge creator');

        await call('updateIssuers', 'studio', { badgeId: 'mvp', add: ['mod', 'ref'], remove: ['studio', 'ref'] });
        const [badge] = await adapter.query('SELECT issuers FROM badges');
        expect(JSON.parse(badge.issuers)).toEqual(['studio', 'mod']);
    });

    test('payment_total rules award once the threshold is reached', async () => {
        await call('defineBadge', 'studio', {
            badgeId: 'supporter',
            title: 'Supporter',
            rule: { type: 'payment_total', asset: 'HBD', minAmount: '25.000' }
        });

        const pay = (amount: string, to = 'game') => contract.actions.contribute.handler({ badgeId: 'supporter' }, makeContext(streamer, {
            sender: 'alice', amount, to
        }));

        await pay('10.000 HBD');
        expect(await awards()).toEqual([]);
        await expect(pay('10.000 HIVE')).rejects.toThrow('counts HBD payments only');
        await expect(pay('10.000 HBD', 'elsewhere')).rejects.toThrow('must be sent to game');
        await pay('15.000 HBD');

        expect(await awards()).toEqual([{ badge_id: 'supporter', recipient: 'alice', issuer: 'rule:payment_total', status: 'active' }]);

        // Further payments keep counting without duplicate awards.
        await pay('5.000 HBD');
        expect(await awards()).toHaveLength(1);
    });

    test('checkin_count rules enforce the period and optional streaks', async () => {
        await call('defineBadge', 'studio', {
            badgeId: 'streak-3',
            title: 'Three Day Streak',
            rule: { type: 'checkin_count', minCount: 3, periodSeconds: 86400, consecutive: true }
        });

        const checkIn = (time: string) => call('checkIn', 'alice', { badgeId: 'streak-3' }, time);

        await checkIn('2026-07-01T09:00:00Z');
        await expect(checkIn('2026-07-01T20:00:00Z')).rejects.toThrow('Already checked in');
        await checkIn('2026-07-02T09:00:00Z');
        // Skipped a whole day: streak restarts.
        await checkIn('2026-07-04T10:00:00Z');
        await checkIn('2026-07-05T10:00:00Z');
        expect(await awards()).toEqual([]);

        await checkIn('2026-07-06T10:00:00Z');
        expect(await awards()).toEqual([{ badge_id: 'streak-3', recipient: 'alice', issuer: 'rule:checkin_count', status: 'active' }]);
    });

    test('rules must match the earning action and require configuration', async () => {
        await call('defineBadge', 'studio', { badgeId: 'manual', title: 'Manual' });
        await expect(call('checkIn', 'alice', { badgeId: 'manual' })).rejects.toThrow('not earned by check-ins');
        await expect(call('issueBadge', 'studio', { badgeId: 'nope', recipient: 'alice' })).rejects.toThrow('does not exist');

        const noAccount = createBadgesContract({ name: 'noaccount' });
        await streamer.registerContract(noAccount);
        await expect(noAccount.actions.defineBadge.handler({
            badgeId: 'pay', title: 'Pay', rule: { type: 'payment_total', asset: 'HIVE', minAmount: '1.000' }
        } as any, makeContext(streamer, { sender: 'studio' }))).rejects.toThrow('configured with an account');
    });

    test('admins restrict who can define badges', async () => {
        const restricted = createBadgesContract({ name: 'restricted', admins: ['studio'] });
        await streamer.registerContract(restricted);

        expect(restricted.actions.defineBadge.guards).toEqual({ allowedSenders: ['studio'] });
        await expect(restricted.actions.defineBadge.handler({ badgeId: 'x', title: 'X' } as any, makeContext(streamer, { sender: 'alice' })))
            .rejects.toThrow('cannot define badges');
    });
});
