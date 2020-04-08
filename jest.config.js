module.exports = {
    globals: {
        'ts-jest': {
            tsConfig: 'tsconfig.json'
        }
    },
    setupFilesAfterEnv: ["<rootDir>/tests/setup.ts"],
    moduleFileExtensions: ['ts', 'js'],
    transform: {
        '^.+\\.(ts|tsx)$': 'ts-jest'
    },
    testMatch: ['**/tests/**/*.spec.(ts)'],
    testEnvironment: 'node'
};