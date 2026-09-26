/**
 * Shared introspection for the contract docs pages and the contract catalog.
 *
 * Instantiates every `create*Contract` factory exported from src/index.ts,
 * reads each action's triggers and zod payload schema, and reads the
 * factory's options interface from the TypeScript source. Both
 * scripts/generate-contract-docs.ts and scripts/generate-contract-catalog.ts
 * render from the catalog this returns, so they can never disagree.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import { z } from 'zod';

import * as hiveStream from '../../src';
import {
    CONTRACT_CATEGORIES,
    ContractCatalog,
    ContractCatalogAction,
    ContractCatalogEntry,
    ContractCatalogField,
    ContractCatalogOption,
    ContractCatalogTrigger,
    ContractCategory,
    ContractStorageRequirement
} from '../../src/catalog/types';
import { CONTRACT_METADATA } from './contract-metadata';
import { examplePayload } from './example-payload';

const ROOT = path.resolve(__dirname, '..', '..');
const INDEX_PATH = path.join(ROOT, 'src', 'index.ts');

export interface IntrospectionResult {
    catalog: ContractCatalog;
    /** Problems that should fail CI (missing metadata, factories that throw). */
    problems: string[];
}

export function isContractFactoryExport(name: string, value: unknown): boolean {
    return name.startsWith('create') && name.endsWith('Contract') && typeof value === 'function';
}

function zodTypeToString(schema: any): string {
    const def = schema?._zod?.def;

    if (!def) {
        return 'unknown';
    }

    switch (def.type) {
        case 'string': return 'string';
        case 'number': return 'number';
        case 'int': return 'number';
        case 'bigint': return 'bigint';
        case 'boolean': return 'boolean';
        case 'null': return 'null';
        case 'literal': return def.values.map((v: any) => JSON.stringify(v)).join(' | ');
        case 'enum': return Object.values(def.entries).map((v: any) => JSON.stringify(v)).join(' | ');
        case 'optional': return zodTypeToString(def.innerType);
        case 'default': return zodTypeToString(def.innerType);
        case 'prefault': return zodTypeToString(def.innerType);
        case 'catch': return zodTypeToString(def.innerType);
        case 'readonly': return zodTypeToString(def.innerType);
        case 'nonoptional': return zodTypeToString(def.innerType);
        case 'nullable': return `${zodTypeToString(def.innerType)} | null`;
        case 'array': return `${zodTypeToString(def.element)}[]`;
        case 'union': return def.options.map((o: any) => zodTypeToString(o)).join(' | ');
        case 'record': return 'record';
        case 'object': return 'object';
        case 'pipe': return zodTypeToString(def.in);
        case 'any': return 'any';
        case 'unknown': return 'unknown';
        default: return def.type ?? 'unknown';
    }
}

/** Enum/literal values, looking through optional/default/nullable wrappers. */
function zodValues(schema: any): Array<string | number | boolean | null> | undefined {
    const def = schema?._zod?.def;

    if (!def) {
        return undefined;
    }

    switch (def.type) {
        case 'literal': return [...def.values];
        case 'enum': return Object.values(def.entries) as Array<string | number>;
        case 'optional':
        case 'default':
        case 'prefault':
        case 'nullable':
        case 'readonly':
        case 'catch':
            return zodValues(def.innerType);
        case 'pipe': return zodValues(def.in);
        default: return undefined;
    }
}

function zodDefault(schema: any): { value: unknown } | undefined {
    const def = schema?._zod?.def;

    if (!def) {
        return undefined;
    }

    if (def.type === 'default') {
        try {
            const value = def.defaultValue;
            JSON.stringify(value);
            return { value };
        } catch (error) {
            return undefined;
        }
    }

    if (def.type === 'optional' || def.type === 'nullable' || def.type === 'readonly') {
        return zodDefault(def.innerType);
    }

    return undefined;
}

