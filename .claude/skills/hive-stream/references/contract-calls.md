# Contract Calls

Use the browser-safe `hive-stream/client` entry point when an app, script, or test needs to construct a contract call.

## Shared Interface

```ts
import { createContractCaller, defineContractSpec } from 'hive-stream/client';
import { z } from 'zod';

const spec = defineContractSpec({
    name: 'guestbook',
    actions: {
        sign: {
            trigger: 'custom_json',
            schema: z.object({ message: z.string().max(280) })
        }
    }
});

const calls = createContractCaller(spec);
const operation = calls.customJson('alice', 'sign', { message: 'Hello' });
```

Reuse `spec.actions.sign` as the options passed to the server-side `action()` helper. This keeps the action name, schema, trigger, and authority requirement in one place.

## Available Builders

- `caller.customJson(sender, action, payload, options?)`
- `caller.transfer(from, to, amount, action, payload, options?)`
- `caller.payload(action, payload, options?)`
- `caller.memo(action, payload, options?)`
- `caller.validate(action, payload, options?)`

Direct helpers are also available: `createContractPayload`, `createContractMemo`, `createContractCustomJsonOperation`, `createContractTransferOperation`, `createContractEscrowTransferOperation`, and `validateContractCall`.

The client surface does not sign or broadcast. Custom JSON callers select active authority automatically for actions marked `requiresActiveKey`; native transfers require exact strings such as `1.000 HIVE` or `2.500 HBD`.

Address transfers to the app account (or the built-in's `account`). Transfers sent anywhere else are rejected server-side with `recipient_not_allowed` (and not refunded, because the app never received them).

## Escrow calls

`createContractEscrowTransferOperation(call, options)` builds the `escrow_transfer` a buyer signs to open an escrow carrying a contract call in `json_meta`:

```ts
import { createContractEscrowTransferOperation } from 'hive-stream/client';

const operation = createContractEscrowTransferOperation(
    { contract: 'escrowmarket', action: 'openTrade', payload: { listingId: 'lamp-1' } },
    {
        from: 'buyer', to: 'seller', agent: 'myapp-agent', escrowId: 1001,
        hiveAmount: '25.000 HIVE', fee: '0.250 HIVE',
        ratificationDeadline: new Date(Date.now() + 24 * 3600 * 1000),
        expiration: new Date(Date.now() + 30 * 24 * 3600 * 1000)
    }
);

hive_keychain.requestBroadcast('buyer', [operation], 'Active', callback);
```

It validates that `from`, `to` and `agent` are distinct valid accounts, `escrowId` is an unsigned 32-bit integer, at least one of `hiveAmount`/`hbdAmount` is positive, and `expiration` is after `ratificationDeadline`. Read the built-in's catalog entry for the exact payload and agent fee it expects (`escrowmarket` `agentFeeBps`, `p2pswap` `feeBps`).

## Built-in contract payloads

For built-in contracts, take action names, triggers, active-key requirements, payload fields and an `example` payload from `hive-stream/catalog` (`getCatalogContract('escrowmarket')`) instead of guessing. Value-moving custom JSON actions on the built-ins require active authority, so sign them with `'Active'` in Keychain.

## Fairness verification

`hive-stream/client` also exports the provably-fair verifier: `verifyOutcome(input, spec, claimed)`, `deriveOutcome`, `hashServerSeed`, `verifyServerSeedCommitment`. See `fairness.md`.

## Browser use

`hive-stream/client`, `hive-stream/scaffold` and `hive-stream/catalog` import no Node built-ins. A frontend can build a memo with `createContractMemo({ contract, action, payload })` and hand it to Hive Keychain's `requestTransfer`. See `examples/recipes/browser-client.ts`.
