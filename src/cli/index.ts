#!/usr/bin/env node

import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';

import { color, confirm, isInteractive, select, text } from './prompts';
import { generateProjectFiles, isDirectoryUsable, validateProjectName, writeProjectFiles } from './scaffold';
import { ADAPTERS, TEMPLATES, getAdapter, getTemplate } from './templates';

interface ParsedArgs {
    command: string | null;
    positional: string[];
    flags: Record<string, string | boolean>;
}

const FLAG_ALIASES: Record<string, string> = {
    t: 'template',
    a: 'adapter',
    u: 'username',
    y: 'yes',
    h: 'help',
    v: 'version'
};

const VALUE_FLAGS = new Set(['template', 'adapter', 'username']);

function getPackageVersion(): string {
    const packagePath = path.join(__dirname, '..', '..', 'package.json');
    const contents = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

    return contents.version;
}

function parseArgs(argv: string[]): ParsedArgs {
    const parsed: ParsedArgs = { command: null, positional: [], flags: {} };
    let index = 0;

    while (index < argv.length) {
        const arg = argv[index];

        if (arg.startsWith('--') || (arg.startsWith('-') && arg.length === 2)) {
            const raw = arg.replace(/^-+/, '');
            const name = FLAG_ALIASES[raw] ?? raw;

            if (VALUE_FLAGS.has(name)) {
                const value = argv[index + 1];

                if (value === undefined || value.startsWith('-')) {
                    fail(`Flag --${name} requires a value.`);
                }

                parsed.flags[name] = value;
                index += 2;
                continue;
            }

            parsed.flags[name] = true;
            index += 1;
            continue;
        }

        if (parsed.command === null) {
            parsed.command = arg;
        } else {
            parsed.positional.push(arg);
        }

        index += 1;
    }

    return parsed;
}

function fail(message: string): never {
    console.error(`${color.red('error')} ${message}`);
    process.exit(1);
}

function printHelp(): void {
    const lines = [
        '',
        `${color.bold('hive-stream')} — build apps on the Hive blockchain`,
        '',
        `${color.bold('Usage')}`,
        `  hive-stream new <name> [options]   Scaffold a new Hive app`,
        `  hive-stream list                   Show available templates and adapters`,
        `  hive-stream help                   Show this help`,
        '',
        `${color.bold('Options for new')}`,
        `  -t, --template <id>   App template (${TEMPLATES.map((template) => template.id).join(', ')})`,
        `  -a, --adapter <id>    Storage adapter (${ADAPTERS.map((adapter) => adapter.id).join(', ')})`,
        `  -u, --username <name> Hive account the app runs as`,
        `  --api                 Enable the built-in HTTP API server`,
        `  --install             Run npm install after scaffolding`,
        `  -y, --yes             Skip prompts and accept defaults`,
        '',
        `${color.bold('Examples')}`,
        `  npx hive-stream new my-game --template game --username my-account`,
        `  npx hive-stream new my-exchange -t exchange -a postgresql --api`,
        ''
    ];

    console.log(lines.join('\n'));
}

function printList(): void {
    console.log('');
    console.log(color.bold('Templates'));

    for (const template of TEMPLATES) {
        console.log(`  ${color.cyan(template.id.padEnd(12))} ${template.description}`);
    }

    console.log('');
    console.log(color.bold('Adapters'));

    for (const adapter of ADAPTERS) {
        console.log(`  ${color.cyan(adapter.id.padEnd(12))} ${adapter.description}`);
    }

    console.log('');
    console.log(color.dim('Scaffold an app with: npx hive-stream new <name> --template <id>'));
    console.log('');
}

