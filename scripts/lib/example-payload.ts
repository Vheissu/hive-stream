/**
 * Builds a realistic example payload from an action's zod schema: required
 * fields only, defaults and enum values first, then placeholders chosen from
 * the field name and checked against the field's own schema. Used for the
 * generated contract pages and the catalog's `example` field.
 */
import { z } from 'zod';

const SAMPLE_TIME = '2030-01-01T00:00:00.000Z';

const STRING_HINTS: Array<[RegExp, string[]]> = [
    [/^base(Asset|Symbol)?$/i, ['HIVE']],
    [/^quote(Asset|Symbol)?$/i, ['HBD']],
    [/(^|[a-z])(At|Date|Time|deadline|expires|expiry|until|starts|ends|closes|opens)/i, [SAMPLE_TIME]],
    [/address/i, ['0x0000000000000000000000000000000000000001']],
    [/(url|uri|link)$/i, ['https://example.com']],
    [/(hash|seed)$/i, ['0'.repeat(64), 'example-seed']],
    [/(txid|trxid|transactionid|txhash)$/i, ['0xabc123']],
    [/(account|sender|recipient|owner|user|player|seller|buyer|beneficiary|affiliate|issuer|oracle|operator|organizer|signer|approver|reporter|donor|to|from|member|holder|staker|creator|payer|payee|referrer)$/i, ['alice']],
    [/(asset|currency|symbol|token)$/i, ['HIVE', 'EXAMPLE']],
    [/(amount|price|quantity|fee|cost|value|budget|reward|stake|target|goal|min|max|limit|bid)$/i, ['1.000', '1', '100']],
    [/(chain|network)$/i, ['eth']],
    [/(move|choice|side|option|outcome)$/i, ['heads', 'rock', 'yes']],
    [/(id|code|slug|key|ref|label|handle)$/i, ['example-1', 'example1', 'EXAMPLE1']],
    [/(name|title)$/i, ['Example']],
    [/(description|summary|note|notes|message|memo|reason|details|question|text|body|content|venue|metadata)$/i, ['Example text']]
];

const CHOICES = ['Yes', 'No', 'Maybe', 'Later', 'Never'];

const GENERIC_STRINGS = ['example-1', 'example', 'Example text', 'alice', 'HIVE', '1.000', '1', 'EXAMPLE', SAMPLE_TIME, 'https://example.com', 'a'];

const NUMBER_HINTS: Array<[RegExp, number[]]> = [
    [/(bps|basisPoints)$/i, [100, 1000]],
    [/(percent|percentage|pct)$/i, [50, 10]],
    [/(hours|days|seconds|minutes|duration|delay|interval)$/i, [24, 1, 60]],
    [/(index|nonce|round|level|position)$/i, [0, 1]]
];

const GENERIC_NUMBERS = [1, 10, 50, 100, 0, 1000, 2, 5];

function unwrap(schema: any): any {
    let current = schema;

    while (current?._zod?.def && ['optional', 'nullable', 'readonly', 'catch', 'prefault', 'nonoptional'].includes(current._zod.def.type)) {
        current = current._zod.def.innerType;
    }

    return current;
}

function accepts(schema: any, value: unknown): boolean {
    try {
        return schema.safeParse(value).success;
    } catch (error) {
        return false;
    }
}

function firstAccepted<T>(schema: any, candidates: T[]): T | undefined {
    return candidates.find((candidate) => accepts(schema, candidate));
}

function hinted<T>(key: string, hints: Array<[RegExp, T[]]>): T[] {
    return hints.filter(([pattern]) => pattern.test(key)).flatMap(([, values]) => values);
}

function exampleFor(schema: any, key: string): unknown {
    const def = schema?._zod?.def;

    if (!def) {
        return undefined;
    }

    if (def.type === 'default') {
        return def.defaultValue;
    }

    const inner = unwrap(schema);
    const innerDef = inner?._zod?.def;

    if (!innerDef) {
        return undefined;
    }

    switch (innerDef.type) {
        case 'default':
            return innerDef.defaultValue;
        case 'literal':
            return innerDef.values[0];
        case 'enum':
            return Object.values(innerDef.entries)[0];
        case 'boolean':
            return true;
        case 'string': {
            const candidates = [...hinted(key, STRING_HINTS), ...GENERIC_STRINGS];
            const accepted = firstAccepted(inner, candidates);

            if (accepted !== undefined) {
                return accepted;
            }

            // Length-constrained strings: grow a simple value until it fits.
            for (let length = 1; length <= 64; length++) {
                const value = 'a'.repeat(length);

                if (accepts(inner, value)) {
                    return value;
                }
            }

            return 'example';
        }
        case 'number':
        case 'int':
            return firstAccepted(inner, [...hinted(key, NUMBER_HINTS), ...GENERIC_NUMBERS]) ?? 1;
        case 'array': {
            const element = exampleFor(innerDef.element, key.replace(/s$/, ''));
            const single = [element];

            if (accepts(inner, single)) {
                return single;
            }

            // Arrays with a minimum length (e.g. poll options, prize splits):
            // grow until valid, keeping string elements distinct.
            for (let count = 2; count <= 10; count++) {
                const distinct = typeof element === 'string'
                    ? Array.from({ length: count }, (_, index) => CHOICES[index] && accepts(innerDef.element, CHOICES[index]) ? CHOICES[index] : `${element}-${index + 1}`)
                    : Array.from({ length: count }, () => element);

                if (accepts(inner, distinct)) {
                    return distinct;
                }
            }

            return single;
        }
        case 'object':
            return exampleObject(inner);
        case 'record':
            return {};
        case 'union':
            for (const option of innerDef.options) {
                const value = exampleFor(option, key);

                if (accepts(option, value)) {
                    return value;
                }
            }

            return exampleFor(innerDef.options[0], key);
        case 'pipe':
            return exampleFor(innerDef.in, key);
        default:
            return undefined;
    }
}

function exampleObject(schema: any): Record<string, unknown> {
    const shape = schema.shape ?? {};
    const example: Record<string, unknown> = {};

    for (const key of Object.keys(shape)) {
        const field = shape[key];

        if (field?.isOptional?.()) {
            continue;
        }

        const value = exampleFor(field, key);

        if (value !== undefined) {
            example[key] = value;
        }
    }

    return example;
}

/**
 * Returns an example payload for an object schema, or null when the action
 * has no object schema. `valid` reports whether the example passes the
 * schema (cross-field refinements can defeat per-field placeholders).
 */
export function examplePayload(schema: unknown): { example: Record<string, unknown>; valid: boolean } | null {
    if (!schema || !(schema instanceof z.ZodObject)) {
        return null;
    }

    const example = exampleObject(schema);
    return { example, valid: accepts(schema, example) };
}
