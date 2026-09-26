# Building UIs and tools

Two entry points exist for tools that run outside a Hive Stream app, such as visual builders, project generators, docs sites and editor plugins. Neither imports Node built-ins or the blockchain client, so both bundle cleanly for the browser with Vite, webpack or esbuild.

| Entry | What it gives you |
| --- | --- |
| `hive-stream/scaffold` | The project generator behind `npx hive-stream new` |
| `hive-stream/catalog` | Metadata for every built-in contract factory |

Pair them with [`hive-stream/client`](./contract-calls), which builds and validates contract calls without keys or network access.

## hive-stream/scaffold

```ts
import {
    ADAPTERS,
    TEMPLATES,
    generateProjectFiles,
    getCompatibleAdapters,
    getTemplate,
    validateProjectName
} from 'hive-stream/scaffold';

const template = getTemplate('game')!;
const adapters = getCompatibleAdapters(template); // SQLite and PostgreSQL

const { files, nextSteps } = generateProjectFiles({
    name: 'my-dice-app',       // validated with validateProjectName()
    template: 'game',
    adapter: 'sqlite',
    username: 'mydiceapp',     // optional; validated with validateHiveAccountName()
    api: false,                // optional
    hiveStreamVersion: '4.0.0' // optional; defaults to the installed hive-stream
});
```

`files` maps POSIX paths (`src/index.ts`, `tests/greeting.contract.spec.ts`, `.env.example`, ...) to file contents. The output is identical to the CLI's, so a zip built from it passes `npm run verify` just like a CLI project. `nextSteps` lists the shell commands to show the user afterwards.

`generateProjectFiles()` throws an `Error` with a readable message for an unknown template or adapter, an incompatible pair (SQL-backed templates with MongoDB), or an invalid project or account name. Use `validateProjectName()`, `validateHiveAccountName()` and `getAdapterCompatibilityError()` to show those messages inline before generating.

## hive-stream/catalog

```ts
import { contractCatalog, getCatalogContract, getCatalogContractsByCategory } from 'hive-stream/catalog';

const gambling = getCatalogContractsByCategory('gambling');
const dice = getCatalogContract('hivedice'); // or getCatalogContract('createDiceContract')
```

Each entry looks like this:

```json
{
  "name": "roulette",
  "factory": "createRouletteContract",
  "category": "gambling",
  "description": "Roulette with straight, color, parity, dozen, column, and low/high bets.",
  "options": [
    { "name": "minAmount", "type": "number", "required": false }
  ],
  "actions": [
    {
      "name": "spin",
      "triggers": ["transfer"],
      "requiresActiveKey": false,
      "payload": [
        {
          "name": "betType",
          "type": "\"straight\" | \"color\" | \"parity\" | \"dozen\" | \"column\" | \"range\"",
          "required": true,
          "values": ["straight", "color", "parity", "dozen", "column", "range"]
        }
      ],
      "example": { "betType": "straight", "value": 17 }
    }
  ]
}
```

- `name` is the contract name used in payloads when the factory's `name` option is left at its default.
- `options` come from the factory's TypeScript options interface. `type` is the type as written in the source.
- `payload` is `null` when an action has no schema and `[]` when it takes an empty object. `values` is present for enum and literal fields, `default` for fields with a zod default, and `description` for fields using `.describe()`.
- `example` is a payload that passes the action's schema, with required fields only and placeholder values (`alice`, `1.000`, `HIVE`, `example-1`). Use it to prefill forms or as a starting point for call builders. It's absent when the action has no schema.
- `triggers` defaults to `["custom_json"]` for actions that don't declare one, matching the streamer.
- Categories are `gambling`, `games`, `social`, `commerce`, `finance`, `fundraising`, `governance`, `assets`, `bridge` and `utility` (exported as `CONTRACT_CATEGORIES`).

The catalog is generated from the contract source at build time (`npm run catalog:gen`), the same step that produces the [contract reference pages](/contracts/), so the two always agree.

### Adding a built-in contract

Export the `create*Contract` factory from `src/index.ts` and add one line to `scripts/lib/contract-metadata.ts` with its category and description. Generation discovers the factory automatically, and `tests/contract-catalog.spec.ts` fails until the metadata line exists and `src/catalog/contracts.json` has been regenerated.
