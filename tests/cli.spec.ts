import fs from 'fs';
import os from 'os';
import path from 'path';

import {
    generateProjectFiles,
    isDirectoryUsable,
    validateProjectName,
    writeProjectFiles
} from '../src/cli/scaffold';
import { ADAPTERS, TEMPLATES, getAdapter, getTemplate } from '../src/cli/templates';

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
            'package.json',
            'src/contracts/greeting.contract.ts',
            'src/index.ts',
            'tsconfig.json'
        ]);
    });

    test('package.json is valid and pins hive-stream', () => {
        const { files } = generateProjectFiles(baseOptions);
        const pkg = JSON.parse(files['package.json']);

        expect(pkg.name).toBe('my-app');
        expect(pkg.dependencies['hive-stream']).toBe('^3.0.5');
        expect(pkg.scripts.dev).toBe('ts-node src/index.ts');
    });

    test('throws on unknown template or adapter', () => {
        expect(() => generateProjectFiles({ ...baseOptions, template: 'bogus' })).toThrow(/Unknown template/);
        expect(() => generateProjectFiles({ ...baseOptions, adapter: 'bogus' })).toThrow(/Unknown adapter/);
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

    test('username is embedded as fallback account', () => {
        const { files } = generateProjectFiles({ ...baseOptions, template: 'game', username: 'dice-bank' });

        expect(files['src/index.ts']).toContain(`process.env.HIVE_USERNAME ?? 'dice-bank'`);
        expect(files['.env.example']).toContain('HIVE_USERNAME=dice-bank');
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
