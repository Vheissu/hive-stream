/**
 * Financial safety tests — verifies critical money-handling code paths.
 * Each test corresponds to a specific audit finding.
 */
import BigNumber from 'bignumber.js';
import { createRpsContract } from '../../src/contracts/rps.contract';
import { createLottoContract } from '../../src/contracts/lotto.contract';
import { toBigNumber, ensurePositiveAmount } from '../../src/contracts/helpers';

describe('Financial Safety', () => {
    function createMockStreamer(overrides: any = {}) {
        return {
            client: {
                database: {
                    getAccounts: jest.fn().mockResolvedValue([{ balance: '1000.000 HIVE' }]),
                },
            },
            getTransaction: jest.fn().mockResolvedValue({
                operations: [['transfer', { from: 'alice', to: 'beggars', amount: '1.000 HIVE' }]],
            }),
            verifyTransfer: jest.fn().mockResolvedValue(true),
            transferHiveTokens: jest.fn().mockResolvedValue(true),
            transferHiveTokensMultiple: jest.fn().mockResolvedValue(true),
            ...overrides,
        };
    }

    function createMockAdapter() {
        return {
            addEvent: jest.fn().mockResolvedValue(true),
            find: jest.fn().mockResolvedValue(null),
            findOne: jest.fn().mockResolvedValue(null),
            insert: jest.fn().mockResolvedValue(true),
            replace: jest.fn().mockResolvedValue(true),
        };
    }

    describe('RPS: refund-on-error (audit #3)', () => {
        test('attempts refund when error occurs during play', async () => {
            const mockStreamer = createMockStreamer();
            const mockAdapter = createMockAdapter();

            // Make addEvent fail to simulate mid-processing error
            mockAdapter.addEvent.mockRejectedValue(new Error('Database write failed'));

            const contract = createRpsContract();
            contract.hooks!.create!({ streamer: mockStreamer, adapter: mockAdapter } as any);

            const ctx = {
                sender: 'alice',
                transfer: { rawAmount: '1.000 HIVE' },
                block: { number: 1, id: 'block-1', previousId: 'block-0', time: new Date().toISOString() },
                transaction: { id: 'trx-1' },
            };

            await expect(
                contract.actions.play.handler({ move: 'rock' }, ctx as any)
            ).rejects.toThrow('Database write failed');

            // Critical: refund should have been attempted
            const refundCalls = mockStreamer.transferHiveTokens.mock.calls.filter(
                (call: any[]) => call[4]?.includes('[Refund]')
            );
            expect(refundCalls.length).toBeGreaterThanOrEqual(1);
            expect(refundCalls[0][0]).toBe('beggars'); // from
            expect(refundCalls[0][1]).toBe('alice'); // to
            expect(refundCalls[0][2]).toBe('1.000'); // amount
            expect(refundCalls[0][3]).toBe('HIVE'); // currency
        });

        test('still throws even if refund also fails', async () => {
            const mockStreamer = createMockStreamer();
            const mockAdapter = createMockAdapter();

            mockAdapter.addEvent.mockRejectedValue(new Error('DB error'));
            // Refund also fails
            mockStreamer.transferHiveTokens.mockRejectedValue(new Error('Transfer failed'));

            const contract = createRpsContract();
            contract.hooks!.create!({ streamer: mockStreamer, adapter: mockAdapter } as any);

            const ctx = {
                sender: 'alice',
                transfer: { rawAmount: '1.000 HIVE' },
                block: { number: 1, id: 'b1', previousId: 'b0', time: new Date().toISOString() },
                transaction: { id: 'trx-err' },
            };

            // Should still throw the original error
            await expect(
                contract.actions.play.handler({ move: 'rock' }, ctx as any)
            ).rejects.toThrow('DB error');
        });
    });

    describe('Lotto: refund uses configurable cost (audit #8)', () => {
        test('hourly refund uses cost, not hardcoded 10.000', async () => {
            const mockStreamer = createMockStreamer();
            const mockAdapter = createMockAdapter();

            const contract = createLottoContract({ cost: 5, minEntriesHourly: 100 });
            contract.hooks!.create!({ streamer: mockStreamer, adapter: mockAdapter } as any);

            // Set up an active hourly draw with too few entries
            mockAdapter.find.mockResolvedValue([{
                status: 'active',
                type: 'hourly',
                entries: [
                    { account: 'alice', transactionId: 'trx-1', date: new Date() },
                    { account: 'bob', transactionId: 'trx-2', date: new Date() },
                ],
            }]);

            const ctx = {
                sender: 'system',
                block: { number: 1, id: 'b1', previousId: 'b0', time: new Date().toISOString() },
                transaction: { id: 'trx-draw' },
            };

            await contract.actions.drawHourlyLottery.handler({}, ctx as any);

            // Refund amount should be '5.000', not '10.000'
            expect(mockStreamer.transferHiveTokensMultiple).toHaveBeenCalledWith(
                'beggars',
                ['alice', 'bob'],
                '5.000', // cost = 5, formatted to 3 decimals
                'HIVE',
                expect.stringContaining('Refund')
            );
        });
    });

    describe('Lotto: overpayment creates entry (audit #9)', () => {
        test('overpayment refunds difference AND creates lotto entry', async () => {
            const mockStreamer = createMockStreamer();
            const mockAdapter = createMockAdapter();

            const contract = createLottoContract({ cost: 10 });
            contract.hooks!.create!({ streamer: mockStreamer, adapter: mockAdapter } as any);

            // No existing draw
            mockAdapter.find.mockResolvedValue(null);

            const ctx = {
                sender: 'alice',
                transfer: { rawAmount: '15.000 HIVE' },
                block: { number: 1, id: 'b1', previousId: 'b0', time: new Date().toISOString() },
                transaction: { id: 'trx-overpay' },
            };

            // Mock verifyTransfer to return true
            mockStreamer.getTransaction.mockResolvedValue({
                operations: [['transfer', { from: 'alice', to: 'beggars', amount: '15.000 HIVE' }]],
            });
            mockStreamer.verifyTransfer.mockResolvedValue(true);

            await contract.actions.buy.handler({ type: 'hourly' }, ctx as any);

            // Should have refunded the 5.000 difference
            expect(mockStreamer.transferHiveTokens).toHaveBeenCalledWith(
                'beggars', 'alice', '5.000', 'HIVE',
                expect.stringContaining('Refund')
            );

            // AND should have created a lotto entry (insert called)
            expect(mockAdapter.insert).toHaveBeenCalledWith(
                'lottery',
                expect.objectContaining({
                    status: 'active',
                    type: 'hourly',
                    entries: expect.arrayContaining([
                        expect.objectContaining({ account: 'alice' }),
                    ]),
                })
            );
        });
    });

    describe('Lotto: NaN amount validation (audit #6)', () => {
        test('rejects NaN amount with error', async () => {
            const mockStreamer = createMockStreamer();
            const mockAdapter = createMockAdapter();

            const contract = createLottoContract();
            contract.hooks!.create!({ streamer: mockStreamer, adapter: mockAdapter } as any);

            const ctx = {
                sender: 'alice',
                transfer: { rawAmount: 'notanumber HIVE' },
                block: { number: 1, id: 'b1', previousId: 'b0', time: new Date().toISOString() },
                transaction: { id: 'trx-nan' },
            };

            mockStreamer.verifyTransfer.mockResolvedValue(true);

            await expect(
                contract.actions.buy.handler({ type: 'hourly' }, ctx as any)
            ).rejects.toThrow('Invalid ticket amount');
        });
    });

    describe('Lotto: balance check before fee (audit #7)', () => {
        test('throws before paying fee when balance insufficient', async () => {
            const mockStreamer = createMockStreamer();
            const mockAdapter = createMockAdapter();

            // Set balance very low
            mockStreamer.client.database.getAccounts.mockResolvedValue([{ balance: '1.000 HIVE' }]);

            const contract = createLottoContract({
                cost: 10,
                minEntriesHourly: 2,
                hourlyWinnersPick: 1,
                feeAccount: 'feeaccount',
            });
            contract.hooks!.create!({ streamer: mockStreamer, adapter: mockAdapter } as any);

            // Active draw with enough entries
            mockAdapter.find.mockResolvedValue([{
                status: 'active',
                type: 'hourly',
                entries: Array.from({ length: 5 }, (_, i) => ({
                    account: `user${i}`,
                    transactionId: `trx-${i}`,
                    date: new Date(),
                })),
            }]);

            const ctx = {
                sender: 'system',
                block: { number: 1, id: 'b1', previousId: 'b0', time: new Date().toISOString() },
                transaction: { id: 'trx-draw' },
            };

            await expect(
                contract.actions.drawHourlyLottery.handler({}, ctx as any)
            ).rejects.toThrow('Balance is less than amount to pay out');

            // Fee should NOT have been paid
            expect(mockStreamer.transferHiveTokens).not.toHaveBeenCalled();
        });
    });

    describe('toBigNumber: NaN/null guard (audit #10)', () => {
        test('throws for empty string', () => {
            expect(() => toBigNumber('')).toThrow('Invalid numeric value');
        });

        test('throws for null', () => {
            expect(() => toBigNumber(null as any)).toThrow('Invalid numeric value');
        });

        test('throws for undefined', () => {
            expect(() => toBigNumber(undefined as any)).toThrow('Invalid numeric value');
        });

        test('throws for NaN string', () => {
            expect(() => toBigNumber('not-a-number')).toThrow('Invalid numeric value');
        });

        test('throws for Infinity', () => {
            expect(() => toBigNumber(Infinity)).toThrow('Invalid numeric value');
        });

        test('accepts valid numbers', () => {
            expect(toBigNumber('100.5').toNumber()).toBe(100.5);
            expect(toBigNumber(42).toNumber()).toBe(42);
            expect(toBigNumber('0').toNumber()).toBe(0);
            expect(toBigNumber(new BigNumber('99.99')).toNumber()).toBe(99.99);
        });

        test('accepts negative numbers', () => {
            expect(toBigNumber('-5').toNumber()).toBe(-5);
        });
    });

    describe('ensurePositiveAmount with toBigNumber guard', () => {
        test('throws for zero', () => {
            expect(() => ensurePositiveAmount('0', 'Amount')).toThrow('greater than zero');
        });

        test('throws for negative', () => {
            expect(() => ensurePositiveAmount('-1', 'Amount')).toThrow('greater than zero');
        });

        test('throws for garbage input', () => {
            expect(() => ensurePositiveAmount('abc', 'Amount')).toThrow('Invalid numeric value');
        });

        test('accepts positive amount', () => {
            expect(() => ensurePositiveAmount('10.5', 'Amount')).not.toThrow();
        });
    });

    describe('verifyTransfer only checks first op (audit #12)', () => {
        test('verifyTransfer matches first operation', async () => {
            const tx = {
                operations: [
                    ['transfer', { from: 'alice', to: 'bob', amount: '1.000 HIVE' }],
                    ['transfer', { from: 'bob', to: 'alice', amount: '1.000 HIVE' }],
                ],
            } as any;

            // It only checks operations[0] — this is a KNOWN LIMITATION
            const result = await Utils.verifyTransfer(tx, 'alice', 'bob', '1.000 HIVE');
            expect(result).toBe(true);

            // A malicious second op that reverses the transfer is NOT caught
            // This test documents the limitation
        });
    });

    describe('Lotto: underpayment rejected (audit #16)', () => {
        test('refunds when amount is less than ticket cost', async () => {
            const mockStreamer = createMockStreamer();
            const mockAdapter = createMockAdapter();

            const contract = createLottoContract({ cost: 10 });
            contract.hooks!.create!({ streamer: mockStreamer, adapter: mockAdapter } as any);

            const ctx = {
                sender: 'alice',
                transfer: { rawAmount: '5.000 HIVE' },
                block: { number: 1, id: 'b1', previousId: 'b0', time: new Date().toISOString() },
                transaction: { id: 'trx-underpay' },
            };

            mockStreamer.verifyTransfer.mockResolvedValue(true);

            await contract.actions.buy.handler({ type: 'hourly' }, ctx as any);

            // Should refund the full amount
            expect(mockStreamer.transferHiveTokens).toHaveBeenCalledWith(
                'beggars', 'alice', '5.000', 'HIVE',
                expect.stringContaining('Insufficient amount')
            );

            // Should NOT create a lottery entry
            const lotteryInserts = mockAdapter.insert.mock.calls.filter(
                (call: any[]) => call[0] === 'lottery'
            );
            expect(lotteryInserts).toHaveLength(0);
        });
    });

    describe('Lotto: draw status updated (audit #17)', () => {
        test('marks draw as completed before payouts', async () => {
            const mockStreamer = createMockStreamer();
            const mockAdapter = createMockAdapter();

            const contract = createLottoContract({ cost: 5, minEntriesHourly: 2, hourlyWinnersPick: 1 });
            contract.hooks!.create!({ streamer: mockStreamer, adapter: mockAdapter } as any);

            mockAdapter.find.mockResolvedValue([{
                _id: 'draw-1',
                status: 'active',
                type: 'hourly',
                entries: [
                    { account: 'alice', transactionId: 'trx-1', date: new Date() },
                    { account: 'bob', transactionId: 'trx-2', date: new Date() },
                    { account: 'carol', transactionId: 'trx-3', date: new Date() },
                ],
            }]);

            const ctx = {
                sender: 'system',
                block: { number: 1, id: 'b1', previousId: 'b0', time: new Date().toISOString() },
                transaction: { id: 'trx-draw' },
            };

            await contract.actions.drawHourlyLottery.handler({}, ctx as any);

            // Draw should be marked as completed
            expect(mockAdapter.replace).toHaveBeenCalledWith(
                'lottery',
                { _id: 'draw-1' },
                expect.objectContaining({ status: 'completed' })
            );

            // replace should be called BEFORE transferHiveTokensMultiple
            const replaceCallOrder = mockAdapter.replace.mock.invocationCallOrder[0];
            const transferCallOrder = mockStreamer.transferHiveTokensMultiple.mock.invocationCallOrder[0];
            expect(replaceCallOrder).toBeLessThan(transferCallOrder);
        });

        test('marks refund draw as completed too', async () => {
            const mockStreamer = createMockStreamer();
            const mockAdapter = createMockAdapter();

            const contract = createLottoContract({ cost: 5, minEntriesHourly: 100 });
            contract.hooks!.create!({ streamer: mockStreamer, adapter: mockAdapter } as any);

            mockAdapter.find.mockResolvedValue([{
                _id: 'draw-2',
                status: 'active',
                type: 'hourly',
                entries: [
                    { account: 'alice', transactionId: 'trx-1', date: new Date() },
                ],
            }]);

            const ctx = {
                sender: 'system',
                block: { number: 1, id: 'b1', previousId: 'b0', time: new Date().toISOString() },
                transaction: { id: 'trx-refund' },
            };

            await contract.actions.drawHourlyLottery.handler({}, ctx as any);

            // Draw should be marked completed even for refunds
            expect(mockAdapter.replace).toHaveBeenCalledWith(
                'lottery',
                { _id: 'draw-2' },
                expect.objectContaining({ status: 'completed' })
            );
        });
    });

    describe('Lotto: unique winners (audit #18)', () => {
        test('getWinners does not select duplicates', async () => {
            const mockStreamer = createMockStreamer();
            const mockAdapter = createMockAdapter();

            const contract = createLottoContract({ cost: 1, minEntriesHourly: 3, hourlyWinnersPick: 3 });
            contract.hooks!.create!({ streamer: mockStreamer, adapter: mockAdapter } as any);

            // 5 unique entries
            const entries = Array.from({ length: 5 }, (_, i) => ({
                account: `user${i}`,
                transactionId: `trx-${i}`,
                date: new Date(),
            }));

            mockAdapter.find.mockResolvedValue([{
                _id: 'draw-uniq',
                status: 'active',
                type: 'hourly',
                entries,
            }]);

            const ctx = {
                sender: 'system',
                block: { number: 100, id: 'block100', previousId: 'block99', time: new Date().toISOString() },
                transaction: { id: 'trx-draw-uniq' },
            };

            await contract.actions.drawHourlyLottery.handler({}, ctx as any);

            // Check winners are unique — transferHiveTokensMultiple gets the winner list
            const winnerCall = mockStreamer.transferHiveTokensMultiple.mock.calls.find(
                (call: any[]) => call[4]?.includes('Congratulations')
            );
            if (winnerCall) {
                const winners = winnerCall[1]; // accounts array
                const uniqueWinners = new Set(winners);
                expect(uniqueWinners.size).toBe(winners.length);
            }
        });
    });

    describe('Lotto: balance check includes fee (audit #19)', () => {
        test('checks total outgoing amount not just payout', async () => {
            const mockStreamer = createMockStreamer();
            const mockAdapter = createMockAdapter();

            // Balance of exactly the payout total (but not enough for payout + fee)
            // 5 entries * 10 cost = 50 total, 5% fee = 2.5, payout = 47.5
            // Set balance to 48 — enough for payout but NOT for total (50)
            mockStreamer.client.database.getAccounts.mockResolvedValue([{ balance: '48.000 HIVE' }]);

            const contract = createLottoContract({
                cost: 10,
                minEntriesHourly: 2,
                hourlyWinnersPick: 1,
                feeAccount: 'feeaccount',
                feePercentage: 5,
            });
            contract.hooks!.create!({ streamer: mockStreamer, adapter: mockAdapter } as any);

            mockAdapter.find.mockResolvedValue([{
                _id: 'draw-fee',
                status: 'active',
                type: 'hourly',
                entries: Array.from({ length: 5 }, (_, i) => ({
                    account: `user${i}`,
                    transactionId: `trx-${i}`,
                    date: new Date(),
                })),
            }]);

            const ctx = {
                sender: 'system',
                block: { number: 1, id: 'b1', previousId: 'b0', time: new Date().toISOString() },
                transaction: { id: 'trx-draw-fee' },
            };

            await expect(
                contract.actions.drawHourlyLottery.handler({}, ctx as any)
            ).rejects.toThrow('Balance is less than amount to pay out');
        });
    });

    describe('Exchange: createPair requires exchange account (audit #20)', () => {
        test('rejects non-exchange account', async () => {
            const { createExchangeContract } = require('../../src/contracts/exchange.contract');
            const mockAdapter = {
                query: jest.fn().mockResolvedValue([]),
                addEvent: jest.fn().mockResolvedValue(undefined),
                capabilities: { sql: true },
            };

            const contract = createExchangeContract({ account: 'exchange-acc' });
            await contract.hooks!.create!({ adapter: mockAdapter, streamer: {} } as any);

            await expect(
                contract.actions.createPair.handler(
                    { base: 'HIVE', quote: 'HBD' },
                    { sender: 'random-user' } as any
                )
            ).rejects.toThrow('Only the exchange account can create trading pairs');
        });
    });

    describe('Crowdfund: milestone sum validation (audit #21)', () => {
        test('rejects milestones exceeding 100%', async () => {
            const { createCrowdfundContract } = require('../../src/contracts/crowdfund.contract');
            const mockAdapter = {
                query: jest.fn().mockResolvedValue([]),
                addEvent: jest.fn().mockResolvedValue(undefined),
                capabilities: { sql: true },
            };

            const contract = createCrowdfundContract();
            await contract.hooks!.create!({ adapter: mockAdapter, streamer: {} } as any);

            await expect(
                contract.actions.createCampaign.handler(
                    {
                        campaignId: 'test-campaign',
                        title: 'Test',
                        targetAmount: '100',
                        asset: 'HIVE',
                        deadline: new Date(Date.now() + 86400000).toISOString(),
                        milestones: [
                            { title: 'Phase 1', targetPercent: 60 },
                            { title: 'Phase 2', targetPercent: 50 },
                        ],
                    },
                    { sender: 'alice' } as any
                )
            ).rejects.toThrow('Milestone percentages cannot exceed 100%');
        });
    });

    describe('Utils: BigNumber in transferHiveTokens (audit #22)', () => {
        test('throws for NaN amount', () => {
            expect(() =>
                Utils.transferHiveTokens(
                    {} as any, { ACTIVE_KEY: 'test' } as any,
                    'from', 'to', 'notanumber', 'HIVE'
                )
            ).toThrow('Invalid transfer amount');
        });
    });

    describe('Amount formatting safety', () => {
        test('parseFloat NaN produces "NaN" string in transfer amount', () => {
            // Documenting the risk: if someone passes a bad amount string
            const formatted = `${parseFloat('invalid').toFixed(3)} HIVE`;
            expect(formatted).toBe('NaN HIVE');
            // This is why contracts should validate amounts before calling transferHiveTokens
        });

        test('BigNumber.toFixed(3) handles edge cases safely', () => {
            expect(new BigNumber('0.001').toFixed(3)).toBe('0.001');
            expect(new BigNumber('999999.999').toFixed(3)).toBe('999999.999');
            expect(new BigNumber('0.0001').toFixed(3)).toBe('0.000');
            expect(new BigNumber('0').toFixed(3)).toBe('0.000');
        });
    });
});

// Import Utils for the verifyTransfer test
import { Utils } from '../../src/utils';
