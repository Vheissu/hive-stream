import express from 'express';

const app = express();
const port = 5001;

export class Api {
    public server;
    public streamer;

    constructor(streamer) {
        this.streamer = streamer;

        this.setupRoutes();

        this.server = app.listen(port, () => {
            console.log(`Running server on port ${port}`);
        });
    }

    private setupRoutes() {
        app.get('/transfers', async (req, res) => {
            const transfers = await this.streamer.adapter.getTransfers();

            res.json(transfers);
        });

        app.get('/transfers/contract/:contractName', async (req, res) => {
            const transfers = await this.streamer.adapter.getTransfersByContract(req.params.contractName);

            res.json(transfers);
        });

        app.get('/transfers/account/:account', async (req, res) => {
            const transfers = await this.streamer.adapter.getTransfersByAccount(req.params.account);

            res.json(transfers);
        });

        app.get('/transfers/block/:blockId', async (req, res) => {
            const transfers = await this.streamer.adapter.getTransfersByBlockid(req.params.blockId);

            res.json(transfers);
        });

        app.get('/json', async (req, res) => {
            const jsons = await this.streamer.adapter.getJson();

            res.json(jsons);
        });

        app.get('/json/contract/:contractName', async (req, res) => {
            const jsons = await this.streamer.adapter.getJsonByContract(req.params.contractName);

            res.json(jsons);
        });

        app.get('/json/account/:account', async (req, res) => {
            const jsons = await this.streamer.adapter.getJsonByAccount(req.params.account);

            res.json(jsons);
        });

        app.get('/json/block/:blockId', async (req, res) => {
            const jsons = await this.streamer.adapter.getJsonByBlockid(req.params.blockId);

            res.json(jsons);
        });

        app.get('/events', async (req, res) => {
            const events = await this.streamer.adapter.getEvents();

            res.json(events);
        });

        app.get('/events/contract/:contractName', async (req, res) => {
            const events = await this.streamer.adapter.getEventsByContract(req.params.contractName);

            res.json(events);
        });

        app.get('/events/account/:account', async (req, res) => {
            const events = await this.streamer.adapter.getEventsByAccount(req.params.account);

            res.json(events);
        });

        app.get('/health', async (req, res) => {
            const health = {
                status: 'ok',
                timestamp: new Date().toISOString(),
                uptime: process.uptime(),
                version: process.env.npm_package_version || '1.0.0'
            };

            res.json(health);
        });

        app.get('/stats', async (req, res) => {
            try {
                const [transfers, customJson, events] = await Promise.all([
                    this.streamer.adapter.getTransfers(),
                    this.streamer.adapter.getJson(),
                    this.streamer.adapter.getEvents()
                ]);

                const stats = {
                    totalTransfers: transfers?.length || 0,
                    totalCustomJson: customJson?.length || 0,
                    totalEvents: events?.length || 0,
                    lastUpdated: new Date().toISOString()
                };

                res.json(stats);
            } catch (error) {
                res.status(500).json({ error: 'Failed to retrieve statistics' });
            }
        });
    }
}