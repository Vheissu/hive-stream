import path from 'path';
import ts from 'typescript';

import * as hiveStream from '../src';
import { contractCatalog } from '../src/catalog';
import { generateProjectFiles, TEMPLATES } from '../src/scaffold';
import { TEMPLATE_CONTRACT_NAMES, TemplateDefinition } from '../src/scaffold/templates';
import { createTestStreamer, TestStreamer } from '../src/testing';

const root = path.resolve(__dirname, '..');
const APP = 'test-app';

// How each README example is sent. Every usage example must have an entry,
// so a new example cannot ship without being exercised here.
interface UsageScenario {
    trigger: 'transfer' | 'custom_json';
    from: string;
    /** Transfer recipient; defaults to the app account. */
    to?: string;
    amount?: string;
    activeKey?: boolean;
}

const SCENARIOS: Record<string, UsageScenario> = {
    'minimal:Call the greeting contract': { trigger: 'custom_json', from: 'alice' },

    'game:Roll the dice': { trigger: 'transfer', from: 'alice', amount: '1.000 HIVE' },
    'game:Flip a coin': { trigger: 'transfer', from: 'alice', amount: '1.000 HIVE' },
    'game:Spin the roulette wheel': { trigger: 'transfer', from: 'alice', amount: '1.000 HIVE' },
    'game:Play rock-paper-scissors': { trigger: 'transfer', from: 'alice', amount: '1.000 HIVE' },
    'game:Play limbo': { trigger: 'transfer', from: 'alice', amount: '1.000 HIVE' },
    'game:Reveal a server seed': { trigger: 'custom_json', from: APP, activeKey: true },

    'exchange:Create a trading pair': { trigger: 'custom_json', from: APP },
    'exchange:Deposit funds': { trigger: 'transfer', from: 'alice', amount: '10.000 HBD' },
    'exchange:Place an order': { trigger: 'custom_json', from: 'alice', activeKey: true },

    'social:Create a fan club': { trigger: 'custom_json', from: 'alice' },
    'social:Join a fan club': { trigger: 'transfer', from: 'bob', amount: '1.000 HIVE' },
    'social:Create a subscription plan': { trigger: 'custom_json', from: 'alice' },
    'social:Leave a tip': { trigger: 'transfer', from: 'bob', amount: '0.500 HIVE' },

    'blog:Create a paywalled resource': { trigger: 'custom_json', from: 'alice' },
    'blog:Buy access': { trigger: 'transfer', from: 'bob', amount: '1.000 HBD' },
    'blog:Leave a tip': { trigger: 'transfer', from: 'bob', amount: '0.500 HIVE' },

    'token:Create a token': { trigger: 'custom_json', from: 'alice' },
    'token:Issue tokens': { trigger: 'custom_json', from: 'alice', activeKey: true },
    'token:Create an NFT collection': { trigger: 'custom_json', from: 'alice' },

    'assets:Create an NFT collection': { trigger: 'custom_json', from: 'alice' },
    'assets:Batch mint numbered editions': { trigger: 'custom_json', from: 'alice' },
    'assets:List an NFT for sale': { trigger: 'custom_json', from: 'some-account', activeKey: true },
    'assets:Buy an NFT non-custodially': { trigger: 'transfer', from: 'bob', to: 'some-account', amount: '5.000 HIVE' },
    'assets:Create a ticketed event': { trigger: 'custom_json', from: 'alice' },
    'assets:Buy a ticket': { trigger: 'transfer', from: 'bob', amount: '2.000 HBD' },
    'assets:Transfer a ticket': { trigger: 'custom_json', from: 'bob' },
    'assets:List a ticket for resale': { trigger: 'custom_json', from: 'friend-account' },
    'assets:Buy a resale ticket non-custodially': { trigger: 'transfer', from: 'carol', to: 'friend-account', amount: '3.000 HBD' }
};

/**
 * Compiles the generated greeting contract and evaluates it against src/,
 * so the minimal template's example runs the exact code a new project gets.
 */
