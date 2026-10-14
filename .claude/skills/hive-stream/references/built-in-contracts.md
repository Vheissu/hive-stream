# Built-In Contracts

Hive Stream exports 48 contract factories. Before writing a contract from scratch, check whether one of these is close enough to extend or compose.

Don't work from memory for options, actions or payloads. Read:

- `hive-stream/catalog` (generated `src/catalog/contracts.json`): category, `storage` (`sql` or `any`), options with descriptions, actions with triggers, `requiresActiveKey`, payload fields and an `example` payload.
- `docs/contracts/<name>.md`: the generated reference page per contract (same source, more prose).
- `src/index.ts` for the export list.

## Rules that apply to every built-in

- **Account resolution.** Contracts that hold or pay money take an optional `account` (house/custody/treasury account) that defaults to the streamer username. Registering one with neither throws (`set options.account or the streamer username`). `account` is optional everywhere except `createBridgeContract` (`custodyAccount`, `operators` required) and `createCheckpointContract` (`tables` required).
- **Recipient guard.** Payments must be sent to an app account. If `options.account` isn't the streamer username, add it to `accounts` in config or spread `guards: { allowedRecipients: ['myhouse'] }`.
- **Storage.** Only dice, coinflip, roulette, rps, lotto and limbo run on MongoDB; the other 42 need SQLite or PostgreSQL. `getCatalogContractsForAdapter({ sql: false })` lists the MongoDB-safe ones.
- **Active key** is required for value-moving custom JSON, including (new in 5.0) exchange `transfer`/`placeOrder`/`cancelOrder`, token `issueTokens`/`transferTokens`, nft `transferNFT`/`listNFT`/`burnNFT`, multisig treasury `approveProposal`/`markExecuted`. Frontends must sign these with active authority (`hive-stream/client` does it from the spec).
- **Payout states.** Money-moving built-ins write pending/paid/failed rows and pay after the state write. Failed broadcasts are retried through `retryPayouts` (p2pswap, tournaments), `retryClaimPayout` (insurance pool), `retryRefund` (bridge), or by calling the settle/claim action again (auction `settleAuction`, crowdfund `releaseMilestone`/`refundContribution`, staking `claim`/`withdraw`/`releaseMatured`, dao `execute`). Dashboards will see `pending`/`failed` values.
- **Block time and per-operation keys.** Deadlines use `ctx.block.time`; records are keyed by `operationRecordId(trxId, opIndex)`.
- **Scheduled work** needs a `TimeAction` registered by the app: lotto `drawHourlyLottery`/`drawDailyLottery`, tournament `finalizeDue`, bridge `processQueue`, staking `releaseMatured`, exchange `matchOrders`, escrowmarket `expireTrades`, p2pswap `expireOffers`, dao `tally`/`execute`, game `rotateSeed`, and the various `expire*`/`close*` actions marked `time` in the catalog.
- Wrap a built-in with guards by spreading it: `registerContract({ ...createDiceContract(opts), guards: { maxAmount: 50, allowedAssets: ['HIVE'] } })`.

## Games (provably fair by default)

`createDiceContract` (`hivedice`), `createCoinflipContract` (`coinflip`), `createRouletteContract` (`roulette`), `createRpsContract` (`rps`), `createLottoContract` (`hivelotto`), `createLimboContract` (`limbo`).

