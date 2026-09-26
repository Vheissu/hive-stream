/**
 * Writes src/catalog/contracts.json, the data behind `hive-stream/catalog`.
 *
 * Run with: npx tsx scripts/generate-contract-catalog.ts
 * (wired into `npm run build` and `npm run docs:gen`)
 */
import * as fs from 'fs';

import { CATALOG_JSON_PATH, introspectContracts, serializeCatalog } from './lib/contract-introspection';

export function writeCatalog(): ReturnType<typeof introspectContracts> {
    const result = introspectContracts();

    for (const problem of result.problems) {
        console.warn(`[catalog] ${problem}`);
    }

    const serialized = serializeCatalog(result.catalog);

    if (!fs.existsSync(CATALOG_JSON_PATH) || fs.readFileSync(CATALOG_JSON_PATH, 'utf8') !== serialized) {
        fs.writeFileSync(CATALOG_JSON_PATH, serialized);
    }

    console.log(`Wrote ${result.catalog.contracts.length} contracts to src/catalog/contracts.json`);

    return result;
}

if (require.main === module) {
    writeCatalog();
}
