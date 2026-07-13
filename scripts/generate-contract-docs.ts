/**
 * Generates the per-contract reference pages for the docs site by
 * instantiating every built-in contract factory and introspecting its
 * actions, triggers, and Zod payload schemas.
 *
 * Run with: npx ts-node scripts/generate-contract-docs.ts
 * (wired into `npm run docs:gen`)
 */
import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';

import * as hiveStream from '../src';

const OUTPUT_DIR = path.resolve(__dirname, '..', 'docs', 'contracts');

const DESCRIPTIONS: Record<string, string> = {
    hivedice: 'A dice rolling game with configurable win chance and payout multipliers.',
    coinflip: 'A heads-or-tails coin flip game.',
    hivelotto: 'A lottery-style game with scheduled draws.',
    hivetoken: 'App-level token issuance, transfers, and balances.',
    hivenft: 'NFT minting, transfers, market listings, and direct peer-to-peer sales.',
    rps: 'Rock-paper-scissors with wagers.',
    roulette: 'Roulette with straight, color, parity, dozen, column, and low/high bets.',
    polls: 'Polls and voting.',
    tipjar: 'A tip jar with an optional message board.',
    exchange: 'An order-book exchange with deposits, withdrawals, balances, and matching.',
    auctionhouse: 'Auctions with reserve prices, buy-now support, and timed settlement.',
    subscriptions: 'Subscription plans renewed by transfers or recurrent transfers.',
    crowdfund: 'Crowdfunding campaigns with milestones, finalization, and refunds.',
    bountyboard: 'Funded bounties, submissions, and award selection.',
    invoices: 'Invoices with partial payments, recurring payments, and overdue sweeps.',
    savings: 'Savings goals with recurring contributions and withdrawal requests.',
    bookings: 'Reservable listings with paid booking windows and confirmations.',
    giftcards: 'Gift card issuance, redemption, and cancellation.',
    groupbuy: 'Threshold-based pooled purchases.',
    sweepstakes: 'Paid-entry sweepstakes with deterministic winner draws.',
    dcabots: 'Time-based DCA bot scheduling and execution request events.',
    multisigtreasury: 'Multisig vaults, proposal approvals, and execution readiness.',
    revenuesplit: 'Revenue share ledgers and withdrawal requests for collaborators.',
    paywall: 'Paid access control for gated resources and memberships.',
    domains: 'App-level namespaces with registrations, renewals, and transfers.',
    rentals: 'Escrow-backed rental agreements for items, passes, or assets.',
    launchpad: 'Launchpad sales with allocations, finalization, and claim flows.',
    predictionmarkets: 'Prediction markets with positions, resolution, and winner claims.',
    questpass: 'Seasonal passes with progress tracking and reward claims.',
    charitymatch: 'Donation campaigns with matched totals and closing summaries.',
    referrals: 'Affiliate programs with codes, funded budgets, and payout balances.',
    insurancepool: 'Insurance pools with premium-backed policies, claims, and reserves.',
    oraclebounty: 'Oracle bounty feeds with report rounds and median finalization.',
    grantrounds: 'Matching grant rounds with submissions, donations, and allocations.',
    payroll: 'Recurring team payrolls with funded budgets and scheduled runs.',
    proposaltimelock: 'Timelocked governance queues with approvals and delays.',
    bundlemarketplace: 'Fixed-price bundle storefronts with inventory tracking.',
    ticketing: 'Event ticketing with purchases, check-ins, refunds, transfers, and resale.',
    fanclub: 'Paid fan clubs with renewals, engagement points, and perk redemptions.',
    checkpoint: 'Deterministic state hashes published on-chain for operator verification.'
};

function zodTypeToString(schema: any): string {
    if (!schema || !schema._def) {
        return 'unknown';
    }

    const def = schema._def;
    const typeName = def.typeName;

    switch (typeName) {
        case 'ZodString': return 'string';
        case 'ZodNumber': return 'number';
        case 'ZodBoolean': return 'boolean';
        case 'ZodLiteral': return JSON.stringify(def.value);
        case 'ZodEnum': return def.values.map((v: any) => JSON.stringify(v)).join(' | ');
        case 'ZodOptional': return zodTypeToString(def.innerType);
        case 'ZodDefault': return zodTypeToString(def.innerType);
        case 'ZodNullable': return `${zodTypeToString(def.innerType)} | null`;
        case 'ZodArray': return `${zodTypeToString(def.type)}[]`;
        case 'ZodUnion': return def.options.map((o: any) => zodTypeToString(o)).join(' | ');
        case 'ZodRecord': return 'record';
        case 'ZodObject': return 'object';
        case 'ZodEffects': return zodTypeToString(def.schema);
        case 'ZodAny': return 'any';
        default: return typeName ? typeName.replace('Zod', '').toLowerCase() : 'unknown';
    }
}

function isOptional(schema: any): boolean {
    return schema?.isOptional?.() ?? false;
}

