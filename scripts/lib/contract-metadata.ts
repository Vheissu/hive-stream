import type { ContractCategory } from '../../src/catalog/types';

/**
 * Catalog metadata for built-in contract factories, keyed by the factory's
 * export name from `src/index.ts`.
 *
 * Adding a contract: export its `create*Contract` factory from src/index.ts
 * and add ONE line here. The catalog and docs generators discover factories
 * automatically; tests/contract-catalog.spec.ts fails if a factory has no
 * entry here (or no description/category on the definition itself).
 *
 * `args` supplies representative options for factories whose options have
 * no defaults, so the generator can instantiate them.
 */
export interface ContractMetadata {
    category: ContractCategory;
    description: string;
    args?: unknown[];
}

export const CONTRACT_METADATA: Record<string, ContractMetadata> = {
    createAuctionHouseContract: { category: 'commerce', description: 'Auctions with reserve prices, buy-now support, and timed settlement.' },
    createBadgesContract: { category: 'games', description: 'Non-transferable achievements and badges issued by authorised issuers or earned by payment and check-in rules.' },
    createBookingContract: { category: 'commerce', description: 'Reservable listings with paid booking windows and confirmations.' },
    createBountyBoardContract: { category: 'commerce', description: 'Funded bounties, submissions, and award selection.' },
    createBridgeContract: { category: 'bridge', description: 'A custody bridge/peg with M-of-N operator attestations, fees, per-transaction and daily limits, a pause switch and a full audit trail.', args: [{ custodyAccount: 'bridge-custody', operators: ['operator-a', 'operator-b', 'operator-c'], threshold: 2 }] },
    createBundleMarketplaceContract: { category: 'commerce', description: 'Fixed-price bundle storefronts with inventory tracking.' },
    createCharityMatchContract: { category: 'fundraising', description: 'Donation campaigns with matched totals and closing summaries.' },
    createCheckpointContract: { category: 'utility', description: 'Deterministic state hashes published on-chain for operator verification.', args: [{ tables: ['nft_tokens'] }] },
    createCoinflipContract: { category: 'gambling', description: 'A heads-or-tails coin flip game.' },
    createCrowdfundContract: { category: 'fundraising', description: 'Crowdfunding campaigns with milestones, finalization, and refunds.' },
    createDcaBotContract: { category: 'finance', description: 'Time-based DCA bot scheduling and execution request events.' },
    createDiceContract: { category: 'gambling', description: 'A dice rolling game with configurable win chance and payout multipliers.' },
    createDomainRegistryContract: { category: 'assets', description: 'App-level namespaces with registrations, renewals, and transfers.' },
    createExchangeContract: { category: 'finance', description: 'An order-book exchange with deposits, withdrawals, balances, and matching.' },
    createFanClubContract: { category: 'social', description: 'Paid fan clubs with renewals, engagement points, and perk redemptions.' },
    createGiftCardContract: { category: 'commerce', description: 'Gift card issuance, redemption, and cancellation.' },
    createGrantRoundsContract: { category: 'fundraising', description: 'Matching grant rounds with submissions, donations, and allocations.' },
    createGroupBuyContract: { category: 'commerce', description: 'Threshold-based pooled purchases.' },
    createInsurancePoolContract: { category: 'finance', description: 'Insurance pools with premium-backed policies, claims, and reserves.' },
    createInvoiceContract: { category: 'commerce', description: 'Invoices with partial payments, recurring payments, and overdue sweeps.' },
    createLaunchpadContract: { category: 'finance', description: 'Launchpad sales with allocations, finalization, and claim flows.' },
    createLimboContract: { category: 'gambling', description: 'A provably-fair limbo/crash game: pick a target multiplier and win when the committed-seed result reaches it, with bankroll-based payout caps.', args: [{ account: 'house' }] },
    createLottoContract: { category: 'gambling', description: 'A lottery-style game with scheduled draws.' },
    createMultisigTreasuryContract: { category: 'governance', description: 'Multisig vaults, proposal approvals, and execution readiness.' },
    createNFTContract: { category: 'assets', description: 'NFT minting, transfers, market listings, and direct peer-to-peer sales.' },
    createOracleBountyContract: { category: 'utility', description: 'Oracle bounty feeds with report rounds and median finalization.' },
    createPayrollContract: { category: 'finance', description: 'Recurring team payrolls with funded budgets and scheduled runs.' },
    createPaywallContract: { category: 'commerce', description: 'Paid access control for gated resources and memberships.' },
    createPollContract: { category: 'governance', description: 'Polls and voting.' },
    createPredictionMarketContract: { category: 'gambling', description: 'Prediction markets with positions, resolution, and winner claims.' },
    createProposalTimelockContract: { category: 'governance', description: 'Timelocked governance queues with approvals and delays.' },
    createQuestPassContract: { category: 'games', description: 'Seasonal passes with progress tracking and reward claims.' },
    createReferralContract: { category: 'social', description: 'Affiliate programs with codes, funded budgets, and payout balances.' },
    createRentalContract: { category: 'commerce', description: 'Escrow-backed rental agreements for items, passes, or assets.' },
    createRevenueSplitContract: { category: 'finance', description: 'Revenue share ledgers and withdrawal requests for collaborators.' },
    createRouletteContract: { category: 'gambling', description: 'Roulette with straight, color, parity, dozen, column, and low/high bets.' },
    createRpsContract: { category: 'games', description: 'Rock-paper-scissors with wagers.' },
    createSavingsContract: { category: 'finance', description: 'Savings goals with recurring contributions and withdrawal requests.' },
    createStakingPoolContract: { category: 'finance', description: 'Staking pools with reward-per-share accrual (per second or per block), funded reward reserves, cooldowns and claims.', args: [{ account: 'staking-vault' }] },
    createSubscriptionContract: { category: 'commerce', description: 'Subscription plans renewed by transfers or recurrent transfers.' },
    createSweepstakesContract: { category: 'gambling', description: 'Paid-entry sweepstakes with deterministic winner draws.' },
    createTicketingContract: { category: 'commerce', description: 'Event ticketing with purchases, check-ins, refunds, transfers, and resale.' },
    createTipJarContract: { category: 'social', description: 'A tip jar with an optional message board.' },
    createTokenContract: { category: 'assets', description: 'App-level token issuance, transfers, and balances.' },
    createTournamentContract: { category: 'games', description: 'Game tournaments with entry fees, registration windows, oracle-submitted scores, tie handling and basis-point prize splits.', args: [{ account: 'tournament-host' }] }
};
