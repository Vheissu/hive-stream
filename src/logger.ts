/**
 * Pluggable logging for Hive Stream.
 *
 * By default all library output goes to the console, exactly as before.
 * Supply your own logger (pino, winston, anything matching the interface)
 * via `setLogger()` or the `logger` config option on the Streamer to get
 * structured logs in production.
 */
export interface Logger {
    debug(message?: any, ...meta: any[]): void;
    info(message?: any, ...meta: any[]): void;
    warn(message?: any, ...meta: any[]): void;
    error(message?: any, ...meta: any[]): void;
}

export const consoleLogger: Logger = {
    debug: (message?: any, ...meta: any[]) => console.log(message, ...meta),
    info: (message?: any, ...meta: any[]) => console.log(message, ...meta),
    warn: (message?: any, ...meta: any[]) => console.warn(message, ...meta),
    error: (message?: any, ...meta: any[]) => console.error(message, ...meta)
};

let activeLogger: Logger = consoleLogger;

export function setLogger(logger: Logger): void {
    if (!logger || typeof logger.error !== 'function' || typeof logger.warn !== 'function'
        || typeof logger.info !== 'function' || typeof logger.debug !== 'function') {
        throw new Error('Logger must implement debug, info, warn, and error methods');
    }

    activeLogger = logger;
}

export function resetLogger(): void {
    activeLogger = consoleLogger;
}

export function getLogger(): Logger {
    return activeLogger;
}
