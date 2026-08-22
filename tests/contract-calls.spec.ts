import { z } from 'zod';

import {
    ContractCallValidationError,
    createContractCaller,
    createContractCustomJsonOperation,
    createContractMemo,
    createContractPayload,
    createContractTransferOperation,
    defineContractSpec,
    validateContractCall
} from '../src/client';
import { action, defineContract } from '../src/contracts/contract';

describe('contract call helpers', () => {
    const basicCall = {
        contract: 'greeting',
        action: 'greet',
        payload: { name: 'Hive' }
    };

    test('builds payload wrappers and transfer memos without hand-written JSON', () => {
        expect(createContractPayload(basicCall)).toEqual({
            hive_stream: basicCall
        });
        expect(JSON.parse(createContractMemo(basicCall))).toEqual({
            hive_stream: basicCall
        });
        expect(createContractPayload(basicCall, { payloadIdentifier: 'my_app' })).toEqual({
            my_app: basicCall
        });
    });

    test('builds posting and active custom_json operations', () => {
        const posting = createContractCustomJsonOperation(basicCall, { sender: 'alice' });
        const active = createContractCustomJsonOperation(basicCall, {
            sender: 'alice',
            authority: 'active',
            id: 'my-app'
        });

        expect(posting[0]).toBe('custom_json');
        expect(posting[1]).toEqual(expect.objectContaining({
            id: 'hivestream',
            required_auths: [],
            required_posting_auths: ['alice']
        }));
        expect(JSON.parse(posting[1].json)).toEqual({ hive_stream: basicCall });
        expect(active[1].required_auths).toEqual(['alice']);
        expect(active[1].required_posting_auths).toEqual([]);
        expect(active[1].id).toBe('my-app');
    });

    test('builds native transfer operations with the contract call in the memo', () => {
        const operation = createContractTransferOperation(basicCall, {
            from: 'alice',
            to: 'app-account',
            amount: '1.000 HIVE'
        });

        expect(operation[0]).toBe('transfer');
        expect(operation[1]).toEqual(expect.objectContaining({
            from: 'alice',
            to: 'app-account',
            amount: '1.000 HIVE'
        }));
        expect(JSON.parse(operation[1].memo)).toEqual({ hive_stream: basicCall });
    });

    test('rejects malformed operations before they reach a wallet or RPC node', () => {
        expect(() => createContractCustomJsonOperation(basicCall, {
            sender: 'alice',
            id: 'x'.repeat(32)
        })).toThrow('fewer than 32 characters');
        expect(() => createContractTransferOperation(basicCall, {
            from: 'alice',
            to: 'app-account',
            amount: '1 HIVE'
        })).toThrow('1.000 HIVE');
        expect(() => createContractTransferOperation(basicCall, {
            from: 'alice',
            to: 'app-account',
            amount: '0.000 HIVE'
        })).toThrow('greater than zero');
        expect(() => createContractCustomJsonOperation(basicCall, {
            sender: 'Not A Hive Account'
        })).toThrow('sender is invalid');
        expect(() => createContractTransferOperation(basicCall, {
            from: '@alice',
            to: 'not_valid',
            amount: '1.000 HIVE'
        })).toThrow('to is invalid');

        const circular: any = { value: 1 };
        circular.self = circular;
        expect(() => createContractMemo({ ...basicCall, payload: circular })).toThrow('circular reference');
        expect(() => createContractMemo({ ...basicCall, payload: { value: undefined } })).toThrow('JSON cannot encode');
        expect(() => createContractMemo({ ...basicCall, payload: { value: Number.NaN } })).toThrow('non-finite');
    });
});