function loadGreetingContract(source: string): any {
    const { outputText } = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
    });
    const modules: Record<string, unknown> = {
        'hive-stream': hiveStream,
        'hive-stream/client': require('../src/client'),
        zod: require('zod')
    };
    const module = { exports: {} as Record<string, unknown> };
    const localRequire = (id: string) => {
        if (!(id in modules)) {
            throw new Error(`Generated greeting contract imports unexpected module '${id}'`);
        }
        return modules[id];
    };

    new Function('require', 'module', 'exports', outputText)(localRequire, module, module.exports);

    return module.exports.GreetingContract;
}

/**
 * Runs the template's generated registration and setup lines with the
 * template's imports in scope, exactly as they appear in src/index.ts.
 */
async function registerTemplate(testStreamer: TestStreamer, template: TemplateDefinition): Promise<void> {
    const names = template.imports;
    const values = names.map((name) => {
        const value = (hiveStream as Record<string, unknown>)[name];

        if (value === undefined) {
            throw new Error(`Template '${template.id}' imports '${name}', which hive-stream does not export`);
        }

        return value;
    });
    const AsyncFunction = Object.getPrototypeOf(async () => undefined).constructor;
    const body = [...template.registrations, ...template.setup].join('\n');
    const run = new AsyncFunction('streamer', 'HIVE_USERNAME', ...names, body);

    await run(testStreamer.streamer, testStreamer.username, ...values);
}

describe('scaffold README examples', () => {
    test('every usage example has a scenario', () => {
        const keys = TEMPLATES.flatMap((template) => template.usage.map((example) => `${template.id}:${example.title}`));

        expect(keys.filter((key) => !SCENARIOS[key])).toEqual([]);
        expect(Object.keys(SCENARIOS).filter((key) => !keys.includes(key))).toEqual([]);
    });

    test('examples that need active authority say so', () => {
        for (const template of TEMPLATES) {
            for (const example of template.usage) {
                const scenario = SCENARIOS[`${template.id}:${example.title}`];
                const mentionsActive = /active/i.test(example.description);

                expect({ example: example.title, mentionsActive }).toEqual({ example: example.title, mentionsActive: Boolean(scenario?.activeKey) });
            }
        }
    });

    test('template contract names match the names the factories register', () => {
        const catalogNames = new Set(contractCatalog.contracts.map((entry) => entry.name));

        for (const name of Object.values(TEMPLATE_CONTRACT_NAMES)) {
            expect({ name, inCatalog: catalogNames.has(name) }).toEqual({ name, inCatalog: true });
        }

        expect(hiveStream.createSubscriptionContract().name).toBe(TEMPLATE_CONTRACT_NAMES.subscriptions);
        expect(hiveStream.createTokenContract().name).toBe(TEMPLATE_CONTRACT_NAMES.token);
    });

    test.each(TEMPLATES.map((template) => [template.id, template] as const))(
        '%s template examples reach their contract and pass validation',
        async (_id, template) => {
            const testStreamer = await createTestStreamer({ username: APP, startTime: new Date('2026-01-01T00:00:00Z') });
            const problems: string[] = [];
            const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);

            try {
                // Games check the house can cover a payout.
                testStreamer.client.setAccount(APP, { balance: '100000.000 HIVE', hbd_balance: '100000.000 HBD' });

                testStreamer.streamer.use({
                    onActionRejected: ({ contract, action, reason, message }) => {
                        problems.push(`${contract}.${action} rejected (${reason}): ${message}`);
                    },
                    onInvalidPayload: ({ contract, action, issues }) => {
                        problems.push(`${contract}.${action} invalid payload: ${JSON.stringify(issues)}`);
                    },
                    onContractError: ({ contract, action, error }) => {
                        problems.push(`${contract}.${action} failed: ${error.message}`);
                    }
                });

                const files = generateProjectFiles({ name: 'usage-check', template: template.id, adapter: 'sqlite', username: APP }).files;
                await testStreamer.streamer.registerContract(loadGreetingContract(files['src/contracts/greeting.contract.ts']));
                await registerTemplate(testStreamer, template);

                for (const example of template.usage) {
                    const scenario = SCENARIOS[`${template.id}:${example.title}`];
                    const before = problems.length;

                    if (scenario.trigger === 'transfer') {
                        await testStreamer.transfer(scenario.from, scenario.to ?? APP, scenario.amount ?? '1.000 HIVE', example.payload);
                    } else {
                        await testStreamer.customJson(scenario.from, example.payload, { activeKey: scenario.activeKey });
                    }

                    for (let index = before; index < problems.length; index++) {
                        problems[index] = `[${example.title}] ${problems[index]}`;
                    }
                }

                expect(problems).toEqual([]);
            } finally {
                log.mockRestore();
                await testStreamer.stop();
            }
        },
        30000
    );
});

