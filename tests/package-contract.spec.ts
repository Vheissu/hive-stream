const packageJson = require('../package.json');

describe('package contract', () => {
    test('declares an explicit root export for consumers', () => {
        expect(packageJson.main).toBe('dist/index.js');
        expect(packageJson.types).toBe('dist/index.d.ts');
        expect(packageJson.exports).toEqual(expect.objectContaining({
            '.': {
                types: './dist/index.d.ts',
                require: './dist/index.js',
                default: './dist/index.js'
            },
            './package.json': './package.json'
        }));
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
