# Provably Fair Randomness

Block/transaction-id seeding is biasable by the block producer and by players grinding transaction ids. The fairness module (commit-reveal) fixes that, and since 5.0 every built-in game uses it by default.

## Built-in games

- `createDiceContract`, `createCoinflipContract`, `createRouletteContract`, `createRpsContract`, `createLottoContract`: `fairness` defaults to on. Pass `fairness: { rotateAfter, entropy: 'block' | 'none', onRotate, store, scope }` or a shared `FairnessManager` to tune it, or `fairness: false` for the legacy block-id mode (not verifiable; only for compatibility or tests that hard-code rolls).
- `createLimboContract` always uses it (`fairness` only tunes it).
- With fairness on, results record a proof (`scope`, `seedIndex`, `serverSeedHash`, `clientSeed`, `nonce`, `entropy`) and `outcomeSpec` in contract events, payout memos carry seed index + nonce + commitment, players may pass `seed` (max 64 chars; longer is refunded) as client seed, and a house-only `rotateSeed` action (custom_json with active key, or a `TimeAction`) reveals the seed in a `fairness_seed_rotated` event.
- Lotto uses the sha256 of every entry's transaction id as the client seed, so every entrant contributes entropy.
- Seeds persist in `fairness_seeds` (SQL) or a Mongo collection; nonces are saved before an outcome is computed, and a settlement record is written before any payout, so a replay never draws again.
- Related game defaults: `houseEdge` is a percentage (dice 1, coinflip and rps 2; limbo `houseEdgeBps` 100), `notifyLosses` is off, invalid bets are refunded. See `built-in-contracts.md`.

## Scheme

Commit `sha256(serverSeed)` before bets. Bytes = `HMAC-SHA256(serverSeed, clientSeed[:blockId]:nonce:round)`. Ranges via rejection sampling (no modulo bias). Rotation reveals the old seed and commits a new one. The operator must not play; publish each commitment (event, UI, or on-chain custom JSON from `onRotate`) before players bet, and rotate regularly.

## Own contracts

```ts
import { createFairness } from 'hive-stream';

const fairness = createFairness({ entropy: 'block', rotateAfter: 500 });
// create hook:   await fairness.init({ adapter, scope: 'wheel' });
// handler:       const { outcome, proof } = await fairness.draw({ type: 'int', min: 0, max: 11 }, { clientSeed: payload.seed || ctx.sender!, blockId: ctx.block.id });
```

Specs: `{ type: 'int', min, max }`, `{ type: 'dice', sides? }`, `{ type: 'coin' }`, `{ type: 'roulette' }`, `{ type: 'pick', count, total }`, `{ type: 'float' }`, `{ type: 'crash', houseEdgeBps, maxMultiplierCents? }`. Also `getCommitment()`, `rotate()`, `getRevealedSeed(index)` (active seeds are never returned). Draws are serialized, so concurrent bets never share a nonce.

For a game of your own, also copy what the built-ins do around the draw: verify the bet transfer at its operation index, cap payouts by bankroll, write the settlement before broadcasting, and refund invalid bets.

## Verification (browser-safe)

`verifyOutcome({ serverSeed, serverSeedHash, clientSeed, nonce, entropy }, spec, claimed)` from `hive-stream/client` returns `{ valid, commitmentValid, outcome }`. Also exported: `deriveOutcome`, `hashServerSeed`, `verifyServerSeedCommitment`, `sha256Hex`, `hmacSha256Hex`.
