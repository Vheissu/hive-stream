import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

import * as scaffoldEntry from '../src/scaffold';
import { HIVE_STREAM_VERSION } from '../src/scaffold';
import {
    generateProjectFiles,
    getNextSteps,
    isDirectoryUsable,
    validateHiveAccountName,
    validateProjectName,
    writeProjectFiles
} from '../src/cli/scaffold';
import {
    ADAPTERS,
    TEMPLATES,
    getAdapter,
    getAdapterCompatibilityError,
    getCompatibleAdapters,
    getTemplate
} from '../src/cli/templates';

const baseOptions = {
    name: 'my-app',
    template: 'minimal',
    adapter: 'sqlite',
    username: 'testuser',
    api: false,
    hiveStreamVersion: '3.0.5'
};

describe('validateProjectName', () => {
    test('accepts valid names', () => {
        expect(validateProjectName('my-app')).toBeNull();
        expect(validateProjectName('app2')).toBeNull();
        expect(validateProjectName('my.app_name')).toBeNull();
    });

    test('rejects invalid names', () => {
        expect(validateProjectName('')).not.toBeNull();
        expect(validateProjectName('My App')).not.toBeNull();
        expect(validateProjectName('UPPER')).not.toBeNull();
        expect(validateProjectName('-leading')).not.toBeNull();
        expect(validateProjectName('a'.repeat(215))).not.toBeNull();
    });

    test('rejects paths with a specific message', () => {
        for (const name of ['.', '..', './my-app', 'apps/my-app', '../my-app', 'C:\\apps\\my-app']) {
            expect(validateProjectName(name)).toBe('Project name must be a bare directory name, not a path.');
        }
    });
});

describe('validateHiveAccountName', () => {
    test('accepts valid Hive account names', () => {
        expect(validateHiveAccountName('alice')).toBeNull();
        expect(validateHiveAccountName('dice-bank')).toBeNull();
        expect(validateHiveAccountName('app.one')).toBeNull();
    });

    test('rejects malformed Hive account names', () => {
        expect(validateHiveAccountName('')).not.toBeNull();
        expect(validateHiveAccountName('ab')).not.toBeNull();
        expect(validateHiveAccountName('Uppercase')).not.toBeNull();
        expect(validateHiveAccountName('-alice')).not.toBeNull();
        expect(validateHiveAccountName('a'.repeat(17))).not.toBeNull();
    });
});

describe('template and adapter registries', () => {
    test('all templates resolve by id', () => {
        for (const template of TEMPLATES) {
            expect(getTemplate(template.id)).toBe(template);
        }

        expect(getTemplate('nope')).toBeUndefined();
    });

    test('all adapters resolve by id', () => {
        for (const adapter of ADAPTERS) {
            expect(getAdapter(adapter.id)).toBe(adapter);
        }

        expect(getAdapter('nope')).toBeUndefined();
    });

    test('only offers adapters that satisfy a template requirements', () => {
        expect(getCompatibleAdapters(getTemplate('minimal')!).map((adapter) => adapter.id)).toEqual([
            'sqlite',
            'mongodb',
            'postgresql'
        ]);
        expect(getCompatibleAdapters(getTemplate('exchange')!).map((adapter) => adapter.id)).toEqual([
            'sqlite',
            'postgresql'
        ]);
        expect(getAdapterCompatibilityError(getTemplate('exchange')!, getAdapter('mongodb')!)).toMatch(/requires sql storage/i);
    });

    test('usage examples are valid payload wrappers', () => {
        for (const template of TEMPLATES) {
            for (const example of template.usage) {
                const parsed = JSON.parse(example.payload);

                expect(parsed.hive_stream).toBeDefined();
                expect(typeof parsed.hive_stream.contract).toBe('string');
                expect(typeof parsed.hive_stream.action).toBe('string');
                expect(typeof parsed.hive_stream.payload).toBe('object');
            }
        }
    });
});

