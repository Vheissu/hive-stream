const packageJson = require('../package.json');

describe('package contract', () => {
    test('declares an explicit root export for consumers', () => {
        expect(packageJson.main).toBe('dist/index.js');
        expect(packageJson.types).toBe('dist/index.d.ts');
        expect(packageJson.exports).toEqual(expect.objectContaining({
            '.': {
                types: './dist/index.d.ts',
                import: './dist/index.mjs',
                require: './dist/index.js',
                default: './dist/index.js'
            },
            './testing': {
                types: './dist/testing/index.d.ts',
                import: './dist/testing/index.mjs',
                require: './dist/testing/index.js',
                default: './dist/testing/index.js'
            },
            './client': {
                types: './dist/client/index.d.ts',
                import: './dist/client/index.mjs',
                require: './dist/client/index.js',
                default: './dist/client/index.js'
            },
            './scaffold': {
                types: './dist/scaffold/index.d.ts',
                import: './dist/scaffold/index.mjs',
                require: './dist/scaffold/index.js',
                default: './dist/scaffold/index.js'
            },
            './catalog': {
                types: './dist/catalog/index.d.ts',
                import: './dist/catalog/index.mjs',
                require: './dist/catalog/index.js',
                default: './dist/catalog/index.js'
            },
            './package.json': './package.json'
        }));
    });

    test('build generates the ESM wrappers referenced by the exports map', () => {
        expect(packageJson.scripts.build).toContain('npm run clean');
        expect(packageJson.scripts.build).toContain('generate-esm-wrappers');

        const wrapperScript = require('fs').readFileSync(require('path').join(__dirname, '..', 'scripts', 'generate-esm-wrappers.js'), 'utf8');

        for (const [subpath, target] of Object.entries<any>(packageJson.exports)) {
            if (typeof target === 'object' && target.import) {
                expect({ subpath, wrapped: wrapperScript.includes(target.import.replace('./', '')) }).toEqual({ subpath, wrapped: true });
            }
        }
    });

    test('build regenerates the version constant and contract catalog', () => {
        expect(packageJson.scripts.build).toContain('generate-version');
        expect(packageJson.scripts.build).toContain('catalog:gen');
    });

    test('whitelists the publishable package contents', () => {
        expect(packageJson.files).toEqual(expect.arrayContaining([
            'dist',
            'README.md',
            'DOCUMENTATION.md',
            'CHANGELOG.md',
            'LICENSE'
        ]));
    });
});