- `fairness` defaults to on (commit-reveal); `fairness: false` restores the legacy block-id RNG. Limbo is always fair. Each game has a house-only `rotateSeed` action (active key, or a `TimeAction`). See `fairness.md`.
- `houseEdge` is a **percentage**: dice default 1, coinflip and rps default 2 (rps ties refunded). A 4.x dice value like `0.02` now means 0.02%. Limbo uses `houseEdgeBps` (default 100). Roulette has no `houseEdge` option.
- `notifyLosses` defaults to `false` (no 0.001 "you lost" transfers; results are always recorded as events).
- Bets must be addressed to the house account, from the sender, in an accepted asset (`validCurrencies`, limbo `assets`). The chain re-read checks the bet at its own operation index, so duplicated operations in one transaction don't get extra rolls.
- Invalid bets (dice roll out of range, unknown coin side or rps move, bad roulette bet, unknown lotto draw, seed over 64 chars) are refunded with a `[Refund] ...` memo. HBD bets are checked against the house `hbd_balance` and paid in the bet's asset.
- A settlement record is written to the ledger before any payout, so retries never draw twice.
- Bet limits: dice `minBet`/`maxBet`; coinflip, roulette, rps `minAmount`/`maxAmount`; limbo `minBet`, `maxBet`, `minTarget`, `maxTarget`, `maxPayout`, `maxPayoutBankrollBps`. Lotto: `cost`, `feeAccount`, `feePercentage`, `maxTicketsPerUser`, winners per draw; tickets in the wrong asset are refunded.
- Tests: give the house a bankroll (`ts.client.setAccount('myhouse', { balance: '1000.000 HIVE' })`) or bets are refunded.

## New in 5.0

- `createEscrowMarketplaceContract({ account?, agentFeeBps?, ratificationHours?, expirationDays?, autoApprove?, allowedAssets? })` (`escrowmarket`): listings paid through native Hive escrow with the app as agent. The buyer's `escrow_transfer` carries `openTrade` in `json_meta`; the agent approves (`autoApprove`, default true, or `approveTrade`, active key), the seller `markShipped`, the buyer releases on chain or `confirmDelivery`; `resolveDispute` (active key) after a dispute; `expireTrades` time action. The app never holds funds.
- `createP2PSwapContract({ account?, feeBps?, allowedAssets?, allowedTokens?, offerTtlHours? })` (`p2pswap`): `createOffer`, `fundOffer`, `takeOffer` (transfer or escrow_transfer), `settle`, `cancelOffer`, `expireOffers`, `retryPayouts` (active key). HIVE/HBD pairs settle through escrow with the app as agent (approved only after the maker pays the taker); pairs with a Hive Engine token are custodial for one leg with pending/paid/failed payouts. Mismatched payments are refunded.
- `createDaoContract({ account?, votingPower?: 'hive-power' | 'engine-token' | 'equal', tokenSymbol?, proposalDeposit?, depositAsset?, votingPeriodHours?, timelockHours?, quorum?, passThresholdBps?, admins?, allowedAssets? })` (`dao`): `deposit` (treasury funding), `createProposal` (by transfer with the deposit), `vote`, `tally`, `execute`, `vetoProposal` and `setParams` (active key), `cancelProposal`. `quorum` is an absolute amount; treasury balance comes from the contract's own ledger.

## Changed in 5.0 (money-moving contracts)

