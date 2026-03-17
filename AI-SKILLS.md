# AI Skills

This repo ships companion skills for both Claude Code and Codex so builders can work with `hive-stream` at the package level instead of re-deriving the API from scratch.

## Included Skill Bundles

Claude Code bundle:

- Source: `.claude/skills/hive-stream`
- Entry file: `.claude/skills/hive-stream/SKILL.md`

Codex bundle:

- Source: `codex-skills/hive-stream`
- Entry file: `codex-skills/hive-stream/SKILL.md`

Both bundles include focused references for:

- package surface and lifecycle
- contracts, triggers, and payload wrappers
- `flows.*`, `ops.*`, and `money.*`
- built-in contract factories already exported by `hive-stream`

## What The Skill Covers

Use the skill when building or debugging:

- `Streamer` setup and config
- event subscriptions like `onTransfer`, `onCustomJson`, and `onHiveEngine`
- contracts built with `defineContract(...)` and `action(...)`
- scheduled actions with `TimeAction`
- inbound transfer automation with `flows.*`
- fluent outbound writes with `ops.*`
- adapter or provider selection
- apps that should use `HIVE_STREAM_METADATA` as the package source of truth

## Install For Claude Code

### Option 1: Use It In This Repo

If you are working inside this repository, the skill already lives at:

```bash
.claude/skills/hive-stream
```

Claude Code can use repo-local skills directly.

Manual invocation:

```text
/hive-stream
/hive-stream contracts
/hive-stream flows
```

### Option 2: Install As A Personal Claude Skill

Symlink this repo's skill into your Claude skills directory:

```bash
mkdir -p ~/.claude/skills
ln -s "$(pwd)/.claude/skills/hive-stream" ~/.claude/skills/hive-stream
```

If you prefer a physical copy instead of a symlink:

```bash
mkdir -p ~/.claude/skills
cp -R ./.claude/skills/hive-stream ~/.claude/skills/hive-stream
```

## Install For Codex

Codex skills are user-scoped. Install the repo bundle into `$CODEX_HOME/skills` or `~/.codex/skills`.

### Option 1: Symlink

```bash
export CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
mkdir -p "$CODEX_HOME/skills"
ln -s "$(pwd)/codex-skills/hive-stream" "$CODEX_HOME/skills/hive-stream"
```

### Option 2: Copy

```bash
export CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
mkdir -p "$CODEX_HOME/skills"
cp -R ./codex-skills/hive-stream "$CODEX_HOME/skills/hive-stream"
```

Manual invocation:

```text
$hive-stream
```

The Codex skill also includes `agents/openai.yaml` metadata for the skill picker UI.

## Updating

If you installed with symlinks, updating this repo updates the installed skill automatically.

If you copied the files instead, re-copy after pulling changes:

```bash
cp -R ./.claude/skills/hive-stream ~/.claude/skills/hive-stream
cp -R ./codex-skills/hive-stream "${CODEX_HOME:-$HOME/.codex}/skills/hive-stream"
```

## Recommended Usage

Prompt with package-level intent rather than raw blockchain primitives. Good examples:

- "Use hive-stream to build a transfer-driven contract for subscriptions."
- "Add a `flows.incomingTransfers()` pipeline that burns 5% and forwards the rest."
- "Register a `TimeAction` that runs a settlement contract every 30 seconds."
- "Generate a starter app that uses `HIVE_STREAM_METADATA` to scaffold config and routes."

## Repo Notes

- The Claude bundle is stored in-repo because Claude supports repo-local skills.
- The Codex bundle is stored under `codex-skills/` so users can install it into their user skill directory without mixing Codex-specific metadata into the Claude bundle.
- The skills are documentation assets for AI tooling, not part of the published runtime library.
