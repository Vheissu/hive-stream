import {
    DEFAULT_CONTRACT_JSON_ID,
    DEFAULT_CONTRACT_PAYLOAD_IDENTIFIER
} from '../defaults';
import type {
    ContractPayload,
    ContractTrigger
} from '../types/hive-stream';
import { normalizeHiveAccountName } from '../validation/hive-account';
import type { ZodSchema } from 'zod';

export type ContractAuthority = 'posting' | 'active';

export interface ContractCallInput<Payload = Record<string, unknown>, Meta = Record<string, unknown>> {
    contract: string;
    action: string;
    payload?: Payload;
    meta?: Meta;
}

export interface ContractPayloadOptions {
    payloadIdentifier?: string;
}

export interface ContractCustomJsonOptions extends ContractPayloadOptions {
    sender: string;
    id?: string;
    authority?: ContractAuthority;
}

export interface ContractTransferOptions extends ContractPayloadOptions {
    from: string;
    to: string;
    amount: string;
}

export type ContractCustomJsonOperation = [
    'custom_json',
    {
        required_auths: string[];
        required_posting_auths: string[];
        id: string;
        json: string;
    }
];

export interface ContractEscrowTransferOptions extends ContractPayloadOptions {
    from: string;
    to: string;
    agent: string;
    /** Chosen by the buyer; unique among their open escrows. */
    escrowId: number;
    hiveAmount?: string;
    hbdAmount?: string;
    /** The agent's fee, in HIVE or HBD. */
    fee: string;
    ratificationDeadline: string | Date;
    expiration: string | Date;
}

export type ContractEscrowTransferOperation = [
    'escrow_transfer',
    {
        from: string;
        to: string;
        agent: string;
        escrow_id: number;
        hive_amount: string;
        hbd_amount: string;
        fee: string;
        ratification_deadline: string;
        escrow_expiration: string;
        json_meta: string;
    }
];

export type ContractTransferOperation = [
    'transfer',
    {
        from: string;
        to: string;
        amount: string;
        memo: string;
    }
];

export type ContractCallIssueCode =
    | 'contract_mismatch'
    | 'unknown_action'
    | 'trigger_not_allowed'
    | 'active_key_required'
    | 'invalid_payload'
    | 'invalid_json';

export interface ContractCallIssue {
    code: ContractCallIssueCode;
    message: string;
    path?: Array<string | number>;
}

export type ContractCallValidationResult<Payload = unknown> =
    | { success: true; payload: Payload; issues: [] }
    | { success: false; issues: ContractCallIssue[] };

export interface ValidateContractCallOptions {
    trigger?: ContractTrigger;
    signedWithActiveKey?: boolean;
}

export interface ContractCallerOptions extends ContractPayloadOptions {
    jsonId?: string;
}

export interface ContractCallerPayloadOptions<Meta = Record<string, unknown>> extends ValidateContractCallOptions {
    meta?: Meta;
}

export interface ContractCallerCustomJsonOptions<Meta = Record<string, unknown>> {
    authority?: ContractAuthority | 'auto';
    meta?: Meta;
}

export interface ContractCallerTransferOptions<Meta = Record<string, unknown>> {
    meta?: Meta;
}

export interface ContractCallActionDefinition<Payload = any> {
    schema?: ZodSchema<Payload>;
    trigger?: ContractTrigger | ContractTrigger[];
    requiresActiveKey?: boolean;
    description?: string;
}

export interface ContractCallDefinition<
    Actions extends Record<string, ContractCallActionDefinition<any>> = Record<string, ContractCallActionDefinition<any>>
> {
    name: string;
    actions: Actions;
}

type ContractActionName<Definition extends ContractCallDefinition> = Extract<keyof Definition['actions'], string>;

type ContractActionPayload<
    Definition extends ContractCallDefinition,
    ActionName extends ContractActionName<Definition>
> = Definition['actions'][ActionName] extends ContractCallActionDefinition<infer Payload> ? Payload : never;

const CONTRACT_TRIGGERS = new Set<ContractTrigger>([
    'custom_json',
    'transfer',
    'time',
    'escrow_transfer',
    'escrow_approve',
    'escrow_dispute',
    'escrow_release',
    'recurrent_transfer'
]);

function normalizeRequiredString(value: unknown, label: string): string {
    if (typeof value !== 'string' || !value.trim()) {
        throw new Error(`${label} must be a non-empty string`);
    }

    return value.trim();
}

