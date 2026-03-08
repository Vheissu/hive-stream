import { z } from 'zod';
import { action, defineContract } from './contract';
import {
    amountSchema,
    assetSchema,
    assertAssetMatches,
    createContractState,
    emitContractEvent,
    getIncomingPayment,
    identifierSchema,
    initializeTables,
    parseJson,
    requireSender,
    toBigNumber
} from './helpers';

const DEFAULT_NAME = 'referrals';

export interface ReferralContractOptions {
    name?: string;
}

export function createReferralContract(options: ReferralContractOptions = {}) {
    const name = options.name || DEFAULT_NAME;
    const state = createContractState();

    const createProgramSchema = z.object({
        programId: identifierSchema,
        title: z.string().min(3).max(140),
        payoutAsset: assetSchema,
        rewardBps: z.number().int().min(1).max(10000),
        maxPayoutPerConversion: amountSchema.optional(),
        metadata: z.record(z.any()).optional()
    });

    const fundProgramSchema = z.object({
        programId: identifierSchema
    });

    const registerCodeSchema = z.object({
        programId: identifierSchema,
        code: identifierSchema
    });

    const recordConversionSchema = z.object({
        programId: identifierSchema,
        code: identifierSchema,
        buyer: z.string().min(3).max(32),
        grossAmount: amountSchema,
        asset: assetSchema,
        externalRef: identifierSchema.optional()
    });

    const withdrawSchema = z.object({
        programId: identifierSchema.optional()
    }).optional();

    const initialize = async () => {
        await initializeTables(state.adapter, [
            `
                CREATE TABLE IF NOT EXISTS referral_programs (
                    program_id TEXT PRIMARY KEY,
                    owner TEXT NOT NULL,
                    title TEXT NOT NULL,
                    payout_asset TEXT NOT NULL,
                    reward_bps INTEGER NOT NULL,
                    max_payout_per_conversion TEXT,
                    budget_balance TEXT NOT NULL,
                    metadata TEXT,
                    created_at DATETIME NOT NULL
                )
            `,
            `
                CREATE TABLE IF NOT EXISTS referral_codes (
                    code TEXT PRIMARY KEY,
                    program_id TEXT NOT NULL,
                    account TEXT NOT NULL,
                    created_at DATETIME NOT NULL
                )
            `,
            `
                CREATE TABLE IF NOT EXISTS referral_balances (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    program_id TEXT NOT NULL,
                    account TEXT NOT NULL,
                    asset TEXT NOT NULL,
                    balance TEXT NOT NULL,
                    updated_at DATETIME NOT NULL,
                    UNIQUE(program_id, account, asset)
                )
            `,
            `
                CREATE TABLE IF NOT EXISTS referral_conversions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    program_id TEXT NOT NULL,
                    code TEXT NOT NULL,
                    account TEXT NOT NULL,
                    buyer TEXT NOT NULL,
                    gross_amount TEXT NOT NULL,
                    payout_amount TEXT NOT NULL,
                    asset TEXT NOT NULL,
                    external_ref TEXT,
                    created_at DATETIME NOT NULL
                )
            `
        ]);
    };

    const createProgram = async (payload: z.infer<typeof createProgramSchema>, ctx: any) => {
        const owner = requireSender(ctx);
        const existing = await state.adapter.query('SELECT program_id FROM referral_programs WHERE program_id = ?', [payload.programId]);
        if (existing.length > 0) {
            throw new Error(`Referral program ${payload.programId} already exists`);
        }

        await state.adapter.query(
            `INSERT INTO referral_programs (
                program_id, owner, title, payout_asset, reward_bps, max_payout_per_conversion, budget_balance, metadata, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                payload.programId,
                owner,
                payload.title,
                payload.payoutAsset,
                payload.rewardBps,
                payload.maxPayoutPerConversion || null,
                '0',
                JSON.stringify(payload.metadata || {}),
                new Date()
            ]
        );

        await emitContractEvent(state.adapter, name, 'createProgram', payload, {
            action: 'referral_program_created',
            data: {
                programId: payload.programId,
                owner
            }
        });
    };

    const fundProgram = async (payload: z.infer<typeof fundProgramSchema>, ctx: any) => {
        const owner = requireSender(ctx);
        const payment = getIncomingPayment(ctx);
        const rows = await state.adapter.query('SELECT * FROM referral_programs WHERE program_id = ?', [payload.programId]);
        if (rows.length === 0) {
            throw new Error(`Referral program ${payload.programId} does not exist`);
        }

        const program = rows[0];
        if (program.owner !== owner) {
            throw new Error('Only the program owner can fund this referral program');
        }

        assertAssetMatches(payment.asset, program.payout_asset);
        const nextBudget = toBigNumber(program.budget_balance).plus(payment.amount);
        await state.adapter.query(
            'UPDATE referral_programs SET budget_balance = ? WHERE program_id = ?',
            [nextBudget.toFixed(), payload.programId]
        );

        await emitContractEvent(state.adapter, name, 'fundProgram', payload, {
            action: 'referral_program_funded',
            data: {
                programId: payload.programId,
                owner,
                budgetBalance: nextBudget.toFixed()
            }
        });
    };

    const registerCode = async (payload: z.infer<typeof registerCodeSchema>, ctx: any) => {
        const account = requireSender(ctx);
        const programRows = await state.adapter.query('SELECT * FROM referral_programs WHERE program_id = ?', [payload.programId]);
        if (programRows.length === 0) {
            throw new Error(`Referral program ${payload.programId} does not exist`);
        }

        const existing = await state.adapter.query('SELECT code FROM referral_codes WHERE code = ?', [payload.code]);
        if (existing.length > 0) {
            throw new Error(`Referral code ${payload.code} already exists`);
        }

        await state.adapter.query(
            'INSERT INTO referral_codes (code, program_id, account, created_at) VALUES (?, ?, ?, ?)',
            [payload.code, payload.programId, account, new Date()]
        );

        await emitContractEvent(state.adapter, name, 'registerCode', payload, {
            action: 'referral_code_registered',
            data: {
                programId: payload.programId,
                code: payload.code,
                account
            }
        });
    };

    const recordConversion = async (payload: z.infer<typeof recordConversionSchema>, ctx: any) => {
        const owner = requireSender(ctx);
        const programRows = await state.adapter.query('SELECT * FROM referral_programs WHERE program_id = ?', [payload.programId]);
        const codeRows = await state.adapter.query('SELECT * FROM referral_codes WHERE code = ? AND program_id = ?', [payload.code, payload.programId]);
        if (programRows.length === 0 || codeRows.length === 0) {
            throw new Error('Referral program or code does not exist');
        }

        const program = programRows[0];
        if (program.owner !== owner) {
            throw new Error('Only the program owner can record conversions');
        }

        assertAssetMatches(payload.asset, program.payout_asset, 'Conversion asset');

        let payout = toBigNumber(payload.grossAmount).multipliedBy(Number(program.reward_bps)).dividedBy(10000).decimalPlaces(8, 1);
        if (program.max_payout_per_conversion && payout.gt(program.max_payout_per_conversion)) {
            payout = toBigNumber(program.max_payout_per_conversion);
        }

        if (payout.gt(program.budget_balance)) {
            throw new Error('Referral program does not have enough funded budget for this conversion');
        }

        const affiliate = codeRows[0].account;
        const balanceRows = await state.adapter.query(
            'SELECT * FROM referral_balances WHERE program_id = ? AND account = ? AND asset = ?',
            [payload.programId, affiliate, program.payout_asset]
        );
        const nextBalance = (balanceRows.length > 0 ? toBigNumber(balanceRows[0].balance) : toBigNumber(0)).plus(payout);

        await state.adapter.query(
            'UPDATE referral_programs SET budget_balance = ? WHERE program_id = ?',
            [toBigNumber(program.budget_balance).minus(payout).toFixed(), payload.programId]
        );
        await state.adapter.query(
            `INSERT INTO referral_balances (program_id, account, asset, balance, updated_at)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(program_id, account, asset)
             DO UPDATE SET balance = excluded.balance, updated_at = excluded.updated_at`,
            [payload.programId, affiliate, program.payout_asset, nextBalance.toFixed(), new Date()]
        );
        await state.adapter.query(
            'INSERT INTO referral_conversions (program_id, code, account, buyer, gross_amount, payout_amount, asset, external_ref, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [payload.programId, payload.code, affiliate, payload.buyer, payload.grossAmount, payout.toFixed(), payload.asset, payload.externalRef || null, new Date()]
        );

        await emitContractEvent(state.adapter, name, 'recordConversion', payload, {
            action: 'referral_conversion_recorded',
            data: {
                programId: payload.programId,
                code: payload.code,
                affiliate,
                buyer: payload.buyer,
                payout: payout.toFixed(),
                asset: payload.asset
            }
        });
    };

    const withdrawAffiliate = async (payload: { programId?: string } = {}, ctx: any) => {
        const account = requireSender(ctx);
        const balances = payload.programId
            ? await state.adapter.query('SELECT * FROM referral_balances WHERE program_id = ? AND account = ?', [payload.programId, account])
            : await state.adapter.query('SELECT * FROM referral_balances WHERE account = ?', [account]);
        if (balances.length === 0) {
            throw new Error('No referral balance available for withdrawal');
        }

        for (const balance of balances) {
            if (toBigNumber(balance.balance).lte(0)) {
                continue;
            }

            await state.adapter.query(
                'UPDATE referral_balances SET balance = ?, updated_at = ? WHERE program_id = ? AND account = ? AND asset = ?',
                ['0', new Date(), balance.program_id, account, balance.asset]
            );

            await emitContractEvent(state.adapter, name, 'withdrawAffiliate', payload, {
                action: 'referral_withdrawal_requested',
                data: {
                    programId: balance.program_id,
                    account,
                    amount: balance.balance,
                    asset: balance.asset
                }
            });
        }
    };

    return defineContract({
        name,
        hooks: {
            create: async ({ adapter }) => {
                state.adapter = adapter;
                await initialize();
            }
        },
        actions: {
            createProgram: action(createProgram, { schema: createProgramSchema, trigger: 'custom_json' }),
            fundProgram: action(fundProgram, { schema: fundProgramSchema, trigger: ['transfer', 'recurrent_transfer'] }),
            registerCode: action(registerCode, { schema: registerCodeSchema, trigger: 'custom_json' }),
            recordConversion: action(recordConversion, { schema: recordConversionSchema, trigger: 'custom_json' }),
            withdrawAffiliate: action(withdrawAffiliate, { schema: withdrawSchema, trigger: 'custom_json' })
        }
    });
}
