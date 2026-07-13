import * as http from 'http';

import { consoleLogger, getLogger, Logger, resetLogger, setLogger } from '../src/logger';
import { createTestStreamer, hive, TestStreamer } from '../src/testing';

function collectLogger(): { logger: Logger; entries: Array<{ level: string; args: any[] }> } {
    const entries: Array<{ level: string; args: any[] }> = [];
    const make = (level: string) => (...args: any[]) => { entries.push({ level, args }); };

    return {
        logger: {
            debug: make('debug'),
            info: make('info'),
            warn: make('warn'),
            error: make('error')
        },
        entries
    };
}

function getJson(url: string): Promise<{ statusCode: number; body: any }> {
    return new Promise((resolve, reject) => {
        http.get(url, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => resolve({ statusCode: res.statusCode as number, body: JSON.parse(data) }));
        }).on('error', reject);
    });
}

describe('logger', () => {
    afterEach(() => {
        resetLogger();
    });

    test('defaults to the console logger and validates replacements', () => {
        expect(getLogger()).toBe(consoleLogger);
        expect(() => setLogger({} as Logger)).toThrow(/must implement/);
    });

    test('streamer routes library logs through an injected logger', async () => {
        const { logger, entries } = collectLogger();
        const ts = new TestStreamer({ logger });

        await ts.setup();

        // A wrapped payload naming an unregistered contract produces a warning
        await ts.contractJson('alice', { contract: 'nonexistent', action: 'nothing' });

        const warning = entries.find((e) => e.level === 'warn' && String(e.args[0]).includes(`Contract 'nonexistent' not found`));
        expect(warning).toBeDefined();

        await ts.stop();
    });
});

describe('getHealth', () => {
    let ts: TestStreamer;

    afterEach(async () => {
        await ts.stop();
        resetLogger();
    });

    test('reports stopped before start and ok once started', async () => {
        ts = await createTestStreamer();

        const before = ts.streamer.getHealth();
        expect(before.status).toBe('stopped');
        expect(before.healthy).toBe(false);
        expect(before.isStarted).toBe(false);

        await ts.streamer.start();
        await ts.advanceBlocks(1);

        const after = ts.streamer.getHealth();
        expect(after.status).toBe('ok');
        expect(after.healthy).toBe(true);
        expect(after.isStarted).toBe(true);
        expect(after.lastBlockNumber).toBeGreaterThan(0);
        expect(Array.isArray(after.contracts)).toBe(true);
    });

    test('serves /health and /status over the built-in API', async () => {
        ts = await createTestStreamer();
        const api = await ts.streamer.startApiServer(5099);

        const health = await getJson('http://127.0.0.1:5099/health');
        // Not started: unhealthy by design, so orchestrators wait for readiness
        expect(health.statusCode).toBe(503);
        expect(health.body.status).toBe('stopped');

        const status = await getJson('http://127.0.0.1:5099/status');
        expect(status.statusCode).toBe(200);
        expect(status.body).toHaveProperty('lastBlockNumber');
        expect(status.body).toHaveProperty('blocksBehind');

        await ts.streamer.stopApiServer();
        expect(api).toBeDefined();
    });
});

describe('enableGracefulShutdown', () => {
    afterEach(() => {
        resetLogger();
    });

    test('stops the streamer and exits on the first signal', async () => {
        const ts = await createTestStreamer();
        const stopSpy = jest.spyOn(ts.streamer, 'stop');
        const exitSpy = jest.spyOn(process, 'exit').mockImplementation((() => undefined) as any);

        // SIGUSR2 keeps the test isolated from real Ctrl+C handling
        const dispose = ts.streamer.enableGracefulShutdown(['SIGUSR2']);

        process.emit('SIGUSR2');
        await new Promise((resolve) => setTimeout(resolve, 150));

        expect(stopSpy).toHaveBeenCalled();
        expect(exitSpy).toHaveBeenCalledWith(0);

        dispose();
        expect(process.listeners('SIGUSR2')).toHaveLength(0);

        exitSpy.mockRestore();
    });
});

describe('replayBlocks', () => {
    afterEach(() => {
        resetLogger();
    });

    test('reprocesses a historical range and moves the cursor', async () => {
        const ts = await createTestStreamer({ username: 'myapp' });

        const seen: number[] = [];
        ts.streamer.onTransfer('myapp', (op: any, blockNumber: number) => {
            seen.push(blockNumber);
        });

        await ts.transfer('alice', 'myapp', hive(1), 'one');   // block 2
        await ts.transfer('bob', 'myapp', hive(2), 'two');     // block 3
        await ts.advanceBlocks(2);                              // blocks 4-5

        expect(seen).toEqual([2, 3]);

        const replayed = await ts.streamer.replayBlocks(2, 4);

        expect(replayed).toBe(3);
        expect(seen).toEqual([2, 3, 2, 3]);
        expect(ts.streamer.getStatus().lastBlockNumber).toBe(4);

        await expect(ts.streamer.replayBlocks(4, 2)).rejects.toThrow(/Invalid replay range/);

        await ts.stop();
    });

    test('refuses to replay while started', async () => {
        const ts = await createTestStreamer();
        await ts.streamer.start();

        await expect(ts.streamer.replayBlocks(1, 2)).rejects.toThrow(/Stop the streamer/);

        await ts.stop();
    });
});