describe('generateProjectFiles', () => {
    test('generates the expected file set', () => {
        const { files } = generateProjectFiles(baseOptions);

        expect(Object.keys(files).sort()).toEqual([
            '.env.example',
            '.gitignore',
            'README.md',
            'jest.config.js',
            'package.json',
            'src/contracts/greeting.contract.ts',
            'src/index.ts',
            'tests/greeting.contract.spec.ts',
            'tsconfig.build.json',
            'tsconfig.json'
        ]);
    });

    test('package.json is valid and pins hive-stream', () => {
        const { files } = generateProjectFiles(baseOptions);
        const pkg = JSON.parse(files['package.json']);

        expect(pkg.name).toBe('my-app');
        expect(pkg.dependencies['hive-stream']).toBe('^3.0.5');
        expect(pkg.scripts.dev).toBe('tsx src/index.ts');
        expect(pkg.scripts.verify).toBe('npm run check && npm test && npm run build');
        expect(pkg.private).toBe(true);
        expect(pkg.dependencies.mongodb).toBeUndefined();
        expect(pkg.dependencies.pg).toBeUndefined();
    });

    test('package.json adds the driver for external adapters', () => {
        const mongoPkg = JSON.parse(generateProjectFiles({ ...baseOptions, adapter: 'mongodb' }).files['package.json']);
        const pgPkg = JSON.parse(generateProjectFiles({ ...baseOptions, adapter: 'postgresql' }).files['package.json']);

        expect(mongoPkg.dependencies.mongodb).toMatch(/^\^7\./);
        expect(pgPkg.dependencies.pg).toMatch(/^\^8\./);
    });

    test('throws on unknown template or adapter', () => {
        expect(() => generateProjectFiles({ ...baseOptions, template: 'bogus' })).toThrow(/Unknown template/);
        expect(() => generateProjectFiles({ ...baseOptions, adapter: 'bogus' })).toThrow(/Unknown adapter/);
    });

    test('rejects SQL contract templates paired with MongoDB', () => {
        for (const template of ['exchange', 'social', 'blog', 'token', 'assets']) {
            expect(() => generateProjectFiles({ ...baseOptions, template, adapter: 'mongodb' }))
                .toThrow(/requires sql storage/i);
        }

        expect(() => generateProjectFiles({ ...baseOptions, template: 'game', adapter: 'mongodb' }))
            .not.toThrow();
    });

    test('throws on invalid project name', () => {
        expect(() => generateProjectFiles({ ...baseOptions, name: 'Bad Name' })).toThrow(/lowercase/);
    });

    test('every template registers its contracts and imports', () => {
        for (const template of TEMPLATES) {
            const { files } = generateProjectFiles({ ...baseOptions, template: template.id });
            const index = files['src/index.ts'];

            expect(index).toContain('registerContract(GreetingContract)');
            expect(index).toContain('await streamer.start();');

            for (const named of template.imports) {
                expect(index).toContain(named);
            }
        }
    });

    test('username stays in environment config instead of application source', () => {
        const { files } = generateProjectFiles({ ...baseOptions, template: 'game', username: 'dice-bank' });

        expect(files['src/index.ts']).toContain('streamer.getConfig().USERNAME');
        expect(files['src/index.ts']).not.toContain(`'dice-bank'`);
        expect(files['.env.example']).toContain('HIVE_USERNAME=dice-bank');
    });

    test('generates a clear startup guard when no username is configured', () => {
        const { files } = generateProjectFiles({ ...baseOptions, username: '' });

        expect(files['.env.example']).toContain('HIVE_USERNAME=\n');
        expect(files['src/index.ts']).toContain('Set HIVE_USERNAME in .env before starting the app.');
    });

    test('adapters wire their constructor and env vars', () => {
        const mongo = generateProjectFiles({ ...baseOptions, adapter: 'mongodb' });

        expect(mongo.files['src/index.ts']).toContain('new MongodbAdapter(');
        expect(mongo.files['src/index.ts']).toContain(`'my-app'`);
        expect(mongo.files['.env.example']).toContain('MONGODB_URI=');

        const pg = generateProjectFiles({ ...baseOptions, adapter: 'postgresql' });

        expect(pg.files['src/index.ts']).toContain('new PostgreSQLAdapter(');
        expect(pg.files['.env.example']).toContain('DATABASE_URL=');

        const sqlite = generateProjectFiles(baseOptions);

        expect(sqlite.files['src/index.ts']).toContain('new SqliteAdapter()');
    });

    test('derives a valid MongoDB database name from dotted project names', () => {
        const mongo = generateProjectFiles({ ...baseOptions, name: 'my.app.v2', adapter: 'mongodb' });

        expect(mongo.files['.env.example']).toContain('MONGODB_DATABASE=my_app_v2\n');
        expect(mongo.files['src/index.ts']).toContain(`'my_app_v2'`);
        expect(mongo.files['src/index.ts']).not.toContain(`?? 'my.app`);

        const long = generateProjectFiles({ ...baseOptions, name: 'a'.repeat(100), adapter: 'mongodb' });
        const database = /MONGODB_DATABASE=(.*)\n/.exec(long.files['.env.example'])![1];

        expect(database.length).toBeLessThan(64);
    });

    test('api flag switches env example and readme', () => {
        const withApi = generateProjectFiles({ ...baseOptions, api: true });

        expect(withApi.files['.env.example']).toContain('API_ENABLED=true');
        expect(withApi.files['README.md']).toContain('## HTTP API');

        const withoutApi = generateProjectFiles(baseOptions);

        expect(withoutApi.files['.env.example']).toContain('# API_ENABLED=true');
        expect(withoutApi.files['README.md']).not.toContain('## HTTP API');
    });

    test('readme includes usage examples for the template', () => {
        const { files, template } = generateProjectFiles({ ...baseOptions, template: 'exchange' });

        for (const example of template.usage) {
            expect(files['README.md']).toContain(example.payload);
        }
    });

    test('includes an offline starter test and graceful shutdown wiring', () => {
        const { files } = generateProjectFiles(baseOptions);

        expect(files['tests/greeting.contract.spec.ts']).toContain("from 'hive-stream/testing'");
        expect(files['tests/greeting.contract.spec.ts']).toContain("from 'hive-stream/client'");
        expect(files['src/index.ts']).toContain('streamer.enableGracefulShutdown();');
        expect(files['src/index.ts']).not.toContain("process.on('SIGINT'");
        expect(files['README.md']).toContain('npm run verify');
    });

    test('returns next steps and defaults optional options', () => {
        const { files, nextSteps } = generateProjectFiles({ name: 'my-app', template: 'minimal', adapter: 'sqlite' });
        const pkg = JSON.parse(files['package.json']);

        expect(pkg.dependencies['hive-stream']).toBe(`^${HIVE_STREAM_VERSION}`);
        expect(files['.env.example']).toContain('HIVE_USERNAME=\n');
        expect(files['.env.example']).toContain('# API_ENABLED=true');
        expect(nextSteps).toEqual(getNextSteps('my-app'));
        expect(getNextSteps('my-app')).toContain('npm install');
        expect(getNextSteps('my-app', { installed: true })).not.toContain('npm install');
    });

    test('the browser-safe scaffold entry generates the same project as the CLI module', () => {
        expect(scaffoldEntry.generateProjectFiles(baseOptions).files).toEqual(generateProjectFiles(baseOptions).files);
        expect(scaffoldEntry.TEMPLATES).toBe(TEMPLATES);
        expect(scaffoldEntry.ADAPTERS).toBe(ADAPTERS);
    });
});

