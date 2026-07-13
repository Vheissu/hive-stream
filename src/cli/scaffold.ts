import fs from 'fs';
import path from 'path';

import { AdapterDefinition, TemplateDefinition, getAdapter, getTemplate } from './templates';

export interface ScaffoldOptions {
    name: string;
    template: string;
    adapter: string;
    username: string;
    api: boolean;
    hiveStreamVersion: string;
}

export interface ScaffoldResult {
    files: Record<string, string>;
    template: TemplateDefinition;
    adapter: AdapterDefinition;
}

const NAME_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

export function validateProjectName(name: string): string | null {
    if (!name) {
        return 'Project name is required.';
    }

    if (name.length > 214) {
        return 'Project name must be 214 characters or fewer.';
    }

    if (!NAME_PATTERN.test(name)) {
        return 'Project name must be lowercase and may only contain letters, numbers, dots, hyphens, and underscores.';
    }

    return null;
}

function indent(lines: string[], spaces: number): string {
    const pad = ' '.repeat(spaces);

    return lines
        .map((line) => (line.length > 0 ? `${pad}${line}` : line))
        .join('\n');
}

function generatePackageJson(options: ScaffoldOptions): string {
    const pkg = {
        name: options.name,
        version: '0.1.0',
        description: `A Hive blockchain app built with hive-stream.`,
        main: 'dist/index.js',
        scripts: {
            dev: 'ts-node src/index.ts',
            build: 'tsc',
            start: 'node dist/index.js'
        },
        dependencies: {
            'hive-stream': `^${options.hiveStreamVersion}`,
            zod: '^3.25.76'
        },
        devDependencies: {
            '@types/node': '^24.1.0',
            'ts-node': '^10.9.2',
            typescript: '^5.9.2'
        }
    };

    return `${JSON.stringify(pkg, null, 4)}\n`;
}

function generateTsconfig(): string {
    const tsconfig = {
        compilerOptions: {
            target: 'es2022',
            module: 'commonjs',
            moduleResolution: 'node',
            outDir: 'dist',
            rootDir: 'src',
            strict: true,
            esModuleInterop: true,
            skipLibCheck: true,
            forceConsistentCasingInFileNames: true,
            resolveJsonModule: true
        },
        include: ['src']
    };

    return `${JSON.stringify(tsconfig, null, 4)}\n`;
}

function generateGitignore(): string {
    return [
        'node_modules/',
        'dist/',
        '.env',
        '*.db',
        '*.log',
        ''
    ].join('\n');
}

function generateEnvExample(options: ScaffoldOptions, adapter: AdapterDefinition): string {
    const lines = [
        '# Your Hive account name (without the @)',
        `HIVE_USERNAME=${options.username}`,
        '',
        '# Private posting key: used for posts, comments, votes, and custom_json',
        'HIVE_POSTING_KEY=',
        '',
        '# Private active key: required for transfers and other financial operations',
        'HIVE_ACTIVE_KEY='
    ];

    if (adapter.envLines.length > 0) {
        lines.push('');
        lines.push(...adapter.envLines.map((line) => line.replace(/APP_NAME_PLACEHOLDER/g, envSafeName(options.name))));
    }

    lines.push('');

    if (options.api) {
        lines.push('# Built-in HTTP API server');
        lines.push('API_ENABLED=true');
        lines.push('API_PORT=5001');
    } else {
        lines.push('# Uncomment to enable the built-in HTTP API server');
        lines.push('# API_ENABLED=true');
        lines.push('# API_PORT=5001');
    }

    lines.push('');

    return lines.join('\n');
}

function envSafeName(name: string): string {
    return name.replace(/[^a-z0-9_-]/g, '-');
}

function generateIndex(options: ScaffoldOptions, template: TemplateDefinition, adapter: AdapterDefinition): string {
    const namedImports = ['Streamer', 'loadEnv', adapter.importName, ...template.imports]
        .sort((a, b) => a.localeCompare(b));

    const sections: string[] = [];

    sections.push(`import { ${namedImports.join(', ')} } from 'hive-stream';`);
    sections.push('');
    sections.push(`import { GreetingContract } from './contracts/greeting.contract';`);
    sections.push('');
    sections.push(`loadEnv();`);
    sections.push('');
    sections.push(`const HIVE_USERNAME = process.env.HIVE_USERNAME ?? '${options.username}';`);
    sections.push('');
    sections.push(`async function main() {`);
    sections.push(`    // env: true reads HIVE_USERNAME, HIVE_POSTING_KEY, HIVE_ACTIVE_KEY,`);
    sections.push(`    // API_ENABLED, and other settings from .env`);
    sections.push(`    const streamer = new Streamer({ env: true });`);
    sections.push('');
    sections.push(`    await streamer.registerAdapter(${adapter.construct.replace(/APP_NAME_PLACEHOLDER/g, envSafeName(options.name))});`);
    sections.push('');
    sections.push(`    await streamer.registerContract(GreetingContract);`);

    if (template.registrations.length > 0) {
        sections.push(indent(template.registrations, 4));
    }

    if (template.setup.length > 0) {
        sections.push('');
        sections.push(indent(template.setup, 4));
    }

    sections.push('');
    sections.push(`    await streamer.start();`);
    sections.push('');
    sections.push(`    console.log('${options.name} is streaming the Hive blockchain. Press Ctrl+C to stop.');`);
    sections.push('');
    sections.push(`    process.on('SIGINT', () => {`);
    sections.push(`        void streamer.stop().then(() => {`);
    sections.push(`            process.exit(0);`);
    sections.push(`        });`);
    sections.push(`    });`);
    sections.push(`}`);
    sections.push('');
    sections.push(`main().catch((error) => {`);
    sections.push(`    console.error(error);`);
    sections.push(`    process.exit(1);`);
    sections.push(`});`);
    sections.push('');

    return sections.join('\n');
}

