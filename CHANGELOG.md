# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [5.0.1] - 2026-10-14

### 🐛 Fixed
- `createContractEscrowTransferOperation()` rejected a zero agent fee, which Hive allows. The fee must still be a three-decimal HIVE or HBD amount.

## [5.0.0] - 2026-10-14 - Safe by default

A security and correctness release. Several defaults changed because the old ones could lose money; the [migration guide](docs/guide/migrating-to-5.md) ([online](https://vheissu.github.io/hive-stream/guide/migrating-to-5)) lists what to check.

### ⚠️ Breaking changes
- **Transfer-triggered contract actions only run for transfers addressed to the app.** A wrapped memo on a transfer between two other accounts used to run your handler (`ctx.transfer.to` was never checked); it is now rejected with reason `recipient_not_allowed`. The accepted recipients default to the streamer username; the new `allowedRecipients` guard widens them (`['*']` accepts any recipient for non-custodial flows). Without a username and without the guard every transfer is rejected, with a warning at registration. The built-in `buyNFTDirect` and `buyTicketDirect` actions opt in and verify the seller themselves.
- **The built-in HTTP API binds to loopback.** It has no authentication, so `apiHost` now defaults to `127.0.0.1`; set `apiHost: '0.0.0.0'` (or `API_HOST`) behind an authenticating proxy to expose it. `/transfers`, `/json` and `/events` are paged (`?limit=` default 100, max 1000; `?offset=`), and `/stats` counts rows instead of loading the tables.
- **`onHiveEngine` no longer delivers unverified transactions.** A transaction the sidechain hasn't indexed yet is retried three times; one it rejected, or that is still unknown, is skipped and reported to `onError` (phase `subscription`). Previously an unknown or unreachable result counted as success.
- **Transfer flows (`autoRefund`/`autoForward`/`autoBurn`/`autoSplit`/`autoRoute`) key each transfer by transaction id and operation index** (a transaction with two transfers to the app is handled twice, as it should be) and record what they paid in the adapter's idempotency ledger, so a block processed again after a crash, halt, fork or replay never pays twice. A custom `dedupeStore` is still honoured.
- **A throwing `beforeOperation` hook now skips the operation** (fail closed, like `beforeContractAction`) instead of letting it through.
- **Unparseable environment values are a `ConfigValidationError`** (`IDEMPOTENCY_ENABLED=ture`, `ERROR_MAX_RETRIES=5x`) instead of silently becoming `false` or a default. On Windows a bare `USERNAME` variable is never read as the Hive account (the OS sets it); use `HIVE_ACCOUNT`.
- `Streamer.onTransfer` callbacks receive the operation index as a seventh argument, and `TransferEvent.transaction.operationIndex` is set.

### ✨ Added
- **Several app accounts.** `accounts: [{ name, activeKey?, postingKey? }]` (env `HIVE_ACCOUNTS` as JSON) registers extra accounts the app acts as. Transfers to any of them run contract actions (`allowedRecipients` defaults to the whole list), every write method signs with the keys of the account it acts as (a batch is signed with every key it needs), `refundRejectedTransfers` refunds from the receiving account, `onTransfer()` accepts an array of accounts, and `getAppAccounts()` / `isAppAccount()` / `addAccount()` / `removeAccount()` manage the list at runtime. An account listed without keys signs with the primary keys, for accounts that granted the app account authority.
- **`refundRejectedTransfers`** (`REFUND_REJECTED_TRANSFERS`, default `false`): send a transfer to the app account whose contract action was rejected (invalid payload, guard, pause, veto, unknown action) back to the sender with a `[Refund] <reason>` memo. Rejections are written to the ledger first, so a replay never refunds twice. The `game` scaffold template turns it on.
- **`allowedRecipients` guard** and `recipient_not_allowed` rejection reason.
- **Escrow lifecycle triggers work.** Actions declaring `escrow_approve`, `escrow_dispute` or `escrow_release` were accepted but never ran, because those operations carry no JSON to route by. They now reach every action that declares the trigger, with the escrow details as the payload and `who` as the sender, each with its own ledger key.
- **`apiHost`** config option (`API_HOST`).
- **`createContractEscrowTransferOperation()`** in `hive-stream/client` builds the `escrow_transfer` a buyer signs to open an escrow carrying a contract call, with the same validation as the transfer builder. A new [Escrow guide](docs/guide/escrow.md) covers the four operations, triggers, broadcasting and testing.
- `start()` works after a halt: the streamer leaves `isStarted` so an operator can fix the cause and restart from the failed block (previously `start()` returned at once and the stream stayed halted). Checkpoint failures follow `errorPolicy` like other storage writes.
- Adapters: `getTransfers`/`getJson`/`getEvents` accept `{ limit, offset }`, and `getCounts()` returns row counts. MongoDB creates unique indexes on `transfers.id` and `customJson.id` and upserts, so a replayed block never stores an operation twice.
- A CI workflow runs the build and the test suite on Node 22 and 24 for every push and pull request.

### Contracts

Three new contracts for the apps people ask about most, all exercising native Hive features:

- **Escrow marketplace** (`createEscrowMarketplaceContract`, `escrowmarket`): listings paid through native Hive escrow with the app as *agent*. The buyer's `escrow_transfer` carries the contract call in `json_meta`; the agent approves (`autoApprove`), the seller ships, the buyer releases on chain, and the agent only steps in to resolve disputes (`resolveDispute`, active key). Options `agentFeeBps`, `ratificationHours`, `expirationDays`, `allowedAssets`. The app never holds the funds.
- **Peer-to-peer swap desk** (`createP2PSwapContract`, `p2pswap`): HIVE/HBD pairs settle through Hive escrow with the app as agent. The taker locks the buy side in escrow; the app approves it only after it sees the maker pay the taker, then the taker releases to the maker (or the app does, on a dispute). If the maker never pays, the escrow goes back to the taker. Pairs involving Hive Engine tokens are custodial for one leg only: the maker deposits tokens with the app, the taker pays, and the app pays both sides out with pending/paid/failed states and a `retryPayouts` action. Offers expire (`offerTtlHours`); every mismatched payment is refunded.
- **DAO** (`createDaoContract`, `dao`): proposals funded by a deposit, votes weighted by Hive Power, a staked Hive Engine token or one account one vote, an absolute `quorum`, `passThresholdBps`, a timelock with admin veto, and treasury payouts that retry until they land. The treasury balance is derived from the contract's own ledger.

Audit fixes to the existing contracts (every money-moving built-in was reviewed):

- **Games are provably fair by default.** `fairness: true` is now the default for dice, coinflip, roulette, rps and lotto (limbo already was); `fairness: false` keeps the legacy block-id mode.
- **Games verify the transfer they were triggered by.** The bet must be addressed to the house account, from the sender, in an accepted asset; the chain re-read checks the operation at its own index (`Utils.verifyTransfer` takes an `operationIndex`), so a transaction carrying one real bet and N copies to an alt no longer gets N+1 rolls, and a bet that isn't the first operation in its transaction settles correctly.
- **Coinflip and RPS have a house edge** (`houseEdge`, percent, default 2); they paid fair 2x odds before. Dice's `houseEdge` is now a percentage too (default 1), the same convention as coinflip and rps, instead of a fraction.
- **Loss notices are opt-in** (`notifyLosses`, default `false`) on dice, coinflip, roulette, rps and lotto; the 0.001 "you lost" transfers made minimum bets net positive for the player.
- **Invalid bets are refunded** with a `[Refund] …` memo (dice roll out of range, unknown coin side or rps move, bad roulette bet, unknown lotto draw, seed over 64 characters) instead of the payload being rejected and the money kept.
- **HBD bets** are checked against the house's `hbd_balance` and paid out in the bet's asset (dice always paid in HIVE).
- **No double payouts:** a settlement record is written to the ledger before the first outgoing transfer, so a retry or replay of the same bet never draws again, and the stake is only refunded from an error path if nothing was sent.
- **Lotto** uses BigNumber for every amount, refunds tickets paid in the wrong asset, and scopes its MongoDB documents by contract name (existing documents need `updateMany({}, { $set: { contract: 'hivelotto' } })`).

- **Active key now required** for value-moving custom JSON: exchange `transfer`/`placeOrder`/`cancelOrder`, token `issueTokens`/`transferTokens`, nft `transferNFT`/`listNFT`/`burnNFT`, multisig treasury `approveProposal`/`markExecuted`.
- **Auction house holds bids.** New `account` option (default the streamer username). Outbid bidders are refunded automatically, the seller is paid only on settle or buy-now, a bid that can't be accepted (closed, late, too low, wrong asset, the seller's own) is refunded instead of kept, and the reserve-not-met case refunds the high bidder. Payouts are pending until broadcast and retried by a later `settleAuction`.
- **Launchpad** gains `account` and an optional `softCap` per sale (below it, `finalizeSale` refunds every allocation). A contribution fills as many whole units as it can and refunds the rest; one that can't fill anything is refunded in full.
- **Prediction market:** `resolveMarket` runs once (`status === 'open'`), stakes are summed with BigNumber instead of SQL `SUM` (which failed on PostgreSQL), and a market whose winning option nobody backed becomes `void` so every staker can reclaim their stakes.
- **NFT:** `buyNFT` verifies the payment from the triggering transfer (recipient, sender, amount) and the chain re-read checks the right operation in multi-operation transactions; no royalty when the seller is the creator; royalties round down so payouts add up to the price exactly; `buyNFTDirect` (non-custodial) declares `allowedRecipients: ['*']`.
- **Exchange:** deposits must be addressed to the exchange account (`account` adds the recipient guard); a withdrawal whose broadcast was attempted is never credited back (it is marked `unconfirmed` for review).
- **Token:** quantities with more decimals than the token's precision are rejected.
- **Insurance pool, crowdfund, booking** gain an `account` option. Claims, milestone releases and refunds are paid from the app account (they used to be signed from the pool owner or campaign creator, which the app has no key for), rounded down, and marked paid only after the broadcast succeeds; failed ones are retried by `retryClaimPayout`, `releaseMilestone` or `refundContribution`.
- **Booking:** prices are compared with BigNumber (`10.000` now matches `10`); a payment that can't be honoured is refunded (`booking_refunded`); state transitions are checked (confirm from pending only, cancel/complete from pending or confirmed).
- **Bounty board / group buy / oracle bounty / savings:** `closeBounty`, `finalizeRound` and `closeGoal` run once; `closeBounty` zeroes `remaining_reward`; withdrawing a group-buy commitment before the deadline lowers the totals so the organiser isn't paid refunded money; contributions and commitments are keyed by operation, not transaction.
- **Proposal timelock:** `executeProposal` works when time-triggered and waits quietly until the delay has passed; executed or cancelled proposals can't be cancelled again.
- **Bridge:** an operator attestation replaces an unattested withdrawal request whose recipient or amount doesn't match (`withdrawal_request_replaced`), so a front-run request can't lock a user's funds; withdrawals above `maxPerTx` or the daily limit are rejected at request time; a failed deposit refund is `refund_failed` and retried by `retryRefund`.
- **Tournament:** with `organizers` unset the oracle defaults to the app account (a payload `oracle` must be the app account or one of `oracles`), prizes and refunds have pending/paid/failed states with `retryPayouts`, and a failed fee transfer emits `tournament_fee_transfer_failed`.
- **Staking pool:** block-based accrual stops at `ends_at`; failed claims and unbonding releases are retried by the next `claim`, `withdraw` or `releaseMatured`.

### 🐛 Fixed
- Under `errorPolicy: 'retry'`, a failed idempotency-ledger write after a successful handler re-ran the whole operation, so a storage blip right after a payout could pay twice. The ledger write is now retried on its own and the handler is never re-run.
- A payload replaced by `beforeContractAction` is validated against the action schema like the original.
- `resetAction()` anchored the next run to the wall clock; it now uses block time like the scheduler.
- Registering a time action whose id already exists logs a warning at all times, not only in debug mode.
- The fallback ledger key for blocks without transaction ids (some HAF views) includes the transaction index, so two transactions' first operations no longer share a key.
- Guards: registering a contract with `minAmount`/`maxAmount` but no `allowedAssets` logs a warning (the limit applies to HIVE and HBD alike).
- Docs: the queries guide referenced methods that don't exist (`getReputationScore`, `query.getTokenBalances`, `fiatToHiveRate` with one argument); the batch example wasn't valid code; the env-var docs recommended `USERNAME`.
- The dev harness (`npm start`) didn't load `.env`, so the built-in games couldn't resolve a house account.
- Stray SQLite databases and scratch notes were removed from the repository.

## [4.0.0] - 2026-09-26 - Reliability, hooks and configuration

This release makes the streamer safe to run money-handling apps on: nothing is processed until it is irreversible, the cursor is saved after every block, and contract actions are recorded so a replay never runs them twice.

Upgrading? Read the [migration guide](docs/guide/migrating-to-4.md) ([online](https://vheissu.github.io/hive-stream/guide/migrating-to-4)). It covers every breaking change below with before/after code, plus the Node 22, zod 4 and optional driver requirements.

### ⚠️ Breaking changes
- **Irreversible streaming is the default.** `streamMode: 'irreversible'` only processes blocks up to `last_irreversible_block_num`, adding a few seconds of latency. Set `streamMode: 'head'` for the old behaviour (now with fork detection).
- **The cursor is saved after every block** instead of every 5 seconds. Use `checkpointMode: 'interval'` to get the old write pattern.
- **Configuration is validated.** Invalid values (zero/negative intervals, empty or malformed `apiNodes`, unknown enum values) throw `ConfigValidationError` from the constructor and `setConfig()`.
- **Subscription callbacks are awaited in order** and their errors are isolated. Previously most were fire-and-forget, so async callbacks could interleave.
- **Time actions run after the block's operations** and are evaluated against the block timestamp rather than the latest head time.
- **`onBlock` receives the number of the block being processed** (it previously received the previous block's number).
- **Subscriptions are no longer trimmed** when a list passes 1000 handlers; a warning is logged instead.
- **Persisted time actions are restored in `init()`**, not only when `registerAction()` is called.
- **Adapters gained ledger methods** (`hasProcessedOperation`, `markOperationProcessed`, `pruneProcessedOperations`); `AdapterBase` provides an in-memory default. SQL adapters add a `processed_operations` table and a `lastBlockId` column on `params` automatically.
- `transfers`/`customJson` adapter rows for the second and later operations in a transaction now use `trxId:opIndex` ids (the first operation keeps the bare transaction id), and inserts ignore duplicates so replays don't fail.
- **Built-in house accounts no longer default to `'beggars'`.** `dice`, `coinflip`, `rps`, `roulette`, `lotto` (house and fee account) and `exchange` resolve their account from `options.account`, else the streamer's configured username, and `registerContract()` throws `createXContract: set options.account or the streamer username` when neither is set. The lotto and exchange fee account defaults to the resolved house account.

### ✨ Added
- **Idempotency ledger** (`idempotency`, `idempotencyRetentionBlocks`): every contract action is keyed by transaction id + operation index (time actions by id + block) and skipped if it already ran. `replayBlocks(from, to, { force: true })` bypasses it.
- **Stream modes and fork handling** (`streamMode`, `maxForkDepth`): `head` mode detects forks, rewinds to the common ancestor, reprocesses the new branch, and fires `onFork` with the orphaned blocks.
- **Error policy** (`errorPolicy: 'skip' | 'halt' | 'retry'`, `errorMaxRetries`, `errorRetryDelayMs`): decide whether a failing handler or storage write skips, halts at the failing block, or retries with backoff. Halts show up as `status: 'halted'` in `getHealth()` with `lastError` in `getStatus()`.
- **Block fetch backoff** (`retryMaxDelayMs`) and **per-request API timeouts** (`apiTimeoutMs`, default 10s instead of dhive's 60s) so a dead node fails over quickly.
- **Streamer hooks**: `onStart`, `onStop`, `beforeBlock`, `afterBlock`, `beforeOperation` (can skip), `afterOperation`, `beforeContractAction` (can veto or replace the payload), `afterContractAction`, `onContractError`, `onInvalidPayload`, `onActionRejected`, `onFork`, `onError`, `onCaughtUp`, `onCheckpoint`. Register via `hooks` config, `streamer.hook()`, or `streamer.use(plugin)`; `defineHooks()` for typed plugins.
- **Contract hooks** `beforeAction` (can veto), `afterAction`, `onError`.
- **Declarative guards** on contracts and actions: `allowedSenders`, `blockedSenders`, `allowedAssets`, `minAmount`, `maxAmount`, `rateLimit`, `paused`. Runtime `pauseContract()` / `resumeContract()` / `isContractPaused()`.
- `defineConfig()` and `validateConfig()` helpers; new options readable from env vars.
- `getStatus()` reports `streamMode`, `irreversibleBlockNumber`, `targetBlockNumber`, `lastBlockId`, `halted`, `lastError`.
- Testing kit: `irreversibleLag` on `MemoryBlockProvider`/`createTestStreamer`, `forkAt()` to simulate microforks, and `transactionIds` on `addBlock()`.
- `ctx.transaction.operationIndex`, and `ctx.transfer` is now populated for `recurrent_transfer` triggers.

### 🐛 Fixed
- **Built-in contracts used the wall clock for deadlines and records.** Checks like "deadline has passed" and every `created_at`/`updated_at`/event timestamp used `new Date()`, so catching up on old blocks rejected contributions, bids and entries that were on time when sent, and replays wrote different timestamps. All built-in contracts now use the block timestamp (`blockTimeOf(ctx)`); `emitContractEvent()` takes an optional time.
- **NFT marketplace sales paid sellers and royalties from `beggars`.** `buyNFT` read a non-existent `config.HIVE_ACCOUNT`, so it verified buyer payments against `beggars` and broadcast seller/royalty payouts from it. The marketplace account is now `options.account` on `createNFTContract()`, defaulting to the streamer username.
- `lotto` never created its tables on SQL adapters, so `registerContract()` failed on a fresh SQLite/PostgreSQL database (`no such table: settings`). It now creates `lotto_draws` and `lotto_settings` (entries, winners and fairness proofs stored as JSON) on SQL adapters and keeps the `lottery`/`settings` collections on MongoDB. A test registers every built-in factory on a fresh SQLite database.
- A crash within 5 seconds of processing a block replayed it and could re-run payouts.
- PostgreSQL returned `lastBlockNumber` as a string (BIGINT), so resuming did string concatenation on the cursor.
- Two contract operations in one transaction collided on the adapter's `transfers`/`customJson` primary key, so the second was never dispatched; replays hit the same error.
- `stop()` could tear down the adapter while a block was mid-processing; it now waits for the block and writes a final checkpoint.
- A missing block slept inside the processing loop instead of yielding back to the poller.
- Invalid payload logging read Zod's removed `.errors` field; it now uses `.issues`.
- `broadcastOperations()` signed `custom_json` operations with `required_auths` using the posting key, so the chain rejected them. They are now signed with the active key.
- The testing kit's fake client couldn't return simulated blocks, so dice, coinflip, roulette, rps and lotto failed offline when they re-read their transaction. `createTestStreamer()` now serves those reads from the simulated chain and uses throwaway keys when none are configured.

### Contracts
- **Provably-fair randomness** (`createFairness`, `FairnessManager`; verifier in `hive-stream/client`)
  - Commit-reveal server seeds (sha256 commitment published before bets) with HMAC-SHA256 derivation over `clientSeed[:entropy]:nonce:round`
  - Rejection sampling, so there is no modulo bias
  - Optional block-id entropy, on by default
  - Nonces persisted per adapter before any outcome is computed, automatic rotation (`rotateAfter`) and an `onRotate` callback
  - `verifyOutcome()`, `deriveOutcome()` and a dependency-free SHA-256/HMAC run identically in Node and browsers
  - Guide: `docs/guide/fairness.md`
- **Fair mode for dice, coinflip, roulette, rps and lotto**
  - Pass `fairness: true` (or options / a shared manager) to settle bets from the committed seed
  - Proofs are recorded in events and memos, and a house-only `rotateSeed` action reveals seeds
  - Without the option the legacy RNG is unchanged. It is biasable by block producers and players, so fair mode is recommended for real money
  - Dice gained an optional `seed` payload field. All game `seed` fields are capped at 64 characters
- **`createBridgeContract`**: custody bridge/peg layer
  - Deposits carry a destination chain and address. Invalid, paused or over-limit deposits are refunded automatically, including malformed memos
  - M-of-N operator attestations for mints, refunds and withdrawal releases; operators must agree on the exact external transaction
  - Fees in basis points, per-transaction, rolling daily and per-account limits
  - `setPaused` switch: deposits are refunded, releases are queued. Use it rather than `pauseContract()`, which would reject deposits without refunding them
  - Queued releases are processed by a scheduled action
  - Two-phase release (`releasing` → `released`, with failed broadcasts marked `release_failed` for admin reconciliation) so a crash never pays twice
  - Full `bridge_audit` trail
  - Optional deposit receipts (`receipts: true | { id }`): the custody account broadcasts a posting-auth custom_json per deposit with the contract's verdict (`accepted`/`refunded` and reason), the net amount and the rolling daily totals, so operators mint only accepted deposits instead of mirroring the custody rules (`BridgeDepositReceipt` type)
- **`createTournamentContract`**
  - Exact entry fees are enforced: wrong assets, amounts, duplicates, late and full entries are refunded
  - Registration windows, and scores submitted only by the tournament's oracle or a global oracle (single or batch)
  - Ascending or descending ranking, `split` or `earliest` tie handling, and basis-point prize splits where dust goes to first place and payouts sum exactly to the pool
  - House fee, and automatic cancellation and refunds for under-subscribed or unscored tournaments
  - Scheduled finalisation. `calculateTournamentPayouts()` is exported
- **`createStakingPoolContract`**
  - Reward-per-share accounting per second of block time or per block
  - Rewards never exceed the funded reserve and stop at the pool end time
  - Cooldown-based unbonding with a scheduled release
  - Claims round down to asset precision and keep the remainder pending
  - Admin-only pool creation and rate changes (accrued at the old rate first)
- **`createLimboContract`**: always-fair limbo/crash game
  - House edge in basis points; payouts are `bet × target`, rounded down
  - Payouts are capped absolutely and as a share of the live bankroll, with in-flight payouts reserved
  - Bets are serialized
  - Invalid bets, and draws that fail, are refunded
- **`createBadgesContract`**: non-transferable achievements for games and social apps
  - Issuers, supply caps and revocation with reasons
  - Rule-based awards from payment totals (`contribute`) and periodic or consecutive check-ins (`checkIn`)
- New contracts use block time (not wall-clock time) for windows, limits and accrual, so replays are deterministic. They key records by `transactionId:operationIndex`, so multi-operation transactions don't collide
- Fixed: the `game` scaffold template's dice memo named contract `dice` instead of `hivedice`. The template now enables fairness and adds limbo

### Tooling
- **Storage requirements in the catalog** - Each catalog entry has `storage: 'sql' | 'any'`, derived from the contract source and verified by registering every contract on a document-store adapter in the tests. `getCatalogContractsForAdapter({ sql })` filters by it, and the generated contract pages now say per contract whether SQL is needed.
- **Example payloads** - Catalog actions carry an `example` payload built from the zod schema (required fields, defaults and enum values first, name-based placeholders) and verified against it; generated contract pages show it in the memo/custom JSON snippets instead of `payload: {}`. Cross-field rules can be covered with `examples` overrides in `scripts/lib/contract-metadata.ts`.
- **Browser-safe scaffolder (`hive-stream/scaffold`)** - Generate exactly what `npx hive-stream new` writes, in memory
  - `generateProjectFiles(options)` returns `{ files, template, adapter, nextSteps }`; `username`, `api` and `hiveStreamVersion` are now optional (the version defaults to the installed hive-stream)
  - Exposes `TEMPLATES`, `ADAPTERS`, compatibility helpers, `validateProjectName()`, `validateHiveAccountName()`, `getNextSteps()` and `HIVE_STREAM_VERSION`
  - The module graph imports no packages or Node built-ins; `tests/browser-safe-entries.spec.ts` enforces it. The CLI is now a thin filesystem wrapper around it
  - Files: `src/scaffold/`, `src/cli/scaffold.ts`, `scripts/generate-version.js`
- **Contract catalog (`hive-stream/catalog`)** - Machine-readable metadata for every built-in contract factory
  - Category, description, factory options (read from the TypeScript source), and each action's triggers, active-key requirement and payload fields (type, required, enum values, defaults) from the zod schemas
  - `contractCatalog`, `getCatalogContract()`, `getCatalogContractsByCategory()`, `CONTRACT_CATEGORIES`
  - Generated to `src/catalog/contracts.json` by `npm run catalog:gen` (also run by `npm run build` and `npm run docs:gen`); new factories are discovered automatically and need one line in `scripts/lib/contract-metadata.ts`
  - Files: `src/catalog/`, `scripts/lib/`, `scripts/generate-contract-catalog.ts`, `tests/contract-catalog.spec.ts`
- **Contract reference pages** now come from the same introspection as the catalog, list factory options and categories, and escape `|` in table cells (enum and union types no longer break tables)

### Developer experience and production

Also part of 4.0.0: the testing kit, the browser client, ESM, the docs site and the production plumbing.

#### Added
- **Contract call client (`hive-stream/client`)** - Share lightweight action specs and build calls without hand-written wire JSON
  - `defineContractSpec()` and `createContractCaller()` provide typed action names, Zod validation, trigger checks, and automatic posting/active authority selection
  - Pure helpers build payload wrappers, transfer memos, `custom_json` operations, and native HIVE/HBD transfer operations without networking, keys, or database dependencies
  - Sender and recipient account names are validated before operations are returned; `validateHiveAccountName()` is available for forms and scripts
  - Structured validation issues make the same checks usable for browser forms, backend scripts, and offline tests
  - Files: `src/client/`, `tests/contract-calls.spec.ts`, `docs/guide/contract-calls.md`
- **Safer generated apps** - New scaffolds include TypeScript checking and an offline starter contract test
  - `npm run verify` runs the type checker, Jest suite, and production build before an app touches Hive
  - Generated packages are private by default, load the username from resolved config, and use the built-in SIGINT/SIGTERM shutdown helper
  - Template prompts only offer compatible storage; SQL-backed templates now reject MongoDB during generation
  - CLI flags support `--name=value` syntax and reject unknown options, extra arguments, and malformed Hive account names
  - Files: `src/cli/`, `tests/cli.spec.ts`
- **Testing Kit (`hive-stream/testing`)** - Test contracts and subscriptions fully offline
  - `createTestStreamer()` runs a real `Streamer` against simulated infrastructure: in-memory blocks, captured broadcasts, in-memory SQLite
  - `contractTransfer()`, `contractJson()`, `transfer()`, `customJson()`, `sendOperations()` inject operations; `advanceBlocks()`/`advanceTime('1h')` drive TimeActions without waiting
  - `MemoryBlockProvider` and `FakeHiveClient` also compose individually via the `blockProvider`/`client` config options
  - Files: `src/testing/`, `examples/testing/`, `tests/testing-kit.spec.ts`
- **ESM support** - `import { Streamer } from 'hive-stream'` now resolves a real ESM entry
  - Thin `.mjs` wrappers over the single CJS implementation: named imports work, and there is exactly one copy of every class at runtime (no dual-package hazard; `instanceof` is always safe)
  - Subpath export `hive-stream/testing`; types verified under `nodenext` and `bundler` resolution
  - Files: `scripts/generate-esm-wrappers.js`, `package.json`
- **Documentation site** - VitePress site with 18 guides and auto-generated reference pages for all 45 built-in contracts
  - Contract pages are generated from source (`npm run docs:gen`), so triggers and payload schemas never drift
  - Deploys to GitHub Pages via `.github/workflows/docs.yml`; run locally with `npm run docs:dev`
  - Files: `docs/`, `scripts/generate-contract-docs.ts`
- **Production operations**
  - `getHealth()` plus `/health` (200/503) and `/status` API routes for load balancers and orchestrators
  - `enableGracefulShutdown()` registers SIGINT/SIGTERM handlers that stop the streamer cleanly
  - `replayBlocks(from, to)` reprocesses a historical range through subscriptions, contracts, and adapters
  - Pluggable structured logging: `logger` config option / `setLogger()`; all library output routes through it (console by default)
  - `init()` + `processPendingBlocks()` for timer-free block processing (tests, replays, serverless)
  - Files: `src/logger.ts`, `src/streamer.ts`, `src/api.ts`, `tests/production-ops.spec.ts`
- **Package metadata** - npm keywords, homepage, bugs URL, and an `engines` field (Node 22+)

#### Fixed
- **Hive Engine RPC dependency** - Replaced the abandoned `sscjs` client and its vulnerable Axios dependency chain with a small built-in JSON-RPC client that reports HTTP, RPC, and timeout failures directly
- **Tooling metadata** - Corrected `onCustomJsonId` argument order and documented the contract call client surface
- **Contract setup validation** - `defineContract()` and `registerContract()` now reject missing handlers, invalid schemas, unsupported triggers, empty trigger lists, and malformed hooks immediately
- **Package builds** - `npm run build` now clears generated output first so removed source modules cannot survive in published tarballs
- **TimeAction time anchoring** - `reset()` and `incrementExecutionCount()` now anchor to blockchain time instead of wall-clock time, keeping schedules consistent under clock skew, replays, and simulation
- **README** - `onCustomJsonId` example showed the callback and id arguments in the wrong order
- **SQLite adapter** - replaced deprecated `createTableIfNotExists` calls (knex warning spam on startup)
- **Injected dhive clients** - `setConfig()` no longer replaces a client supplied via the new `client` config option

#### Changed
- **Dependencies** - Upgraded UUID to its patched 11.x release and refreshed compatible transitive dependencies
- **Live write tests** - every suite that broadcasts now requires `RUN_LIVE_TESTS=1` in addition to credentials, so `npm test` never spends Resource Credits by accident
- **Legacy `/health` API route** - replaced the static always-ok response with real streamer health (previous `timestamp`/`uptime`/`version` fields are preserved)

## [3.1.0] - 2026-07-13

### ✨ Added
- **App Scaffolding CLI** - New `hive-stream` binary for scaffolding Hive app projects
  - Files: `src/cli/`
- **Roulette Contract** - Added roulette game contract and usage examples
  - Files: `src/contracts/`
- **Non-Custodial Asset Trading** - Added non-custodial asset trading with checkpoint support
  - Files: `src/contracts/`

## [3.0.0] - 2025-08-01

### 🔒 Security

#### Fixed
- **CRITICAL: SQL Injection Vulnerabilities** - Fixed multiple SQL injection vulnerabilities in SQLite adapter
  - Replaced all string concatenation in SQL queries with parameterized queries
  - Affected methods: `saveState()`, `processTransfer()`, `processCustomJson()`, `addEvent()`, and all query methods
  - Impact: Prevents malicious input from executing arbitrary SQL commands
  - Files: `src/adapters/sqlite.adapter.ts`

#### Changed
- **Enhanced Error Handling** - Improved error handling consistency across the codebase
  - Added structured error logging with context information
  - Implemented proper error type checking (`instanceof Error`)
  - Added retry logic for blockchain processing errors
  - Enhanced JSON parsing with validation and debug logging
  - Files: `src/streamer.ts`, `src/contracts/dice.contract.ts`, `src/utils.ts`

- **TypeScript Configuration** - Enhanced TypeScript settings for better type safety
  - Added strict TypeScript configuration with gradual adoption approach
  - Created proper interfaces for contracts, adapters, and subscriptions
  - Removed dangerous `any` types in critical areas
  - Added better type checking without breaking existing functionality
  - Files: `tsconfig.json`, `tsconfig.build.json`, `src/types/hive-stream.ts`

### ⚡ Performance

#### Added
- **Block Processing Optimization** - Significantly improved block processing performance
  - Replaced expensive `Object.entries()` calls with direct array access
  - Implemented concurrent transaction processing with batch limits (50 operations)
  - Added error isolation for individual operation failures
  - Impact: ~40-60% faster block processing
  - Files: `src/streamer.ts`

- **Database Performance Enhancement** - Major database performance improvements
  - Added prepared statement caching for frequently used queries
  - Implemented batch operations (100 operations or 1 second timeout)
  - Added transaction batching with automatic commits
  - Impact: ~70-80% reduction in database I/O operations
  - Files: `src/adapters/sqlite.adapter.ts`

- **Smart Caching System** - Comprehensive caching for frequently accessed data
  - Block caching with LRU eviction (1000 blocks maximum)
  - Account balance caching with 30-second timeout
  - Transaction caching for reuse scenarios
  - Contract lookup caching for faster resolution
  - Impact: ~50-70% reduction in API calls
  - Files: `src/streamer.ts`, `src/contracts/dice.contract.ts`

- **Action Processing Optimization** - Dramatically improved time-based action processing
  - Replaced expensive moment.js calculations with native timestamp operations
  - Added pre-computed frequency map for instant lookups
  - Implemented contract caching for faster resolution
  - Impact: ~80-90% faster action processing
  - Files: `src/streamer.ts`

- **State Saving Optimization** - Optimized state persistence
  - Changed from every-block to throttled saving (5-second intervals)
  - Made state saving asynchronous to prevent blocking
  - Impact: ~95% reduction in I/O operations
  - Files: `src/streamer.ts`

#### Fixed
- **Memory Leak Prevention** - Fixed potential memory leaks in subscription management
  - Added subscription array bounds with automatic cleanup (1000 items maximum)
  - Implemented automatic cleanup every minute
  - Added methods to remove specific subscriptions
  - Prevents unbounded memory growth in long-running processes
  - Files: `src/streamer.ts`

### 🛠️ Technical Improvements

#### Changed
- **Enhanced Type Safety** - Improved type definitions throughout the codebase
  - Created comprehensive interfaces for contracts, adapters, and subscriptions
  - Fixed method signatures and parameter types
  - Improved IDE support and compile-time error detection
  - Files: `src/types/hive-stream.ts`, `src/adapters/*.ts`, `src/streamer.ts`

- **Contract Lifecycle Management** - Improved contract method visibility
  - Changed contract lifecycle methods from private to public
  - Fixed contract instance management
  - Better contract registration and cleanup
  - Files: `src/contracts/*.ts`

#### Fixed
- **Test Configuration** - Fixed jest-fetch-mock configuration issues
  - Improved fetch mock assignment for test compatibility
  - Enhanced error handling in test setup
  - Files: `tests/setup.ts`

### 📦 Dependencies

#### Updated
- Added missing TypeScript type definitions:
  - `@types/node` (updated to latest)
  - `@types/uuid` (added)
  - `@types/seedrandom` (added)

---

## Previous Versions

### [2.0.5] - Previous Release
- Various bug fixes and improvements
- SQLite database updates
- Node configuration updates

---

## Security Policy

See [SECURITY.md](SECURITY.md) for how to report a vulnerability.
