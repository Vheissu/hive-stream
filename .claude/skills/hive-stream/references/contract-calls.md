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

Direct helpers are also available: `createContractPayload`, `createContractMemo`, `createContractCustomJsonOperation`, `createContractTransferOperation`, and `validateContractCall`.

The client surface does not sign or broadcast. Custom JSON callers select active authority automatically for actions marked `requiresActiveKey`; native transfers require exact strings such as `1.000 HIVE` or `2.500 HBD`.

## Fairness verification

`hive-stream/client` also exports the provably-fair verifier: `verifyOutcome(input, spec, claimed)`, `deriveOutcome`, `hashServerSeed`, `verifyServerSeedCommitment`. See `fairness.md`.

## Browser use

`hive-stream/client`, `hive-stream/scaffold` and `hive-stream/catalog` import no Node built-ins. A frontend can build a memo with `createContractMemo({ contract, action, payload })` and hand it to Hive Keychain's `requestTransfer`. See `examples/recipes/browser-client.ts`.
