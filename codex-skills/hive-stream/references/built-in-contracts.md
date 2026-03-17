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

Use `src/index.ts` as the source of truth for the current export list and names.

Good practice:

- Prefer composing around an existing factory before cloning contract logic.
- Reuse package contracts for app bootstrap examples.
- Add focused tests when wrapping or extending a built-in contract.
