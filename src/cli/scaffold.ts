import fs from 'fs';
import path from 'path';

import {
    AdapterDefinition,
    TemplateDefinition,
    getAdapter,
    getAdapterCompatibilityError,
    getTemplate
} from './templates';
import { validateHiveAccountName } from '../validation/hive-account';

export { validateHiveAccountName } from '../validation/hive-account';

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

function generatePackageJson(options: ScaffoldOptions, adapter: AdapterDefinition): string {
    const pkg = {
        name: options.name,
        version: '0.1.0',
        description: `A Hive blockchain app built with hive-stream.`,
        private: true,
        main: 'dist/index.js',
        engines: {
            node: '>=22'
        },
        scripts: {
            dev: 'tsx src/index.ts',
            check: 'tsc --noEmit',
            build: 'tsc --project tsconfig.build.json',
            start: 'node dist/index.js',
            test: 'jest --runInBand',
            verify: 'npm run check && npm test && npm run build'
        },
        dependencies: {
            'hive-stream': `^${options.hiveStreamVersion}`,
            ...adapter.dependencies,
            zod: '^4.6.5'
        },
        devDependencies: {
            '@types/jest': '^30.0.0',
            '@types/node': '^22.20.4',
            jest: '^30.5.2',
            'ts-jest': '^29.4.14',
            tsx: '^4.23.15',
            typescript: '~6.0.3'
        }
    };

    return `${JSON.stringify(pkg, null, 4)}\n`;
}

function generateTsconfig(): string {
    const tsconfig = {
        compilerOptions: {
            target: 'es2023',
            module: 'Node16',
            moduleResolution: 'Node16',
            types: ['node', 'jest'],
            strict: true,
            isolatedModules: true,
            esModuleInterop: true,
            skipLibCheck: true,
            forceConsistentCasingInFileNames: true,
            resolveJsonModule: true
        },
        include: ['src', 'tests']
    };

    return `${JSON.stringify(tsconfig, null, 4)}\n`;
}

function generateBuildTsconfig(): string {
    const tsconfig = {
        extends: './tsconfig.json',
        compilerOptions: {
            outDir: 'dist',
            rootDir: 'src',
            declaration: true,
            sourceMap: true
        },
        include: ['src'],
        exclude: ['tests', 'node_modules', 'dist']
    };

    return `${JSON.stringify(tsconfig, null, 4)}\n`;
}

function generateJestConfig(): string {
    return `module.exports = {
    moduleFileExtensions: ['ts', 'js'],
    transform: {
        '^.+\\\\.ts$': 'ts-jest'
    },
    testMatch: ['**/tests/**/*.spec.ts'],
    testEnvironment: 'node'
};
`;
}

function generateGitignore(): string {
    return [
        'node_modules/',
        'dist/',
        '.env',
        '*.db',
        '*.log',
        'coverage/',
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
    const namedImports = ['Streamer', adapter.importName, ...template.imports]
        .sort((a, b) => a.localeCompare(b));

    const sections: string[] = [];

    sections.push(`import { ${namedImports.join(', ')} } from 'hive-stream';`);
    sections.push('');
    sections.push(`import { GreetingContract } from './contracts/greeting.contract';`);
    sections.push('');
    sections.push(`async function main() {`);
    sections.push(`    const streamer = new Streamer({ env: true });`);
    sections.push(`    const HIVE_USERNAME = streamer.getConfig().USERNAME;`);
    sections.push('');
    sections.push(`    if (!HIVE_USERNAME) {`);
    sections.push(`        throw new Error('Set HIVE_USERNAME in .env before starting the app.');`);
    sections.push(`    }`);
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
    sections.push(`    streamer.enableGracefulShutdown();`);
    sections.push(`    await streamer.start();`);
    sections.push('');
    sections.push(`    console.log('${options.name} is streaming the Hive blockchain. Press Ctrl+C to stop.');`);
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
import { defineContractSpec } from 'hive-stream/client';
import { z } from 'zod';

const greetSchema = z.object({
    name: z.string().min(1).max(80)
});

type GreetPayload = z.infer<typeof greetSchema>;

export const GreetingSpec = defineContractSpec({
    name: 'greeting',
    actions: {
        greet: {
            trigger: 'custom_json',
            schema: greetSchema
        }
    }
});

// A minimal custom contract. Users call it by broadcasting a custom_json
// operation with id 'hivestream' and this JSON:
// {"hive_stream":{"contract":"greeting","action":"greet","payload":{"name":"Hive"}}}
export const GreetingContract = defineContract({
    name: GreetingSpec.name,
    actions: {
        greet: action(async (payload: GreetPayload, ctx) => {
            console.log(\`Hello, \${payload.name}! Greeted by @\${ctx.sender} in block \${ctx.block.number}.\`);
        }, GreetingSpec.actions.greet)
    }
});
`;
}

function generateGreetingTest(): string {
    return `import { createContractCaller } from 'hive-stream/client';
import { createTestStreamer } from 'hive-stream/testing';

import { GreetingContract, GreetingSpec } from '../src/contracts/greeting.contract';

describe('GreetingContract', () => {
    test('accepts valid calls and rejects invalid payloads offline', async () => {
        const testStreamer = await createTestStreamer({ username: 'test-app' });
        const greeting = createContractCaller(GreetingSpec);
        const output = jest.spyOn(console, 'log').mockImplementation(() => undefined);

        try {
            await testStreamer.streamer.registerContract(GreetingContract);
            await testStreamer.sendOperations([
                greeting.customJson('alice', 'greet', { name: 'Hive' })
            ]);

            expect(output).toHaveBeenCalledWith(expect.stringContaining('Hello, Hive! Greeted by @alice'));
            expect(greeting.validate('greet', { name: '' }).success).toBe(false);
        } finally {
            output.mockRestore();
            await testStreamer.stop();
        }
    });
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
    lines.push('npm run verify');
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

    lines.push('Use `createContractCaller` from `hive-stream/client` when a frontend, script, or test needs to call a contract. It checks the action name, trigger, authority, and zod schema before it builds the Hive operation.');
    lines.push('');
    lines.push('## Tests');
    lines.push('');
    lines.push('`npm test` runs the starter contract against simulated blocks and in-memory storage. It does not connect to Hive or use private keys. Add contract tests under `tests/` as the app grows.');
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

    const compatibilityError = getAdapterCompatibilityError(template, adapter);

    if (compatibilityError) {
        throw new Error(compatibilityError);
    }

    const nameError = validateProjectName(options.name);

    if (nameError) {
        throw new Error(nameError);
    }

    if (options.username) {
        const usernameError = validateHiveAccountName(options.username);

        if (usernameError) {
            throw new Error(usernameError);
        }
    }

    const files: Record<string, string> = {
        'package.json': generatePackageJson(options, adapter),
        'tsconfig.json': generateTsconfig(),
        'tsconfig.build.json': generateBuildTsconfig(),
        'jest.config.js': generateJestConfig(),
        '.gitignore': generateGitignore(),
        '.env.example': generateEnvExample(options, adapter),
        'README.md': generateReadme(options, template, adapter),
        'src/index.ts': generateIndex(options, template, adapter),
        'src/contracts/greeting.contract.ts': generateGreetingContract(),
        'tests/greeting.contract.spec.ts': generateGreetingTest()
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
