import fs from 'fs';
import path from 'path';
import ts from 'typescript';

import { HIVE_STREAM_VERSION } from '../src/scaffold';

const packageJson = require('../package.json');

const SRC = path.resolve(__dirname, '..', 'src');

function resolveLocal(fromFile: string, specifier: string): string {
    const base = path.resolve(path.dirname(fromFile), specifier);
    const candidates = [base, `${base}.ts`, path.join(base, 'index.ts')];
    const found = candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());

    if (!found) {
        throw new Error(`Cannot resolve '${specifier}' from ${path.relative(SRC, fromFile)}`);
    }

    return found;
}

/**
 * Walks the static import graph (imports, re-exports and requires) from an
 * entry file and returns every non-relative specifier it reaches, keyed by
 * the importing file. Relative imports are followed.
 */
function collectExternalImports(entry: string): Map<string, string[]> {
    const external = new Map<string, string[]>();
    const visited = new Set<string>();
    const queue = [entry];

    while (queue.length > 0) {
        const file = queue.pop()!;

        if (visited.has(file) || !file.endsWith('.ts')) {
            visited.add(file);
            continue;
        }

        visited.add(file);

        const info = ts.preProcessFile(fs.readFileSync(file, 'utf8'), true, true);

        for (const { fileName } of info.importedFiles) {
            if (fileName.startsWith('.')) {
                queue.push(resolveLocal(file, fileName));
            } else {
                const relative = path.relative(SRC, file);
                external.set(relative, [...(external.get(relative) ?? []), fileName]);
            }
        }
    }

    return external;
}

describe('browser-safe entry points', () => {
    test.each([
        ['hive-stream/scaffold', path.join(SRC, 'scaffold', 'index.ts')],
        ['hive-stream/catalog', path.join(SRC, 'catalog', 'index.ts')]
    ])('%s imports no packages or Node built-ins', (_name, entry) => {
        // Anything non-relative (fs, node:path, zod, @hiveio/dhive, ...) would
        // break bundling for the browser or drag in heavy runtime code.
        expect(Object.fromEntries(collectExternalImports(entry))).toEqual({});
    });

    test('scaffold version constant matches package.json (run npm run build to regenerate)', () => {
        expect(HIVE_STREAM_VERSION).toBe(packageJson.version);
    });
});
