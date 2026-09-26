module.exports = {
    setupFilesAfterEnv: ["<rootDir>/tests/setup.ts"],
    moduleFileExtensions: ['ts', 'js'],
    transform: {
        '^.+\\.(ts|tsx)$': 'ts-jest'
    },
    testMatch: ['**/tests/**/*.spec.(ts)'],
    testEnvironment: 'node',
    modulePathIgnorePatterns: ['<rootDir>/.claude/', '<rootDir>/dist/'],
    testPathIgnorePatterns: ['/node_modules/', '<rootDir>/.claude/']
};