# Troubleshooting

The short list of things that go wrong on a first run, and what to look at. Turn on `debugMode: true` (or `DEBUG_MODE=true`) to see every dispatch decision in the log.

## My contract never fires

Work through these in order; the log line for each rejection names the reason.

1. **Is the payload wrapped and addressed to your app?** A transfer memo or `custom_json` body must be `{"hive_stream":{"contract":"...","action":"...","payload":{...}}}` (the wrapper key is `payloadIdentifier`), and a `custom_json` operation must use your `jsonId` (`hivestream` by default). Anything else is ignored silently, because it isn't yours.
2. **Was the transfer sent to the app account?** A transfer-triggered action only runs for transfers to the streamer username (`HIVE_ACCOUNT`) or an account in `allowedRecipients`. Otherwise you'll see `recipient_not_allowed`. If no username is configured at all, every transfer is rejected and a warning is logged when the contract is registered.
3. **Does the trigger match?** An action declared with `trigger: 'custom_json'` ignores transfers, and vice versa (`trigger_not_allowed`).
4. **Did the payload pass the schema?** `onInvalidPayload` receives the Zod issues; the log shows them too.
5. **Was it signed with the right authority?** `requiresActiveKey: true` rejects posting-authority custom JSON with `active_key_required`.
6. **Is the block processed yet?** In the default `irreversible` mode a block is handled a few seconds after it is produced. Check `getStatus().lastBlockNumber` against the block your transaction landed in (a block explorer shows it).
7. **Did it already run?** A transaction id and operation index that is in the idempotency ledger is skipped (`duplicate`). That includes rejections. `replayBlocks(from, to, { force: true })` runs it again on purpose.

## `ConfigValidationError` at startup

The message lists every problem. The usual ones: an API node without `https://`, a zero interval, an enum value with a typo (`STREAM_MODE=fast`), or an environment value that doesn't parse (`IDEMPOTENCY_ENABLED=ture`). Fix all of them; the error is thrown before anything connects.

## The app streams as the wrong account (Windows)

Windows sets `USERNAME` to the OS login for every process, and dotenv never overrides an existing variable. Hive Stream therefore ignores a bare `USERNAME` on Windows. Use `HIVE_ACCOUNT` (the scaffold writes `HIVE_USERNAME`, which also works).

## `getHealth()` says `halted`

`errorPolicy: 'halt'` or an exhausted `retry` stopped the stream at a block it could not process. `getStatus().lastError` has the phase, the block number and the message. Fix the cause (a read-only database, a broken payout API, a handler bug) and call `start()` again or `processPendingBlocks()`; the failed block is processed again and actions that already succeeded in it are skipped.

## `getHealth()` says `stalled` or `behind`

`stalled` means no block was processed for a minute while started: the API nodes are unreachable, or a handler is stuck awaiting something. `onError` with phase `block` reports each failed fetch. `behind` is normal during catch-up after downtime; raise `catchUpBatchSize` if it takes too long, and move to your own node or HAF if public nodes throttle you.

## `no such table` or `requires a SQL adapter`

Most built-in contracts keep state in SQL tables and refuse to register on MongoDB; only dice, coinflip, roulette, rps, lotto and limbo work there. The [contract reference](/contracts/) says which. `npx hive-stream list` and the catalog's `storage` field carry the same information.

## A payout was sent twice

Check, in order: two streamer processes running against the same account; `idempotency: false`; a handler that broadcasts before writing its own record and then throws; a flow with a custom `dedupeStore` that isn't persistent. The ledger covers contract actions and the built-in flows, and only within one database.

## `onHiveEngine` never fires, or fires late

The sidechain is asked whether it executed the transaction before the callback runs, and it indexes a few seconds behind Hive. A transaction the sidechain rejected (for example an unfunded token transfer) is never delivered. One it hasn't indexed after three attempts is skipped and reported to `onError` with phase `subscription`; replay the block later with `replayBlocks()`.

## Tests: a time action never fires

The testing kit runs on simulated chain time. A `TimeAction` registered without an explicit date is anchored to the current simulated block time, and `advanceTime('1h')` mints one block at the new time and fires each due action once. For a schedule that should fire several times, call `advanceTime` once per interval.

## Tests: `outgoingTransfers` is empty

The fake client only records broadcasts that went through the streamer. A handler that threw before broadcasting shows up in `onContractError`, not in the transfers. If the handler read the chain, give the fake client fixture data with `ts.client.onCall(...)` or `ts.client.setAccount(...)` first; the built-in games read the house balance before accepting a bet.

## Still stuck

Open an issue at [github.com/Vheissu/hive-stream/issues](https://github.com/Vheissu/hive-stream/issues) with the log around the operation (debug mode on), your config with keys removed, and the transaction id.
