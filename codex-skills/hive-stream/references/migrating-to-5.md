# Upgrading Apps From 4.x To 5.0

5.0 is a security release: nothing was removed, but several defaults changed because the old ones could lose money. Coming from 3.x, apply `migrating-to-4.md` first. When reviewing or upgrading a 4.x app, check these:

## Streamer

- **Transfers must be addressed to the app.** Transfer-triggered actions only run for transfers to an app account (streamer username or `accounts`) or the action's `allowedRecipients` guard; others are rejected with `recipient_not_allowed`. Make sure the streamer has a username (`HIVE_ACCOUNT`). If a built-in uses a house `account` other than the username, add it to `accounts` or spread `guards: { allowedRecipients: ['myhouse'] }`. Non-custodial actions paying a third party need `allowedRecipients: ['*']` and their own `ctx.transfer.to` check. Remove now-redundant `ctx.transfer.to` checks only if the guard covers them.
- **API on loopback.** `apiHost` defaults to `127.0.0.1`. A container exposing port 5001 stops answering from outside; set `apiHost: '0.0.0.0'` / `API_HOST` only behind an authenticating proxy. `/transfers`, `/json`, `/events` are paged (`?limit=` up to 1000, `?offset=`).
- **`onHiveEngine` is verified.** Sidechain-rejected or still-unknown transactions are skipped and reported to `onError` (phase `subscription`).
- **Flows dedupe per operation** in the idempotency ledger; a custom `dedupeStore` used only for persistence can go.
- **`beforeOperation` fails closed**: a throwing hook skips the operation.
- **Env parsing is strict**: unparseable values throw `ConfigValidationError`. Use `HIVE_ACCOUNT`, not `USERNAME` (ignored on Windows).
- `onTransfer` callbacks get the operation index as a seventh argument; `start()` resumes a halted streamer.
- **Turn on `refundRejectedTransfers: true`** for apps that take payments, and delete hand-written refunds in `onActionRejected`.
- New: `accounts` / `HIVE_ACCOUNTS` for several app accounts with per-account signing; escrow approve/dispute/release triggers now actually fire.

## Built-in contracts

- Auction house, launchpad, insurance pool, crowdfund, booking (and bounty board, group buy) resolve an `account` (option or streamer username); registering with neither throws.
- Active key now required for exchange `transfer`/`placeOrder`/`cancelOrder`, token `issueTokens`/`transferTokens`, nft `transferNFT`/`listNFT`/`burnNFT`, multisig treasury `approveProposal`/`markExecuted`. Posting-signed calls get `active_key_required`.
- Auction house holds bids and refunds outbid bidders; seller paid on settlement.
- Prediction market resolves once; a market nobody backed the winner of becomes `void` (refundable).
- Payout rows have `pending`/`failed` states with retry actions (`retryPayouts`, `retryClaimPayout`, `retryRefund`, or the settle/claim action again). Update dashboards that read those tables.
- Tournament oracle defaults to the app account when `organizers` is unset.
- Bridge withdrawal requests can be replaced by a mismatching operator attestation (`withdrawal_request_replaced`).
- Lotto on MongoDB scopes documents by contract name: run `updateMany({}, { $set: { contract: 'hivelotto' } })` on existing documents.
- New contracts: `createEscrowMarketplaceContract`, `createP2PSwapContract`, `createDaoContract`.

## Games

- Provably fair by default. Tests hard-coding block-id rolls need `fairness: false` or should assert through the proof.
- `houseEdge` is a percentage everywhere: dice `0.01` (4.x, 1%) must become `1`. Coinflip and rps now take a 2% edge by default.
- `notifyLosses` is off unless set.
- Invalid bets are refunded; remove refunds done in `onInvalidPayload`.
- Bets must go to the house account; others are rejected before the handler.

Full guide: `docs/guide/migrating-to-5.md`.
