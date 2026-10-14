import { createRpsContract } from '../../src/contracts/rps.contract';
import { FairnessManager, MemoryFairnessStore } from '../../src';

describe('RPS Contract', () => {
    let contract: ReturnType<typeof createRpsContract>;
    let mockStreamer: any;
    let mockAdapter: any;

    beforeEach(() => {
        mockStreamer = {
            client: {
                database: {
                    getAccounts: jest.fn().mockResolvedValue([{ balance: '1000.000 HIVE' }]),
                },
            },
            getTransaction: jest.fn().mockResolvedValue({
                operations: [['transfer', { from: 'alice', to: 'beggars', amount: '1.000 HIVE' }]],
            }),
            transferHiveTokens: jest.fn().mockResolvedValue(true),
        };

        mockAdapter = {
            addEvent: jest.fn().mockResolvedValue(true),
        };

        contract = createRpsContract({ account: 'beggars' });
    });

    async function initContract(target = contract) {
        await target.hooks!.create!({ streamer: mockStreamer, adapter: mockAdapter } as any);
    }

    // The transfer in the context and the operation the contract re-reads
    // from the chain must agree, so build both from the same amount.
    function makeCtx(overrides: any = {}, rawAmount: any = '1.000 HIVE') {
        mockStreamer.getTransaction.mockResolvedValue({
            operations: [['transfer', { from: 'alice', to: 'beggars', amount: rawAmount }]],
        });

        return {
            sender: 'alice',
            transfer: { from: 'alice', to: 'beggars', rawAmount },
            block: { number: 1, id: 'block-1', previousId: 'block-0', time: new Date().toISOString() },
            transaction: { id: 'trx-1' },
            ...overrides,
        };
    }

    describe('contract definition', () => {
        test('has correct name', () => {
            expect(contract.name).toBe('rps');
        });

        test('has play action', () => {
            expect(contract.actions.play).toBeDefined();
            expect(contract.actions.play.trigger).toBe('transfer');
        });

        test('accepts custom name', () => {
            const custom = createRpsContract({ account: 'beggars', name: 'custom-rps' });
            expect(custom.name).toBe('custom-rps');
        });

        test('has create hook', () => {
            expect(contract.hooks?.create).toBeDefined();
        });
    });

    describe('create hook', () => {
        test('sets streamer and adapter references', async () => {
            await initContract();
            // If create hook didn't work, play would throw accessing null streamer
            // We test indirectly through play
        });
    });

    describe('play action', () => {
        beforeEach(async () => {
            await initContract();
        });

        test('processes a bet', async () => {
            const ctx = makeCtx();
            await contract.actions.play.handler({ move: 'rock' }, ctx);

            expect(mockStreamer.getTransaction).toHaveBeenCalledWith(1, 'trx-1');
            expect(mockAdapter.addEvent).toHaveBeenCalled();

            const result = mockAdapter.addEvent.mock.calls[0][4].data.result;
            // Wins and ties pay out; losses send nothing by default.
            expect(mockStreamer.transferHiveTokens).toHaveBeenCalledTimes(result === 'lose' ? 0 : 1);
        });

        test('records event with rps_result action', async () => {
            const ctx = makeCtx();
            await contract.actions.play.handler({ move: 'rock' }, ctx);

            const eventCall = mockAdapter.addEvent.mock.calls[0];
            expect(eventCall[1]).toBe('rps');
            expect(eventCall[2]).toBe('play');
            expect(eventCall[4].action).toBe('rps_result');
            expect(eventCall[4].data.player).toBe('alice');
            expect(eventCall[4].data.playerMove).toBe('rock');
            expect(['rock', 'paper', 'scissors']).toContain(eventCall[4].data.serverMove);
            expect(['win', 'lose', 'tie']).toContain(eventCall[4].data.result);
        });

        test('throws when transfer context is missing', async () => {
            const ctx = makeCtx({ transfer: undefined });
            await expect(contract.actions.play.handler({ move: 'rock' }, ctx)).rejects.toThrow('Transfer context required');
        });

        test('refunds invalid currency', async () => {
            const ctx = makeCtx({}, '1.000 HBD');
            // Default validCurrencies is ['HIVE']
            await contract.actions.play.handler({ move: 'rock' }, ctx);

            expect(mockStreamer.transferHiveTokens).toHaveBeenCalledWith(
                'beggars', 'alice', '1.000', 'HBD',
                expect.stringContaining('invalid currency')
            );
        });

        test('refunds amount below minimum', async () => {
            const custom = createRpsContract({ account: 'beggars', minAmount: 0.5 });
            await initContract(custom);
            const ctx = makeCtx({}, '0.100 HIVE');
            await custom.actions.play.handler({ move: 'paper' }, ctx);

            expect(mockStreamer.transferHiveTokens).toHaveBeenCalledWith(
                'beggars', 'alice', '0.100', 'HIVE',
                expect.stringContaining('too small')
            );
        });

        test('refunds amount above maximum', async () => {
            const ctx = makeCtx({}, '25.000 HIVE');
            await contract.actions.play.handler({ move: 'scissors' }, ctx);

            expect(mockStreamer.transferHiveTokens).toHaveBeenCalledWith(
                'beggars', 'alice', '25.000', 'HIVE',
                expect.stringContaining('too much')
            );
        });

        test('refunds when server cannot afford payout', async () => {
            // Balance = 1000, bet = 10, potential payout = 20 ... should work.
            // But set balance very low:
            mockStreamer.client.database.getAccounts.mockResolvedValue([{ balance: '0.001 HIVE' }]);
            const ctx = makeCtx({}, '5.000 HIVE');
            await contract.actions.play.handler({ move: 'rock' }, ctx);

            expect(mockStreamer.transferHiveTokens).toHaveBeenCalledWith(
                'beggars', 'alice', '5.000', 'HIVE',
                expect.stringContaining('cannot afford')
            );
        });

        test('throws and moves no money when the transfer cannot be verified on chain', async () => {
            const ctx = makeCtx();
            mockStreamer.getTransaction.mockResolvedValue({
                operations: [['transfer', { from: 'alice', to: 'beggars', amount: '0.001 HIVE' }]],
            });

            await expect(contract.actions.play.handler({ move: 'rock' }, ctx)).rejects.toThrow('could not be verified');
            expect(mockAdapter.addEvent).not.toHaveBeenCalled();
            expect(mockStreamer.transferHiveTokens).not.toHaveBeenCalled();
        });

        test('throws and moves no money when the transfer was not sent to the house', async () => {
            const ctx = makeCtx({ transfer: { from: 'alice', to: 'alice-alt', rawAmount: '1.000 HIVE' } });

            await expect(contract.actions.play.handler({ move: 'rock' }, ctx)).rejects.toThrow('Bets must be sent to beggars');
            expect(mockStreamer.transferHiveTokens).not.toHaveBeenCalled();
        });

        test('refunds an unknown move instead of keeping the stake', async () => {
            await contract.actions.play.handler({ move: 'lizard' }, makeCtx());

            expect(mockStreamer.transferHiveTokens).toHaveBeenCalledWith(
                'beggars', 'alice', '1.000', 'HIVE', '[Refund] Move must be rock, paper or scissors.'
            );
            expect(mockAdapter.addEvent).not.toHaveBeenCalled();
        });

        test('throws for invalid amount format (no space)', async () => {
            const ctx = makeCtx({}, '1.000HIVE');
            await expect(contract.actions.play.handler({ move: 'rock' }, ctx)).rejects.toThrow('Invalid amount format');
        });

        test('throws for null amount', async () => {
            const ctx = makeCtx({}, null);
            await expect(contract.actions.play.handler({ move: 'rock' }, ctx)).rejects.toThrow('Invalid amount format');
        });

        test('wins pay 2x less the 2% house edge, ties refund and losses send nothing', async () => {
            const results: string[] = [];
            for (let i = 0; i < 50; i++) {
                mockStreamer.transferHiveTokens.mockClear();
                mockAdapter.addEvent.mockClear();
                mockStreamer.client.database.getAccounts.mockResolvedValue([{ balance: '1000.000 HIVE' }]);

                const ctx = makeCtx({ transaction: { id: `trx-${i}` } });
                await contract.actions.play.handler({ move: 'rock' }, ctx);

                if (mockAdapter.addEvent.mock.calls.length > 0) {
                    const result = mockAdapter.addEvent.mock.calls[0][4].data.result;
                    results.push(result);

                    const transferCall = mockStreamer.transferHiveTokens.mock.calls[0];
                    if (result === 'win') {
                        expect(transferCall[2]).toBe('1.960'); // 2x less 2%
                        expect(transferCall[4]).toContain('[Winner]');
                    } else if (result === 'tie') {
                        expect(transferCall[2]).toBe('1.000'); // refund
                        expect(transferCall[4]).toContain('[Tie]');
                    } else {
                        expect(transferCall).toBeUndefined();
                    }
                }
            }

            // Over 50 iterations, we should see at least 2 different results
            const unique = [...new Set(results)];
            expect(unique.length).toBeGreaterThanOrEqual(2);
        });

        test('pendingPayouts resets after play completes', async () => {
            const ctx = makeCtx();
            await contract.actions.play.handler({ move: 'rock' }, ctx);
            // After play, pendingPayouts should be 0 (the finally block cleans up)
            // We can't access state directly, but we can verify a second bet works fine
            mockStreamer.transferHiveTokens.mockClear();
            mockAdapter.addEvent.mockClear();

            const ctx2 = makeCtx({ transaction: { id: 'trx-2' } });
            await contract.actions.play.handler({ move: 'paper' }, ctx2);
            expect(mockAdapter.addEvent).toHaveBeenCalled();
        });
    });

    describe('custom options', () => {
        test('uses custom account', async () => {
            const custom = createRpsContract({ account: 'myaccount' });
            await initContract(custom);
            // Custom account will be used in transfers
        });

        test('houseEdge changes the win payout and is validated', async () => {
            expect(() => createRpsContract({ account: 'beggars', houseEdge: 100 })).toThrow('houseEdge');

            const fairness = new FairnessManager({ store: new MemoryFairnessStore(), generateSeed: () => 'rps-edge-seed' });
            const custom = createRpsContract({ account: 'beggars', houseEdge: 10, fairness });
            await initContract(custom);

            for (let i = 0; i < 30 && !mockStreamer.transferHiveTokens.mock.calls.some((call: any[]) => call[4].includes('[Winner]')); i++) {
                await custom.actions.play.handler({ move: 'paper' }, makeCtx({ transaction: { id: `edge-${i}` } }));
            }

            const win = mockStreamer.transferHiveTokens.mock.calls.find((call: any[]) => call[4].includes('[Winner]'));
            expect(win![2]).toBe('1.800');
        });

        test('checks the HBD bankroll for HBD bets and pays in HBD', async () => {
            mockStreamer.client.database.getAccounts.mockResolvedValue([{ balance: '0.000 HIVE', hbd_balance: '100.000 HBD' }]);
            const custom = createRpsContract({ account: 'beggars', validCurrencies: ['HIVE', 'HBD'] });
            await initContract(custom);

            for (let i = 0; i < 30 && mockStreamer.transferHiveTokens.mock.calls.length === 0; i++) {
                await custom.actions.play.handler({ move: 'rock' }, makeCtx({ transaction: { id: `hbd-${i}` } }, '1.000 HBD'));
            }

            const [call] = mockStreamer.transferHiveTokens.mock.calls;
            expect(call[3]).toBe('HBD');
            expect(call[4]).not.toContain('cannot afford');
        });

        test('uses custom token symbol and valid currencies', async () => {
            const custom = createRpsContract({
                account: 'beggars',
                tokenSymbol: 'HBD',
                validCurrencies: ['HBD', 'HIVE'],
            });
            await initContract(custom);
            mockStreamer.client.database.getAccounts.mockResolvedValue([{ balance: '0.000 HIVE', hbd_balance: '1000.000 HBD' }]);

            const ctx = makeCtx({}, '1.000 HBD');
            await custom.actions.play.handler({ move: 'rock' }, ctx);

            // Should not refund as HBD is valid
            const refunds = mockStreamer.transferHiveTokens.mock.calls.filter((call: any[]) => call[4].includes('[Refund]'));
            expect(refunds).toHaveLength(0);
            expect(mockAdapter.addEvent).toHaveBeenCalled();
        });

        test('uses custom min/max amounts', async () => {
            const custom = createRpsContract({ account: 'beggars', minAmount: 5, maxAmount: 10 });
            await initContract(custom);

            // Below min
            const ctx = makeCtx();
            await custom.actions.play.handler({ move: 'rock' }, ctx);
            expect(mockStreamer.transferHiveTokens).toHaveBeenCalledWith(
                'beggars', 'alice', '1.000', 'HIVE',
                expect.stringContaining('too small')
            );
        });
    });

    describe('balance caching', () => {
        beforeEach(async () => {
            await initContract();
        });

        test('caches balance and reuses on second call', async () => {
            const ctx1 = makeCtx({ transaction: { id: 'trx-cache-1' } });
            await contract.actions.play.handler({ move: 'rock' }, ctx1);
            expect(mockStreamer.client.database.getAccounts).toHaveBeenCalledTimes(1);

            mockStreamer.transferHiveTokens.mockClear();
            mockAdapter.addEvent.mockClear();

            const ctx2 = makeCtx({ transaction: { id: 'trx-cache-2' } });
            await contract.actions.play.handler({ move: 'rock' }, ctx2);
            // Should still be 1 because cache hasn't expired
            expect(mockStreamer.client.database.getAccounts).toHaveBeenCalledTimes(1);
        });

        test('falls back to cached balance on API error', async () => {
            // First call succeeds and caches
            const ctx1 = makeCtx({ transaction: { id: 'trx-fb-1' } });
            await contract.actions.play.handler({ move: 'rock' }, ctx1);

            // Force cache expiry by mocking Date.now
            const originalNow = Date.now;
            Date.now = () => originalNow() + 60000;

            // API fails
            mockStreamer.client.database.getAccounts.mockRejectedValue(new Error('API down'));
            mockStreamer.transferHiveTokens.mockClear();
            mockAdapter.addEvent.mockClear();

            const ctx2 = makeCtx({ transaction: { id: 'trx-fb-2' } });
            await contract.actions.play.handler({ move: 'rock' }, ctx2);
            // Should still work with cached balance
            expect(mockAdapter.addEvent).toHaveBeenCalled();

            Date.now = originalNow;
        });

        test('returns 0 balance when API fails with no cache', async () => {
            mockStreamer.client.database.getAccounts.mockRejectedValue(new Error('API down'));
            const ctx = makeCtx();
            await contract.actions.play.handler({ move: 'rock' }, ctx);

            // With 0 balance, potential payout (1.960) > available (0) → refund
            expect(mockStreamer.transferHiveTokens).toHaveBeenCalledWith(
                'beggars', 'alice', '1.000', 'HIVE',
                expect.stringContaining('cannot afford')
            );
        });
    });

    describe('play action schema', () => {
        test('schema requires move field', () => {
            expect(contract.actions.play.schema).toBeDefined();
        });
    });
});