function describePayload(schema: any): ContractCatalogField[] | null {
    if (!schema || !(schema instanceof z.ZodObject)) {
        return null;
    }

    const shape = schema.shape;

    return Object.keys(shape).map((key) => {
        const fieldSchema: any = shape[key];
        const field: ContractCatalogField = {
            name: key,
            type: zodTypeToString(fieldSchema),
            required: !(fieldSchema?.isOptional?.() ?? false)
        };

        if (typeof fieldSchema?.description === 'string' && fieldSchema.description) {
            field.description = fieldSchema.description;
        }

        const values = zodValues(fieldSchema);

        if (values) {
            field.values = values;
        }

        const fallback = zodDefault(fieldSchema);

        if (fallback) {
            field.default = fallback.value;
        }

        return field;
    });
}

function normaliseTriggers(trigger: unknown): ContractCatalogTrigger[] {
    if (!trigger) {
        return ['custom_json'];
    }

    return (Array.isArray(trigger) ? trigger : [trigger]) as ContractCatalogTrigger[];
}

function loadProgram(): ts.Program {
    const configPath = path.join(ROOT, 'tsconfig.json');
    const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
    const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, ROOT);

    return ts.createProgram([INDEX_PATH], { ...parsed.options, noEmit: true });
}

/** Reads each factory's first parameter type (its options object) from the TypeScript source. */
export function readFactoryOptions(factoryNames: string[]): Map<string, ContractCatalogOption[]> {
    const program = loadProgram();
    const checker = program.getTypeChecker();
    const sourceFile = program.getSourceFile(INDEX_PATH);
    const result = new Map<string, ContractCatalogOption[]>();

    if (!sourceFile) {
        throw new Error(`Could not load ${INDEX_PATH}`);
    }

    const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
    const wanted = new Set(factoryNames);

    for (const exported of checker.getExportsOfModule(moduleSymbol!)) {
        if (!wanted.has(exported.name)) {
            continue;
        }

        const symbol = exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
        const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0];

        if (!declaration) {
            result.set(exported.name, []);
            continue;
        }

        const signature = checker.getTypeOfSymbolAtLocation(symbol, declaration).getCallSignatures()[0];
        const parameter = signature?.parameters[0];

        if (!parameter) {
            result.set(exported.name, []);
            continue;
        }

        const parameterType = checker.getNonNullableType(checker.getTypeOfSymbolAtLocation(parameter, declaration));
        const options: ContractCatalogOption[] = checker.getPropertiesOfType(parameterType).map((property) => {
            const propertyDeclaration = property.valueDeclaration ?? property.declarations?.[0];
            const typeNode = propertyDeclaration && (ts.isPropertySignature(propertyDeclaration) || ts.isPropertyDeclaration(propertyDeclaration))
                ? propertyDeclaration.type
                : undefined;
            const type = typeNode
                ? typeNode.getText().replace(/\s+/g, ' ')
                : checker.typeToString(checker.getTypeOfSymbolAtLocation(property, declaration));
            const option: ContractCatalogOption = {
                name: property.name,
                type,
                required: (property.flags & ts.SymbolFlags.Optional) === 0
            };
            const description = ts.displayPartsToString(property.getDocumentationComment(checker)).trim();

            if (description) {
                option.description = description;
            }

            return option;
        });

        result.set(exported.name, options);
    }

    return result;
}

function resolveMetadata(exportName: string, definition: any, problems: string[]): { category: ContractCategory; description: string } {
    const metadata = CONTRACT_METADATA[exportName];
    const category = (typeof definition?.category === 'string' ? definition.category : metadata?.category) as ContractCategory | undefined;
    const description = typeof definition?.description === 'string' && definition.description
        ? definition.description
        : metadata?.description;

    if (!category || !CONTRACT_CATEGORIES.includes(category)) {
        problems.push(`${exportName}: missing or invalid category. Add it to scripts/lib/contract-metadata.ts (one of: ${CONTRACT_CATEGORIES.join(', ')}).`);
    }

    if (!description) {
        problems.push(`${exportName}: missing description. Add it to scripts/lib/contract-metadata.ts.`);
    }

    return { category: category && CONTRACT_CATEGORIES.includes(category) ? category : 'utility', description: description ?? '' };
}