describe('typed contract callers', () => {
    const ContractSpec = defineContractSpec({
        name: 'safe-contract',
        actions: {
            submit: {
                trigger: 'custom_json',
                schema: z.object({ count: z.number().int().positive() })
            },
            deposit: {
                trigger: 'transfer',
                schema: z.object({ reference: z.string().min(1) })
            },
            admin: {
                trigger: 'custom_json',
                requiresActiveKey: true,
                schema: z.object({ command: z.string().min(1) })
            }
        }
    });

    const Contract = defineContract({
        name: ContractSpec.name,
        actions: {
            submit: action(async (_payload: { count: number }) => undefined, {
                ...ContractSpec.actions.submit
            }),
            deposit: action(async (_payload: { reference: string }) => undefined, {
                ...ContractSpec.actions.deposit
            }),
            admin: action(async (_payload: { command: string }) => undefined, {
                ...ContractSpec.actions.admin
            })
        }
    });

    test('reports schema, action, contract, and trigger errors as structured issues', () => {
        expect(validateContractCall(Contract, {
            contract: 'wrong',
            action: 'missing',
            payload: {}
        })).toEqual({
            success: false,
            issues: expect.arrayContaining([
                expect.objectContaining({ code: 'contract_mismatch' }),
                expect.objectContaining({ code: 'unknown_action' })
            ])
        });

        const invalid = validateContractCall(Contract, {
            contract: 'safe-contract',
            action: 'submit',
            payload: { count: 0 }
        }, { trigger: 'transfer' });

        expect(invalid.success).toBe(false);
        if (!invalid.success) {
            expect(invalid.issues).toEqual(expect.arrayContaining([
                expect.objectContaining({ code: 'trigger_not_allowed' }),
                expect.objectContaining({ code: 'invalid_payload', path: ['count'] })
            ]));
        }
    });

    test('validates payloads and chooses the required custom_json authority', () => {
        const caller = createContractCaller(ContractSpec);
        const normal = caller.customJson('alice', 'submit', { count: 2 });
        const admin = caller.customJson('alice', 'admin', { command: 'close' });

        expect(normal[1].required_posting_auths).toEqual(['alice']);
        expect(normal[1].required_auths).toEqual([]);
        expect(admin[1].required_auths).toEqual(['alice']);
        expect(admin[1].required_posting_auths).toEqual([]);
        expect(caller.validate('submit', { count: 2 }).success).toBe(true);
        expect(caller.validate('submit', { count: 0 }).success).toBe(false);
    });

    test('refuses the wrong trigger and exposes all validation issues on the error', () => {
        const caller = createContractCaller(ContractSpec);

        expect(() => caller.transfer(
            'alice',
            'app-account',
            '1.000 HIVE',
            'submit',
            { count: 2 }
        )).toThrow(ContractCallValidationError);

        try {
            caller.customJson('alice', 'submit', { count: 0 });
            throw new Error('Expected invalid contract call to throw');
        } catch (error) {
            expect(error).toBeInstanceOf(ContractCallValidationError);
            expect((error as ContractCallValidationError).issues[0].code).toBe('invalid_payload');
        }
    });

    test('builds transfer calls only for transfer actions', () => {
        const caller = createContractCaller(ContractSpec, { payloadIdentifier: 'safe', jsonId: 'safe-json' });
        const transfer = caller.transfer(
            'alice',
            'app-account',
            '2.500 HBD',
            'deposit',
            { reference: 'invoice-1' }
        );
        const customJson = caller.customJson('alice', 'submit', { count: 1 });

        expect(JSON.parse(transfer[1].memo)).toEqual({
            safe: {
                contract: 'safe-contract',
                action: 'deposit',
                payload: { reference: 'invoice-1' }
            }
        });
        expect(customJson[1].id).toBe('safe-json');
        expect(JSON.parse(customJson[1].json)).toHaveProperty('safe');
    });

    test('rejects invalid lightweight contract specs', () => {
        expect(() => defineContractSpec({ name: 'empty', actions: {} })).toThrow('at least one action');
        expect(() => defineContractSpec({
            name: 'bad-trigger',
            actions: { run: { trigger: 'typo' as any } }
        })).toThrow('invalid triggers');

        expect(() => defineContractSpec({
            name: ' invalid ',
            actions: { okay: {} }
        })).toThrow('surrounding whitespace');

        expect(() => defineContractSpec({
            name: 'invalid',
            actions: { ' not-normalized ': {} }
        })).toThrow('surrounding whitespace');
    });
});
