---
layout: home

hero:
  name: Hive Stream
  text: Build apps on the Hive blockchain
  tagline: Stream operations, run contracts, move money, and test it all offline — one library, batteries included.
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: Built-in Contracts
      link: /contracts/
    - theme: alt
      text: GitHub
      link: https://github.com/Vheissu/hive-stream

features:
  - title: Stream the chain
    details: React to transfers, custom JSON, posts, votes, escrow, and 20+ other operation types with typed subscriptions and automatic node failover.
  - title: 40 built-in contracts
    details: Games, exchanges, ticketing, subscriptions, crowdfunding, payroll, NFTs — register a contract and it runs against real chain activity.
  - title: Test everything offline
    details: The hive-stream/testing kit simulates blocks, captures broadcasts, and time-travels TimeActions. No network, no keys, no waiting.
  - title: Scaffold in seconds
    details: npx hive-stream new gives you contracts, compatible storage, environment config, and an offline starter test.
  - title: Calls checked before signing
    details: Shared contract specs validate action names, payloads, triggers, JSON, and authority before a wallet sees the operation.
  - title: Payments that add up
    details: Transfer flows split, forward, burn, and refund incoming payments with integer-safe math and a previewable plan.
  - title: Your storage, your call
    details: SQLite by default, PostgreSQL and MongoDB adapters included, or write your own adapter with two methods.
---
