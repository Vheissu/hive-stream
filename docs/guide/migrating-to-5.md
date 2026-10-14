# Migrating to 5.0

5.0 is a security release. Nothing was removed from the API, but several defaults changed because the old ones could lose money. Most apps upgrade by bumping the version and checking the six points below. Coming from 3.x? Read [Migrating to 4.0](./migrating-to-4) first.

```shell
npm install hive-stream@^5
```

## 1. Transfers must be addressed to your app

A transfer-triggered action now runs only when the transfer was sent to the streamer username (or an account in the action's new `allowedRecipients` guard). Before, a wrapped memo on a payment between two other accounts ran your handler too.

Check:

- The streamer has a username (`HIVE_ACCOUNT`, or `username` in config). Without one, and without `allowedRecipients`, every transfer is rejected and a warning is logged when the contract is registered.
- If a built-in game or marketplace uses a house account that is not the streamer username (`createDiceContract({ account: 'myhouse' })` with `username: 'myapp'`), add the guard:

  ```ts
  await streamer.registerContract({
      ...createDiceContract({ account: 'myhouse' }),
      guards: { allowedRecipients: ['myhouse'] }
  });
  ```

- Non-custodial actions where the buyer pays a third party directly need `guards: { allowedRecipients: ['*'] }` and must verify `ctx.transfer.to` themselves. The built-in `buyNFTDirect` and `buyTicketDirect` already do.

Rejections arrive in `onActionRejected` with the new reason `recipient_not_allowed`.

## 2. The HTTP API binds to loopback

`apiHost` defaults to `127.0.0.1`. A container or server that exposed port 5001 to the network will stop answering from outside. The API has no authentication, so put an authenticating reverse proxy in front and set `apiHost: '0.0.0.0'` (or `API_HOST=0.0.0.0`) only then. `/transfers`, `/json` and `/events` are now paged (`?limit=` up to 1000, `?offset=`); clients that read whole tables need to page.

## 3. `onHiveEngine` only delivers verified transactions

The sidechain is asked whether it executed the transaction. One it rejected, or one it still hasn't indexed after three attempts, is not delivered and is reported to `onError` with phase `subscription`. Before, an unknown or unreachable result counted as success. If your app credited token payments from `onHiveEngine`, nothing changes for valid transfers; invalid ones stop arriving.

## 4. Transfer flows never pay twice

`autoRefund`, `autoForward`, `autoBurn`, `autoSplit` and `autoRoute` key each transfer by transaction id and operation index and record what they paid in the adapter's idempotency ledger. Two transfers to the app in one transaction are now both handled (before, only the first was). A block processed again after a crash, halt, fork or replay no longer resends. A custom `dedupeStore` is still honoured; if you passed one only to get persistence, you can drop it.

## 5. Hooks and configuration

- A throwing `beforeOperation` hook skips the operation (fail closed). Before, the operation went through.
- An environment value that doesn't parse (`IDEMPOTENCY_ENABLED=ture`, `ERROR_MAX_RETRIES=5x`) throws `ConfigValidationError` at startup instead of becoming `false` or a default.
- On Windows a bare `USERNAME` variable is no longer read as the Hive account. Use `HIVE_ACCOUNT`.
- `onTransfer` callbacks receive the operation index as a seventh argument. Existing callbacks ignore it.
- `start()` resumes a halted streamer; you no longer need `processPendingBlocks()` for that.

## 6. Several app accounts (new)

Apps that act as more than one account (a marketplace and its escrow agent, one account per market) can list them under `accounts` with their own keys. Transfers to any of them run contract actions and every write signs with the right key. See [Configuration](./configuration#several-app-accounts).

## 7. Turn on refunds

Not a breaking change, but the default you probably want:

```ts
const streamer = new Streamer({ env: true, refundRejectedTransfers: true });
```

Any transfer to the app account whose contract action is rejected (invalid payload, guard, pause, veto, unknown action) is sent back with the reason in the memo. If you refund in `onActionRejected` today, remove that code.

## Built-in contracts

The built-in contracts were audited as part of this release. The ones below changed behaviour; the [contract reference](/contracts/) has the current options and actions.

- **Three contracts need an `account` option or a streamer username that they didn't before:** auction house, launchpad, insurance pool, crowdfund and booking resolve the account that holds bids, payouts and refunds. Registering them with neither throws `createXContract: set options.account or the streamer username`.
- **Active key now required** for exchange `transfer`/`placeOrder`/`cancelOrder`, token `issueTokens`/`transferTokens`, nft `transferNFT`/`listNFT`/`burnNFT`, multisig treasury `approveProposal`/`markExecuted`. Frontends that sent these with posting authority get `active_key_required`.
- **Auction house holds bids** and refunds outbid bidders; the seller is paid on settlement. If your UI explained the old "bids are not refunded" behaviour, update it.
- **Prediction market** can only be resolved once and becomes `void` (refundable) when nobody backed the winning option.
- **Payouts have states.** Where a contract used to mark a row paid before broadcasting, it now marks it pending and retries failed broadcasts through an explicit action (`retryPayouts`, `retryClaimPayout`, `retryRefund`, or calling the settle/claim action again). Dashboards that read those tables will see the new `pending`/`failed` values.
- **Tournament oracle** defaults to the app account when `organizers` is unset, not to whoever created the tournament.
- **Bridge withdrawal requests** can be replaced by the first operator attestation when they don't match; subscribe to `withdrawal_request_replaced` if you audit them.
- **Three new contracts:** escrow marketplace, peer-to-peer swap desk and DAO. See the [Escrow guide](./escrow) and the [recipes](./recipes).

### Games

- **Provably fair by default.** If you relied on the legacy block-id outcomes (for example in tests that hard-code rolls), pass `fairness: false` or assert through the proof in the payout memo.
- **`houseEdge` is a percentage everywhere.** Dice used a fraction (`0.01` = 1%); it is now `1` = 1%, like coinflip and rps (default 2). A 4.x value such as `0.02` now means 0.02%, so update it.
- **Loss notices are off** unless you set `notifyLosses: true`.
- **Invalid bets are refunded** rather than kept. If you refunded them yourself in `onInvalidPayload`, remove that code.
- Bets must be sent to the house account (`options.account` or the streamer username). A transfer to any other account is rejected before the handler runs.

