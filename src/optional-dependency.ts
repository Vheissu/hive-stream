/**
 * Loads a package that hive-stream lists as an optional peer dependency,
 * so apps only install the drivers for the adapters they actually use.
 */
export function requireOptionalDependency<T = any>(name: string, feature: string): T {
    try {
        return require(name) as T;
    } catch (error) {
        const code = (error as NodeJS.ErrnoException)?.code;
        const message = String((error as Error)?.message ?? '');

        if (code === 'MODULE_NOT_FOUND' && message.includes(`'${name}'`)) {
            throw new Error(`${feature} requires the optional dependency '${name}'. Install it with: npm install ${name}`);
        }

        throw error;
    }
}
