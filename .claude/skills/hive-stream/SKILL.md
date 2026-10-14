---
name: hive-stream
description: Expert guidance for building Hive apps with the `hive-stream` Node.js package. Use when creating or debugging Hive Stream streamers, contracts, hooks, guards, provably fair games, bridges, transfer or custom_json workflows, built-in contract integrations, adapters, or Hive app backends that react to Hive and Hive Engine activity.
user-invocable: true
argument-hint: [topic]
---

# Hive Stream Builder

Use this skill when the code should be built around `hive-stream` (5.x) instead of dropping to raw Hive RPC handling.

## Workflow

1. Inspect local usage and examples before inventing patterns. `examples/recipes/` has type-checked apps for dice, tournaments, tipping, bridges, an escrow marketplace, a P2P swap desk, a DAO, a multi-account app and browser clients.
2. Use `HIVE_STREAM_METADATA` / `getHiveStreamMetadata()` for config keys, namespace methods, triggers and builder signatures. For built-in contracts, read `hive-stream/catalog` (options, actions, triggers, active-key flags, storage, example payloads) and the generated `docs/contracts/<name>.md` pages, not memory.
3. Choose the narrowest integration path:
   - subscriptions for passive read reactions
   - contracts for wrapped payload dispatch
   - a built-in contract factory when one fits (48 ship with the package)
   - hooks and guards for cross-cutting rules (metrics, allow-lists, bet limits, kill switches)
   - flows for inbound transfer automation
   - ops for fluent outbound write builders
   - native escrow (app as agent) for peer-to-peer trades the app should referee without custody
   - contract callers for browser, script, and test operation construction
4. Keep `new Streamer()` side-effect free. Register adapters, contracts, or time actions explicitly, and call `start()` only when streaming is required.
5. Match authority to the operation. Financial and Hive Engine writes, and value-moving custom JSON actions, need active authority. Posting-style operations can use posting authority.
6. Write tests with `createTestStreamer()` from `hive-stream/testing`.

## Quick Reference

| Topic | Reference |
| --- | --- |
| Package surface, lifecycle, multiple app accounts, defaults, testing kit, browser entry points | [references/package-surface.md](references/package-surface.md) |
| Stream modes, checkpoints, idempotency, refunds, error policy, hooks, guards | [references/reliability-and-hooks.md](references/reliability-and-hooks.md) |
| Contracts, payload wrappers, triggers, recipient rules, escrow, time actions | [references/contracts-and-triggers.md](references/contracts-and-triggers.md) |
| Provably fair randomness for games | [references/fairness.md](references/fairness.md) |
| Transfer flows, ops builders, money helpers | [references/flows-and-builders.md](references/flows-and-builders.md) |
| Built-in contract factories already shipped by the package | [references/built-in-contracts.md](references/built-in-contracts.md) |
| Shared contract specs and safe call builders (including escrow) | [references/contract-calls.md](references/contract-calls.md) |
| Upgrading 4.x apps | [references/migrating-to-5.md](references/migrating-to-5.md) |
| Upgrading 3.x apps | [references/migrating-to-4.md](references/migrating-to-4.md) |

## Package-Specific Rules

- Distinguish subscriptions from contract dispatch. Contract actions only run when a valid wrapper exists under `PAYLOAD_IDENTIFIER`.
- Transfer-triggered actions only run for transfers addressed to an app account (the streamer username or an `accounts` entry) or the action's `allowedRecipients` guard; anything else is rejected with `recipient_not_allowed`. Set `HIVE_ACCOUNT` (not `USERNAME`). Use `allowedRecipients: ['*']` only for non-custodial actions that verify `ctx.transfer.to` themselves.
- For anything that moves money: keep `streamMode: 'irreversible'`, use `errorPolicy: 'halt'`, set `refundRejectedTransfers: true`, keep fairness on for games, never compute amounts with floats, and give payouts pending/paid/failed states with a retry path.
- Guards never refund by themselves; `refundRejectedTransfers` does, once (rejections are recorded in the ledger). Don't also refund in `onActionRejected` when it is on.
- `beforeOperation` and `beforeContractAction` fail closed: a throwing hook skips the operation or vetoes the action.
- Handlers, hooks and subscription callbacks are awaited in order. Queue slow work instead of blocking the stream.
- Prefer camelCase config keys in code. Uppercase canonical keys and env var aliases remain supported. Config (including env values) is validated at construction.
- Prefer explicit adapters when storage choice matters. Most built-in contracts need SQL (SQLite or PostgreSQL); only the six games run on MongoDB. `mongodb` and `pg` are optional peer dependencies the app must install.
- Do not enable the built-in API unless the task needs it (`apiEnabled: true` or `startApiServer()`); it serves `/health`, has no authentication and binds to `127.0.0.1` unless `apiHost` says otherwise.
- `onHiveEngine` only delivers sidechain-confirmed transactions; never credit token payments from raw `custom_json`.
- For exact time values, use `TimeAction.getValidTimeValues()` or metadata instead of memory.
- Use `hive-stream/client` for outbound contract payloads (memos, custom JSON, escrow transfers) instead of assembling wrapper JSON or authority arrays by hand.
- Schemas are zod 4.
- Never hand-edit `docs/contracts/*.md` or `src/catalog/contracts.json`; they're generated (`npm run docs:gen`, `npm run catalog:gen`).
- When the task is codegen-heavy, inspect `README.md`, `docs/guide/`, `examples/`, `src/metadata.ts`, `src/catalog/contracts.json` and `docs/contracts/` before writing code. `docs/guide/security.md` is the checklist for apps that hold keys and money.
