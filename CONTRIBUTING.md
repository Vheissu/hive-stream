# Contributing

Thanks for helping. Hive Stream is a small project with a large surface (a streamer, three storage adapters, 45 contracts, a CLI and a docs site), so the rules below are about keeping it coherent.

## Setup

```shell
git clone git@github.com:Vheissu/hive-stream.git
cd hive-stream
npm install
npm test            # Jest; the live network suites are skipped unless RUN_LIVE_TESTS=1
npm run build       # CommonJS build, ESM wrappers, contract catalog
npm run docs:dev    # regenerates contract reference pages, then serves the docs
```

Node 22 or later. PostgreSQL and MongoDB integration suites run only when a server is reachable (see `tests/integration/`).

## Making a change

- **Tests first for behaviour.** Contract and streamer behaviour is tested offline with `createTestStreamer()` from `src/testing`; look at `tests/hardening.spec.ts` and `tests/contracts/` for the patterns. A fix for a bug comes with the test that would have caught it.
- **Money rules.** Amounts go through BigNumber helpers, never floats. Contracts use block time (`blockTimeOf(ctx)`), never `new Date()`, so replays are deterministic. Records are keyed with `operationRecordId(trxId, opIndex)`. Payouts are the last step of a handler, and a catch block never refunds after a payout was attempted.
- **Safe defaults.** A new option whose unsafe value could lose money defaults to the safe value, even if it is less convenient.
- **Style.** 4-space indent, single quotes, curly braces on every `if`. No linter is configured; match the file you are in.
- **Generated files.** `docs/contracts/*.md`, `src/catalog/contracts.json` and `src/scaffold/version.ts` are generated. A new contract factory needs one line in `scripts/lib/contract-metadata.ts`, an export in `src/index.ts`, and a spec.
- **Browser-safe entry points.** `src/client`, `src/scaffold` and `src/catalog` must not import Node built-ins or packages; `tests/browser-safe-entries.spec.ts` fails if they do.
- **Docs.** User-facing changes update the relevant guide in `docs/guide/` and the `CHANGELOG.md` entry under the unreleased version. Code samples in guides are not type-checked, so run them in your head against `src/index.ts`; samples under `examples/` are compiled by `tests/examples-typecheck.spec.ts`.

## Commits and pull requests

Conventional Commits with a scope, as in the history: `feat(contracts): ...`, `fix(core): ...`, `docs(guide): ...`. A pull request says what changed and why, how it was tested (`npm test`, `npm run build`), and links the issue if there is one. Keep refactors and behaviour changes in separate commits.

## Reporting bugs

Open an issue with the hive-stream version, the config with keys removed, the log around the operation (`debugMode: true`) and the transaction id. Security problems go through [SECURITY.md](SECURITY.md) instead.
