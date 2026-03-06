import { PrivateKey } from '@hiveio/dhive';
import { Streamer } from '../src/streamer';
import { Utils } from '../src/utils';
import { action, defineContract } from '../src/contracts/contract';
import { createMockAdapter } from './helpers/mock-adapter';

describe('Hive chain features', () => {
    const activeKey = PrivateKey.fromSeed('hive-stream-active').toString();

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('Utils multisig + escrow helpers', () => {
        test('broadcastMultiSigOperations signs with multiple keys', async () => {
            const keyOne = PrivateKey.fromSeed('key-one').toString();
            const keyTwo = PrivateKey.fromSeed('key-two').toString();
            const sendOperations = jest.fn().mockResolvedValue({ id: 'tx-id' });
            const client = {
                broadcast: {
                    sendOperations
                },
                database: {
                    getAccounts: jest.fn().mockResolvedValue([{
                        memo_key: 'STMmemo',
                        json_metadata: '{}',
                        posting_json_metadata: '{}'
                    }])
                }
            } as any;

            await Utils.broadcastMultiSigOperations(client, [['vote', { voter: 'alice' }]], [keyOne, keyTwo]);

            const passedKeys = sendOperations.mock.calls[0][1];
            expect(Array.isArray(passedKeys)).toBe(true);
            expect(passedKeys).toHaveLength(2);
        });

        test('updateAccountAuthorities uses account_update2 when posting JSON metadata is provided', async () => {
            const sendOperations = jest.fn().mockResolvedValue({ id: 'tx-id' });
            const client = {
                broadcast: {
                    sendOperations
                },
                database: {
                    getAccounts: jest.fn().mockResolvedValue([{
                        memo_key: 'STMmemo',
                        json_metadata: '{}',
                        posting_json_metadata: '{}'
                    }])
                }
            } as any;

            await Utils.updateAccountAuthorities(client, { ACTIVE_KEY: activeKey }, 'alice', {
                active: Utils.createAuthority([[`STM${'1'.repeat(50)}`, 1]], [], 1),
                posting_json_metadata: '{}'
            });

            const operation = sendOperations.mock.calls[0][0][0];
            expect(operation[0]).toBe('account_update2');
        });

        test('escrowTransfer builds and broadcasts escrow_transfer operation', async () => {
            const sendOperations = jest.fn().mockResolvedValue({ id: 'tx-id' });
            const client = {
                broadcast: {
                    sendOperations
                }
            } as any;

            await Utils.escrowTransfer(client, { ACTIVE_KEY: activeKey }, {
                from: 'alice',
                to: 'bob',
                agent: 'escrow.agent',
                escrow_id: 42,
                hive_amount: '1.000 HIVE',
                hbd_amount: '0.000 HBD',
                fee: '0.001 HIVE',
                ratification_deadline: new Date('2025-01-01T00:00:00.000Z'),
                escrow_expiration: new Date('2025-01-02T00:00:00.000Z'),
                json_meta: { test: true }
            });

            const operation = sendOperations.mock.calls[0][0][0];
            expect(operation[0]).toBe('escrow_transfer');
            expect(operation[1].escrow_id).toBe(42);
            expect(operation[1].json_meta).toBe(JSON.stringify({ test: true }));
            expect(operation[1].ratification_deadline).toBe('2025-01-01T00:00:00');
            expect(operation[1].escrow_expiration).toBe('2025-01-02T00:00:00');
        });
    });

    describe('Streamer operation behavior', () => {
        let streamer: Streamer;

        beforeEach(async () => {
            streamer = new Streamer({
                ACTIVE_KEY: activeKey,
                JSON_ID: 'testing',
                PAYLOAD_IDENTIFIER: 'hive_stream',
                DEBUG_MODE: false
            });

            await streamer.registerAdapter(createMockAdapter());
        });

        afterEach(async () => {
            await streamer.stop();
        });

        test('transferHiveEngineTokens forwards quantity and symbol in correct order', () => {
            const spy = jest.spyOn(Utils, 'transferHiveEngineTokens').mockResolvedValue({} as any);

            streamer.transferHiveEngineTokens('alice', 'bob', 'TEST', '1.500', 'memo');

            expect(spy).toHaveBeenCalledWith(
                expect.anything(),
                expect.anything(),
                'alice',
                'bob',
                '1.500',
                'TEST',
                'memo'
            );
        });

        test('onCustomJsonId only fires callbacks for the matching id', async () => {
            const matching = jest.fn();
            const nonMatching = jest.fn();

            streamer.onCustomJsonId(matching, 'target-id');
            streamer.onCustomJsonId(nonMatching, 'other-id');

            await streamer.processOperation([
                'custom_json',
                {
                    id: 'target-id',
                    json: '{}',
                    required_auths: ['alice'],
                    required_posting_auths: []
                }
            ], 10, 'block-id', 'prev-id', 'trx-id', new Date());

            expect(matching).toHaveBeenCalledTimes(1);
            expect(nonMatching).not.toHaveBeenCalled();
        });

        test('onHiveEngine still fires when tx verification lookup fails', async () => {
            const handler = jest.fn();
            const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
            const getTransactionInfo = jest.spyOn(streamer['hive'], 'getTransactionInfo')
                .mockRejectedValue(new Error('temporary hive engine outage'));

            streamer.onHiveEngine(handler);

            await streamer.processOperation([
                'custom_json',
                {
                    id: 'ssc-mainnet-hive',
                    json: JSON.stringify({
                        contractName: 'tokens',
                        contractAction: 'transfer',
                        contractPayload: {
                            symbol: 'TEST',
                            to: 'target',
                            quantity: '1.000',
                            memo: 'memo'
                        }
                    }),
                    required_auths: ['alice'],
                    required_posting_auths: []
                }
            ], 20, 'block-20', 'block-19', 'trx-20', new Date('2025-01-01T00:00:00.000Z'));

            expect(getTransactionInfo).toHaveBeenCalledWith('trx-20');
            expect(handler).toHaveBeenCalledWith(
                'tokens',
                'transfer',
                {
                    symbol: 'TEST',
                    to: 'target',
                    quantity: '1.000',
                    memo: 'memo'
                },
                'alice',
                expect.objectContaining({ id: 'ssc-mainnet-hive' }),
                20,
                'block-20',
                'block-19',
                'trx-20',
                expect.any(Date)
            );

            consoleError.mockRestore();
        });

        test('onHiveEngine does not fire when tx verification reports contract errors', async () => {
            const handler = jest.fn();
            jest.spyOn(streamer['hive'], 'getTransactionInfo').mockResolvedValue({
                logs: JSON.stringify({
                    errors: ['boom']
                })
            } as any);

            streamer.onHiveEngine(handler);

            await streamer.processOperation([
                'custom_json',
                {
                    id: 'ssc-mainnet-hive',
                    json: JSON.stringify({
                        contractName: 'tokens',
                        contractAction: 'transfer',
                        contractPayload: {
                            symbol: 'TEST',
                            to: 'target',
                            quantity: '1.000',
                            memo: 'memo'
                        }
                    }),
                    required_auths: ['alice'],
                    required_posting_auths: []
                }
            ], 21, 'block-21', 'block-20', 'trx-21', new Date('2025-01-01T00:00:00.000Z'));

            expect(handler).not.toHaveBeenCalled();
        });

        test('processTransfer forwards block metadata into adapter', async () => {
            const adapter = createMockAdapter();
            const processTransferSpy = jest.spyOn(adapter, 'processTransfer');
            await streamer.registerAdapter(adapter);
            await streamer.registerContract(defineContract({
                name: 'sample',
                actions: {
                    pay: action(jest.fn(), { trigger: 'transfer' })
                }
            }));

            await streamer.processOperation([
                'transfer',
                {
                    from: 'alice',
                    to: 'bob',
                    amount: '1.000 HIVE',
                    memo: JSON.stringify({
                        hive_stream: {
                            contract: 'sample',
                            action: 'pay',
                            payload: { value: 1 }
                        }
                    })
                }
            ], 55, 'block-55', 'block-54', 'trx-55', new Date('2025-01-01T00:00:00.000Z'));

            expect(processTransferSpy).toHaveBeenCalledWith(
                expect.anything(),
                expect.anything(),
                expect.objectContaining({
                    blockNumber: 55,
                    blockId: 'block-55',
                    previousBlockId: 'block-54',
                    transactionId: 'trx-55'
                })
            );
        });

        test('escrow transfer can trigger a contract action via json_meta payload', async () => {
            const handler = jest.fn();
            const escrowSub = jest.fn();

            await streamer.registerContract(defineContract({
                name: 'escrowcontract',
                actions: {
                    create: action(handler, { trigger: 'escrow_transfer' })
                }
            }));

            streamer.onEscrowTransfer(escrowSub);

            await streamer.processOperation([
                'escrow_transfer',
                {
                    from: 'alice',
                    to: 'bob',
                    agent: 'escrow.agent',
                    escrow_id: 99,
                    hive_amount: '1.000 HIVE',
                    hbd_amount: '0.000 HBD',
                    fee: '0.001 HIVE',
                    ratification_deadline: '2025-01-01T00:00:00',
                    escrow_expiration: '2025-01-02T00:00:00',
                    json_meta: JSON.stringify({
                        hive_stream: {
                            contract: 'escrowcontract',
                            action: 'create',
                            payload: {
                                orderId: 'A-1'
                            }
                        }
                    })
                }
            ], 100, 'block-100', 'block-99', 'trx-100', new Date('2025-01-01T00:00:00.000Z'));

            expect(handler).toHaveBeenCalledWith(
                { orderId: 'A-1' },
                expect.objectContaining({
                    trigger: 'escrow_transfer',
                    sender: 'alice',
                    escrow: expect.objectContaining({
                        type: 'escrow_transfer',
                        escrowId: 99
                    })
                })
            );
            expect(escrowSub).toHaveBeenCalledTimes(1);
        });
    });
});
