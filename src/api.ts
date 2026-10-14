import { getLogger } from './logger';
import express from 'express';
import cors from 'cors';
import type { Server } from 'http';

interface ApiOptions {
    port?: number;
    /** Interface to bind. Defaults to loopback so the unauthenticated API is never exposed by accident. */
    host?: string;
}

const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 1000;

/** Reads `?limit=` and `?offset=` with sane bounds so one request can't load a whole table. */
function pageOptions(req: express.Request): { limit: number; offset: number } {
    const rawLimit = Number.parseInt(String(req.query.limit ?? ''), 10);
    const rawOffset = Number.parseInt(String(req.query.offset ?? ''), 10);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, MAX_PAGE_SIZE) : DEFAULT_PAGE_SIZE;
    const offset = Number.isFinite(rawOffset) && rawOffset > 0 ? rawOffset : 0;

    return { limit, offset };
}

type RouteHandler = (req: express.Request, res: express.Response) => Promise<void> | void;

export class Api {
    public readonly app = express();
    public readonly streamer;
    public readonly port: number;
    public readonly host: string;
    public server: Server | null = null;

    constructor(streamer, options: ApiOptions = {}) {
        this.streamer = streamer;
        this.port = options.port ?? 5001;
        this.host = options.host ?? '127.0.0.1';

        this.app.use(cors());
        this.setupRoutes();
    }

    public async start(): Promise<Server> {
        if (this.server) {
            return this.server;
        }

        this.server = await new Promise<Server>((resolve, reject) => {
            const server = this.app.listen(this.port, this.host, () => {
                getLogger().debug(`Running server on ${this.host}:${this.port}`);
                resolve(server);
            });

            server.once('error', reject);
        });

        return this.server;
    }

    public async stop(): Promise<void> {
        if (!this.server) {
            return;
        }

        const server = this.server;
        this.server = null;

        await new Promise<void>((resolve, reject) => {
            server.close((error) => {
                if (error) {
                    reject(error);
                    return;
                }

                resolve();
            });
        });
    }

    private route(path: string, handler: RouteHandler): void {
        this.app.get(path, async (req, res) => {
            try {
                await handler(req, res);
            } catch (error) {
                getLogger().error(`[Api] Failed handling GET ${path}:`, error);

                if (!res.headersSent) {
                    res.status(500).json({ error: 'Internal server error' });
                }
            }
        });
    }