function assertJsonValue(value: unknown, label: string, ancestors: Set<object> = new Set()): void {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') {
        return;
    }

    if (typeof value === 'number') {
        if (!Number.isFinite(value)) {
            throw new Error(`${label} contains a non-finite number`);
        }
        return;
    }

    if (typeof value !== 'object') {
        throw new Error(`${label} contains a value that JSON cannot encode`);
    }

    if (ancestors.has(value)) {
        throw new Error(`${label} contains a circular reference`);
    }

    const prototype = Object.getPrototypeOf(value);
    if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
        throw new Error(`${label} must contain plain objects, arrays, and JSON primitive values`);
    }

    ancestors.add(value);

    if (Array.isArray(value)) {
        value.forEach((entry, index) => assertJsonValue(entry, `${label}[${index}]`, ancestors));
    } else {
        for (const [key, entry] of Object.entries(value)) {
            assertJsonValue(entry, `${label}.${key}`, ancestors);
        }
    }

    ancestors.delete(value);
}

function normalizePayloadIdentifier(value?: string): string {
    return normalizeRequiredString(value ?? DEFAULT_CONTRACT_PAYLOAD_IDENTIFIER, 'payloadIdentifier');
}

function normalizeJsonId(value?: string): string {
    const id = normalizeRequiredString(value ?? DEFAULT_CONTRACT_JSON_ID, 'id');

    if (id.length >= 32) {
        throw new Error('id must be fewer than 32 characters');
    }

    return id;
}

function normalizeTransferAmount(amount: string): string {
    if (typeof amount !== 'string' || !/^\d+\.\d{3} (?:HIVE|HBD)$/.test(amount)) {
        throw new Error(`amount must be a native asset string like '1.000 HIVE' or '1.000 HBD'`);
    }

    const numeric = amount.slice(0, amount.indexOf(' ')).replace('.', '');
    if (!/[1-9]/.test(numeric)) {
        throw new Error('amount must be greater than zero');
    }

    return amount;
}

function normalizeEscrowAmount(amount: string | undefined, symbol: 'HIVE' | 'HBD'): string {
    if (amount === undefined) {
        return `0.000 ${symbol}`;
    }

    if (typeof amount !== 'string' || !new RegExp(`^\\d+\\.\\d{3} ${symbol}$`).test(amount)) {
        throw new Error(`${symbol.toLowerCase()}Amount must be an asset string like '1.000 ${symbol}'`);
    }

    return amount;
}

/** Hive wants escrow timestamps as ISO strings without a timezone suffix, to the second. */
function normalizeEscrowTime(value: string | Date, label: string): string {
    const date = value instanceof Date ? value : new Date(value);

    if (Number.isNaN(date.getTime())) {
        throw new Error(`${label} must be a valid date`);
    }

    return date.toISOString().replace(/\.\d{3}Z$/, '');
}

function serializeContractPayload<Payload, Meta>(
    call: ContractCallInput<Payload, Meta>,
    options: ContractPayloadOptions = {}
): string {
    const payloadIdentifier = normalizePayloadIdentifier(options.payloadIdentifier);
    const contract = normalizeRequiredString(call.contract, 'contract');
    const action = normalizeRequiredString(call.action, 'action');
    const payload = call.payload ?? {};

    assertJsonValue(payload, 'payload');

    const body: ContractPayload<Payload, Meta> = { contract, action, payload: payload as Payload };

    if (call.meta !== undefined) {
        assertJsonValue(call.meta, 'meta');
        body.meta = call.meta;
    }

    return JSON.stringify({ [payloadIdentifier]: body });
}

export function createContractPayload<Payload = Record<string, unknown>, Meta = Record<string, unknown>>(
    call: ContractCallInput<Payload, Meta>,
    options: ContractPayloadOptions = {}
): Record<string, ContractPayload<Payload, Meta>> {
    return JSON.parse(serializeContractPayload(call, options));
}

export function createContractMemo<Payload = Record<string, unknown>, Meta = Record<string, unknown>>(
    call: ContractCallInput<Payload, Meta>,
    options: ContractPayloadOptions = {}
): string {
    return serializeContractPayload(call, options);
}

export function createContractCustomJsonOperation<Payload = Record<string, unknown>, Meta = Record<string, unknown>>(
    call: ContractCallInput<Payload, Meta>,
    options: ContractCustomJsonOptions
): ContractCustomJsonOperation {
    const sender = normalizeHiveAccountName(options.sender, 'sender');
    const authority = options.authority ?? 'posting';

    if (authority !== 'posting' && authority !== 'active') {
        throw new Error(`authority must be 'posting' or 'active'`);
    }

    return [
        'custom_json',
        {
            required_auths: authority === 'active' ? [sender] : [],
            required_posting_auths: authority === 'posting' ? [sender] : [],
            id: normalizeJsonId(options.id),
            json: serializeContractPayload(call, options)
        }
    ];
}

