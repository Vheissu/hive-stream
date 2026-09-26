#!/usr/bin/env node

import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';

import { color, confirm, isInteractive, select, text } from './prompts';
import {
    generateProjectFiles,
    getNextSteps,
    isDirectoryUsable,
    validateHiveAccountName,
    validateProjectName,
    writeProjectFiles
} from './scaffold';
import {
    ADAPTERS,
    TEMPLATES,
    getAdapter,
    getAdapterCompatibilityError,
    getCompatibleAdapters,
    getTemplate
} from './templates';

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
const BOOLEAN_FLAGS = new Set(['yes', 'api', 'install', 'help', 'version']);
const KNOWN_FLAGS = new Set([...VALUE_FLAGS, ...BOOLEAN_FLAGS]);
const NEW_FLAGS = new Set(['template', 'adapter', 'username', 'yes', 'api', 'install']);

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

        if (arg.startsWith('-')) {
            if (arg === '-' || (arg.startsWith('-') && !arg.startsWith('--') && arg.length !== 2)) {
                fail(`Unknown option '${arg}'. Run hive-stream help for usage.`);
            }

            const raw = arg.replace(/^-+/, '');
            const separator = raw.indexOf('=');
            const rawName = separator >= 0 ? raw.slice(0, separator) : raw;
            const inlineValue = separator >= 0 ? raw.slice(separator + 1) : undefined;
            const name = FLAG_ALIASES[rawName] ?? rawName;

            if (!KNOWN_FLAGS.has(name)) {
                fail(`Unknown option '${arg}'. Run hive-stream help for usage.`);
            }

            if (VALUE_FLAGS.has(name)) {
                const value = inlineValue ?? argv[index + 1];

                if (value === undefined || value === '' || (inlineValue === undefined && value.startsWith('-'))) {
                    fail(`Flag --${name} requires a value.`);
                }

                parsed.flags[name] = value;
                index += inlineValue === undefined ? 2 : 1;
                continue;
            }

            if (inlineValue !== undefined) {
                fail(`Flag --${name} does not take a value.`);
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

function validateCommandUsage(parsed: ParsedArgs): void {
    if (parsed.command === 'list') {
        if (parsed.positional.length > 0) {
            fail(`Unexpected argument '${parsed.positional[0]}'. Usage: hive-stream list`);
        }

        const flag = Object.keys(parsed.flags)[0];

        if (flag) {
            fail(`Option --${flag} is only valid with the new command.`);
        }

        return;
    }

    if (parsed.command === 'new' || parsed.command === 'create') {
        const invalidFlag = Object.keys(parsed.flags).find((flag) => !NEW_FLAGS.has(flag));

        if (invalidFlag) {
            fail(`Option --${invalidFlag} is not valid with the ${parsed.command} command.`);
        }
    }
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
        '',
        `  MongoDB is available for the minimal and game templates. Templates built`,
        `  from SQL-backed contracts use SQLite or PostgreSQL.`,
        ''
    ];

    console.log(lines.join('\n'));
}

function printList(): void {
    console.log('');
    console.log(color.bold('Templates'));

    for (const template of TEMPLATES) {
        const storage = getCompatibleAdapters(template).map((adapter) => adapter.id).join(', ');
        console.log(`  ${color.cyan(template.id.padEnd(12))} ${template.description}`);
        console.log(`  ${''.padEnd(12)} ${color.dim(`Storage: ${storage}`)}`);
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

    if (parsed.positional.length > 1) {
        fail(`Unexpected argument '${parsed.positional[1]}'. Usage: hive-stream new <name>`);
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

    const selectedTemplate = getTemplate(template)!;
    const compatibleAdapters = getCompatibleAdapters(selectedTemplate);

    let adapter = typeof parsed.flags.adapter === 'string' ? parsed.flags.adapter : '';

    if (adapter && !getAdapter(adapter)) {
        fail(`Unknown adapter '${adapter}'. Available: ${ADAPTERS.map((entry) => entry.id).join(', ')}`);
    }

    if (adapter) {
        const compatibilityError = getAdapterCompatibilityError(selectedTemplate, getAdapter(adapter)!);

        if (compatibilityError) {
            fail(compatibilityError);
        }
    }

    if (!adapter) {
        adapter = skipPrompts ? 'sqlite' : await select(
            'Where should app state be stored?',
            compatibleAdapters.map((entry) => ({ value: entry.id, label: entry.label, hint: entry.description })),
            'sqlite'
        );
    }

    let username = typeof parsed.flags.username === 'string' ? parsed.flags.username : '';

    if (!username) {
        username = skipPrompts
            ? ''
            : await text(
                'Hive account the app runs as:',
                '',
                (value) => validateHiveAccountName(value.replace(/^@/, ''))
            );
    }

    username = username.replace(/^@/, '');

    if (username) {
        const usernameError = validateHiveAccountName(username);

        if (usernameError) {
            fail(usernameError);
        }
    }

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

    const steps = getNextSteps(name, { installed: Boolean(parsed.flags.install) });

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

    if (parsed.flags.help || parsed.command === 'help') {
        printHelp();
        return;
    }

    if (parsed.command === null) {
        const flag = Object.keys(parsed.flags)[0];

        if (flag) {
            fail(`Option --${flag} requires a command.`);
        }

        printHelp();
        return;
    }

    validateCommandUsage(parsed);

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
