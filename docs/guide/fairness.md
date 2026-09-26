# Provably Fair Randomness

Games that take real money need randomness that neither the house nor the players can steer, and that players can check afterwards. Hive Stream ships a commit-reveal scheme for this. The built-in games use it when you pass `fairness`, and your own contracts can use it too.

## Why block ids are not enough

The legacy mode of `dice`, `coinflip`, `roulette`, `rps` and `lotto` seeds its random number generator from the bet's block id, the previous block id and the transaction id. All three are public, and two parties can influence them:

- **The block producer.** A witness assembles the block. By including, excluding or reordering transactions they change the block id, so a witness who also plays (or colludes with a player) can try several candidate blocks and publish the one that wins.
- **The player.** The transaction id is a hash of the transaction the player signs. A player can tweak the memo or expiration until the id lands on something favourable when combined with a block id they can predict or influence.

`coinflip`, `roulette` and `rps` also mixed in a random per-bet server seed. It was only published after the bet, though, so nothing stopped the operator from choosing a losing seed.

## How the commit-reveal scheme works

1. **Commit.** The operator generates a secret `serverSeed` (32 random bytes) and publishes `sha256(serverSeed)` before accepting any bet that uses it.
2. **Bet.** Every bet has a `clientSeed`, which is the player's `seed` payload field or their account name. It also gets the next `nonce` for the active seed. In the recommended `entropy: 'block'` mode, the bet's block id is mixed in as public entropy.
3. **Derive.** The random bytes are `HMAC-SHA256(key = serverSeed, message)` with this message:
   - `clientSeed:nonce:round`, or
   - `clientSeed:entropy:nonce:round` when block entropy is on.

   `round` starts at `0` and increments when more than 32 bytes are needed. The bytes are read as big-endian `uint32` values and mapped to ranges by rejection sampling, so every outcome is exactly equally likely (no modulo bias).
4. **Reveal.** Rotating the seed publishes the old `serverSeed` and commits to a new one. Anyone can then check that the seed hashes to the commitment and recompute every outcome.

What each party can and cannot do:

- **The operator** committed to the seed before seeing the bets, so it cannot pick outcomes. It does not control the client seed, and it does not know the block id in advance.
- **A player** cannot predict an outcome without the server seed.
- **Block entropy (recommended).** Even if a server seed leaks early, a player still cannot know their outcome before the block is produced.
- **A block producer** can nudge the block id, but without the server seed that tells them nothing about any outcome.

::: warning Remaining trust
The operator knows the server seed, so the operator must not also play. Keep the seed secret until rotation, and rotate regularly (for example with `rotateAfter`). Publish each commitment somewhere players can see it before they bet: an event, your UI, or an on-chain `custom_json` from `onRotate`.
:::

## Enabling it on the built-in games

```ts
import { createDiceContract, createLimboContract } from 'hive-stream';

await streamer.registerContract(createDiceContract({ account: 'myhouse', fairness: true }));

await streamer.registerContract(createLimboContract({
    account: 'myhouse',
    fairness: {
        rotateAfter: 1000,          // reveal and replace the seed every 1000 bets
        onRotate: async ({ revealed, commitment }) => {
            // publish the new commitment somewhere players can see it
        }
    }
}));
```

With fairness on:

- Each settled bet records its proof (`scope`, `seedIndex`, `serverSeedHash`, `clientSeed`, `nonce`, `entropy`) and the `outcomeSpec` in the contract event.
- The payout memo carries the seed index, the nonce and the commitment.
- Players can set their own client seed with the optional `seed` payload field.
- The game gains a `rotateSeed` action. It is called by the house account over `custom_json` with active authority, or by a time action, and reveals the current seed in a `fairness_seed_rotated` event.

Seeds and nonces are stored through your adapter: a `fairness_seeds` table for SQLite and PostgreSQL, a collection for MongoDB. Nonces are persisted before an outcome is computed, so a restart never reuses one.

`createLimboContract` always uses the fair scheme. `lotto` draws use the sha256 of every entry's transaction id as the client seed, so every entrant contributes entropy.

## Verifying a bet (browser or Node)

The verifier is pure JavaScript with no dependencies, and is exported from `hive-stream/client`:

```ts
import { verifyOutcome } from 'hive-stream/client';

const result = verifyOutcome(
    {
        serverSeed: revealed.serverSeed,      // from the rotation event
        serverSeedHash: proof.serverSeedHash, // committed before the bet
        clientSeed: proof.clientSeed,
        nonce: proof.nonce,
        entropy: proof.entropy
    },
    { type: 'dice', sides: 100 },           // the bet's outcomeSpec
    settledRoll                             // what the operator paid out on
);

result.valid;            // commitment matches AND outcome matches
result.commitmentValid;  // sha256(serverSeed) === serverSeedHash
result.outcome;          // the recomputed outcome
```

Supported outcome specs:

| Spec | Result |
| --- | --- |
| `{ type: 'int', min, max }` | integer in `[min, max]` |
| `{ type: 'dice', sides? }` | integer in `[1, sides]` (default 100) |
| `{ type: 'coin' }` | `'heads' \| 'tails'` |
| `{ type: 'roulette' }` | integer in `[0, 36]` |
| `{ type: 'pick', count, total }` | `count` distinct indices from `[0, total)` |
| `{ type: 'float' }` | float in `[0, 1)` with 52 bits |
| `{ type: 'crash', houseEdgeBps, maxMultiplierCents? }` | `{ multiplierCents, multiplier }`, where `P(result ≥ t) = (1 - edge) / t` |

## Using it in your own contracts

```ts
import { createFairness, defineContract, action } from 'hive-stream';
import { z } from 'zod';

const fairness = createFairness({ entropy: 'block', rotateAfter: 500 });

export const wheel = defineContract({
    name: 'wheel',
    hooks: {
        create: async ({ adapter }) => {
            await fairness.init({ adapter, scope: 'wheel' });
        }
    },
    actions: {
        spin: action(async (payload, ctx) => {
            const { outcome, proof } = await fairness.draw(
                { type: 'int', min: 0, max: 11 },
                { clientSeed: payload.seed || ctx.sender!, blockId: ctx.block.id }
            );
            // settle using `outcome`, store `proof` with the result
        }, { trigger: 'transfer', schema: z.object({ seed: z.string().max(64).optional() }) })
    }
});
```

`fairness.getCommitment()` returns the active `serverSeedHash` and next nonce for your UI. `fairness.rotate()` reveals a seed, and `fairness.getRevealedSeed(index)` fetches a revealed one; active seeds are never returned. Draws are serialized, so concurrent bets never share a nonce.
