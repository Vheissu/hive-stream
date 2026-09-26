/**
 * Generates the per-contract reference pages for the docs site and the
 * contract catalog (src/catalog/contracts.json) from one introspection pass
 * over every built-in contract factory. See scripts/lib/contract-introspection.ts.
 *
 * Run with: npx tsx scripts/generate-contract-docs.ts
 * (wired into `npm run docs:gen`)
 */
import * as fs from 'fs';
import * as path from 'path';

import type { ContractCatalogEntry, ContractCatalogField, ContractCatalogOption } from '../src/catalog/types';
import { writeCatalog } from './generate-contract-catalog';

const OUTPUT_DIR = path.resolve(__dirname, '..', 'docs', 'contracts');

/** Escapes characters that would break a markdown table cell. */
export function escapeTableCell(value: string): string {
    return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function renderPayloadTable(payload: ContractCatalogField[] | null): string {
    if (payload === null) {
        return '_No payload validation defined for this action._\n';
    }

    if (payload.length === 0) {
        return '_This action takes an empty payload._\n';
    }

    const rows = payload.map((field) => {
        return `| \`${field.name}\` | \`${escapeTableCell(field.type)}\` | ${field.required ? 'Yes' : 'No'} |`;
    });

    return ['| Field | Type | Required |', '| --- | --- | --- |', ...rows].join('\n') + '\n';
}

function renderOptionsTable(options: ContractCatalogOption[]): string {
    if (!options.some((option) => option.description)) {
        const rows = options.map((option) => `| \`${option.name}\` | \`${escapeTableCell(option.type)}\` | ${option.required ? 'Yes' : 'No'} |`);
        return ['| Option | Type | Required |', '| --- | --- | --- |', ...rows].join('\n') + '\n';
    }

    const rows = options.map((option) => {
        const description = option.description ? escapeTableCell(option.description) : '';
        return `| \`${option.name}\` | \`${escapeTableCell(option.type)}\` | ${option.required ? 'Yes' : 'No'} | ${description} |`;
    });

    return ['| Option | Type | Required | Description |', '| --- | --- | --- | --- |', ...rows].join('\n') + '\n';
}

/** A syntactically valid placeholder for a required factory option in examples. */
function placeholderFor(type: string): string {
    switch (type) {
        case 'string': return `'...'`;
        case 'string[]': return `['...']`;
        case 'number': return '0';
        case 'boolean': return 'false';
        default: return `{} as any /* ${type} */`;
    }
}

function renderContractPage(entry: ContractCatalogEntry): string {
    const lines: string[] = [];
    const requiredOptions = entry.options.filter((option) => option.required);
    const factoryArgs = requiredOptions.length > 0
        ? `{ ${requiredOptions.map((option) => `${option.name}: ${placeholderFor(option.type)}`).join(', ')} }`
        : '';

    lines.push(`# ${entry.name}`);
    lines.push('');

    if (entry.description) {
        lines.push(entry.description);
        lines.push('');
    }

    lines.push(`**Category:** ${entry.category}`);
    lines.push('');
    lines.push('```ts');
    lines.push(`import { ${entry.factory} } from 'hive-stream';`);
    lines.push('');
    lines.push(`await streamer.registerContract(${entry.factory}(${factoryArgs}));`);
    lines.push('```');
    lines.push('');
    lines.push('::: tip SQL adapter');
    lines.push('Most built-in contracts persist state in SQL tables and require a SQL-capable adapter (SQLite or PostgreSQL).');
    lines.push(':::');
    lines.push('');

    if (entry.options.length > 0) {
        lines.push('## Options');
        lines.push('');
        lines.push(renderOptionsTable(entry.options));
    }

    lines.push('## Actions');
    lines.push('');

    for (const action of entry.actions) {
        lines.push(`### ${action.name}`);
        lines.push('');

        if (action.description) {
            lines.push(action.description);
            lines.push('');
        }

        lines.push(`- **Trigger:** ${action.triggers.map((trigger) => `\`${trigger}\``).join(', ')}`);

        if (action.requiresActiveKey) {
            lines.push('- **Requires active key signature**');
        }

        lines.push('');
        lines.push('**Payload**');
        lines.push('');
        lines.push(renderPayloadTable(action.payload));

        const isTimeOnly = action.triggers.length === 1 && action.triggers[0] === 'time';

        if (!isTimeOnly) {
            const wrapper = JSON.stringify({ hive_stream: { contract: entry.name, action: action.name, payload: {} } });

            lines.push(action.triggers.includes('transfer')
                ? `Send as a transfer memo:`
                : `Send as custom JSON (id: your configured \`JSON_ID\`):`);
            lines.push('');
            lines.push('```json');
            lines.push(wrapper);
            lines.push('```');
            lines.push('');
        }
    }

    return lines.join('\n');
}

function run(): void {
    const { catalog, problems } = writeCatalog();

    fs.mkdirSync(OUTPUT_DIR, { recursive: true });

    for (const entry of catalog.contracts) {
        fs.writeFileSync(path.join(OUTPUT_DIR, `${entry.name}.md`), renderContractPage(entry));
    }

    const index: string[] = [];
    index.push('# Built-in Contracts');
    index.push('');
    index.push(`Hive Stream ships ${catalog.contracts.length} ready-to-register contracts. Every page here is generated from the contract source, so triggers, options and payload schemas are always current. The same data is available to tools as JSON through \`hive-stream/catalog\`.`);
    index.push('');
    index.push('| Contract | Category | Actions | Description |');
    index.push('| --- | --- | --- | --- |');

    for (const entry of catalog.contracts) {
        index.push(`| [${entry.name}](./${entry.name}) | ${entry.category} | ${entry.actions.length} | ${escapeTableCell(entry.description)} |`);
    }

    index.push('');
    fs.writeFileSync(path.join(OUTPUT_DIR, 'index.md'), index.join('\n'));

    // Sidebar items consumed by .vitepress/config.ts
    const sidebar = catalog.contracts.map((entry) => ({ text: entry.name, link: `/contracts/${entry.name}` }));
    fs.writeFileSync(path.join(OUTPUT_DIR, 'sidebar.json'), JSON.stringify(sidebar, null, 2));

    console.log(`Generated ${catalog.contracts.length} contract reference pages in docs/contracts/`);

    if (problems.length > 0) {
        process.exitCode = 1;
    }
}

if (require.main === module) {
    run();
}
