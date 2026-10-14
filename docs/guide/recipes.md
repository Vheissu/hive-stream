# Recipes

Complete, working starting points for the kinds of apps people build on Hive. Every file here lives in [`examples/recipes`](https://github.com/Vheissu/hive-stream/tree/master/examples/recipes) and a test type-checks it against the current API, so the code on this page compiles.

Each server recipe expects `USERNAME`, `ACTIVE_KEY` and `POSTING_KEY` in `.env` (loaded by `env: true`). Try any of them offline first with the [testing kit](./testing).

## Dice with provably fair rolls

A house account takes bets by transfer. Seeds are committed before bets and revealed daily ([how that works](./fairness)). Guards cap bet size and rate, and a hook refunds anything a guard rejects.

<<< @/../examples/recipes/dice-fairness.ts

Why the refund hook writes a ledger key before it transfers: if the process dies between the refund and the next checkpoint, the block is replayed on restart and the guard rejects the bet again. The key makes the second pass a no-op. Doing it in that order means a crash can lose a refund (you'll see it in the logs) but can never pay one twice.

Leave `errorPolicy: 'halt'` on for anything that moves money. A handler that throws stops the stream at that block, `getHealth()` reports `halted`, and nothing further is paid until you look.

## A paid tournament for a game

Players enter by sending the exact entry fee. Your game server is the oracle: it posts scores with active authority, and prizes pay out when the tournament ends. Ties split the prize by default, and under-subscribed tournaments refund every entry.

<<< @/../examples/recipes/tournament.ts

Prize splits are in basis points and must add up to 10000. Any rounding dust goes to first place, so payouts always sum to exactly the pool minus the house fee.

## Tips with public thank-you replies

The tip jar contract records tips. A streamer hook replies publicly to each one instead of sending a dust transfer back, and a plugin made with `defineHooks` collects timings and errors.

<<< @/../examples/recipes/tipping-hooks.ts

`afterContractAction` only fires after the handler succeeds, so a tip that failed validation never gets a thank-you. Replies need the posting key.

## A custody bridge with operator attestations

Three files, because a bridge is three roles. The custody rules turn on deposit receipts, so the custody account publishes its decision on every deposit:

<<< @/../examples/recipes/bridge-config.ts

The custody service holds deposits and releases withdrawals once enough operators agree:

<<< @/../examples/recipes/bridge.ts

Each operator runs its own process with its own account and key:

<<< @/../examples/recipes/bridge-operator.ts

The part to get right is the operator's check before minting. The custody contract refunds deposits that break its rules, and an operator that mints one anyway has created unbacked tokens on the other chain. With `receipts` on, operators don't have to re-implement those rules: the custody account broadcasts a custom_json receipt (posting authority) with `status: 'accepted'` or `status: 'refunded'` and a reason. Operators mint only accepted deposits, using the receipt's `netAmount`. Accepted receipts also carry `dailyTotal` and `accountDailyTotal`, the rolling 24-hour totals the daily limits were checked against. Always check that a receipt was signed by the custody account: anyone can broadcast a custom_json under the same id.

If a receipt broadcast fails, the deposit decision still stands. The failure is recorded in `bridge_audit` as `deposit_receipt_failed`, and the deposit stays `pending` in `bridge_deposits` for an operator to pick up.

Withdrawals run the other way. A user burns or locks on the other chain and calls `requestWithdrawal`. Operators then attest with `attestWithdrawal`, and custody releases the funds at the threshold. If a release broadcast fails, it's marked `release_failed` and waits for an admin: it's never retried blindly.

## A peer-to-peer escrow marketplace

Buyers lock funds in a native Hive escrow with the app as *agent*; the seller ships, the buyer releases, and the app only steps in to resolve disputes. The app never holds the money. Built on the `escrowmarket` contract and the escrow lifecycle triggers.

<<< @/../examples/recipes/escrow-marketplace.ts

## A peer-to-peer swap desk

HIVE, HBD and Hive Engine tokens traded between users. HIVE/HBD pairs settle through Hive escrow with the app as agent, which approves the taker's escrow only once the maker has paid; token legs are held by the app only until the other side pays. Built on the `p2pswap` contract.

<<< @/../examples/recipes/p2p-swap.ts

## A DAO with a treasury

Stake-weighted proposals (Hive Power, a Hive Engine token, or one account one vote), a quorum, a timelock, admin veto, and payouts that retry until they land. Built on the `dao` contract.

<<< @/../examples/recipes/dao.ts

## One app, several accounts

A platform that acts as a public-facing account, a treasury and an escrow agent at once: each signs with its own keys, transfers to any of them run contract actions, and a rejected payment goes back from the account that received it.

<<< @/../examples/recipes/multi-account.ts

## A browser frontend

`hive-stream/client` has no Node dependencies. This builds a dice bet for Hive Keychain and checks a settled bet against the revealed seed:

<<< @/../examples/recipes/browser-client.ts

For contracts you write yourself, share a [contract spec](./contract-calls) between server and frontend. Payload validation then runs in the browser before the user signs anything.
