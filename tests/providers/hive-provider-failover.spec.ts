import http from 'http';
import type { AddressInfo } from 'net';

import { HiveProvider } from '../../src/providers/hive-provider';

function listen(handler: http.RequestListener): Promise<{ server: http.Server; url: string }> {
    return new Promise((resolve) => {
        const server = http.createServer(handler);
        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address() as AddressInfo;
            resolve({ server, url: `http://127.0.0.1:${port}` });
        });
    });
}

function close(server: http.Server): Promise<void> {
    return new Promise((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
    });
}

describe('HiveProvider node failover', () => {
    test('fails over to the next API node when the first one is down', async () => {
        let deadHits = 0;
        let healthyHits = 0;

        const dead = await listen((req) => {
            deadHits++;
            // Drop the connection without a response, like a crashed node.
            req.socket.destroy();
        });

        const healthy = await listen((req, res) => {
            healthyHits++;
            let body = '';
            req.on('data', (chunk) => { body += chunk; });
            req.on('end', () => {
                const request = JSON.parse(body);
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({
                    jsonrpc: '2.0',
                    id: request.id,
                    result: {
                        head_block_number: 100,
                        last_irreversible_block_num: 98,
                        time: '2026-01-01T00:00:00'
                    }
                }));
            });
        });

        try {
            const provider = new HiveProvider({ apiNodes: [dead.url, healthy.url], timeout: 5000 });
            const props = await provider.getDynamicGlobalProperties();

            expect(props.head_block_number).toBe(100);
            expect(props.last_irreversible_block_num).toBe(98);
            expect(deadHits).toBeGreaterThanOrEqual(1);
            expect(healthyHits).toBeGreaterThanOrEqual(1);
        } finally {
            await close(dead.server);
            await close(healthy.server);
        }
    }, 15000);

    test('rejects an empty node list', () => {
        expect(() => new HiveProvider({ apiNodes: [] })).toThrow(/at least one API node/);
    });
});
