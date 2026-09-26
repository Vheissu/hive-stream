import { requireOptionalDependency } from '../src/optional-dependency';

describe('requireOptionalDependency', () => {
    test('returns the module when it is installed', () => {
        const pg = requireOptionalDependency<typeof import('pg')>('pg', 'HafClient');

        expect(typeof pg.Client).toBe('function');
    });

    test('explains how to install a missing optional dependency', () => {
        expect(() => requireOptionalDependency('hive-stream-missing-driver', 'SomeAdapter'))
            .toThrow("SomeAdapter requires the optional dependency 'hive-stream-missing-driver'. Install it with: npm install hive-stream-missing-driver");
    });
});