async function runNew(parsed: ParsedArgs): Promise<void> {
    const skipPrompts = Boolean(parsed.flags.yes) || !isInteractive();

    let name = parsed.positional[0] ?? '';

    if (!name && !skipPrompts) {
        name = await text('Project name:', 'my-hive-app', validateProjectName);
    } else if (!name) {
        fail('Project name is required. Usage: hive-stream new <name>');
    }

    const nameError = validateProjectName(name);

    if (nameError) {
        fail(nameError);
    }

    const targetDir = path.resolve(process.cwd(), name);
    const usable = isDirectoryUsable(targetDir);

    if (!usable.usable) {
        fail(`Cannot create ${name}: ${usable.reason}`);
    }

    let template = typeof parsed.flags.template === 'string' ? parsed.flags.template : '';

    if (template && !getTemplate(template)) {
        fail(`Unknown template '${template}'. Available: ${TEMPLATES.map((entry) => entry.id).join(', ')}`);
    }

    if (!template) {
        template = skipPrompts ? 'minimal' : await select(
            'What are you building?',
            TEMPLATES.map((entry) => ({ value: entry.id, label: entry.label, hint: entry.description })),
            'minimal'
        );
    }

    let adapter = typeof parsed.flags.adapter === 'string' ? parsed.flags.adapter : '';

    if (adapter && !getAdapter(adapter)) {
        fail(`Unknown adapter '${adapter}'. Available: ${ADAPTERS.map((entry) => entry.id).join(', ')}`);
    }

    if (!adapter) {
        adapter = skipPrompts ? 'sqlite' : await select(
            'Where should app state be stored?',
            ADAPTERS.map((entry) => ({ value: entry.id, label: entry.label, hint: entry.description })),
            'sqlite'
        );
    }

    let username = typeof parsed.flags.username === 'string' ? parsed.flags.username : '';

    if (!username) {
        username = skipPrompts
            ? 'your-account'
            : await text('Hive account the app runs as:', 'your-account');
    }

    username = username.replace(/^@/, '');

    let api = Boolean(parsed.flags.api);

    if (!parsed.flags.api && !skipPrompts) {
        api = await confirm('Enable the built-in HTTP API server?', false);
    }

    const { files, template: templateDef, adapter: adapterDef } = generateProjectFiles({
        name,
        template,
        adapter,
        username,
        api,
        hiveStreamVersion: getPackageVersion()
    });

    const written = writeProjectFiles(targetDir, files);

    console.log('');
    console.log(`${color.green('✔')} Created ${color.bold(name)} (${templateDef.label} template, ${adapterDef.label} storage)`);
    console.log('');

    for (const file of written) {
        console.log(`  ${color.dim(name + '/')}${file}`);
    }

    if (parsed.flags.install) {
        console.log('');
        console.log(`${color.cyan('→')} Installing dependencies...`);

        const install = spawnSync('npm', ['install'], { cwd: targetDir, stdio: 'inherit', shell: process.platform === 'win32' });

        if (install.status !== 0) {
            console.log(`${color.yellow('!')} npm install failed. Run it manually inside ${name}.`);
        }
    }

    const steps = [`cd ${name}`];

    if (!parsed.flags.install) {
        steps.push('npm install');
    }

    steps.push('cp .env.example .env   # add your Hive account and keys');
    steps.push('npm run dev');

    console.log('');
    console.log(color.bold('Next steps'));

    for (const step of steps) {
        console.log(`  ${step}`);
    }

    console.log('');
    console.log(color.dim('Usage examples for your contracts are in the generated README.md.'));
    console.log('');
}

async function main(): Promise<void> {
    const parsed = parseArgs(process.argv.slice(2));

    if (parsed.flags.version) {
        console.log(getPackageVersion());
        return;
    }

    if (parsed.flags.help || parsed.command === 'help' || parsed.command === null) {
        printHelp();
        return;
    }

    switch (parsed.command) {
        case 'new':
        case 'create':
            await runNew(parsed);
            break;
        case 'list':
            printList();
            break;
        default:
            fail(`Unknown command '${parsed.command}'. Run hive-stream help for usage.`);
    }
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
