# Upgrading Apps From 3.x To 4.0

When reviewing or upgrading an app written for 3.x, check these:

- Node 22+, `zod@^4` (schemas are typed against zod 4: `z.record(z.string(), v)`, `error.issues` not `.errors`), and `mongodb@^7` / `pg@^8` installed explicitly if those adapters or `HafProvider` are used.
- Blocks now wait for irreversibility. Apps needing head latency set `streamMode: 'head'` and should add an `onFork` hook.
- Subscription callbacks are awaited in order: long work inside `onTransfer` etc. now stalls the stream. Move it to a queue.
- `onBlock` receives the processed block's number (remove any `+ 1` workaround).
- Time actions run after each block's operations, against the block timestamp; persisted ones restore in `init()`.
- Config validation throws `ConfigValidationError` (e.g. `apiNodes` entries without `https://`, zero intervals).
- `broadcastOperations()` now signs `custom_json` with `required_auths` using the active key.
- `lotto` splits the pot across winners actually drawn, rounding down.
- `createTestStreamer()` supplies throwaway keys and serves `getBlock` from simulated blocks, so built-in games work offline.

Full guide: `docs/guide/migrating-to-4.md`. Then apply `migrating-to-5.md` for the 5.0 safety defaults.
