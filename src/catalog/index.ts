// Browser-safe entry point: `hive-stream/catalog`.
//
// A machine-readable description of every built-in contract factory: what it
// is for, the options it takes, and each action's triggers and payload fields.
// contracts.json is generated from the contract source by
// scripts/generate-contract-catalog.ts (run by `npm run build` and
// `npm run docs:gen`); never edit it by hand.
import catalogData from './contracts.json';
import type { ContractCatalog, ContractCatalogEntry, ContractCategory } from './types';

export { CONTRACT_CATEGORIES } from './types';
export type {
    ContractCatalog,
    ContractCatalogAction,
    ContractCatalogEntry,
    ContractCatalogField,
    ContractCatalogOption,
    ContractCatalogTrigger,
    ContractCategory
} from './types';

export const contractCatalog: ContractCatalog = catalogData as ContractCatalog;

/** Finds a contract by its default contract name (e.g. `hivedice`) or factory export (e.g. `createDiceContract`). */
export function getCatalogContract(nameOrFactory: string): ContractCatalogEntry | undefined {
    return contractCatalog.contracts.find((entry) => entry.name === nameOrFactory || entry.factory === nameOrFactory);
}

export function getCatalogContractsByCategory(category: ContractCategory): ContractCatalogEntry[] {
    return contractCatalog.contracts.filter((entry) => entry.category === category);
}