describe('writeProjectFiles and isDirectoryUsable', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-stream-cli-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test('writes all files to disk with nested directories', () => {
        const target = path.join(tmpDir, 'my-app');
        const { files } = generateProjectFiles(baseOptions);
        const written = writeProjectFiles(target, files);

        expect(written).toHaveLength(Object.keys(files).length);

        for (const relativePath of written) {
            expect(fs.existsSync(path.join(target, relativePath))).toBe(true);
        }

        expect(fs.readFileSync(path.join(target, 'package.json'), 'utf8')).toBe(files['package.json']);
    });

    test('reports non-empty directories as unusable', () => {
        const target = path.join(tmpDir, 'existing');

        fs.mkdirSync(target);
        expect(isDirectoryUsable(target).usable).toBe(true);

        fs.writeFileSync(path.join(target, 'file.txt'), 'hello');
        expect(isDirectoryUsable(target).usable).toBe(false);
    });

    test('reports files as unusable targets', () => {
        const target = path.join(tmpDir, 'a-file');

        fs.writeFileSync(target, 'hello');

        const result = isDirectoryUsable(target);

        expect(result.usable).toBe(false);
        expect(result.reason).toMatch(/file/i);
    });

    test('ignores .git when checking emptiness', () => {
        const target = path.join(tmpDir, 'with-git');

        fs.mkdirSync(path.join(target, '.git'), { recursive: true });
        expect(isDirectoryUsable(target).usable).toBe(true);
    });
});

