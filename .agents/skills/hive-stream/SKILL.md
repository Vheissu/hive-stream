---
name: hive-stream
description: Expert guidance for building Hive apps with the `hive-stream` Node.js package. Use when creating or debugging Hive Stream streamers, contracts, transfer or custom_json workflows, built-in contract integrations, adapters, or Hive app backends that react to Hive and Hive Engine activity.
user-invocable: true
argument-hint: [topic]
---

# Hive Stream Builder

Use this skill when the code should be built around `hive-stream` instead of dropping to raw Hive RPC handling.

## Workflow

1. Inspect local usage and examples before inventing patterns.
2. Use `HIVE_STREAM_METADATA` or `getHiveStreamMetadata()` for exact config keys, namespace methods, triggers, and builder signatures.
3. Choose the narrowest integration path:
   - subscriptions for passive read reactions
   - contracts for wrapped payload dispatch
   - flows for inbound transfer automation
   - ops for fluent outbound write builders
4. Keep `new Streamer()` side-effect free. Register adapters, contracts, or time actions explicitly, and call `start()` only when streaming is required.
5. Match authority to the operation. Financial and Hive Engine writes need active authority. Posting-style operations can use posting authority.

## Quick Reference

| Topic | Reference |
| --- | --- |
| Package surface, lifecycle, defaults | [references/package-surface.md](references/package-surface.md) |
| Contracts, payload wrappers, triggers, time actions | [references/contracts-and-triggers.md](references/contracts-and-triggers.md) |
| Transfer flows, ops builders, money helpers | [references/flows-and-builders.md](references/flows-and-builders.md) |
| Built-in contract factories already shipped by the package | [references/built-in-contracts.md](references/built-in-contracts.md) |

## Package-Specific Rules

- Distinguish subscriptions from contract dispatch. Contract actions only run when a valid wrapper exists under `PAYLOAD_IDENTIFIER`.
- Prefer camelCase config keys in code. Uppercase canonical keys and env var aliases remain supported for compatibility.
- Prefer explicit adapters when storage choice matters. The default SQLite adapter is lazy, but app code should not assume SQLite forever.
- Do not enable the built-in API unless the task needs it. Use `apiEnabled: true` on `start()` or call `startApiServer()` directly.
- For exact time values, use `TimeAction.getValidTimeValues()` or metadata instead of memory.
- When the task is codegen-heavy, inspect `README.md`, `DOCUMENTATION.md`, `examples/flows/`, `examples/contracts/`, and `src/metadata.ts` before writing code.
