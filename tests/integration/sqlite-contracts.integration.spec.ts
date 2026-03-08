import fs from 'fs';
import os from 'os';
import path from 'path';
import {
    Streamer,
    SqliteAdapter,
    createRevenueSplitContract,
    createPaywallContract,
    createSubscriptionContract,
    createRentalContract,
    createReferralContract
} from '../../src';

describe('SQLite contract integration', () => {
    let tempDir: string;
    let dbPath: string;
    let streamer: Streamer;
    let adapter: SqliteAdapter;

    const customJsonOp = (sender: string, contract: string, action: string, payload: Record<string, any>, active = true) => ([
        'custom_json',
        {
            id: 'hivestream',
            json: JSON.stringify({
                hive_stream: {
                    contract,
                    action,
                    payload
                }
            }),
            required_auths: active ? [sender] : [],
            required_posting_auths: active ? [] : [sender]
        }
    ] as [string, any]);

    const transferOp = (sender: string, amount: string, contract: string, action: string, payload: Record<string, any>) => ([
        'transfer',
        {
            from: sender,
            to: 'app.contract',
            amount,
            memo: JSON.stringify({
                hive_stream: {
                    contract,
                    action,
                    payload
                }
            })
        }
    ] as [string, any]);

    const recurrentTransferOp = (sender: string, amount: string, contract: string, action: string, payload: Record<string, any>) => ([
        'recurrent_transfer',
        {
            from: sender,
            to: 'app.contract',
            amount,
            memo: JSON.stringify({
                hive_stream: {
                    contract,
                    action,
                    payload
                }
            }),
            recurrence: 30,
            executions: 12
        }
    ] as [string, any]);

    const escrowTransferOp = (sender: string, hiveAmount: string, hbdAmount: string, contract: string, action: string, payload: Record<string, any>) => ([
        'escrow_transfer',
        {
            from: sender,
            to: 'alice',
            agent: 'escrow.agent',
            escrow_id: 51,
            hive_amount: hiveAmount,
            hbd_amount: hbdAmount,
            fee: '0.001 HIVE',
            ratification_deadline: '2026-03-08T00:00:00',
            escrow_expiration: '2026-03-10T00:00:00',
            json_meta: JSON.stringify({
                hive_stream: {
                    contract,
                    action,
                    payload
                }
            })
        }
    ] as [string, any]);

    beforeEach(async () => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-stream-contracts-'));
        dbPath = path.join(tempDir, 'integration.sqlite');

        streamer = new Streamer({
            JSON_ID: 'hivestream',
            PAYLOAD_IDENTIFIER: 'hive_stream'
        });
        adapter = new SqliteAdapter(dbPath);
        await streamer.registerAdapter(adapter);

        await streamer.registerContract(createRevenueSplitContract({ name: 'revenuesplit' }));
        await streamer.registerContract(createPaywallContract({ name: 'paywall' }));
        await streamer.registerContract(createSubscriptionContract({ name: 'subscriptions' }));
        await streamer.registerContract(createRentalContract({ name: 'rentals' }));
        await streamer.registerContract(createReferralContract({ name: 'referrals' }));
    });

    afterEach(async () => {
        await streamer.stop();
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    test('processOperation routes to contracts and persists real SQLite state', async () => {
        const now = new Date('2026-03-07T00:00:00.000Z');

        await streamer.processOperation(
            customJsonOp('alice', 'revenuesplit', 'createSplit', {
                splitId: 'split-live',
                title: 'Live Split',
                recipients: [
                    { account: 'alice', bps: 6000 },
                    { account: 'bob', bps: 4000 }
                ]
            }),
            1,
            'block-1',
            'block-0',
            'trx-1',
            now
        );

        await streamer.processOperation(
            transferOp('fan', '10.000 HBD', 'revenuesplit', 'distribute', { splitId: 'split-live' }),
            2,
            'block-2',
            'block-1',
            'trx-2',
            now
        );

        await streamer.processOperation(
            customJsonOp('alice', 'paywall', 'createResource', {
                resourceId: 'report',
                title: 'Research Report',
                price: '3.000',
                asset: 'HIVE',
                accessDays: 14
            }, false),
            3,
            'block-3',
            'block-2',
            'trx-3',
            now
        );

        await streamer.processOperation(
            transferOp('carol', '3.000 HIVE', 'paywall', 'grantAccess', { resourceId: 'report' }),
            4,
            'block-4',
            'block-3',
            'trx-4',
            now
        );

        await streamer.processOperation(
            customJsonOp('alice', 'subscriptions', 'createPlan', {
                planId: 'pro',
                title: 'Pro Plan',
                price: '5.000',
                asset: 'HBD',
                intervalDays: 30
            }),
            5,
            'block-5',
            'block-4',
            'trx-5',
            now
        );

        await streamer.processOperation(
            recurrentTransferOp('dave', '5.000 HBD', 'subscriptions', 'subscribe', { planId: 'pro' }),
            6,
            'block-6',
            'block-5',
            'trx-6',
            now
        );

        await streamer.processOperation(
            customJsonOp('alice', 'rentals', 'createListing', {
                listingId: 'board',
                assetRef: 'nft:surfboard',
                title: 'Board Rental',
                collateralAmount: '20.000',
                collateralAsset: 'HBD',
                dailyRate: '5.000',
                rateAsset: 'HBD'
            }),
            7,
            'block-7',
            'block-6',
            'trx-7',
            now
        );

        await streamer.processOperation(
            escrowTransferOp('erin', '0.000 HIVE', '20.000 HBD', 'rentals', 'initiateRental', {
                listingId: 'board',
                rentalId: 'rental-live',
                endsAt: '2026-03-09T00:00:00.000Z'
            }),
            8,
            'block-8',
            'block-7',
            'trx-8',
            now
        );

        await streamer.processOperation(
            customJsonOp('alice', 'referrals', 'createProgram', {
                programId: 'affiliate',
                title: 'Affiliate',
                payoutAsset: 'HBD',
                rewardBps: 1000
            }),
            9,
            'block-9',
            'block-8',
            'trx-9',
            now
        );

        await streamer.processOperation(
            transferOp('alice', '25.000 HBD', 'referrals', 'fundProgram', { programId: 'affiliate' }),
            10,
            'block-10',
            'block-9',
            'trx-10',
            now
        );

        await streamer.processOperation(
            customJsonOp('bob', 'referrals', 'registerCode', { programId: 'affiliate', code: 'BOB10' }),
            11,
            'block-11',
            'block-10',
            'trx-11',
            now
        );

        await streamer.processOperation(
            customJsonOp('alice', 'referrals', 'recordConversion', {
                programId: 'affiliate',
                code: 'BOB10',
                buyer: 'zoe',
                grossAmount: '10.000',
                asset: 'HBD',
                externalRef: 'sale-1'
            }),
            12,
            'block-12',
            'block-11',
            'trx-12',
            now
        );

        const splitBalances = await adapter.query(
            'SELECT account, balance FROM revenue_split_balances WHERE split_id = ? ORDER BY account ASC',
            ['split-live']
        );
        const paywallAccess = await adapter.query(
            'SELECT status FROM paywall_access WHERE resource_id = ? AND account = ?',
            ['report', 'carol']
        );
        const memberships = await adapter.query(
            'SELECT status, last_source FROM subscription_memberships WHERE plan_id = ? AND subscriber = ?',
            ['pro', 'dave']
        );
        const rentals = await adapter.query(
            'SELECT renter, escrow_id, status FROM rental_agreements WHERE rental_id = ?',
            ['rental-live']
        );
        const referralBalances = await adapter.query(
            'SELECT balance FROM referral_balances WHERE program_id = ? AND account = ?',
            ['affiliate', 'bob']
        );
        const persistedTransfers = await adapter.query('SELECT COUNT(*) AS count FROM transfers', []);
        const persistedCustomJson = await adapter.query('SELECT COUNT(*) AS count FROM customJson', []);
        const persistedEvents = await adapter.query('SELECT COUNT(*) AS count FROM events', []);

        expect(splitBalances[0].balance).toBe('6');
        expect(splitBalances[1].balance).toBe('4');
        expect(paywallAccess[0].status).toBe('active');
        expect(memberships[0].status).toBe('active');
        expect(memberships[0].last_source).toBe('recurrent_transfer');
        expect(rentals[0].renter).toBe('erin');
        expect(rentals[0].escrow_id).toBe(51);
        expect(rentals[0].status).toBe('active');
        expect(referralBalances[0].balance).toBe('1');
        expect(Number(persistedTransfers[0].count)).toBeGreaterThanOrEqual(3);
        expect(Number(persistedCustomJson[0].count)).toBeGreaterThanOrEqual(5);
        expect(Number(persistedEvents[0].count)).toBeGreaterThanOrEqual(8);

        await streamer.stop();

        const reopenedAdapter = new SqliteAdapter(dbPath);
        await reopenedAdapter.create();
        const reopenedRental = await reopenedAdapter.query(
            'SELECT renter, escrow_id FROM rental_agreements WHERE rental_id = ?',
            ['rental-live']
        );
        const reopenedPaywall = await reopenedAdapter.query(
            'SELECT status FROM paywall_access WHERE resource_id = ? AND account = ?',
            ['report', 'carol']
        );

        expect(reopenedRental[0].renter).toBe('erin');
        expect(reopenedRental[0].escrow_id).toBe(51);
        expect(reopenedPaywall[0].status).toBe('active');

        await reopenedAdapter.destroy();
    });
});
