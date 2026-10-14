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
    apiHost: '127.0.0.1',             // loopback; the API has no authentication
    debugMode: false,
    logger: console,                  // anything with debug/info/warn/error

    // Reliability (4.0)
    streamMode: 'irreversible',       // or 'head'
    checkpointMode: 'block',          // or 'interval'
    checkpointIntervalMs: 5000,       // only used in 'interval' mode
    idempotency: true,
    idempotencyRetentionBlocks: 201600,
    errorPolicy: 'skip',              // or 'halt' / 'retry'
    errorMaxRetries: 3,
    errorRetryDelayMs: 500,
    retryMaxDelayMs: 30000,
    apiTimeoutMs: 10000,
    maxForkDepth: 20,
    refundRejectedTransfers: false,   // send rejected payments back (see Hooks & Guards)

    hooks: {}                         // see Hooks & Guards
});
```

CamelCase keys are recommended; legacy uppercase keys (`ACTIVE_KEY`, `USERNAME`, …) still work. `username` also accepts the aliases `account` and `hiveAccount`, and `idempotency` the alias `idempotencyEnabled`.

## Environment variables

Pass `env: true` to load `.env` (via dotenv) and read settings from the environment. Values from the environment only apply when `env` is set; explicit constructor values win over them.

```ts
const streamer = new Streamer({ env: true });
const streamer = new Streamer({ env: { path: '.env.production', override: true } });
```

| Setting | Environment variables, first match wins |
| --- | --- |
| `username` | `HIVE_ACCOUNT`, `HIVE_USERNAME`, `ACCOUNT`, `USERNAME` |
| `activeKey` | `HIVE_ACTIVE_KEY`, `ACTIVE_KEY` |
| `postingKey` | `HIVE_POSTING_KEY`, `POSTING_KEY` |
| everything else | the uppercase name (`STREAM_MODE`, `ERROR_POLICY`, `API_HOST`, `REFUND_REJECTED_TRANSFERS`, …) |

Use `HIVE_ACCOUNT` for the app account. Windows sets `USERNAME` to the OS login for every process, so a bare `USERNAME` is ignored there, and dotenv never overrides a variable that already exists. Booleans accept `true`/`false`, `1`/`0`, `yes`/`no`, `on`/`off`. A value that doesn't parse (`IDEMPOTENCY_ENABLED=ture`, `ERROR_MAX_RETRIES=5x`) is a `ConfigValidationError`, not a silent default.

## Several app accounts

An app can act as more than one account: a house account and a treasury, a marketplace and its escrow agent, one account per market. List the extra ones under `accounts`, each with the keys it signs with:

```ts
const streamer = new Streamer({
    env: true,                                   // HIVE_ACCOUNT, HIVE_ACTIVE_KEY, HIVE_POSTING_KEY for the primary account
    accounts: [
        { name: 'myapp-vault', activeKey: process.env.VAULT_ACTIVE_KEY },
        { name: 'myapp-agent', activeKey: process.env.AGENT_ACTIVE_KEY, postingKey: process.env.AGENT_POSTING_KEY }
    ]
});
```

From the environment, `HIVE_ACCOUNTS` takes the same list as JSON. `streamer.addAccount()` and `removeAccount()` change it at runtime; `getAppAccounts()` lists every account (primary first) and `isAppAccount(name)` checks one.

What that does:

- Transfers to any app account run contract actions (the default for the `allowedRecipients` guard is the whole list), and `ctx.transfer.to` tells the handler which account was paid.
- Every write method signs with the keys of the account it acts as: `transferHiveTokens('myapp-vault', ...)` uses the vault's active key, `follow('myapp-agent', ...)` the agent's posting key. A batch built with `streamer.batch()` or `broadcastOperations()` is signed with every key its operations need.
- `refundRejectedTransfers` refunds from the account that received the payment.
- An account listed without a key signs with the primary account's keys. That is for accounts that granted the app account authority on chain (`updateAccountAuthorities`), which is often simpler than handling several active keys.
- `onTransfer(['myapp', 'myapp-vault'], cb)` subscribes to several accounts at once.

The built-in contracts still pay from one account, `options.account` or the primary username; use several contract instances (one per account, with distinct `name`s) when each account runs its own market.

## Key settings explained

| Setting | What it does |
| --- | --- |
| `blockCheckInterval` | How often to poll for new blocks (ms). Keep the 1000ms default. |
| `blocksBehindWarning` | Warn to the console after falling this many blocks behind head. |
| `resumeFromState` | Resume from the adapter's stored block on restart (default `true`). Set `false` and supply `lastBlockNumber` to force a start block. |
| `catchUpBatchSize` | Blocks processed per polling cycle when behind. |
| `catchUpDelayMs` | Delay between catch-up batches. `0` for fastest catch-up. |
| `apiNodes` | Hive API endpoints, used in order with automatic failover. |
| `apiEnabled` / `apiPort` / `apiHost` | Boot the built-in Express API from `start()`. Also available on demand via `startApiServer()`. It binds to loopback by default; it has no authentication, so put a reverse proxy with auth in front before setting `apiHost: '0.0.0.0'`. |
| `logger` | Anything with `debug`/`info`/`warn`/`error` (pino, winston, …). Defaults to the console. |
| `jsonId` | The custom JSON id your app listens on for contract payloads. |
| `payloadIdentifier` | The wrapper key contract payloads live under in memos and JSON bodies. |

## Reliability settings

| Setting | Default | What it does |
| --- | --- | --- |
| `streamMode` | `'irreversible'` | `'irreversible'` only processes blocks that can't be reverted. `'head'` follows the head block for lower latency and handles forks. See [Streaming](./streaming#irreversible-vs-head-streaming). |
| `checkpointMode` | `'block'` | `'block'` saves the cursor after every block. `'interval'` saves at most every `checkpointIntervalMs` (fewer writes, more replay after a crash). |
| `idempotency` | `true` | Record every contract action so a replayed block never runs it twice. |
| `idempotencyRetentionBlocks` | `201600` | How long ledger rows are kept (about 7 days of blocks). |
| `errorPolicy` | `'skip'` | What happens when a contract handler or storage write fails. See [Production](./production#error-policy). |
| `errorMaxRetries` / `errorRetryDelayMs` | `3` / `500` | Retry count and base delay (doubling) for `errorPolicy: 'retry'`. |
| `retryMaxDelayMs` | `30000` | Ceiling for the backoff used when fetching blocks fails. |
| `apiTimeoutMs` | `10000` | Per-request timeout before failing over to the next API node. |
| `maxForkDepth` | `20` | How far back `head` mode searches for a common ancestor after a fork. |
| `refundRejectedTransfers` | `false` | Send transfers to the app account whose contract action was rejected back to the sender. Recommended for apps that take payments. See [Hooks & Guards](./hooks#guards). |

All of these can also be set from the environment with their uppercase names (`STREAM_MODE`, `ERROR_POLICY`, `CHECKPOINT_MODE`, `IDEMPOTENCY_ENABLED`, …).

## Validation

Configuration is validated when the `Streamer` is constructed and on every `setConfig()` call. Every problem is reported at once in a `ConfigValidationError`:

```text
Invalid hive-stream configuration:
  - BLOCK_CHECK_INTERVAL must be an integer >= 1 (received 0)
  - API_NODES contains an invalid URL: "api.hive.blog"
  - STREAM_MODE must be one of 'irreversible', 'head' (received "fast")
```

A failed `setConfig()` leaves the previous configuration in place. You can run the same checks yourself with `validateConfig(createConfig(input))`.

## Keeping config in its own module

`defineConfig()` is an identity helper that gives you type checking and autocomplete outside the constructor call:

```ts
// hive.config.ts
import { defineConfig } from 'hive-stream';

export default defineConfig({
    env: true,
    streamMode: 'irreversible',
    errorPolicy: 'halt',
    hooks: {
        onError: ({ error, fatal }) => fatal && pager.trigger(error.message)
    }
});
```

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

- `blockProvider` — where blocks come from. Defaults to the Hive API; the testing kit supplies an in-memory provider, and `HafProvider` (exported from `hive-stream`, needs `pg`) reads from a HAF database.
- `client` — the dhive client used for reads and broadcasts. Inject a preconfigured client or a fake (captured broadcasts). An injected client is never replaced by `setConfig`. The default client uses `apiTimeoutMs` and fails over across `apiNodes`.