export function createContractTransferOperation<Payload = Record<string, unknown>, Meta = Record<string, unknown>>(
    call: ContractCallInput<Payload, Meta>,
    options: ContractTransferOptions
): ContractTransferOperation {
    return [
        'transfer',
        {
            from: normalizeHiveAccountName(options.from, 'from'),
            to: normalizeHiveAccountName(options.to, 'to'),
            amount: normalizeTransferAmount(options.amount),
            memo: serializeContractPayload(call, options)
        }
    ];
}

/**
 * Builds the `escrow_transfer` a buyer signs to open an escrow whose
 * `json_meta` carries a contract call, so the app (as agent) can run the
 * named action when the escrow lands. The buyer signs it with their own
 * active key, for example through Hive Keychain's `requestBroadcast`.
 */
export function createContractEscrowTransferOperation<Payload = Record<string, unknown>, Meta = Record<string, unknown>>(
    call: ContractCallInput<Payload, Meta>,
    options: ContractEscrowTransferOptions
): ContractEscrowTransferOperation {
    const from = normalizeHiveAccountName(options.from, 'from');
    const to = normalizeHiveAccountName(options.to, 'to');
    const agent = normalizeHiveAccountName(options.agent, 'agent');

    if (from === to || from === agent || to === agent) {
        throw new Error('from, to and agent must be three different accounts');
    }

    if (!Number.isInteger(options.escrowId) || options.escrowId < 0 || options.escrowId > 4294967295) {
        throw new Error('escrowId must be an unsigned 32-bit integer');
    }

    const hiveAmount = normalizeEscrowAmount(options.hiveAmount, 'HIVE');
    const hbdAmount = normalizeEscrowAmount(options.hbdAmount, 'HBD');

    if (!/[1-9]/.test(hiveAmount.replace(' HIVE', '')) && !/[1-9]/.test(hbdAmount.replace(' HBD', ''))) {
        throw new Error('an escrow needs a HIVE or HBD amount greater than zero');
    }

    // Hive allows a zero agent fee, so the fee is validated as an amount, not a payment.
    if (typeof options.fee !== 'string' || !/^\d+\.\d{3} (?:HIVE|HBD)$/.test(options.fee)) {
        throw new Error(`fee must be a native asset string like '0.000 HIVE' or '0.250 HBD'`);
    }

    const fee = options.fee;
    const ratificationDeadline = normalizeEscrowTime(options.ratificationDeadline, 'ratificationDeadline');
    const expiration = normalizeEscrowTime(options.expiration, 'expiration');

    if (expiration <= ratificationDeadline) {
        throw new Error('expiration must be after ratificationDeadline');
    }

    return [
        'escrow_transfer',
        {
            from,
            to,
            agent,
            escrow_id: options.escrowId,
            hive_amount: hiveAmount,
            hbd_amount: hbdAmount,
            fee,
            ratification_deadline: ratificationDeadline,
            escrow_expiration: expiration,
            json_meta: serializeContractPayload(call, options)
        }
    ];
}

function getAllowedTriggers(actionDefinition: ContractCallActionDefinition<any>): ContractTrigger[] {
    if (actionDefinition.trigger === undefined) {
        return ['custom_json'];
    }

    return Array.isArray(actionDefinition.trigger)
        ? actionDefinition.trigger
        : [actionDefinition.trigger];
}