- **Auction house** (`account?`): holds bids, refunds outbid bidders and unacceptable bids, pays the seller only on `settleAuction` or buy-now, refunds the high bidder when the reserve isn't met.
- **Launchpad** (`account?`): optional `softCap` per sale (below it `finalizeSale` refunds everyone); contributions fill whole units and refund the rest.
- **Insurance pool, crowdfund, booking** (`account?`): claims, milestones and refunds are paid from the app account, rounded down, marked paid after broadcast. Booking compares prices with BigNumber, refunds payments it can't honour (`booking_refunded`) and checks state transitions.
- **Bounty board, group buy** (`account?`): `closeBounty`, `finalizeRound`, `closeGoal` run once; withdrawing a group-buy commitment lowers the totals; records keyed per operation.
- **Prediction market**: `resolveMarket` runs once; a market nobody backed the winning option of becomes `void` and refundable.
- **NFT** (`hivenft`; scaffolded apps register it as `nft`): `buyNFT` verifies payment from the triggering transfer; `buyNFTDirect` is non-custodial (`allowedRecipients: ['*']`, verifies the seller); royalties round down, none when the seller is the creator. Also `mintBatchNFT`.
- **Exchange** (`account?`): deposits must be addressed to the exchange account; an attempted withdrawal broadcast is never credited back (marked `unconfirmed`).
- **Token**: quantities with more decimals than the token's precision are rejected.
- **Proposal timelock**: `executeProposal` works time-triggered and waits for the delay; executed/cancelled proposals can't be cancelled again.
- **Bridge** (`createBridgeContract({ custodyAccount, operators, threshold?, assets?, chains?, addressPattern?, feeBps?, minAmount?, maxPerTx?, dailyLimit?, accountDailyLimit?, admins?, receipts? })`): M-of-N `attestDeposit`/`attestWithdrawal` (active key); an attestation replaces a mismatching unattested withdrawal request (`withdrawal_request_replaced`); over-limit withdrawals rejected at request time; failed deposit refunds are `refund_failed` and retried by `retryRefund`; `setPaused` (prefer it over `pauseContract`); `receipts` publishes `BridgeDepositReceipt` custom JSON per deposit.
- **Tournament** (`createTournamentContract({ account?, feeBps?, feeAccount?, oracles?, organizers? })`, `tournaments`): with `organizers` unset, the oracle defaults to the app account (a payload `oracle` must be the app account or in `oracles`); prizes/refunds have payout states with `retryPayouts`; `calculateTournamentPayouts()` exported.
- **Staking pool** (`createStakingPoolContract({ account?, admins?, accrual?: 'time' | 'block' })`, `stakingpool`): accrual stops at `endsAt`; failed claims and unbonding releases retried by the next `claim`/`withdraw`/`releaseMatured`.

## All exports by category

- Gambling: `createDiceContract`, `createCoinflipContract`, `createRouletteContract`, `createLottoContract`, `createLimboContract`, `createSweepstakesContract`, `createPredictionMarketContract`
- Games: `createRpsContract`, `createTournamentContract`, `createBadgesContract`, `createQuestPassContract`
- Social: `createTipJarContract`, `createFanClubContract`, `createReferralContract`
- Commerce: `createEscrowMarketplaceContract`, `createAuctionHouseContract`, `createBookingContract`, `createBountyBoardContract`, `createBundleMarketplaceContract`, `createGiftCardContract`, `createGroupBuyContract`, `createInvoiceContract`, `createPaywallContract`, `createRentalContract`, `createSubscriptionContract`, `createTicketingContract`
- Finance: `createP2PSwapContract`, `createExchangeContract`, `createStakingPoolContract`, `createDcaBotContract`, `createInsurancePoolContract`, `createLaunchpadContract`, `createPayrollContract`, `createRevenueSplitContract`, `createSavingsContract`
- Assets: `createTokenContract`, `createNFTContract`, `createDomainRegistryContract`
- Bridge: `createBridgeContract`
- Fundraising: `createCrowdfundContract`, `createCharityMatchContract`, `createGrantRoundsContract`
- Governance: `createDaoContract`, `createPollContract`, `createMultisigTreasuryContract`, `createProposalTimelockContract`
- Utility: `createCheckpointContract`, `createOracleBountyContract`

Other notes:

- `createBadgesContract({ account?, admins? })`: non-transferable badges, `defineBadge`, `issueBadge`, `revokeBadge`, `updateIssuers`, rule-based `contribute` and `checkIn`.
- `createTicketingContract` tickets are transferable (`transferTicket`) and resellable peer-to-peer (`listTicket`, `unlistTicket`, `buyTicketDirect`, non-custodial).
- `createRentalContract` starts rentals from an `escrow_transfer` (`initiateRental`).
- `createCheckpointContract({ tables, account? })` publishes deterministic state hashes on-chain (pair with a `TimeAction` calling `publishCheckpoint`) and verifies other operators' hashes via `recordCheckpoint`.

Good practice:

- Prefer composing around an existing factory before cloning contract logic.
- Add focused tests when wrapping or extending a built-in contract, using `createTestStreamer()`.
- Recipes in `examples/recipes/` show dice, tournament, bridge, escrow marketplace, P2P swap, DAO and multi-account setups end to end.
