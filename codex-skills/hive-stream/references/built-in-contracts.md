# Built-In Contracts

Hive Stream exports 45 contract factories. Before writing a contract from scratch, check whether one of these is close enough to extend or compose. `hive-stream/catalog` (generated `src/catalog/contracts.json`) lists each one's category, options, actions, triggers, active-key requirements and payload fields; `docs/contracts/*.md` has a generated reference page per contract.

Added in 4.0:

- `createBridgeContract({ custodyAccount, operators, threshold?, assets?, chains?, addressPattern?, feeBps?, minAmount?, maxPerTx?, dailyLimit?, accountDailyLimit?, admins? })` (name `bridge`): deposits by transfer with `{ chain, address }`, M-of-N `attestDeposit` / `attestWithdrawal` (active key), `requestWithdrawal`, `setPaused` (refunds deposits, queues releases; prefer it over `pauseContract`), `processQueue` time action, `bridge_audit` trail. Deposit id = `operationRecordId(trxId, opIndex)`.
- `createTournamentContract({ account, feeBps?, feeAccount?, oracles?, organizers? })` (name `tournaments`): `createTournament`, `enter` (exact fee by transfer), oracle-only `submitScore`/`submitScores` (active key), `finalize`, `cancelTournament`, `finalizeDue` time action. `prizeSplitBps` must sum to 10000; `calculateTournamentPayouts()` exported.
- `createStakingPoolContract({ account, admins?, accrual?: 'time' | 'block' })` (name `stakingpool`): `createPool`, `fundRewards`, `stake`, `unstake`, `withdraw`, `claim`, `setRewardRate`, `releaseMatured` time action.
- `createLimboContract({ account, assets?, houseEdgeBps?, minBet?, maxBet?, minTarget?, maxTarget?, maxPayout?, maxPayoutBankrollBps?, notifyLosses?, fairness? })` (name `limbo`): always provably fair.
- `createBadgesContract({ account?, admins? })` (name `badges`): non-transferable `defineBadge`, `issueBadge`, `revokeBadge`, `updateIssuers`, rule-based `contribute` and `checkIn`.
- `fairness` option on `createDiceContract` (name `hivedice`), `createCoinflipContract`, `createRouletteContract`, `createRpsContract`, `createLottoContract` (name `hivelotto`; time actions `drawHourlyLottery` / `drawDailyLottery`). See `fairness.md`.

All exports:

- `createDiceContract`
- `createLottoContract`
- `createCoinflipContract`
- `createTokenContract`
- `createNFTContract`
- `createRpsContract`
- `createPollContract`
- `createTipJarContract`
- `createExchangeContract`
- `createAuctionHouseContract`
- `createSubscriptionContract`
- `createCrowdfundContract`
- `createBountyBoardContract`
- `createInvoiceContract`
- `createSavingsContract`
- `createBookingContract`
- `createGiftCardContract`
- `createGroupBuyContract`
- `createSweepstakesContract`
- `createDcaBotContract`
- `createMultisigTreasuryContract`
- `createRevenueSplitContract`
- `createPaywallContract`
- `createDomainRegistryContract`
- `createRentalContract`
- `createLaunchpadContract`
- `createPredictionMarketContract`
- `createQuestPassContract`
- `createCharityMatchContract`
- `createReferralContract`
- `createInsurancePoolContract`
- `createOracleBountyContract`
- `createGrantRoundsContract`
- `createPayrollContract`
- `createProposalTimelockContract`
- `createBundleMarketplaceContract`
- `createTicketingContract`
- `createFanClubContract`
- `createCheckpointContract`
- `createBridgeContract`
- `createTournamentContract`
- `createStakingPoolContract`
- `createLimboContract`
- `createBadgesContract`

Use `src/index.ts` as the source of truth for the current export list and names.

Non-custodial asset notes:

- `createNFTContract` supports `mintBatchNFT` (numbered editions or explicit token lists) and `buyNFTDirect` (buyer pays the seller directly; the contract verifies the recipient and flips ownership — no funds through the app account). Its default registered name is `hivenft`; scaffolded apps register it as `nft`.
- `createTicketingContract` tickets are transferable (`transferTicket`) and resellable peer-to-peer (`listTicket`, `unlistTicket`, `buyTicketDirect`).
- `createCheckpointContract({ account, tables })` publishes deterministic state hashes on-chain (pair with a `TimeAction` calling `publishCheckpoint`) and verifies other operators' hashes via `recordCheckpoint`.

Good practice:

- Prefer composing around an existing factory before cloning contract logic.
- Reuse package contracts for app bootstrap examples.
- Add focused tests when wrapping or extending a built-in contract, using `createTestStreamer()`.
- Most built-ins use SQL tables: register them with SQLite or PostgreSQL, not MongoDB.
- Built-ins with scheduled work need a `TimeAction` registered by the app (lotto draws, tournament `finalizeDue`, bridge `processQueue`, staking `releaseMatured`, game `rotateSeed`).
- Wrap a built-in with guards by spreading it: `registerContract({ ...createDiceContract(opts), guards: { maxAmount: 50 } })`.
