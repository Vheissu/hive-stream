# Security

A Hive Stream app holds a private key and reacts to money. This page is the checklist for not losing either. Report a vulnerability in the library itself through [SECURITY.md](https://github.com/Vheissu/hive-stream/blob/master/SECURITY.md).

## Keys

- **Use a dedicated app account.** Give it the active key your contracts need to pay out and keep only the bankroll in it. Your personal account, with its owner key and its savings, is not the app account.
- **Never put the owner key anywhere near the app.** Hive Stream has no use for it. If the active key leaks, use the owner key from a clean machine to change it.
- **Keep keys out of the repository.** `env: true` reads `HIVE_ACTIVE_KEY` and `HIVE_POSTING_KEY` from the environment and from `.env`. Commit `.env.example` with empty values and keep `.env` in `.gitignore` (the scaffold does both). In production, inject the variables from your secret manager or your process manager's environment rather than from a file on disk.
- **Give the app the least authority it needs.** A read-only app needs no keys. A tipping bot that only replies needs the posting key. Only an app that transfers funds needs the active key.
- **Rotate after an incident.** `streamer.setConfig({ activeKey })` picks up a new key without a restart.

## Money in

The streamer checks a few things before any transfer-triggered action runs:

- The transfer was addressed to the app account (or an account in the action's `allowedRecipients`). A wrapped memo on a payment between two other accounts is rejected. Keep it that way: only open `allowedRecipients` to `['*']` for genuinely non-custodial actions that verify the recipient themselves.
- Guards: `allowedAssets`, `minAmount`, `maxAmount`, `rateLimit`, `allowedSenders`, `blockedSenders`, `paused`. Set `allowedAssets` whenever you set an amount limit, because the limit compares numbers regardless of asset.
- The idempotency ledger: a transaction id and operation index that already ran is skipped, so a replayed block cannot pay twice.

Inside the handler, still read `ctx.transfer` (amount, asset, from, to) rather than the payload: the payload is whatever the sender typed, the transfer is what the chain settled. Hive amounts have three decimals; compare them with BigNumber, not floats.

Turn on `refundRejectedTransfers` for an app that takes payments. A bet with a typo in it is then sent back with the reason instead of being kept, which is both fairer and cheaper than the support tickets.

## Money out

- **Cap payouts by bankroll.** A dice site that can pay a 96x multiplier must refuse a bet it couldn't pay. The built-in games read the house balance before accepting a bet; copy that in your own contracts.
- **Keep the broadcast as the last step** of a handler, after state is written, and record your own side effects keyed by `ctx.transaction.id` and `ctx.transaction.operationIndex` so a retry can see what was already sent. [Writing Contracts](./contracts#write-handlers-to-be-safe-to-retry) has the pattern.
- **Treat a failed broadcast as unknown, not as failed.** A timeout can mean the transfer landed. Don't refund from a catch block after a payout was attempted; mark the row for review instead.
- **Require the active key for value-moving custom JSON actions** (`requiresActiveKey: true`). Any frontend a user has granted posting authority to could otherwise call them.
- **Prefer `errorPolicy: 'halt'` for custody and accounting apps.** Stopping at a failed block and paging someone beats skipping it.

## Randomness

Block ids can be nudged by the witness producing the block, and a player chooses when their transaction lands. Don't derive outcomes from them alone. The [fairness module](./fairness) commits to a server seed before any bet, derives outcomes with HMAC-SHA256, and publishes the proof in the payout memo so players can verify it in a browser. The built-in games use it by default.

## The HTTP API

The built-in API has no authentication and serves your stored transfers, custom JSON and events, plus `getStatus()` with the last error message. It binds to loopback by default. If you need it from outside the host, put a reverse proxy with authentication in front of it and set `apiHost: '0.0.0.0'` only then.

## Operations

- **One streamer per app account.** Two instances handling the same account both pay out; the ledger is per database, the rate limiter per process.
- **Watch `getHealth()`.** `halted` means the error policy stopped the stream and someone has to look. `stalled` means no block in a minute.
- **Alert on `onError` with `fatal: true`** and on `onActionRejected` spikes (a burst of `recipient_not_allowed` or `rate_limited` is someone probing you).
- **Keep dependencies current.** `npm audit` is part of the release checklist here; `@hiveio/dhive` pins an old `elliptic`, which npm flags at low severity, and there is no fixed release of that chain yet.