export function defineContractSpec<const Definition extends ContractCallDefinition>(definition: Definition): Definition {
    if (!definition || typeof definition !== 'object' || Array.isArray(definition)) {
        throw new Error('Contract call definition must be an object');
    }

    const normalizedName = normalizeRequiredString(definition.name, 'Contract call definition name');

    if (normalizedName !== definition.name) {
        throw new Error('Contract call definition name must not have surrounding whitespace');
    }

    if (!definition.actions || typeof definition.actions !== 'object' || Array.isArray(definition.actions)) {
        throw new Error(`Contract call definition '${definition.name}' must define actions`);
    }

    const actions = Object.entries(definition.actions);

    if (actions.length === 0) {
        throw new Error(`Contract call definition '${definition.name}' must define at least one action`);
    }

    for (const [actionName, actionDefinition] of actions) {
        const normalizedActionName = normalizeRequiredString(actionName, 'Contract action name');

        if (normalizedActionName !== actionName) {
            throw new Error(`Contract call definition '${definition.name}' action names must not have surrounding whitespace`);
        }

        if (!actionDefinition || typeof actionDefinition !== 'object' || Array.isArray(actionDefinition)) {
            throw new Error(`Contract call definition '${definition.name}' action '${actionName}' is invalid`);
        }

        if (actionDefinition.schema !== undefined && typeof actionDefinition.schema?.safeParse !== 'function') {
            throw new Error(`Contract call definition '${definition.name}' action '${actionName}' schema must provide safeParse()`);
        }

        const triggers = getAllowedTriggers(actionDefinition);
        if (triggers.length === 0 || triggers.some((trigger) => !CONTRACT_TRIGGERS.has(trigger))) {
            throw new Error(`Contract call definition '${definition.name}' action '${actionName}' has invalid triggers`);
        }

        if (actionDefinition.requiresActiveKey !== undefined && typeof actionDefinition.requiresActiveKey !== 'boolean') {
            throw new Error(`Contract call definition '${definition.name}' action '${actionName}' requiresActiveKey must be a boolean`);
        }

        if (actionDefinition.description !== undefined && typeof actionDefinition.description !== 'string') {
            throw new Error(`Contract call definition '${definition.name}' action '${actionName}' description must be a string`);
        }
    }

    return definition;
}

export function validateContractCall<Payload = unknown>(
    definition: ContractCallDefinition,
    call: ContractCallInput<Payload, any>,
    options: ValidateContractCallOptions = {}
): ContractCallValidationResult<Payload> {
    const issues: ContractCallIssue[] = [];
    let contract: string;
    let action: string;

    try {
        contract = normalizeRequiredString(call.contract, 'contract');
        action = normalizeRequiredString(call.action, 'action');
    } catch (error) {
        return {
            success: false,
            issues: [{ code: 'invalid_json', message: error instanceof Error ? error.message : String(error) }]
        };
    }

    if (contract !== definition.name) {
        issues.push({
            code: 'contract_mismatch',
            message: `Expected contract '${definition.name}', received '${contract}'`
        });
    }

    const actionDefinition = definition.actions[action];

    if (!actionDefinition) {
        issues.push({
            code: 'unknown_action',
            message: `Action '${action}' is not defined by contract '${definition.name}'`
        });
        return { success: false, issues };
    }

    if (options.trigger && !getAllowedTriggers(actionDefinition).includes(options.trigger)) {
        issues.push({
            code: 'trigger_not_allowed',
            message: `Action '${definition.name}.${action}' does not allow the '${options.trigger}' trigger`
        });
    }

    if (
        options.trigger === 'custom_json' &&
        actionDefinition.requiresActiveKey &&
        !options.signedWithActiveKey
    ) {
        issues.push({
            code: 'active_key_required',
            message: `Action '${definition.name}.${action}' requires active authority`
        });
    }

    const rawPayload = (call.payload ?? {}) as Payload;
    let payload = rawPayload;

    if (actionDefinition.schema) {
        try {
            const result = actionDefinition.schema.safeParse(payload);

            if (!result.success) {
                const schemaIssues = (result.error as any)?.issues ?? (result.error as any)?.errors ?? [];

                if (schemaIssues.length === 0) {
                    issues.push({ code: 'invalid_payload', message: `Payload for '${definition.name}.${action}' is invalid` });
                } else {
                    for (const issue of schemaIssues) {
                        issues.push({
                            code: 'invalid_payload',
                            message: issue.message || `Payload for '${definition.name}.${action}' is invalid`,
                            path: Array.isArray(issue.path) ? issue.path : undefined
                        });
                    }
                }
            } else {
                payload = result.data as Payload;
            }
        } catch (error) {
            issues.push({
                code: 'invalid_payload',
                message: error instanceof Error ? error.message : String(error)
            });
        }
    }

    try {
        // The raw payload is what gets broadcast, so that is what must be JSON.
        assertJsonValue(rawPayload, 'payload');
        if (call.meta !== undefined) {
            assertJsonValue(call.meta, 'meta');
        }
    } catch (error) {
        issues.push({
            code: 'invalid_json',
            message: error instanceof Error ? error.message : String(error)
        });
    }

    return issues.length > 0
        ? { success: false, issues }
        : { success: true, payload, issues: [] };
}

export class ContractCallValidationError extends Error {
    public readonly issues: ContractCallIssue[];

