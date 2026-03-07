import { z } from 'zod';
import { action, defineContract } from './contract';
import {
    amountSchema,
    createContractState,
    emitContractEvent,
    getIncomingPayment,
    identifierSchema,
    initializeTables,
    parseDateValue,
    requireSender,
    toBigNumber
} from './helpers';

const DEFAULT_NAME = 'giftcards';

export interface GiftCardContractOptions {
    name?: string;
}

export function createGiftCardContract(options: GiftCardContractOptions = {}) {
    const name = options.name || DEFAULT_NAME;
    const state = createContractState();

    const issueSchema = z.object({
        code: identifierSchema,
        recipient: z.string().min(3).max(32).optional(),
        message: z.string().max(280).optional(),
        expiresAt: z.string().optional()
    });

    const redeemSchema = z.object({
        code: identifierSchema,
        amount: amountSchema.optional()
    });

    const initialize = async () => {
        await initializeTables(state.adapter, [
            `
                CREATE TABLE IF NOT EXISTS gift_cards (
                    code TEXT PRIMARY KEY,
                    issuer TEXT NOT NULL,
                    purchaser TEXT NOT NULL,
                    recipient TEXT,
                    amount TEXT NOT NULL,
                    remaining_amount TEXT NOT NULL,
                    asset TEXT NOT NULL,
                    message TEXT,
                    expires_at DATETIME,
                    status TEXT NOT NULL,
                    created_at DATETIME NOT NULL
                )
            `,
            `
                CREATE TABLE IF NOT EXISTS gift_card_redemptions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    code TEXT NOT NULL,
                    redeemer TEXT NOT NULL,
                    amount TEXT NOT NULL,
                    created_at DATETIME NOT NULL
                )
            `
        ]);
    };

    const issueGiftCard = async (payload: z.infer<typeof issueSchema>, ctx: any) => {
        const issuer = requireSender(ctx);
        const payment = getIncomingPayment(ctx);
        const existing = await state.adapter.query('SELECT code FROM gift_cards WHERE code = ?', [payload.code]);
        if (existing.length > 0) {
            throw new Error(`Gift card ${payload.code} already exists`);
        }

        const expiresAt = parseDateValue(payload.expiresAt);
        await state.adapter.query(
            `INSERT INTO gift_cards (
                code, issuer, purchaser, recipient, amount, remaining_amount, asset, message, expires_at, status, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                payload.code,
                issuer,
                issuer,
                payload.recipient || null,
                payment.amount,
                payment.amount,
                payment.asset,
                payload.message || '',
                expiresAt,
                'active',
                new Date()
            ]
        );

        await emitContractEvent(state.adapter, name, 'issueGiftCard', payload, {
            action: 'gift_card_issued',
            data: {
                code: payload.code,
                issuer,
                amount: payment.amount,
                asset: payment.asset,
                recipient: payload.recipient || null
            }
        });
    };

    const redeemGiftCard = async (payload: z.infer<typeof redeemSchema>, ctx: any) => {
        const redeemer = requireSender(ctx);
        const rows = await state.adapter.query('SELECT * FROM gift_cards WHERE code = ?', [payload.code]);
        if (rows.length === 0) {
            throw new Error(`Gift card ${payload.code} does not exist`);
        }

        const card = rows[0];
        if (card.status !== 'active') {
            throw new Error('Gift card is not active');
        }

        const expiresAt = parseDateValue(card.expires_at);
        if (expiresAt && expiresAt < new Date()) {
            throw new Error('Gift card has expired');
        }

        if (card.recipient && card.recipient !== redeemer) {
            throw new Error('Gift card is restricted to a different recipient');
        }

        const amount = payload.amount || card.remaining_amount;
        if (toBigNumber(amount).gt(card.remaining_amount)) {
            throw new Error('Redemption amount exceeds card balance');
        }

        const remaining = toBigNumber(card.remaining_amount).minus(amount);
        const status = remaining.eq(0)
            ? 'redeemed'
            : 'active';

        await state.adapter.query(
            'INSERT INTO gift_card_redemptions (code, redeemer, amount, created_at) VALUES (?, ?, ?, ?)',
            [payload.code, redeemer, amount, new Date()]
        );
        await state.adapter.query(
            'UPDATE gift_cards SET remaining_amount = ?, status = ? WHERE code = ?',
            [remaining.toFixed(), status, payload.code]
        );

        await emitContractEvent(state.adapter, name, 'redeemGiftCard', payload, {
            action: 'gift_card_redeemed',
            data: {
                code: payload.code,
                redeemer,
                amount,
                asset: card.asset,
                remainingAmount: remaining.toFixed()
            }
        });
    };

    const cancelGiftCard = async (payload: z.infer<typeof redeemSchema>, ctx: any) => {
        const issuer = requireSender(ctx);
        const rows = await state.adapter.query('SELECT * FROM gift_cards WHERE code = ?', [payload.code]);
        if (rows.length === 0) {
            throw new Error(`Gift card ${payload.code} does not exist`);
        }

        const card = rows[0];
        if (card.issuer !== issuer) {
            throw new Error('Only the issuer can cancel this gift card');
        }

        if (toBigNumber(card.remaining_amount).lt(card.amount)) {
            throw new Error('Gift cards with redemptions cannot be cancelled');
        }

        await state.adapter.query(
            'UPDATE gift_cards SET status = ? WHERE code = ?',
            ['cancelled', payload.code]
        );

        await emitContractEvent(state.adapter, name, 'cancelGiftCard', payload, {
            action: 'gift_card_cancelled',
            data: {
                code: payload.code,
                issuer
            }
        });
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
            issueGiftCard: action(issueGiftCard, { schema: issueSchema, trigger: ['transfer', 'recurrent_transfer'] }),
            redeemGiftCard: action(redeemGiftCard, { schema: redeemSchema, trigger: 'custom_json' }),
            cancelGiftCard: action(cancelGiftCard, { schema: z.object({ code: identifierSchema }), trigger: 'custom_json' })
        }
    });
}
