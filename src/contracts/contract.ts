import type { ContractActionDefinition, ContractContext, ContractDefinition } from '../types/hive-stream';

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

        if (definition.hooks.destroy !== undefined && typeof definition.hooks.destroy !== 'function') {
            throw new Error(`Contract '${definition.name}' destroy hook must be a function`);
        }
    }

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
