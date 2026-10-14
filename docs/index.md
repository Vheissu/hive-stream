---
layout: home

hero:
  name: Hive Stream
  text: Build apps on the Hive blockchain
  tagline: Stream operations, run contracts that move real money, and test all of it offline. Node.js, TypeScript, MIT.
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: Recipes
      link: /guide/recipes
    - theme: alt
      text: Built-in Contracts
      link: /contracts/
    - theme: alt
      text: Upgrading to 5.0
      link: /guide/migrating-to-5

features:
  - title: Gambling apps
    details: Dice, coinflip, roulette, lotto and limbo with commit-reveal seeds players can verify, bankroll caps, and refunds for bets the house can't cover.
    link: /guide/recipes#dice-with-provably-fair-rolls
    linkText: Dice recipe
  - title: Games
    details: Paid tournaments with oracle-submitted scores, non-transferable badges, quest passes and NFTs. Prizes split in basis points and always sum to the pool.
    link: /guide/recipes#a-paid-tournament-for-a-game
    linkText: Tournament recipe
  - title: Social apps
    details: React to posts, votes, follows and tips, reply in public threads, and run polls, fan clubs and paywalls. Hooks give you metrics and moderation in one place.
    link: /guide/recipes#tips-with-public-thank-you-replies
    linkText: Tipping recipe
  - title: Bridges and custody
    details: Deposits held until M-of-N operators attest, per-transaction and daily limits, a pause switch, and an audit row for every state change.
    link: /guide/recipes#a-custody-bridge-with-operator-attestations
    linkText: Bridge recipe
  - title: Safe with real money
    details: Blocks are processed once irreversible, the cursor is saved after every block, an idempotency ledger stops a replay from paying twice, and only transfers to your account run paid actions. Rejected payments can be refunded automatically.
    link: /guide/production
    linkText: Production guide
  - title: Test everything offline
    details: hive-stream/testing runs the real streamer against simulated blocks and captures every broadcast. Time actions fire on demand.
    link: /guide/testing
    linkText: Testing guide
---
