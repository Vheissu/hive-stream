import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as ts from 'typescript';

import * as hiveStream from '../src';

// Every built-in factory's return value must be accepted by registerContract()
// in a strict-mode consumer project. Consumers see the emitted .d.ts, which
// can differ from the source types (conditional action spreads become
// `{ rotateSeed?: undefined }` unions), so the check runs against freshly
// emitted declarations rather than src/.
const root = path.resolve(__dirname, '..');

describe('built-in contract factory types', () => {
    test('every create*Contract result registers under strict mode', () => {
        const factories = Object.keys(hiveStream)
            .filter((name) => /^create\w+Contract$/.test(name) && typeof (hiveStream as any)[name] === 'function')
            .sort();

        expect(factories.length).toBeGreaterThan(40);

        const source = [
            `import { Streamer, ${factories.join(', ')} } from 'hive-stream';`,
            'const streamer = new Streamer();',
            ...factories.map((name) => `void streamer.registerContract(${name}({} as any));`)
        ].join('\n');

        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-stream-factory-types-'));
        const declarationsDir = path.join(dir, 'types');
        const file = path.join(dir, 'factories.ts');
        fs.writeFileSync(file, source);

        try {
            const configPath = path.join(root, 'tsconfig.build.json');
            const parsed = ts.parseJsonConfigFileContent(ts.readConfigFile(configPath, ts.sys.readFile).config, ts.sys, root);
            const emit = ts.createProgram(parsed.fileNames, {
                ...parsed.options,
                declaration: true,
                emitDeclarationOnly: true,
                declarationMap: false,
                sourceMap: false,
                noEmit: false,
                outDir: declarationsDir
            }).emit();

            // emitSkipped is unreliable with emitDeclarationOnly + JSON modules;
            // check for real diagnostics and the entry declaration instead.
            expect(emit.diagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'))).toEqual([]);
            expect(fs.existsSync(path.join(declarationsDir, 'index.d.ts'))).toBe(true);

            const program = ts.createProgram([file], {
                module: ts.ModuleKind.CommonJS,
                moduleResolution: ts.ModuleResolutionKind.Bundler,
                target: ts.ScriptTarget.ES2023,
                esModuleInterop: true,
                resolveJsonModule: true,
                strict: true,
                noEmit: true,
                skipLibCheck: true,
                types: ['node'],
                typeRoots: [path.join(root, 'node_modules', '@types')],
                baseUrl: root,
                paths: { 'hive-stream': [path.join(declarationsDir, 'index.d.ts')] }
            });

            const messages = ts.getPreEmitDiagnostics(program)
                .filter((diagnostic) => diagnostic.file?.fileName === file)
                .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));

            expect(messages).toEqual([]);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }, 120000);
});
