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
            './package.json': './package.json'
        }));
    });

    test('build generates the ESM wrappers referenced by the exports map', () => {
        expect(packageJson.scripts.build).toContain('generate-esm-wrappers');
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
