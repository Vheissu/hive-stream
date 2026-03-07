import { z } from 'zod';
import { action, defineContract } from './contract';
import {
    amountSchema,
    assetSchema,
    createContractState,
    emitContractEvent,
    identifierSchema,
    initializeTables,
    parseJson,
    requireSender,
    uniqueItems
} from './helpers';

const DEFAULT_NAME = 'multisigtreasury';

export interface MultisigTreasuryContractOptions {
    name?: string;
}

export function createMultisigTreasuryContract(options: MultisigTreasuryContractOptions = {}) {
    const name = options.name || DEFAULT_NAME;
    const state = createContractState();

    const createVaultSchema = z.object({
        vaultId: identifierSchema,
        title: z.string().min(3).max(140),
        signers: z.array(z.string().min(3).max(32)).min(1).max(25),
        threshold: z.number().int().min(1).max(25),
        metadata: z.record(z.any()).optional()
    });

    const proposeTransferSchema = z.object({
        vaultId: identifierSchema,
        proposalId: identifierSchema,
        title: z.string().min(3).max(140),
        to: z.string().min(3).max(32),
        amount: amountSchema,
        asset: assetSchema,
        memo: z.string().max(280).optional()
    });

    const proposalSchema = z.object({
        proposalId: identifierSchema
    });

    const markExecutedSchema = z.object({
        proposalId: identifierSchema,
        txId: z.string().max(120).optional()
    });

    const initialize = async () => {
        await initializeTables(state.adapter, [
            `
                CREATE TABLE IF NOT EXISTS treasury_vaults (
                    vault_id TEXT PRIMARY KEY,
                    owner TEXT NOT NULL,
                    title TEXT NOT NULL,
                    threshold INTEGER NOT NULL,
                    signers TEXT NOT NULL,
                    status TEXT NOT NULL,
                    metadata TEXT,
                    created_at DATETIME NOT NULL
                )
            `,
            `
                CREATE TABLE IF NOT EXISTS treasury_proposals (
                    proposal_id TEXT PRIMARY KEY,
                    vault_id TEXT NOT NULL,
                    proposer TEXT NOT NULL,
                    title TEXT NOT NULL,
                    operation_type TEXT NOT NULL,
                    operation_json TEXT NOT NULL,
                    approvals_count INTEGER NOT NULL,
                    status TEXT NOT NULL,
                    created_at DATETIME NOT NULL,
                    executed_at DATETIME
                )
            `,
            `
                CREATE TABLE IF NOT EXISTS treasury_approvals (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    proposal_id TEXT NOT NULL,
                    signer TEXT NOT NULL,
                    approved_at DATETIME NOT NULL,
                    UNIQUE(proposal_id, signer)
                )
            `
        ]);
    };

    const createVault = async (payload: z.infer<typeof createVaultSchema>, ctx: any) => {
        const owner = requireSender(ctx);
        const signers = uniqueItems([owner, ...payload.signers]);
        if (payload.threshold > signers.length) {
            throw new Error('Threshold cannot exceed the number of unique signers');
        }

        const existing = await state.adapter.query('SELECT vault_id FROM treasury_vaults WHERE vault_id = ?', [payload.vaultId]);
        if (existing.length > 0) {
            throw new Error(`Vault ${payload.vaultId} already exists`);
        }

        await state.adapter.query(
            `INSERT INTO treasury_vaults (
                vault_id, owner, title, threshold, signers, status, metadata, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                payload.vaultId,
                owner,
                payload.title,
                payload.threshold,
                JSON.stringify(signers),
                'active',
                JSON.stringify(payload.metadata || {}),
                new Date()
            ]
        );

        await emitContractEvent(state.adapter, name, 'createVault', payload, {
            action: 'treasury_vault_created',
            data: {
                vaultId: payload.vaultId,
                owner,
                threshold: payload.threshold,
                signers
            }
        });
    };

    const proposeTransfer = async (payload: z.infer<typeof proposeTransferSchema>, ctx: any) => {
        const proposer = requireSender(ctx);
        const vaults = await state.adapter.query('SELECT * FROM treasury_vaults WHERE vault_id = ?', [payload.vaultId]);
        if (vaults.length === 0) {
            throw new Error(`Vault ${payload.vaultId} does not exist`);
        }

        const vault = vaults[0];
        const signers = parseJson<string[]>(vault.signers, []);
        if (!signers.includes(proposer)) {
            throw new Error('Only a vault signer can create proposals');
        }

        const existing = await state.adapter.query('SELECT proposal_id FROM treasury_proposals WHERE proposal_id = ?', [payload.proposalId]);
        if (existing.length > 0) {
            throw new Error(`Proposal ${payload.proposalId} already exists`);
        }

        await state.adapter.query(
            `INSERT INTO treasury_proposals (
                proposal_id, vault_id, proposer, title, operation_type, operation_json, approvals_count, status, created_at, executed_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                payload.proposalId,
                payload.vaultId,
                proposer,
                payload.title,
                'transfer',
                JSON.stringify({
                    to: payload.to,
                    amount: payload.amount,
                    asset: payload.asset,
                    memo: payload.memo || ''
                }),
                0,
                'pending',
                new Date(),
                null
            ]
        );

        await emitContractEvent(state.adapter, name, 'proposeTransfer', payload, {
            action: 'treasury_proposal_created',
            data: {
                proposalId: payload.proposalId,
                vaultId: payload.vaultId,
                proposer
            }
        });
    };

    const approveProposal = async (payload: z.infer<typeof proposalSchema>, ctx: any) => {
        const signer = requireSender(ctx);
        const proposalRows = await state.adapter.query('SELECT * FROM treasury_proposals WHERE proposal_id = ?', [payload.proposalId]);
        if (proposalRows.length === 0) {
            throw new Error(`Proposal ${payload.proposalId} does not exist`);
        }

        const proposal = proposalRows[0];
        if (proposal.status === 'cancelled' || proposal.status === 'executed') {
            throw new Error('Proposal is no longer active');
        }

        const vaultRows = await state.adapter.query('SELECT * FROM treasury_vaults WHERE vault_id = ?', [proposal.vault_id]);
        const vault = vaultRows[0];
        const signers = parseJson<string[]>(vault.signers, []);
        if (!signers.includes(signer)) {
            throw new Error('Only a vault signer can approve this proposal');
        }

        await state.adapter.query(
            'INSERT INTO treasury_approvals (proposal_id, signer, approved_at) VALUES (?, ?, ?)',
            [payload.proposalId, signer, new Date()]
        );

        const approvalCountRows = await state.adapter.query('SELECT COUNT(*) AS count FROM treasury_approvals WHERE proposal_id = ?', [payload.proposalId]);
        const approvalsCount = Number(approvalCountRows[0]?.count || 0);
        const status = approvalsCount >= Number(vault.threshold)
            ? 'ready'
            : 'pending';

        await state.adapter.query(
            'UPDATE treasury_proposals SET approvals_count = ?, status = ? WHERE proposal_id = ?',
            [approvalsCount, status, payload.proposalId]
        );

        await emitContractEvent(state.adapter, name, 'approveProposal', payload, {
            action: status === 'ready' ? 'treasury_proposal_ready' : 'treasury_proposal_approved',
            data: {
                proposalId: payload.proposalId,
                signer,
                approvalsCount,
                threshold: vault.threshold
            }
        });
    };

    const cancelProposal = async (payload: z.infer<typeof proposalSchema>, ctx: any) => {
        const sender = requireSender(ctx);
        const proposals = await state.adapter.query('SELECT * FROM treasury_proposals WHERE proposal_id = ?', [payload.proposalId]);
        if (proposals.length === 0) {
            throw new Error(`Proposal ${payload.proposalId} does not exist`);
        }

        const proposal = proposals[0];
        const vaultRows = await state.adapter.query('SELECT * FROM treasury_vaults WHERE vault_id = ?', [proposal.vault_id]);
        const vault = vaultRows[0];
        if (proposal.proposer !== sender && vault.owner !== sender) {
            throw new Error('Only the proposer or vault owner can cancel this proposal');
        }

        await state.adapter.query(
            'UPDATE treasury_proposals SET status = ? WHERE proposal_id = ?',
            ['cancelled', payload.proposalId]
        );

        await emitContractEvent(state.adapter, name, 'cancelProposal', payload, {
            action: 'treasury_proposal_cancelled',
            data: {
                proposalId: payload.proposalId,
                cancelledBy: sender
            }
        });
    };

    const markExecuted = async (payload: z.infer<typeof markExecutedSchema>, ctx: any) => {
        const sender = requireSender(ctx);
        const proposals = await state.adapter.query('SELECT * FROM treasury_proposals WHERE proposal_id = ?', [payload.proposalId]);
        if (proposals.length === 0) {
            throw new Error(`Proposal ${payload.proposalId} does not exist`);
        }

        const proposal = proposals[0];
        const vaultRows = await state.adapter.query('SELECT * FROM treasury_vaults WHERE vault_id = ?', [proposal.vault_id]);
        const vault = vaultRows[0];
        const signers = parseJson<string[]>(vault.signers, []);
        if (!signers.includes(sender)) {
            throw new Error('Only a vault signer can mark this proposal executed');
        }

        if (proposal.status !== 'ready') {
            throw new Error('Proposal is not ready for execution');
        }

        await state.adapter.query(
            'UPDATE treasury_proposals SET status = ?, executed_at = ? WHERE proposal_id = ?',
            ['executed', new Date(), payload.proposalId]
        );

        await emitContractEvent(state.adapter, name, 'markExecuted', payload, {
            action: 'treasury_proposal_executed',
            data: {
                proposalId: payload.proposalId,
                executedBy: sender,
                txId: payload.txId || null
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
            createVault: action(createVault, { schema: createVaultSchema, trigger: 'custom_json' }),
            proposeTransfer: action(proposeTransfer, { schema: proposeTransferSchema, trigger: 'custom_json' }),
            approveProposal: action(approveProposal, { schema: proposalSchema, trigger: 'custom_json' }),
            cancelProposal: action(cancelProposal, { schema: proposalSchema, trigger: 'custom_json' }),
            markExecuted: action(markExecuted, { schema: markExecutedSchema, trigger: 'custom_json' })
        }
    });
}
