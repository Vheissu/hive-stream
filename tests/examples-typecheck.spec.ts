import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

// Type-checks every example under examples/ against the library source, so
// the snippets in the docs (many are included straight from these files)
// can't drift from the real API. Package imports resolve to src/.
const root = path.resolve(__dirname, '..');
const examplesDir = path.join(root, 'examples');

function collectFiles(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
            return collectFiles(fullPath);
        }

        return entry.name.endsWith('.ts') ? [fullPath] : [];
    });
}

describe('examples', () => {
    test('every example type-checks against the current API', () => {
        const files = collectFiles(examplesDir);
        expect(files.length).toBeGreaterThan(0);

        const program = ts.createProgram(files, {
            module: ts.ModuleKind.CommonJS,
            moduleResolution: ts.ModuleResolutionKind.Bundler,
            target: ts.ScriptTarget.ES2023,
            esModuleInterop: true,
            resolveJsonModule: true,
            strict: true,
            noEmit: true,
            skipLibCheck: true,
            types: ['node'],
            baseUrl: root,
            paths: {
                'hive-stream': ['src/index.ts'],
                'hive-stream/testing': ['src/testing/index.ts'],
                'hive-stream/client': ['src/client/index.ts'],
                'hive-stream/scaffold': ['src/scaffold/index.ts'],
                'hive-stream/catalog': ['src/catalog/index.ts']
            }
        });

        const diagnostics = ts.getPreEmitDiagnostics(program)
            .filter((diagnostic) => diagnostic.file && diagnostic.file.fileName.startsWith(examplesDir));

        const messages = diagnostics.map((diagnostic) => {
            const { line, character } = diagnostic.file!.getLineAndCharacterOfPosition(diagnostic.start ?? 0);
            const relative = path.relative(root, diagnostic.file!.fileName);
            return `${relative}:${line + 1}:${character + 1} ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`;
        });

        expect(messages).toEqual([]);
    }, 120000);
});