    constructor(contract: string, action: string, issues: ContractCallIssue[]) {
        super(`Invalid contract call ${contract}.${action}: ${issues.map((issue) => issue.message).join('; ')}`);
        this.name = 'ContractCallValidationError';
        this.issues = issues;
    }
}

export class ContractCaller<Definition extends ContractCallDefinition> {
    constructor(
        private readonly definition: Definition,
        private readonly options: ContractCallerOptions = {}
    ) {}

    public validate<ActionName extends ContractActionName<Definition>>(
        action: ActionName,
        payload: ContractActionPayload<Definition, ActionName>,
        options: ValidateContractCallOptions = {}
    ): ContractCallValidationResult<ContractActionPayload<Definition, ActionName>> {
        return validateContractCall(this.definition, {
            contract: this.definition.name,
            action,
            payload
        }, options) as ContractCallValidationResult<ContractActionPayload<Definition, ActionName>>;
    }

    public payload<ActionName extends ContractActionName<Definition>, Meta = Record<string, unknown>>(
        action: ActionName,
        payload: ContractActionPayload<Definition, ActionName>,
        options: ContractCallerPayloadOptions<Meta> = {}
    ): Record<string, ContractPayload<ContractActionPayload<Definition, ActionName>, Meta>> {
        const prepared = this.prepare(action, payload, options);

        return createContractPayload({
            contract: this.definition.name,
            action,
            payload: prepared,
            meta: options.meta
        }, this.options);
    }

    public memo<ActionName extends ContractActionName<Definition>, Meta = Record<string, unknown>>(
        action: ActionName,
        payload: ContractActionPayload<Definition, ActionName>,
        options: ContractCallerTransferOptions<Meta> = {}
    ): string {
        const prepared = this.prepare(action, payload, { trigger: 'transfer' });

        return createContractMemo({
            contract: this.definition.name,
            action,
            payload: prepared,
            meta: options.meta
        }, this.options);
    }

    public customJson<ActionName extends ContractActionName<Definition>, Meta = Record<string, unknown>>(
        sender: string,
        action: ActionName,
        payload: ContractActionPayload<Definition, ActionName>,
        options: ContractCallerCustomJsonOptions<Meta> = {}
    ): ContractCustomJsonOperation {
        const actionDefinition = this.definition.actions[action];

        if (!actionDefinition) {
            // Let validation report unknown_action instead of a TypeError below.
            this.prepare(action, payload, { trigger: 'custom_json' });
        }

        const authority = options.authority === undefined || options.authority === 'auto'
            ? (actionDefinition?.requiresActiveKey ? 'active' : 'posting')
            : options.authority;
        const prepared = this.prepare(action, payload, {
            trigger: 'custom_json',
            signedWithActiveKey: authority === 'active'
        });

        return createContractCustomJsonOperation({
            contract: this.definition.name,
            action,
            payload: prepared,
            meta: options.meta
        }, {
            sender,
            authority,
            id: this.options.jsonId,
            payloadIdentifier: this.options.payloadIdentifier
        });
    }

    public transfer<ActionName extends ContractActionName<Definition>, Meta = Record<string, unknown>>(
        from: string,
        to: string,
        amount: string,
        action: ActionName,
        payload: ContractActionPayload<Definition, ActionName>,
        options: ContractCallerTransferOptions<Meta> = {}
    ): ContractTransferOperation {
        const prepared = this.prepare(action, payload, { trigger: 'transfer' });

        return createContractTransferOperation({
            contract: this.definition.name,
            action,
            payload: prepared,
            meta: options.meta
        }, {
            from,
            to,
            amount,
            payloadIdentifier: this.options.payloadIdentifier
        });
    }

    private prepare<ActionName extends ContractActionName<Definition>>(
        action: ActionName,
        payload: ContractActionPayload<Definition, ActionName>,
        options: ValidateContractCallOptions
    ): ContractActionPayload<Definition, ActionName> {
        const result = this.validate(action, payload, options);

        if (!result.success) {
            throw new ContractCallValidationError(this.definition.name, action, result.issues);
        }

        // Serialise what the caller passed, not the schema's parsed output:
        // the contract re-parses it on-chain, and output from .transform() or
        // .default() may not be valid input for the same schema.
        return (payload ?? {}) as ContractActionPayload<Definition, ActionName>;
    }
}

export function createContractCaller<const Definition extends ContractCallDefinition>(
    definition: Definition,
    options: ContractCallerOptions = {}
): ContractCaller<Definition> {
    return new ContractCaller(defineContractSpec(definition), options);
}