describe('CLI argument guardrails', () => {
    let tmpDir: string;
    const cli = path.resolve(__dirname, '../src/cli/index.ts');
    const tsx = path.resolve(__dirname, '../node_modules/.bin/tsx');

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-stream-cli-process-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    function run(args: string[]) {
        return spawnSync(tsx, [cli, ...args], {
            cwd: tmpDir,
            encoding: 'utf8'
        });
    }

    test('supports equals syntax for value flags', () => {
        const result = run([
            'new',
            'equals-app',
            '--template=game',
            '--adapter=mongodb',
            '--username=test-app',
            '--yes'
        ]);

        expect(result.status).toBe(0);
        expect(fs.existsSync(path.join(tmpDir, 'equals-app', 'package.json'))).toBe(true);
    });

    test('rejects a path as the project name with a specific message', () => {
        const result = run(['new', './nested/app', '--yes']);

        expect(result.status).toBe(1);
        expect(result.stderr).toContain('must be a bare directory name, not a path');
        expect(result.stderr).not.toContain('lowercase');
        expect(fs.existsSync(path.join(tmpDir, 'nested'))).toBe(false);
    });

    test('rejects unknown flags instead of silently using defaults', () => {
        const result = run(['new', 'typo-app', '--templta=game', '--yes']);

        expect(result.status).toBe(1);
        expect(result.stderr).toContain("Unknown option '--templta=game'");
        expect(fs.existsSync(path.join(tmpDir, 'typo-app'))).toBe(false);
    });

    test('rejects new-only flags and extra arguments on list', () => {
        const flagResult = run(['list', '--template=minimal']);
        const argumentResult = run(['list', 'extra']);

        expect(flagResult.status).toBe(1);
        expect(flagResult.stderr).toContain('Option --template is only valid with the new command.');
        expect(argumentResult.status).toBe(1);
        expect(argumentResult.stderr).toContain("Unexpected argument 'extra'");
    });

    test('rejects command-specific flags when no command was supplied', () => {
        const result = run(['--api']);

        expect(result.status).toBe(1);
        expect(result.stderr).toContain('Option --api requires a command.');
    });

    test('rejects incompatible storage before creating the directory', () => {
        const result = run([
            'new',
            'broken-app',
            '--template=exchange',
            '--adapter=mongodb',
            '--username=test-app',
            '--yes'
        ]);

        expect(result.status).toBe(1);
        expect(result.stderr).toMatch(/requires sql storage/i);
        expect(fs.existsSync(path.join(tmpDir, 'broken-app'))).toBe(false);
    });
});
