import type { ContractActionDefinition, ContractActionGuards, ContractContext, ContractDefinition } from '../types/hive-stream';

const CONTRACT_TRIGGERS = new Set([
    'custom_json',
    'transfer',
    'time',
    'escrow_transfer',
    'escrow_approve',
    'escrow_dispute',
    'escrow_release',
    'recurrent_transfer'
]);

function isAmountLike(value: unknown): boolean {
    if (typeof value === 'number') {
        return Number.isFinite(value) && value >= 0;
    }

    if (typeof value === 'string') {
        return /^\d+(\.\d+)?$/.test(value.trim());
    }

    return false;
}

function validateStringList(label: string, value: unknown): void {
    if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string' || !entry.trim())) {
        throw new Error(`${label} must be an array of non-empty strings`);
    }
}

export function validateGuards(label: string, guards: ContractActionGuards | undefined): void {
    if (guards === undefined) {
        return;
    }

    if (!guards || typeof guards !== 'object' || Array.isArray(guards)) {
        throw new Error(`${label} guards must be an object`);
    }

    const known = new Set(['allowedSenders', 'allowedRecipients', 'blockedSenders', 'allowedAssets', 'minAmount', 'maxAmount', 'rateLimit', 'paused']);

    for (const key of Object.keys(guards)) {
        if (!known.has(key)) {
            throw new Error(`${label} has unknown guard '${key}'`);
        }
    }

    if (guards.allowedSenders !== undefined) {
        validateStringList(`${label} guards.allowedSenders`, guards.allowedSenders);
    }

    if (guards.allowedRecipients !== undefined) {
        validateStringList(`${label} guards.allowedRecipients`, guards.allowedRecipients);
    }

    if (guards.blockedSenders !== undefined) {
        validateStringList(`${label} guards.blockedSenders`, guards.blockedSenders);
    }

    if (guards.allowedAssets !== undefined) {
        validateStringList(`${label} guards.allowedAssets`, guards.allowedAssets);
    }

    if (guards.minAmount !== undefined && !isAmountLike(guards.minAmount)) {
        throw new Error(`${label} guards.minAmount must be a non-negative number or numeric string`);
    }

    if (guards.maxAmount !== undefined && !isAmountLike(guards.maxAmount)) {
        throw new Error(`${label} guards.maxAmount must be a non-negative number or numeric string`);
    }

    if (guards.minAmount !== undefined && guards.maxAmount !== undefined && Number(guards.minAmount) > Number(guards.maxAmount)) {
        throw new Error(`${label} guards.minAmount must not exceed guards.maxAmount`);
    }

    if (guards.rateLimit !== undefined) {
        const rateLimit = guards.rateLimit;

        if (!rateLimit || typeof rateLimit !== 'object' ||
            !Number.isInteger(rateLimit.max) || rateLimit.max < 1 ||
            typeof rateLimit.windowSeconds !== 'number' || !Number.isFinite(rateLimit.windowSeconds) || rateLimit.windowSeconds <= 0) {
            throw new Error(`${label} guards.rateLimit must be { max: positive integer, windowSeconds: positive number }`);
        }
    }

    if (guards.paused !== undefined && typeof guards.paused !== 'boolean') {
        throw new Error(`${label} guards.paused must be a boolean`);
    }
}

