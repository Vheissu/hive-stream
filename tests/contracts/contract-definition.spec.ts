import { defineContract, action } from '../../src/contracts/contract';

describe('defineContract()', () => {
    const validDef = {
        name: 'test-contract',
        actions: {
            doSomething: { handler: jest.fn() },
        },
    };

    test('returns the definition when valid', () => {
        const result = defineContract(validDef);
        expect(result).toBe(validDef);
        expect(result.name).toBe('test-contract');
    });

    test('throws for null definition', () => {
        expect(() => defineContract(null as any)).toThrow('must be an object');
    });

    test('throws for undefined definition', () => {
        expect(() => defineContract(undefined as any)).toThrow('must be an object');
    });

    test('throws for non-object definition', () => {
        expect(() => defineContract('not-an-object' as any)).toThrow('must be an object');
    });

    test('throws when name is missing', () => {
        expect(() => defineContract({ actions: { a: { handler: jest.fn() } } } as any)).toThrow('requires a name');
    });

    test('throws when name is empty string', () => {
        expect(() => defineContract({ name: '', actions: { a: { handler: jest.fn() } } })).toThrow('requires a name');
    });

    test('throws when names contain surrounding whitespace', () => {
        expect(() => defineContract({
            name: ' invalid ',
            actions: { okay: action(jest.fn()) }
        })).toThrow('surrounding whitespace');

        expect(() => defineContract({
            name: 'valid',
            actions: { ' not-normalized ': action(jest.fn()) }
        })).toThrow('surrounding whitespace');
    });

    test('throws when name is not a string', () => {
        expect(() => defineContract({ name: 42, actions: { a: { handler: jest.fn() } } } as any)).toThrow('requires a name');
    });

    test('throws when actions is missing', () => {
        expect(() => defineContract({ name: 'test' } as any)).toThrow('must define actions');
    });

    test('throws when actions is not an object', () => {
        expect(() => defineContract({ name: 'test', actions: 'string' } as any)).toThrow('must define actions');
    });

    test('throws when actions is empty object', () => {
        expect(() => defineContract({ name: 'test', actions: {} })).toThrow('at least one action');
    });

    test('throws when an action has no handler', () => {
        expect(() => defineContract({
            name: 'test',
            actions: { broken: {} as any }
        })).toThrow("action 'broken' requires a handler function");
    });

    test('throws for unsupported or empty trigger lists', () => {
        expect(() => defineContract({
            name: 'test',
            actions: { broken: { handler: jest.fn(), trigger: 'typo' as any } }
        })).toThrow("unsupported trigger 'typo'");

        expect(() => defineContract({
            name: 'test',
            actions: { broken: { handler: jest.fn(), trigger: [] } }
        })).toThrow('at least one trigger');
    });

    test('throws for invalid lifecycle hooks', () => {
        expect(() => defineContract({
            name: 'test',
            hooks: { create: 'not-a-function' } as any,
            actions: { valid: { handler: jest.fn() } }
        })).toThrow('create hook must be a function');
    });

    test('preserves hooks in definition', () => {
        const hooks = { create: jest.fn(), destroy: jest.fn() };
        const def = defineContract({
            name: 'with-hooks',
            hooks,
            actions: { doIt: { handler: jest.fn() } },
        });
        expect(def.hooks).toBe(hooks);
    });
});

describe('action()', () => {
    test('wraps handler into ContractActionDefinition', () => {
        const handler = jest.fn();
        const result = action(handler);
        expect(result.handler).toBe(handler);
    });

    test('includes options in the result', () => {
        const handler = jest.fn();
        const result = action(handler, { trigger: 'transfer', requiresActiveKey: true });
        expect(result.trigger).toBe('transfer');
        expect(result.requiresActiveKey).toBe(true);
        expect(result.handler).toBe(handler);
    });

    test('works with schema option', () => {
        const handler = jest.fn();
        const schema = { safeParse: jest.fn() };
        const result = action(handler, { schema: schema as any });
        expect(result.schema).toBe(schema);
    });

    test('rejects invalid handlers and schemas immediately', () => {
        expect(() => action(null as any)).toThrow('requires a handler function');
        expect(() => action(jest.fn(), { schema: { parse: jest.fn() } as any })).toThrow('schema must provide safeParse()');
    });

    test('defaults to empty options', () => {
        const handler = jest.fn();
        const result = action(handler);
        expect(result.trigger).toBeUndefined();
        expect(result.schema).toBeUndefined();
        expect(result.requiresActiveKey).toBeUndefined();
    });
});
