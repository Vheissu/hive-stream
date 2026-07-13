# Built-In Contracts

Hive Stream already exports many contract factories. Before writing a contract from scratch, check whether one of these is close enough to extend or compose.

Representative exports:

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

Use `src/index.ts` as the source of truth for the current export list and names.

Non-custodial asset notes:

- `createNFTContract` supports `mintBatchNFT` (numbered editions or explicit token lists) and `buyNFTDirect` (buyer pays the seller directly; the contract verifies the recipient and flips ownership — no funds through the app account). Its default registered name is `hivenft`; scaffolded apps register it as `nft`.
- `createTicketingContract` tickets are transferable (`transferTicket`) and resellable peer-to-peer (`listTicket`, `unlistTicket`, `buyTicketDirect`).
- `createCheckpointContract({ account, tables })` publishes deterministic state hashes on-chain (pair with a `TimeAction` calling `publishCheckpoint`) and verifies other operators' hashes via `recordCheckpoint`.

Good practice:

- Prefer composing around an existing factory before cloning contract logic.
- Reuse package contracts for app bootstrap examples.
- Add focused tests when wrapping or extending a built-in contract.