function generateGreetingContract(): string {
    return `import { action, defineContract } from 'hive-stream';
import { z } from 'zod';

const greetSchema = z.object({
    name: z.string().min(1).max(80)
});

// A minimal custom contract. Users call it by broadcasting a custom_json
// operation with id 'hivestream' and this JSON:
// {"hive_stream":{"contract":"greeting","action":"greet","payload":{"name":"Hive"}}}
export const GreetingContract = defineContract({
    name: 'greeting',
    actions: {
        greet: action(async (payload, ctx) => {
            const data = greetSchema.parse(payload);

            console.log(\`Hello, \${data.name}! Greeted by @\${ctx.sender} in block \${ctx.block.number}.\`);
        }, {
            trigger: 'custom_json'
        })
    }
});
`;
}

function generateReadme(options: ScaffoldOptions, template: TemplateDefinition, adapter: AdapterDefinition): string {
    const lines: string[] = [];

    lines.push(`# ${options.name}`);
    lines.push('');
    lines.push(`A Hive blockchain app built with [hive-stream](https://github.com/Vheissu/hive-stream), using the **${template.label}** template and **${adapter.label}** for persistence.`);
    lines.push('');
    lines.push('## Getting started');
    lines.push('');
    lines.push('```bash');
    lines.push('npm install');
    lines.push('cp .env.example .env   # then fill in your Hive account and keys');
    lines.push('npm run dev');
    lines.push('```');
    lines.push('');
    lines.push('Your app streams blocks from the Hive blockchain and reacts to operations addressed to it. Contract actions are invoked by transfers (with a JSON memo) or custom_json operations using the `hivestream` id and the `hive_stream` payload wrapper.');
    lines.push('');

    if (template.usage.length > 0) {
        lines.push('## Try it');
        lines.push('');

        for (const example of template.usage) {
            lines.push(`### ${example.title}`);
            lines.push('');
            lines.push(example.description);
            lines.push('');
            lines.push('```json');
            lines.push(example.payload);
            lines.push('```');
            lines.push('');
        }
    }

    lines.push('## Custom contracts');
    lines.push('');
    lines.push('A starter contract lives in `src/contracts/greeting.contract.ts`. Define actions with `defineContract` and `action`, validate payloads with zod, and register the contract in `src/index.ts`. Actions can be triggered by `custom_json`, `transfer`, `time`, escrow, and recurrent transfer operations.');
    lines.push('');

    if (options.api) {
        lines.push('## HTTP API');
        lines.push('');
        lines.push('The built-in API server is enabled in `.env` and serves contract state and events at `http://localhost:5001`.');
        lines.push('');
    }

    lines.push('## Learn more');
    lines.push('');
    lines.push('- [hive-stream documentation](https://github.com/Vheissu/hive-stream/blob/master/DOCUMENTATION.md)');
    lines.push('- [Hive developer portal](https://developers.hive.io)');
    lines.push('');

    return lines.join('\n');
}

export function generateProjectFiles(options: ScaffoldOptions): ScaffoldResult {
    const template = getTemplate(options.template);

    if (!template) {
        throw new Error(`Unknown template '${options.template}'.`);
    }

    const adapter = getAdapter(options.adapter);

    if (!adapter) {
        throw new Error(`Unknown adapter '${options.adapter}'.`);
    }

    const nameError = validateProjectName(options.name);

    if (nameError) {
        throw new Error(nameError);
    }

    const files: Record<string, string> = {
        'package.json': generatePackageJson(options),
        'tsconfig.json': generateTsconfig(),
        '.gitignore': generateGitignore(),
        '.env.example': generateEnvExample(options, adapter),
        'README.md': generateReadme(options, template, adapter),
        'src/index.ts': generateIndex(options, template, adapter),
        'src/contracts/greeting.contract.ts': generateGreetingContract()
    };

    return { files, template, adapter };
}

export function writeProjectFiles(targetDir: string, files: Record<string, string>): string[] {
    const written: string[] = [];

    for (const [relativePath, contents] of Object.entries(files)) {
        const fullPath = path.join(targetDir, relativePath);

        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        fs.writeFileSync(fullPath, contents, 'utf8');
        written.push(relativePath);
    }

    return written;
}

export function isDirectoryUsable(targetDir: string): { usable: boolean; reason?: string } {
    if (!fs.existsSync(targetDir)) {
        return { usable: true };
    }

    const stats = fs.statSync(targetDir);

    if (!stats.isDirectory()) {
        return { usable: false, reason: 'A file with that name already exists.' };
    }

    const entries = fs.readdirSync(targetDir).filter((entry) => entry !== '.git');

    if (entries.length > 0) {
        return { usable: false, reason: 'Directory already exists and is not empty.' };
    }

    return { usable: true };
}
