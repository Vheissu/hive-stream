# Reliability, Hooks And Guards (4.0)

## Defaults that matter for money

- `streamMode: 'irreversible'` (default) processes blocks up to `last_irreversible_block_num`. `'head'` follows head with fork detection: it rewinds to the common ancestor (up to `maxForkDepth`, default 20), fires `onFork` with the orphaned blocks, and halts if no ancestor is found. Actions from orphaned-only transactions already ran and can't be undone.
- `checkpointMode: 'block'` (default) saves the cursor after every block. `'interval'` + `checkpointIntervalMs` saves less often.
- `idempotency: true` (default): each contract action is recorded in the adapter's ledger keyed by transaction id + operation index (time actions by id + block) and skipped on replay. `idempotencyRetentionBlocks` (default 201600) controls pruning. `replayBlocks(from, to, { force: true })` bypasses it.
- The ledger is written after the handler returns. A crash in between re-runs the action. Handlers that broadcast payouts should record their own side effect keyed by `ctx.transaction.id` + `ctx.transaction.operationIndex` before or with the broadcast.
- Subscriptions (`onTransfer` etc.) are NOT covered by the ledger. They are at-least-once.
- Rejected actions (guards, vetoes, invalid payloads) are NOT recorded in the ledger. A refund issued from `onActionRejected` must dedupe itself, e.g. `adapter.hasProcessedOperation(key)` / `markOperationProcessed({ key, blockNumber, status })` with a `refund:` prefixed key, and must skip reason `duplicate`.

## Error policy

`errorPolicy`: `'skip'` (default) logs and continues; `'halt'` stops at the failing block (`getHealth().status === 'halted'`, `getStatus().lastError`); `'retry'` retries `errorMaxRetries` times with doubling `errorRetryDelayMs`, then halts. Recommend `'halt'` for bridges, custody and payouts. Block fetch failures never halt: they back off up to `retryMaxDelayMs` and fail over across `apiNodes` with `apiTimeoutMs` per request.

## Config

Validated at construction and on `setConfig()`; problems throw `ConfigValidationError` listing every issue. `defineConfig()` types a config module; `validateConfig(createConfig(input))` runs the checks. New keys also read from env with uppercase names (`STREAM_MODE`, `ERROR_POLICY`, `CHECKPOINT_MODE`, `IDEMPOTENCY_ENABLED`, ...).

## Streamer hooks

Register via `hooks: {...}` in config, `streamer.hook(name, fn)` (returns a disposer), or `streamer.use(plugin)` where a plugin is a hooks object or `(streamer) => hooks`. `defineHooks()` types a plugin. Unknown names throw.

| Hook | Notes |
| --- | --- |
| `onStart`, `onStop` | lifecycle |
| `beforeBlock`, `afterBlock` | `afterBlock` runs after the checkpoint |
| `beforeOperation` | return `false` to skip the operation; context has `type`, `data`, `transactionId`, `transactionIndex`, `operationIndex` |
| `afterOperation` | |
| `beforeContractAction` | return `false` to veto, `{ payload }` to replace; throwing vetoes (fail closed) |
| `afterContractAction` | only after success; has `durationMs` |
| `onContractError` | `attempt`, `willRetry` |
| `onInvalidPayload` | zod `issues` |
| `onActionRejected` | `reason`: `contract_not_found`, `action_not_found`, `trigger_not_allowed`, `active_key_required`, `paused`, `sender_not_allowed`, `asset_not_allowed`, `amount_too_low`, `amount_too_high`, `rate_limited`, `vetoed`, `duplicate` |
| `onFork` | `commonAncestor`, `orphanedBlocks` |
| `onError` | `phase` (`block`, `operation`, `adapter`, `contract`, `action`, `subscription`, `hook`, `checkpoint`, `fork`), `fatal` |
| `onCaughtUp`, `onCheckpoint` | |

Hooks and subscription callbacks are awaited in order. A slow one slows the stream: queue long work.

## Contract hooks and guards

`defineContract({ hooks: { create, destroy, beforeAction, afterAction, onError } })`. `beforeAction` returning `false` vetoes.

Guards on the contract (`guards`) or an action (`action(fn, { guards })`), action overriding contract field by field:

- `allowedSenders`, `blockedSenders`
- `allowedAssets` (case-insensitive), `minAmount`, `maxAmount` (inclusive; only for amount-carrying triggers)
- `rateLimit: { max, windowSeconds }` (blockchain time, in memory, resets on restart)
- `paused: true`

Guards never refund. Built-in factories accept guards by spreading: `registerContract({ ...createDiceContract(opts), guards: {...} })`. Runtime switches: `pauseContract(name, action?)`, `resumeContract()`, `isContractPaused()`.

## Order inside a block

`beforeBlock` → adapter `processBlock` → `onBlock` subscribers (receive THIS block's number) → per operation: `beforeOperation` → adapter → subscribers and contracts → `afterOperation` → due time actions (block timestamp) → checkpoint → `afterBlock`.