const CONTRACTS_DIR = path.join(ROOT, 'src', 'contracts');

/**
 * Derives a factory's storage requirement from its source file: contracts
 * that branch on `adapter.capabilities.sql` support both storage styles;
 * contracts that require a SQL adapter, create tables or run raw queries
 * need SQL; everything else (event-only games) works anywhere.
 */
export function readStorageRequirement(factory: string): ContractStorageRequirement {
    const override = CONTRACT_METADATA[factory]?.storage;

    if (override) {
        return override;
    }

    const file = fs.readdirSync(CONTRACTS_DIR)
        .map((name) => path.join(CONTRACTS_DIR, name))
        .find((candidate) => fs.readFileSync(candidate, 'utf8').includes(`export function ${factory}(`));

    if (!file) {
        return 'sql';
    }

    const source = fs.readFileSync(file, 'utf8');

    if (/capabilities\??\.sql/.test(source)) {
        return 'any';
    }

    return /ensureSqlAdapter\(|initializeTables\(|\.query\(/.test(source) ? 'sql' : 'any';
}

export function introspectContracts(): IntrospectionResult {
    const problems: string[] = [];
    const factories = Object.entries(hiveStream)
        .filter(([name, value]) => isContractFactoryExport(name, value))
        .sort(([a], [b]) => a.localeCompare(b));
    const optionsByFactory = readFactoryOptions(factories.map(([name]) => name));
    const contracts: ContractCatalogEntry[] = [];

    for (const [exportName, factory] of factories) {
        let definition: any;

        try {
            definition = (factory as (...args: any[]) => any)(...(CONTRACT_METADATA[exportName]?.args ?? []));
        } catch (error) {
            problems.push(`${exportName}: factory threw with default options (${(error as Error).message}). Add representative 'args' in scripts/lib/contract-metadata.ts.`);
            continue;
        }

        if (!definition?.name || !definition?.actions) {
            problems.push(`${exportName}: does not return a contract definition.`);
            continue;
        }

        const { category, description } = resolveMetadata(exportName, definition, problems);
        const actions: ContractCatalogAction[] = Object.entries(definition.actions as Record<string, any>).map(([actionName, actionDef]) => {
            const entry: ContractCatalogAction = {
                name: actionName,
                triggers: normaliseTriggers(actionDef.trigger),
                requiresActiveKey: Boolean(actionDef.requiresActiveKey),
                payload: describePayload(actionDef.schema)
            };

            if (typeof actionDef.description === 'string' && actionDef.description) {
                entry.description = actionDef.description;
            }

            const override = CONTRACT_METADATA[exportName]?.examples?.[actionName];
            const example = override
                ? { example: override, valid: Boolean(actionDef.schema?.safeParse?.(override)?.success) }
                : examplePayload(actionDef.schema);

            if (example) {
                if (example.valid) {
                    entry.example = example.example;
                } else {
                    problems.push(`${exportName}.${actionName}: could not build a valid example payload (${JSON.stringify(example.example)}). Improve the hints in scripts/lib/example-payload.ts.`);
                }
            }

            return entry;
        });

        contracts.push({
            name: definition.name,
            factory: exportName,
            category,
            description,
            storage: readStorageRequirement(exportName),
            options: optionsByFactory.get(exportName) ?? [],
            actions
        });
    }

    contracts.sort((a, b) => a.name.localeCompare(b.name));

    return {
        catalog: { schemaVersion: 1, contracts },
        problems
    };
}

export const CATALOG_JSON_PATH = path.join(ROOT, 'src', 'catalog', 'contracts.json');

export function serializeCatalog(catalog: ContractCatalog): string {
    return `${JSON.stringify(catalog, null, 2)}\n`;
}