describe('generated projects type-check', () => {
    // Serves the generated files from a virtual directory inside the repo so
    // module resolution finds node_modules, with hive-stream mapped to src/.
    function typeCheck(files: Record<string, string>, label: string): string[] {
        const virtualRoot = path.join(root, '.scaffold-typecheck', label);
        const virtualFiles = new Map(
            Object.entries(files)
                .filter(([file]) => file.endsWith('.ts'))
                .map(([file, contents]) => [path.join(virtualRoot, file), contents])
        );
        const options: ts.CompilerOptions = {
            module: ts.ModuleKind.CommonJS,
            moduleResolution: ts.ModuleResolutionKind.Bundler,
            target: ts.ScriptTarget.ES2023,
            strict: true,
            isolatedModules: true,
            esModuleInterop: true,
            skipLibCheck: true,
            resolveJsonModule: true,
            noEmit: true,
            types: ['node', 'jest'],
            typeRoots: [path.join(root, 'node_modules', '@types')],
            baseUrl: root,
            paths: {
                'hive-stream': ['src/index.ts'],
                'hive-stream/testing': ['src/testing/index.ts'],
                'hive-stream/client': ['src/client/index.ts']
            }
        };
        const host = ts.createCompilerHost(options);
        const baseGetSourceFile = host.getSourceFile.bind(host);
        const baseFileExists = host.fileExists.bind(host);
        const baseReadFile = host.readFile.bind(host);

        host.fileExists = (fileName) => virtualFiles.has(fileName) || baseFileExists(fileName);
        host.directoryExists = (directory) => {
            const prefix = directory.endsWith(path.sep) ? directory : `${directory}${path.sep}`;

            return [...virtualFiles.keys()].some((file) => file.startsWith(prefix)) || ts.sys.directoryExists(directory);
        };
        host.realpath = (fileName) => (virtualFiles.has(fileName) ? fileName : (ts.sys.realpath ? ts.sys.realpath(fileName) : fileName));
        host.readFile = (fileName) => virtualFiles.get(fileName) ?? baseReadFile(fileName);
        host.getSourceFile = (fileName, languageVersion, onError, shouldCreate) => {
            const contents = virtualFiles.get(fileName);

            return contents !== undefined
                ? ts.createSourceFile(fileName, contents, languageVersion, true)
                : baseGetSourceFile(fileName, languageVersion, onError, shouldCreate);
        };

        const program = ts.createProgram([...virtualFiles.keys()], options, host);

        return ts.getPreEmitDiagnostics(program)
            .filter((diagnostic) => diagnostic.file && virtualFiles.has(diagnostic.file.fileName))
            .map((diagnostic) => {
                const { line } = diagnostic.file!.getLineAndCharacterOfPosition(diagnostic.start ?? 0);
                return `${path.relative(virtualRoot, diagnostic.file!.fileName)}:${line + 1} ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`;
            });
    }

    test('every template compiles with strict settings', () => {
        const messages = TEMPLATES.flatMap((template) => {
            const { files } = generateProjectFiles({ name: 'typecheck-app', template: template.id, adapter: 'sqlite', username: APP });

            return typeCheck(files, template.id).map((message) => `${template.id}: ${message}`);
        });

        expect(messages).toEqual([]);
    }, 120000);

    test('the game template refunds rejected bets and the others show the option', () => {
        for (const template of TEMPLATES) {
            const index = generateProjectFiles({ name: 'refund-app', template: template.id, adapter: 'sqlite' }).files['src/index.ts'];

            if (template.id === 'game') {
                expect(index).toContain('// A bad bet is sent back instead of kept.\n        refundRejectedTransfers: true');
            } else {
                expect(index).toContain('// refundRejectedTransfers: true');
                expect(index).not.toMatch(/^\s+refundRejectedTransfers: true/m);
            }
        }
    });
});