    private setupRoutes() {
        this.route('/health', async (req, res) => {
            const health = this.streamer.getHealth();

            res.status(health.healthy ? 200 : 503).json({
                ...health,
                timestamp: new Date().toISOString(),
                uptime: process.uptime(),
                version: process.env.npm_package_version || '1.0.0'
            });
        });

        this.route('/status', async (req, res) => {
            res.json(this.streamer.getStatus());
        });

        this.route('/transfers', async (req, res) => {
            const transfers = await this.streamer.getAdapter().getTransfers(pageOptions(req));

            res.json(transfers);
        });

        this.route('/transfers/contract/:contractName', async (req, res) => {
            const transfers = await this.streamer.getAdapter().getTransfersByContract(req.params.contractName);

            res.json(transfers);
        });

        this.route('/transfers/account/:account', async (req, res) => {
            const transfers = await this.streamer.getAdapter().getTransfersByAccount(req.params.account);

            res.json(transfers);
        });

        this.route('/transfers/block/:blockId', async (req, res) => {
            const transfers = await this.streamer.getAdapter().getTransfersByBlockid(req.params.blockId);

            res.json(transfers);
        });

        this.route('/json', async (req, res) => {
            const jsons = await this.streamer.getAdapter().getJson(pageOptions(req));

            res.json(jsons);
        });

        this.route('/json/contract/:contractName', async (req, res) => {
            const jsons = await this.streamer.getAdapter().getJsonByContract(req.params.contractName);

            res.json(jsons);
        });

        this.route('/json/account/:account', async (req, res) => {
            const jsons = await this.streamer.getAdapter().getJsonByAccount(req.params.account);

            res.json(jsons);
        });

        this.route('/json/block/:blockId', async (req, res) => {
            const jsons = await this.streamer.getAdapter().getJsonByBlockid(req.params.blockId);

            res.json(jsons);
        });

        this.route('/events', async (req, res) => {
            const events = await this.streamer.getAdapter().getEvents(pageOptions(req));

            res.json(events);
        });

        this.route('/events/contract/:contractName', async (req, res) => {
            const events = await this.streamer.getAdapter().getEventsByContract(req.params.contractName);

            res.json(events);
        });

        this.route('/events/account/:account', async (req, res) => {
            const events = await this.streamer.getAdapter().getEventsByAccount(req.params.account);

            res.json(events);
        });

        this.route('/stats', async (req, res) => {
            const adapter = this.streamer.getAdapter();
            let counts = typeof adapter.getCounts === 'function' ? await adapter.getCounts() : null;

            if (!counts) {
                // Adapters without a count query fall back to loading the rows.
                const [transfers, customJson, events] = await Promise.all([
                    adapter.getTransfers(),
                    adapter.getJson(),
                    adapter.getEvents()
                ]);

                counts = {
                    transfers: transfers?.length || 0,
                    customJson: customJson?.length || 0,
                    events: events?.length || 0
                };
            }

            res.json({
                totalTransfers: counts.transfers,
                totalCustomJson: counts.customJson,
                totalEvents: counts.events,
                lastUpdated: new Date().toISOString()
            });
        });

        this.route('/exchange/balances', async (req, res) => {
            try {
                const account = req.query.account as string | undefined;
                const balances = await this.streamer.getAdapter().getExchangeBalances(account);
                res.json(balances);
            } catch (error) {
                res.status(501).json({ error: 'Exchange endpoints require a SQL-capable adapter' });
            }
        });

        this.route('/exchange/balances/:account', async (req, res) => {
            try {
                const balances = await this.streamer.getAdapter().getExchangeBalances(req.params.account);
                res.json(balances);
            } catch (error) {
                res.status(501).json({ error: 'Exchange endpoints require a SQL-capable adapter' });
            }
        });

        this.route('/exchange/orders', async (req, res) => {
            try {
                const filters = {
                    account: req.query.account as string | undefined,
                    base: req.query.base as string | undefined,
                    quote: req.query.quote as string | undefined,
                    status: req.query.status as string | undefined
                };
                const orders = await this.streamer.getAdapter().getExchangeOrders(filters);
                res.json(orders);
            } catch (error) {
                res.status(501).json({ error: 'Exchange endpoints require a SQL-capable adapter' });
            }
        });

        this.route('/exchange/orders/account/:account', async (req, res) => {
            try {
                const orders = await this.streamer.getAdapter().getExchangeOrders({ account: req.params.account });
                res.json(orders);
            } catch (error) {
                res.status(501).json({ error: 'Exchange endpoints require a SQL-capable adapter' });
            }
        });

        this.route('/exchange/trades', async (req, res) => {
            try {
                const filters = {
                    account: req.query.account as string | undefined,
                    base: req.query.base as string | undefined,
                    quote: req.query.quote as string | undefined
                };
                const trades = await this.streamer.getAdapter().getExchangeTrades(filters);
                res.json(trades);
            } catch (error) {
                res.status(501).json({ error: 'Exchange endpoints require a SQL-capable adapter' });
            }
        });

        this.route('/exchange/orderbook', async (req, res) => {
            try {
                const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
                const snapshots = await this.streamer.getAdapter().getExchangeOrderBookSnapshots({
                    base: req.query.base as string | undefined,
                    quote: req.query.quote as string | undefined,
                    limit
                });
                res.json(snapshots);
            } catch (error) {
                res.status(501).json({ error: 'Exchange endpoints require a SQL-capable adapter' });
            }
        });

        this.route('/exchange/orderbook/:base/:quote', async (req, res) => {
            try {
                const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
                const snapshots = await this.streamer.getAdapter().getExchangeOrderBookSnapshots({
                    base: req.params.base,
                    quote: req.params.quote,
                    limit
                });
                res.json(snapshots);
            } catch (error) {
                res.status(501).json({ error: 'Exchange endpoints require a SQL-capable adapter' });
            }
        });
    }
}
