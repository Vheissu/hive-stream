# Reliability, Hooks And Guards (5.x)

## Defaults that matter for money

- `streamMode: 'irreversible'` (default) processes blocks up to `last_irreversible_block_num`. `'head'` follows head with fork detection: it rewinds to the common ancestor (up to `maxForkDepth`, default 20), fires `onFork` with the orphaned blocks, and halts if no ancestor is found. Actions from orphaned-only transactions already ran and can't be undone.
- `checkpointMode: 'block'` (default) saves the cursor after every block. `'interval'` + `checkpointIntervalMs` saves less often. A checkpoint write failure follows `errorPolicy`.
- `idempotency: true` (default): each contract action is recorded in the adapter's ledger (`processed_operations`) keyed by transaction id + operation index (time actions by id + block) and skipped on replay. `idempotencyRetentionBlocks` (default 201600, about 7 days) controls pruning. `replayBlocks(from, to, { force: true })` bypasses it.
- Rejections are recorded too (except `contract_not_found`, `action_not_found` and `duplicate`), so `onActionRejected` and any refund fire once per transfer, even across replays.
- Escrow lifecycle triggers (`escrow_approve`/`escrow_dispute`/`escrow_release`) get one ledger key per receiving action.
- Transfer flows (`flows.auto*`) key each transfer by transaction id + operation index and record their payouts in the same ledger, so a replay never pays twice.
- The ledger is written after the handler returns. A crash in between re-runs the action. Handlers that broadcast payouts should record their own side effect keyed by `operationRecordId(ctx.transaction.id, ctx.transaction.operationIndex)` before the broadcast and check it first. Treat a failed broadcast as unknown (it may have landed): mark it pending/failed for a retry action, never refund from a catch block after a payout was attempted.
- Under `errorPolicy: 'retry'` a failed ledger write is retried on its own; the handler is never re-run for it.
- Subscriptions (`onTransfer` etc.) are NOT covered by the ledger. They are at-least-once.

## Refunding rejected transfers