function validateActionDefinition(contractName: string, actionName: string, definition: ContractActionDefinition<any>): void {
    if (!definition || typeof definition !== 'object' || Array.isArray(definition)) {
        throw new Error(`Contract '${contractName}' action '${actionName}' must be an action definition`);
    }

    if (typeof definition.handler !== 'function') {
        throw new Error(`Contract '${contractName}' action '${actionName}' requires a handler function`);
    }

    if (definition.schema !== undefined && typeof definition.schema?.safeParse !== 'function') {
        throw new Error(`Contract '${contractName}' action '${actionName}' schema must provide safeParse()`);
    }

    if (definition.requiresActiveKey !== undefined && typeof definition.requiresActiveKey !== 'boolean') {
        throw new Error(`Contract '${contractName}' action '${actionName}' requiresActiveKey must be a boolean`);
    }

    if (definition.description !== undefined && typeof definition.description !== 'string') {
        throw new Error(`Contract '${contractName}' action '${actionName}' description must be a string`);
    }

    validateGuards(`Contract '${contractName}' action '${actionName}'`, definition.guards);

    if (definition.trigger === undefined) {
        return;
    }

    const triggers = Array.isArray(definition.trigger) ? definition.trigger : [definition.trigger];

    if (triggers.length === 0) {
        throw new Error(`Contract '${contractName}' action '${actionName}' must allow at least one trigger`);
    }

    for (const trigger of triggers) {
        if (!CONTRACT_TRIGGERS.has(trigger)) {
            throw new Error(`Contract '${contractName}' action '${actionName}' has unsupported trigger '${String(trigger)}'`);
        }
    }
}

export function validateContractDefinition<Definition extends ContractDefinition>(definition: Definition): Definition {
    if (!definition || typeof definition !== 'object' || Array.isArray(definition)) {
        throw new Error('Contract definition must be an object');
    }

    if (!definition.name || typeof definition.name !== 'string' || !definition.name.trim()) {
        throw new Error('Contract definition requires a name');
    }

    if (definition.name.trim() !== definition.name) {
        throw new Error('Contract definition name must not have surrounding whitespace');
    }

    if (!definition.actions || typeof definition.actions !== 'object' || Array.isArray(definition.actions)) {
        throw new Error(`Contract '${definition.name}' must define actions`);
    }

    const actionEntries = Object.entries(definition.actions);

    if (actionEntries.length === 0) {
        throw new Error(`Contract '${definition.name}' must define at least one action`);
    }

    for (const [actionName, actionDefinition] of actionEntries) {
        if (!actionName.trim()) {
            throw new Error(`Contract '${definition.name}' action names must not be empty`);
        }

        if (actionName.trim() !== actionName) {
            throw new Error(`Contract '${definition.name}' action names must not have surrounding whitespace`);
        }

        validateActionDefinition(definition.name, actionName, actionDefinition);
    }

    if (definition.hooks !== undefined) {
        if (!definition.hooks || typeof definition.hooks !== 'object' || Array.isArray(definition.hooks)) {
            throw new Error(`Contract '${definition.name}' hooks must be an object`);
        }

        if (definition.hooks.create !== undefined && typeof definition.hooks.create !== 'function') {
            throw new Error(`Contract '${definition.name}' create hook must be a function`);
        }

        for (const hookName of ['create', 'destroy', 'beforeAction', 'afterAction', 'onError'] as const) {
            if (definition.hooks[hookName] !== undefined && typeof definition.hooks[hookName] !== 'function') {
                throw new Error(`Contract '${definition.name}' ${hookName} hook must be a function`);
            }
        }

        const knownHooks = new Set(['create', 'destroy', 'beforeAction', 'afterAction', 'onError']);

        for (const hookName of Object.keys(definition.hooks)) {
            if (!knownHooks.has(hookName)) {
                throw new Error(`Contract '${definition.name}' has unknown hook '${hookName}'`);
            }
        }
    }

    validateGuards(`Contract '${definition.name}'`, definition.guards);

    return definition;
}

export function action<Payload>(
    handler: (payload: Payload, ctx: ContractContext) => void | Promise<void>,
    options: Omit<ContractActionDefinition<Payload>, 'handler'> = {}
): ContractActionDefinition<Payload> {
    const definition: ContractActionDefinition<Payload> = {
        handler,
        ...options,
    };

    validateActionDefinition('(unregistered)', '(anonymous)', definition);

    return definition;
}

export function defineContract<const Definition extends ContractDefinition>(definition: Definition): Definition {
    return validateContractDefinition(definition);
}
