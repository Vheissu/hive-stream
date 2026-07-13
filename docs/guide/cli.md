# Scaffolding with the CLI

The bundled CLI creates a ready-to-run Hive app: contracts registered, storage configured, `.env.example` written, and a README with copy-paste payload examples for every contract action.

```shell
npx hive-stream new my-app
```

Answer a few prompts, or skip them entirely with flags:

```shell
npx hive-stream new my-game --template game --username my-account
npx hive-stream new my-exchange --template exchange --adapter postgresql --api
npx hive-stream new my-app --template minimal --yes --install
```

## Commands

| Command | Description |
| --- | --- |
| `hive-stream new <name>` | Scaffold a new app |
| `hive-stream list` | Show all templates and adapters |
| `hive-stream help` | Usage information |

## Flags

| Flag | Description |
| --- | --- |
| `--template <name>` | Which template to scaffold |
| `--adapter <name>` | Storage adapter: `sqlite`, `mongodb`, `postgresql` |
| `--username <account>` | Your Hive account name |
| `--api` | Enable the built-in REST API |
| `--install` | Run `npm install` after scaffolding |
| `--yes` | Accept defaults, no prompts |

## Templates

| Template | What you get |
| --- | --- |
| `minimal` | A bare streamer with one example contract |
| `game` | Dice, coinflip, roulette, and rock-paper-scissors |
| `exchange` | Order book with deposits, withdrawals, and matching |
| `social` | Fan clubs, subscriptions, and tips |
| `blog` | Paywall, tips, and post streaming |
| `token` | Tokens and NFTs |
| `assets` | Non-custodial NFTs, event tickets, peer-to-peer sales, on-chain state checkpoints |

Every generated project includes a README documenting its contracts' payloads, so you can trigger actions from Hive Keychain or any wallet immediately.
