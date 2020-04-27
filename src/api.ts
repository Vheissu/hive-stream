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

        app.get('/json/contract/.:contractName', async (req, res) => {
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
    }
}