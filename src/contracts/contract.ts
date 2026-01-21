import type { ContractActionDefinition, ContractContext, ContractDefinition } from '../types/hive-stream';

export function action<Payload>(
    handler: (payload: Payload, ctx: ContractContext) => void | Promise<void>,
    options: Omit<ContractActionDefinition<Payload>, 'handler'> = {}
): ContractActionDefinition<Payload> {
    return {
        handler,
        ...options,
    };
}

export function defineContract(definition: ContractDefinition): ContractDefinition {
    if (!definition || typeof definition !== 'object') {
        throw new Error('Contract definition must be an object');
    }

    if (!definition.name || typeof definition.name !== 'string') {
        throw new Error('Contract definition requires a name');
    }

    if (!definition.actions || typeof definition.actions !== 'object') {
        throw new Error(`Contract '${definition.name}' must define actions`);
    }

    if (Object.keys(definition.actions).length === 0) {
        throw new Error(`Contract '${definition.name}' must define at least one action`);
    }

    return definition;
}