function renderSchemaTable(schema: any): string {
    if (!schema || !(schema instanceof z.ZodObject)) {
        return '_No payload validation defined for this action._\n';
    }

    const shape = schema.shape;
    const keys = Object.keys(shape);

    if (keys.length === 0) {
        return '_This action takes an empty payload._\n';
    }

    const rows = keys.map((key) => {
        const field = shape[key];
        return `| \`${key}\` | \`${zodTypeToString(field)}\` | ${isOptional(field) ? 'No' : 'Yes'} |`;
    });

    return ['| Field | Type | Required |', '| --- | --- | --- |', ...rows].join('\n') + '\n';
}

function triggerBadge(trigger: string | string[] | undefined): string {
    if (!trigger) {
        return '`custom_json`';
    }

    const triggers = Array.isArray(trigger) ? trigger : [trigger];
    return triggers.map((t) => `\`${t}\``).join(', ');
}

function factoryNameFor(exportName: string): string {
    return exportName;
}

function run(): void {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });

    const factories = Object.entries(hiveStream)
        .filter(([name, value]) => name.startsWith('create') && name.endsWith('Contract') && typeof value === 'function');

    const generated: Array<{ name: string; file: string; description: string; actionCount: number }> = [];

    // Factories whose options have no defaults get representative values here.
    const FACTORY_ARGS: Record<string, any[]> = {
        createCheckpointContract: [{ tables: ['nft_tokens'] }]
    };

    for (const [exportName, factory] of factories) {
        let definition: any;

        try {
            definition = (factory as (...args: any[]) => any)(...(FACTORY_ARGS[exportName] ?? []));
        } catch (error) {
            console.warn(`Skipping ${exportName}: factory threw (${(error as Error).message})`);
            continue;
        }

        if (!definition?.name || !definition?.actions) {
            console.warn(`Skipping ${exportName}: does not return a contract definition`);
            continue;
        }

        const name = definition.name;
        const description = DESCRIPTIONS[name] ?? '';
        const actions = Object.entries(definition.actions) as Array<[string, any]>;

        const lines: string[] = [];
        lines.push(`# ${name}`);
        lines.push('');

        if (description) {
            lines.push(description);
            lines.push('');
        }

        lines.push('```ts');
        lines.push(`import { ${factoryNameFor(exportName)} } from 'hive-stream';`);
        lines.push('');
        lines.push(`await streamer.registerContract(${factoryNameFor(exportName)}());`);
        lines.push('```');
        lines.push('');
        lines.push('::: tip SQL adapter');
        lines.push('Most built-in contracts persist state in SQL tables and require a SQL-capable adapter (SQLite or PostgreSQL).');
        lines.push(':::');
        lines.push('');
        lines.push('## Actions');
        lines.push('');

        for (const [actionName, actionDef] of actions) {
            lines.push(`### ${actionName}`);
            lines.push('');
            lines.push(`- **Trigger:** ${triggerBadge(actionDef.trigger)}`);

            if (actionDef.requiresActiveKey) {
                lines.push('- **Requires active key signature**');
            }

            lines.push('');
            lines.push('**Payload**');
            lines.push('');
            lines.push(renderSchemaTable(actionDef.schema));

            const isTransfer = (Array.isArray(actionDef.trigger) ? actionDef.trigger : [actionDef.trigger]).includes('transfer');
            const wrapper = JSON.stringify({ hive_stream: { contract: name, action: actionName, payload: {} } });

            if (actionDef.trigger !== 'time') {
                lines.push(isTransfer
                    ? `Send as a transfer memo:`
                    : `Send as custom JSON (id: your configured \`JSON_ID\`):`);
                lines.push('');
                lines.push('```json');
                lines.push(wrapper);
                lines.push('```');
                lines.push('');
            }
        }

        const file = `${name}.md`;
        fs.writeFileSync(path.join(OUTPUT_DIR, file), lines.join('\n'));
        generated.push({ name, file, description, actionCount: actions.length });
    }

    generated.sort((a, b) => a.name.localeCompare(b.name));

    const index: string[] = [];
    index.push('# Built-in Contracts');
    index.push('');
    index.push(`Hive Stream ships ${generated.length} ready-to-register contracts. Every page here is generated from the contract source, so triggers and payload schemas are always current.`);
    index.push('');
    index.push('| Contract | Actions | Description |');
    index.push('| --- | --- | --- |');

    for (const item of generated) {
        index.push(`| [${item.name}](./${item.file.replace('.md', '')}) | ${item.actionCount} | ${item.description} |`);
    }

    index.push('');
    fs.writeFileSync(path.join(OUTPUT_DIR, 'index.md'), index.join('\n'));

    // Sidebar items consumed by .vitepress/config.ts
    const sidebar = generated.map((item) => ({ text: item.name, link: `/contracts/${item.file.replace('.md', '')}` }));
    fs.writeFileSync(path.join(OUTPUT_DIR, 'sidebar.json'), JSON.stringify(sidebar, null, 2));

    console.log(`Generated ${generated.length} contract reference pages in docs/contracts/`);
}

run();
