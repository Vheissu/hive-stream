# Scaffolding with the CLI

The bundled CLI creates a ready-to-run Hive app with registered contracts, storage, environment config, an offline test, and payload examples.

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

Unknown flags, extra arguments, invalid Hive account names, and unsupported template/storage combinations fail before the target directory is changed. Long value flags accept either `--template game` or `--template=game`.

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

SQLite and PostgreSQL support every template. MongoDB is available for `minimal` and `game`; the other templates use contracts that call SQL queries. Interactive prompts only show compatible adapters, and explicit incompatible choices return an error.

Every project is private by default and includes these checks:

```shell
npm run check    # TypeScript, no output files
npm test         # simulated blocks and in-memory storage
npm run build    # production output
npm run verify   # all three commands
```

The generated entry point reads the username from the resolved Hive Stream config, refuses to start when it is missing, and installs clean SIGINT/SIGTERM shutdown handlers. Its README documents the selected contracts and their payloads.

## Generating projects from code

The CLI is a thin wrapper around a pure generator published as `hive-stream/scaffold`. It returns the same files the CLI writes, as a map of paths to contents, and touches no filesystem, so it runs in a browser as well as in Node:

```ts
import { generateProjectFiles, TEMPLATES } from 'hive-stream/scaffold';

const { files, nextSteps } = generateProjectFiles({
    name: 'my-dice-app',
    template: 'game',
    adapter: 'sqlite',
    username: 'mydiceapp'
});

// files['src/index.ts'], files['package.json'], ...
```

See [Building UIs and tools](./ui-integration) for the full API and the companion contract catalog.
