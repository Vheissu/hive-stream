import fs from 'fs';

import * as hiveStream from '../src';
import {
    CONTRACT_CATEGORIES,
    contractCatalog,
    getCatalogContract,
    getCatalogContractsByCategory
} from '../src/catalog';
import {
    CATALOG_JSON_PATH,
    introspectContracts,
    isContractFactoryExport,
    serializeCatalog
} from '../scripts/lib/contract-introspection';
import { escapeTableCell } from '../scripts/generate-contract-docs';

describe('contract catalog', () => {
    const introspection = introspectContracts();

    test('every built-in factory has catalog metadata and instantiates cleanly', () => {
        // If this fails after adding a contract, add one line to
        // scripts/lib/contract-metadata.ts.
        expect(introspection.problems).toEqual([]);
    });

    test('committed src/catalog/contracts.json is up to date (run npm run catalog:gen)', () => {
        expect(fs.readFileSync(CATALOG_JSON_PATH, 'utf8')).toBe(serializeCatalog(introspection.catalog));
    });

    test('covers every create*Contract export', () => {
        const factories = Object.entries(hiveStream)
            .filter(([name, value]) => isContractFactoryExport(name, value))
            .map(([name]) => name)
            .sort();

        expect(contractCatalog.contracts.map((entry) => entry.factory).sort()).toEqual(factories);
    });

    test('entries are well formed', () => {
        const names = new Set<string>();

        for (const entry of contractCatalog.contracts) {
            expect(names.has(entry.name)).toBe(false);
            names.add(entry.name);
            expect(CONTRACT_CATEGORIES).toContain(entry.category);
            expect(entry.description.length).toBeGreaterThan(0);
            expect(entry.actions.length).toBeGreaterThan(0);

            for (const action of entry.actions) {
                expect(action.triggers.length).toBeGreaterThan(0);
                expect(typeof action.requiresActiveKey).toBe('boolean');
            }
        }
    });

    test('describes payload fields, enum values and factory options', () => {
        const roulette = getCatalogContract('roulette')!;
        const spin = roulette.actions.find((action) => action.name === 'spin')!;
        const betType = spin.payload!.find((field) => field.name === 'betType')!;

        expect(spin.triggers).toEqual(['transfer']);
        expect(betType.required).toBe(true);
        expect(betType.values).toEqual(expect.arrayContaining(['straight', 'color']));

        const checkpoint = getCatalogContract('createCheckpointContract')!;

        expect(checkpoint.name).toBe('checkpoint');
        expect(checkpoint.options).toEqual(expect.arrayContaining([
            { name: 'tables', type: 'string[]', required: true },
            { name: 'account', type: 'string', required: false }
        ]));
    });

    test('filters by category', () => {
        const gambling = getCatalogContractsByCategory('gambling').map((entry) => entry.name);

        expect(gambling).toEqual(expect.arrayContaining(['hivedice', 'coinflip', 'roulette']));
    });

    test('escapes pipes in generated markdown table cells', () => {
        expect(escapeTableCell('"a" | "b"')).toBe('"a" \\| "b"');
    });
});
