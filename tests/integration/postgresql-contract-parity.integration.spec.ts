import {
    Streamer,
    SqliteAdapter,
    PostgreSQLAdapter,
    createRevenueSplitContract,
    createSubscriptionContract,
    createRentalContract,
    createPayrollContract,
    createTicketingContract
} from '../../src';
import type { ContractContext } from '../../src/types/hive-stream';
import { createIsolatedPostgresDatabase, isPostgresTestAvailable } from '../helpers/external-adapters';

const describeIfPostgres = isPostgresTestAvailable() ? describe : describe.skip;

describeIfPostgres('PostgreSQL contract parity', () => {
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
            escrow_id: 61,
            hive_amount: hiveAmount,
            hbd_amount: hbdAmount,
            fee: '0.001 HIVE',
            ratification_deadline: '2026-03-09T00:00:00',
            escrow_expiration: '2026-03-12T00:00:00',
            json_meta: JSON.stringify({
                hive_stream: {
                    contract,
                    action,
                    payload
                }
            })
        }
    ] as [string, any]);

    const createTimeContext = (streamer: Streamer, adapter: SqliteAdapter | PostgreSQLAdapter): ContractContext => ({
        trigger: 'time',
        streamer,
        adapter,
        config: streamer['config'],
        block: {
            number: 999,
            id: 'block-time',
            previousId: 'block-prev',
            time: new Date()
        },
        transaction: {
            id: 'trx-time'
        },
        sender: 'system'
    });

    const buildStreamer = async (adapter: SqliteAdapter | PostgreSQLAdapter) => {
        const streamer = new Streamer({
            JSON_ID: 'hivestream',
            PAYLOAD_IDENTIFIER: 'hive_stream'
        });
        await streamer.registerAdapter(adapter);

        const contracts = {
            revenueSplit: createRevenueSplitContract({ name: 'revenuesplit' }),
            subscriptions: createSubscriptionContract({ name: 'subscriptions' }),
            rentals: createRentalContract({ name: 'rentals' }),
            payroll: createPayrollContract({ name: 'payroll' }),
            ticketing: createTicketingContract({ name: 'ticketing' })
        };

        await streamer.registerContract(contracts.revenueSplit);
        await streamer.registerContract(contracts.subscriptions);
        await streamer.registerContract(contracts.rentals);
        await streamer.registerContract(contracts.payroll);
        await streamer.registerContract(contracts.ticketing);

        return {
            streamer,
            contracts
        };
    };

    const runScenario = async (adapter: SqliteAdapter | PostgreSQLAdapter) => {
        const { streamer, contracts } = await buildStreamer(adapter);
        let blockNumber = 1;
        const now = new Date('2026-03-08T00:00:00.000Z');
        const futureEvent = new Date(Date.now() + 24 * 3600_000).toISOString();

        const runOperation = async (op: [string, any]) => {
            await streamer.processOperation(
                op,
                blockNumber,
                `block-${blockNumber}`,
                `block-${blockNumber - 1}`,
                `trx-${blockNumber}`,
                now
            );
            blockNumber += 1;
        };

        try {
            await runOperation(customJsonOp('alice', 'revenuesplit', 'createSplit', {
                splitId: 'split-parity',
                title: 'Parity Split',
                recipients: [
                    { account: 'alice', bps: 6000 },
                    { account: 'bob', bps: 4000 }
                ]
            }));
            await runOperation(transferOp('fan', '10.000 HBD', 'revenuesplit', 'distribute', { splitId: 'split-parity' }));

            await runOperation(customJsonOp('alice', 'subscriptions', 'createPlan', {
                planId: 'pro',
                title: 'Pro Membership',
                price: '5.000',
                asset: 'HBD',
                intervalDays: 30
            }));
            await runOperation(recurrentTransferOp('carol', '5.000 HBD', 'subscriptions', 'subscribe', { planId: 'pro' }));

            await runOperation(customJsonOp('alice', 'rentals', 'createListing', {
                listingId: 'board',
                assetRef: 'nft:board-1',
                title: 'Board Rental',
                collateralAmount: '20.000',
                collateralAsset: 'HBD',
                dailyRate: '5.000',
                rateAsset: 'HBD'
            }));
            await runOperation(escrowTransferOp('erin', '0.000 HIVE', '20.000 HBD', 'rentals', 'initiateRental', {
                listingId: 'board',
                rentalId: 'rental-parity',
                endsAt: '2026-03-10T00:00:00.000Z'
            }));

            await runOperation(customJsonOp('alice', 'payroll', 'createPayroll', {
                payrollId: 'payroll-parity',
                title: 'Payroll',
                asset: 'HBD',
                intervalDays: 14
            }));
            await runOperation(customJsonOp('alice', 'payroll', 'addRecipient', {
                payrollId: 'payroll-parity',
                account: 'bob',
                amount: '8.000'
            }));
            await runOperation(recurrentTransferOp('alice', '8.000 HBD', 'payroll', 'fundPayroll', { payrollId: 'payroll-parity' }));
            await contracts.payroll.actions.runPayroll.handler({ payrollId: 'payroll-parity' }, createTimeContext(streamer, adapter));

            await runOperation(customJsonOp('alice', 'ticketing', 'createEvent', {
                eventId: 'event-parity',
                title: 'Hive Builders',
                venue: 'Main Hall',
                startsAt: futureEvent,
                ticketPrice: '15.000',
                asset: 'HBD',
                capacity: 25
            }));
            await runOperation(transferOp('gina', '15.000 HBD', 'ticketing', 'purchaseTicket', {
                eventId: 'event-parity',
                ticketId: 'ticket-parity'
            }));
            await runOperation(customJsonOp('alice', 'ticketing', 'checkInTicket', {
                ticketId: 'ticket-parity',
                note: 'gate-a'
            }));

            const summary = {
                splitBalances: await adapter.query(
                    'SELECT account, balance FROM revenue_split_balances WHERE split_id = ? ORDER BY account ASC',
                    ['split-parity']
                ),
                membership: await adapter.query(
                    'SELECT subscriber, status, renewals, last_source, last_asset FROM subscription_memberships WHERE plan_id = ?',
                    ['pro']
                ),
                rental: await adapter.query(
                    'SELECT renter, escrow_id, status FROM rental_agreements WHERE rental_id = ?',
                    ['rental-parity']
                ),
                payrollBalances: await adapter.query(
                    'SELECT account, balance FROM payroll_balances WHERE payroll_id = ? ORDER BY account ASC',
                    ['payroll-parity']
                ),
                payrollRuns: await adapter.query(
                    'SELECT budget_balance FROM payroll_runs WHERE payroll_id = ?',
                    ['payroll-parity']
                ),
                tickets: await adapter.query(
                    'SELECT ticket_id, status FROM tickets WHERE event_id = ? ORDER BY ticket_id ASC',
                    ['event-parity']
                ),
                transferCount: (await adapter.getTransfers())?.length || 0,
                customJsonCount: (await adapter.getJson())?.length || 0,
                eventCount: (await adapter.getEvents())?.length || 0
            };

            await streamer.stop();

            return summary;
        } catch (error) {
            await streamer.stop();
            throw error;
        }
    };

    test('matches SQLite behavior for core SQL-backed contract workflows', async () => {
        const sqliteAdapter = new SqliteAdapter(':memory:');
        const postgresDb = await createIsolatedPostgresDatabase('hive_stream_parity');
        const postgresAdapter = new PostgreSQLAdapter(postgresDb.adapterConfig);

        try {
            const sqliteSummary = await runScenario(sqliteAdapter);
            const postgresSummary = await runScenario(postgresAdapter);

            expect(postgresSummary).toEqual(sqliteSummary);

            const reopenedAdapter = new PostgreSQLAdapter(postgresDb.adapterConfig);
            await reopenedAdapter.create();
            const reopenedTicket = await reopenedAdapter.query(
                'SELECT ticket_id, status FROM tickets WHERE event_id = ? ORDER BY ticket_id ASC',
                ['event-parity']
            );
            const reopenedPayroll = await reopenedAdapter.query(
                'SELECT account, balance FROM payroll_balances WHERE payroll_id = ? ORDER BY account ASC',
                ['payroll-parity']
            );

            expect(reopenedTicket).toEqual(sqliteSummary.tickets);
            expect(reopenedPayroll).toEqual(sqliteSummary.payrollBalances);

            await reopenedAdapter.destroy();
        } finally {
            await postgresDb.cleanup();
        }
    });
});