`refundRejectedTransfers: true` (`REFUND_REJECTED_TRANSFERS`, default `false`) sends a transfer to an app account whose contract action was rejected (invalid payload, guard, pause, veto, unknown action) back to the sender with a `[Refund] <reason>` memo, from the account that received it. The rejection is written to the ledger first, so replays never refund twice. Duplicates, `recipient_not_allowed` (not the app's money) and transfers from app accounts are never refunded. Recommend it for every app that takes payments; when it is on, don't also refund in `onActionRejected`.

## Error policy

`errorPolicy`: `'skip'` (default) logs and continues; `'halt'` stops at the failing block (`getHealth().status === 'halted'`, `getStatus().lastError`); `'retry'` retries `errorMaxRetries` times with doubling `errorRetryDelayMs`, then halts. Recommend `'halt'` for bridges, custody and payouts. After a halt, fix the cause and call `start()` again: it resumes at the failed block. Block fetch failures never halt: they back off up to `retryMaxDelayMs` and fail over across `apiNodes` with `apiTimeoutMs` per request.

## Config

Validated at construction and on `setConfig()`; problems throw `ConfigValidationError` listing every issue, and a failed `setConfig()` keeps the previous config. Unparseable env values (`IDEMPOTENCY_ENABLED=ture`) are errors, not silent defaults. `defineConfig()` types a config module; `validateConfig(createConfig(input))` runs the checks. Keys also read from env with uppercase names (`STREAM_MODE`, `ERROR_POLICY`, `CHECKPOINT_MODE`, `IDEMPOTENCY_ENABLED`, `API_HOST`, `REFUND_REJECTED_TRANSFERS`, `HIVE_ACCOUNTS`, ...). Use `HIVE_ACCOUNT` for the app account, not `USERNAME`.

## Streamer hooks

Register via `hooks: {...}` in config, `streamer.hook(name, fn)` (returns a disposer), or `streamer.use(plugin)` where a plugin is a hooks object or `(streamer) => hooks`. `defineHooks()` types a plugin. Unknown names throw.

| Hook | Notes |
| --- | --- |
| `onStart`, `onStop` | lifecycle |
| `beforeBlock`, `afterBlock` | `afterBlock` runs after the checkpoint |
| `beforeOperation` | return `false` to skip the operation; throwing also skips it (fail closed); context has `type`, `data`, `transactionId`, `transactionIndex`, `operationIndex` |
| `afterOperation` | |
| `beforeContractAction` | return `false` to veto, `{ payload }` to replace (the replacement is validated against the action schema); throwing vetoes (fail closed) |
| `afterContractAction` | only after success; has `durationMs` |
| `onContractError` | `attempt`, `willRetry` |
| `onInvalidPayload` | zod `issues` |
| `onActionRejected` | `reason`: `contract_not_found`, `action_not_found`, `trigger_not_allowed`, `active_key_required`, `paused`, `sender_not_allowed`, `recipient_not_allowed`, `asset_not_allowed`, `amount_too_low`, `amount_too_high`, `rate_limited`, `vetoed`, `duplicate` |
| `onFork` | `commonAncestor`, `orphanedBlocks` |
| `onError` | `phase` (`block`, `operation`, `adapter`, `contract`, `action`, `subscription`, `hook`, `checkpoint`, `fork`), `fatal` |
| `onCaughtUp`, `onCheckpoint` | |

Any other hook that throws is logged and reported to `onError` (phase `hook`) and processing continues. Hooks and subscription callbacks are awaited in order. A slow one slows the stream: queue long work. Alert on `onError` with `fatal: true` and on bursts of `recipient_not_allowed` / `rate_limited` (probing).

## Contract hooks and guards

`defineContract({ hooks: { create, destroy, beforeAction, afterAction, onError } })`. `beforeAction` returning `false` vetoes.

Guards on the contract (`guards`) or an action (`action(fn, { guards })`), action overriding contract field by field. They run after schema validation and before `beforeContractAction`; unknown guard keys throw in `defineContract()`.

- `allowedSenders`, `blockedSenders`
- `allowedRecipients`: accounts a transfer-triggered action accepts payment to. Defaults to every app account (`getAppAccounts()`); `['*']` accepts any recipient, for non-custodial actions that verify `ctx.transfer.to` themselves (the built-in `buyNFTDirect` and `buyTicketDirect` do this). With no username, no `accounts` and no `allowedRecipients`, every transfer is rejected and a warning is logged at registration. Set it when a built-in's house `account` differs from the streamer username.
- `allowedAssets` (case-insensitive), `minAmount`, `maxAmount` (inclusive; only for amount-carrying triggers `transfer`/`recurrent_transfer`; they compare numbers regardless of asset, so pair them with `allowedAssets`, which the streamer warns about at registration)
- `rateLimit: { max, windowSeconds }` (blockchain time, in memory, resets on restart)
- `paused: true`

Guards never refund by themselves; `refundRejectedTransfers` does. Built-in factories accept guards by spreading: `registerContract({ ...createDiceContract(opts), guards: {...} })`. Runtime switches: `pauseContract(name, action?)`, `resumeContract()`, `isContractPaused()`. A due time action on a paused contract skips that tick.

## Order inside a block

`beforeBlock` -> adapter `processBlock` -> `onBlock` subscribers (receive THIS block's number) -> per operation: `beforeOperation` -> adapter -> subscribers and contracts -> `afterOperation` -> due time actions (block timestamp) -> checkpoint -> `afterBlock`.

## Operations checklist

- Dedicated app account; never the owner key; keys from env or a secret manager. `setConfig({ activeKey })` rotates without a restart.
- `streamMode: 'irreversible'`, `errorPolicy: 'halt'`, `refundRejectedTransfers: true` for money.
- `requiresActiveKey: true` on every value-moving `custom_json` action.
- Cap payouts by bankroll; amounts with BigNumber, never floats.
- One streamer process per set of app accounts; keep a stopped standby rather than two live instances.
- Keep the API on loopback unless an authenticating proxy is in front.
- Full checklist: `docs/guide/security.md`; first-run problems: `docs/guide/troubleshooting.md`.
