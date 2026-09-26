# Built-in Contracts

Hive Stream ships 45 ready-to-register contracts. Every page here is generated from the contract source, so triggers, options and payload schemas are always current. The same data is available to tools as JSON through `hive-stream/catalog`.

| Contract | Category | Actions | Description |
| --- | --- | --- | --- |
| [auctionhouse](./auctionhouse) | commerce | 4 | Auctions with reserve prices, buy-now support, and timed settlement. |
| [badges](./badges) | games | 6 | Non-transferable achievements and badges issued by authorised issuers or earned by payment and check-in rules. |
| [bookings](./bookings) | commerce | 5 | Reservable listings with paid booking windows and confirmations. |
| [bountyboard](./bountyboard) | commerce | 4 | Funded bounties, submissions, and award selection. |
| [bridge](./bridge) | bridge | 7 | A custody bridge/peg with M-of-N operator attestations, fees, per-transaction and daily limits, a pause switch and a full audit trail. |
| [bundlemarketplace](./bundlemarketplace) | commerce | 4 | Fixed-price bundle storefronts with inventory tracking. |
| [charitymatch](./charitymatch) | fundraising | 3 | Donation campaigns with matched totals and closing summaries. |
| [checkpoint](./checkpoint) | utility | 2 | Deterministic state hashes published on-chain for operator verification. |
| [coinflip](./coinflip) | gambling | 1 | A heads-or-tails coin flip game. |
| [crowdfund](./crowdfund) | fundraising | 5 | Crowdfunding campaigns with milestones, finalization, and refunds. |
| [dcabots](./dcabots) | finance | 5 | Time-based DCA bot scheduling and execution request events. |
| [domains](./domains) | assets | 5 | App-level namespaces with registrations, renewals, and transfers. |
| [exchange](./exchange) | finance | 8 | An order-book exchange with deposits, withdrawals, balances, and matching. |
| [fanclub](./fanclub) | social | 4 | Paid fan clubs with renewals, engagement points, and perk redemptions. |
| [giftcards](./giftcards) | commerce | 3 | Gift card issuance, redemption, and cancellation. |
| [grantrounds](./grantrounds) | fundraising | 6 | Matching grant rounds with submissions, donations, and allocations. |
| [groupbuy](./groupbuy) | commerce | 4 | Threshold-based pooled purchases. |
| [hivedice](./hivedice) | gambling | 1 | A dice rolling game with configurable win chance and payout multipliers. |
| [hivelotto](./hivelotto) | gambling | 3 | A lottery-style game with scheduled draws. |
| [hivenft](./hivenft) | assets | 13 | NFT minting, transfers, market listings, and direct peer-to-peer sales. |
| [hivetoken](./hivetoken) | assets | 5 | App-level token issuance, transfers, and balances. |
| [insurancepool](./insurancepool) | finance | 6 | Insurance pools with premium-backed policies, claims, and reserves. |
| [invoices](./invoices) | commerce | 4 | Invoices with partial payments, recurring payments, and overdue sweeps. |
| [launchpad](./launchpad) | finance | 4 | Launchpad sales with allocations, finalization, and claim flows. |
| [limbo](./limbo) | gambling | 2 | A provably-fair limbo/crash game: pick a target multiplier and win when the committed-seed result reaches it, with bankroll-based payout caps. |
| [multisigtreasury](./multisigtreasury) | governance | 5 | Multisig vaults, proposal approvals, and execution readiness. |
| [oraclebounty](./oraclebounty) | utility | 5 | Oracle bounty feeds with report rounds and median finalization. |
| [payroll](./payroll) | finance | 5 | Recurring team payrolls with funded budgets and scheduled runs. |
| [paywall](./paywall) | commerce | 4 | Paid access control for gated resources and memberships. |
| [polls](./polls) | governance | 2 | Polls and voting. |
| [predictionmarkets](./predictionmarkets) | gambling | 4 | Prediction markets with positions, resolution, and winner claims. |
| [proposaltimelock](./proposaltimelock) | governance | 5 | Timelocked governance queues with approvals and delays. |
| [questpass](./questpass) | games | 4 | Seasonal passes with progress tracking and reward claims. |
| [referrals](./referrals) | social | 5 | Affiliate programs with codes, funded budgets, and payout balances. |
| [rentals](./rentals) | commerce | 4 | Escrow-backed rental agreements for items, passes, or assets. |
| [revenuesplit](./revenuesplit) | finance | 4 | Revenue share ledgers and withdrawal requests for collaborators. |
| [roulette](./roulette) | gambling | 1 | Roulette with straight, color, parity, dozen, column, and low/high bets. |
| [rps](./rps) | games | 1 | Rock-paper-scissors with wagers. |
| [savings](./savings) | finance | 4 | Savings goals with recurring contributions and withdrawal requests. |
| [stakingpool](./stakingpool) | finance | 8 | Staking pools with reward-per-share accrual (per second or per block), funded reward reserves, cooldowns and claims. |
| [subscriptions](./subscriptions) | commerce | 5 | Subscription plans renewed by transfers or recurrent transfers. |
| [sweepstakes](./sweepstakes) | gambling | 3 | Paid-entry sweepstakes with deterministic winner draws. |
| [ticketing](./ticketing) | commerce | 8 | Event ticketing with purchases, check-ins, refunds, transfers, and resale. |
| [tipjar](./tipjar) | social | 1 | A tip jar with an optional message board. |
| [tournaments](./tournaments) | games | 7 | Game tournaments with entry fees, registration windows, oracle-submitted scores, tie handling and basis-point prize splits. |
