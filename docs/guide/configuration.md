# Configuration

Every configuration value is optional. Read-only streaming needs no keys at all; write operations need `activeKey` and/or `postingKey` plus a `username`.

```ts
const streamer = new Streamer({
    env: true,
    activeKey: '',
    postingKey: '',
    username: '',
    jsonId: 'hivestream',
    payloadIdentifier: 'hive_stream',
    appName: 'hive-stream',
    hiveEngineApi: 'https://api.hive-engine.com/rpc',
    hiveEngineId: 'ssc-mainnet-hive',
    lastBlockNumber: 0,
    blockCheckInterval: 1000,
    blocksBehindWarning: 25,
    resumeFromState: true,
    catchUpBatchSize: 50,
    catchUpDelayMs: 0,
    apiNodes: ['https://api.hive.blog', 'https://api.openhive.network', 'https://rpc.ausbit.dev'],
    apiEnabled: false,
    apiPort: 5001,
    debugMode: false
});
```

CamelCase keys are recommended; legacy uppercase keys (`ACTIVE_KEY`, `USERNAME`, …) still work.

## Environment variables

Pass `env: true` to load credentials from the environment. Hive Stream reads canonical names (`ACTIVE_KEY`, `POSTING_KEY`, `USERNAME`) plus Hive-friendly aliases (`HIVE_ACCOUNT`, `HIVE_ACTIVE_KEY`, `HIVE_POSTING_KEY`).

```ts
const streamer = new Streamer({ env: true });
```

## Key settings explained

| Setting | What it does |
| --- | --- |
| `blockCheckInterval` | How often to poll for new blocks (ms). Keep the 1000ms default. |
| `blocksBehindWarning` | Warn to the console after falling this many blocks behind head. |
| `resumeFromState` | Resume from the adapter's stored block on restart (default `true`). Set `false` and supply `lastBlockNumber` to force a start block. |
| `catchUpBatchSize` | Blocks processed per polling cycle when behind. |
| `catchUpDelayMs` | Delay between catch-up batches. `0` for fastest catch-up. |
| `apiNodes` | Hive API endpoints, used in order with automatic failover. |
| `apiEnabled` / `apiPort` | Boot the built-in Express API from `start()`. Also available on demand via `startApiServer()`. |
| `jsonId` | The custom JSON id your app listens on for contract payloads. |
| `payloadIdentifier` | The wrapper key contract payloads live under in memos and JSON bodies. |

## Changing config at runtime

```ts
streamer.setConfig({
    activeKey: 'newactivekey',
    username: 'newusername'
});
```

Useful when multiple keys are used for issuing, or when credentials rotate.

## Advanced injection

The constructor accepts two infrastructure overrides alongside regular config:

- `blockProvider` — where blocks come from. Defaults to the Hive API; the testing kit supplies an in-memory provider, and a HAF provider ships in `hive-stream/providers`.
- `client` — the dhive client used for reads and broadcasts. Inject a preconfigured client (custom timeouts) or a fake (captured broadcasts). An injected client is never replaced by `setConfig`.
