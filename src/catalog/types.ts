export const CONTRACT_CATEGORIES = [
    'gambling',
    'games',
    'social',
    'commerce',
    'finance',
    'fundraising',
    'governance',
    'assets',
    'bridge',
    'utility'
] as const;

export type ContractCategory = typeof CONTRACT_CATEGORIES[number];

export type ContractCatalogTrigger =
    | 'custom_json'
    | 'transfer'
    | 'time'
    | 'escrow_transfer'
    | 'escrow_approve'
    | 'escrow_dispute'
    | 'escrow_release'
    | 'recurrent_transfer';

/** A field of an action's zod payload schema. */
export interface ContractCatalogField {
    name: string;
    /** TypeScript-like rendering of the zod type, e.g. `string`, `"heads" | "tails"`, `number[]`. */
    type: string;
    required: boolean;
    /** From zod `.describe()`, when present. */
    description?: string;
    /** Allowed values for enum and literal fields. */
    values?: Array<string | number | boolean | null>;
    /** JSON-serialisable default from zod `.default()`, when present. */
    default?: unknown;
}

/** A property of the factory's options object, read from the TypeScript source. */
export interface ContractCatalogOption {
    name: string;
    /** TypeScript type as written in the options interface. */
    type: string;
    required: boolean;
    /** JSDoc on the property, when present. */
    description?: string;
}

export interface ContractCatalogAction {
    name: string;
    description?: string;
    /** Operations allowed to invoke the action. Actions without an explicit trigger accept custom_json only. */
    triggers: ContractCatalogTrigger[];
    /** custom_json calls must be signed with the active key. */
    requiresActiveKey: boolean;
    /** null when the action defines no payload schema; [] when the payload is an empty object. */
    payload: ContractCatalogField[] | null;
    /**
     * A payload that passes the action's schema, with required fields only.
     * Placeholder values (accounts, amounts, ids); absent when the action has
     * no payload schema.
     */
    example?: Record<string, unknown>;
}

/**
 * `sql`: needs a SQL-capable adapter (SQLite or PostgreSQL) and fails to
 * register on MongoDB. `any`: works with every built-in adapter.
 */
export type ContractStorageRequirement = 'sql' | 'any';

export interface ContractCatalogEntry {
    /** Contract name used in payloads when the factory's `name` option is left at its default. */
    name: string;
    /** Named export from `hive-stream` that builds the contract, e.g. `createDiceContract`. */
    factory: string;
    category: ContractCategory;
    description: string;
    /** Adapter capability the contract needs. */
    storage: ContractStorageRequirement;
    options: ContractCatalogOption[];
    actions: ContractCatalogAction[];
}

export interface ContractCatalog {
    /** Bumped when the JSON shape changes incompatibly. */
    schemaVersion: 1;
    contracts: ContractCatalogEntry[];
}
