# Provably Fair Randomness

Block/transaction-id seeding (the legacy RNG in dice, coinflip, roulette, rps, lotto) is biasable by the block producer and by players grinding transaction ids. For real-money games use the fairness module.

## Built-in games

- `createDiceContract({ account, fairness: true })`, same for coinflip, roulette, rps, lotto. Options: `fairness: { rotateAfter, entropy: 'block' | 'none', onRotate, store, scope }` or a shared `FairnessManager`.
- `createLimboContract` always uses it.
- With fairness on, results record a proof (`scope`, `seedIndex`, `serverSeedHash`, `clientSeed`, `nonce`, `entropy`) and `outcomeSpec` in contract events, memos carry seed index + nonce + commitment, players may pass `seed` (max 64 chars) as client seed, and a house-only `rotateSeed` action (custom_json with active key, or a `TimeAction`) reveals the seed.
- Seeds persist in `fairness_seeds` (SQL) or a Mongo collection; nonces are saved before an outcome is computed.

## Scheme

Commit `sha256(serverSeed)` before bets. Bytes = `HMAC-SHA256(serverSeed, clientSeed[:blockId]:nonce:round)`. Ranges via rejection sampling (no modulo bias). Rotation reveals the old seed and commits a new one. The operator must not play.

## Own contracts

```ts
import { createFairness } from 'hive-stream';

const fairness = createFairness({ entropy: 'block', rotateAfter: 500 });
// create hook:   await fairness.init({ adapter, scope: 'wheel' });
// handler:       const { outcome, proof } = await fairness.draw({ type: 'int', min: 0, max: 11 }, { clientSeed: payload.seed || ctx.sender!, blockId: ctx.block.id });
```

Specs: `{ type: 'int', min, max }`, `{ type: 'dice', sides? }`, `{ type: 'coin' }`, `{ type: 'roulette' }`, `{ type: 'pick', count, total }`, `{ type: 'float' }`, `{ type: 'crash', houseEdgeBps, maxMultiplierCents? }`. Also `getCommitment()`, `rotate()`, `getRevealedSeed(index)`.

## Verification (browser-safe)

`verifyOutcome({ serverSeed, serverSeedHash, clientSeed, nonce, entropy }, spec, claimed)` from `hive-stream/client` returns `{ valid, commitmentValid, outcome }`. Also exported: `deriveOutcome`, `hashServerSeed`, `verifyServerSeedCommitment`, `sha256Hex`, `hmacSha256Hex`.
