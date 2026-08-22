# Calling Contracts Safely

Contract calls are ordinary JSON carried by `custom_json`, transfer memos, recurrent transfers, or escrow metadata. Building that JSON by hand leaves several mistakes for the chain to reveal: a misspelled action, the wrong wrapper key, posting authority on an active-only action, or a payload that does not match the server schema.

The `hive-stream/client` entry point catches those errors before anything is signed. It has no network, database, or private-key behavior, so it can run in a browser, backend, CLI, or test.

## Share the contract interface

Keep names, triggers, authority requirements, and Zod schemas in a lightweight spec:

```ts
import { defineContractSpec } from 'hive-stream/client';
import { z } from 'zod';

export const invoiceSpec = defineContractSpec({
    name: 'invoice',
    actions: {
        create: {
            trigger: 'custom_json',
            schema: z.object({
                invoiceId: z.string().min(1),
                amount: z.string().regex(/^\d+\.\d{3}$/)
            })
        },
        pay: {
            trigger: 'transfer',
            schema: z.object({ invoiceId: z.string().min(1) })
        },
        cancel: {
            trigger: 'custom_json',
            requiresActiveKey: true,
            schema: z.object({ invoiceId: z.string().min(1) })
        }
    }
});
```

Use those action options when defining the server contract. The schema is now one source of truth:

```ts
import { action, defineContract } from 'hive-stream';

export const invoiceContract = defineContract({
    name: invoiceSpec.name,
    actions: {
        create: action(createInvoice, invoiceSpec.actions.create),
        pay: action(payInvoice, invoiceSpec.actions.pay),
        cancel: action(cancelInvoice, invoiceSpec.actions.cancel)
    }
});
```

## Build typed operations

Create a caller from the shared spec:

```ts
import { createContractCaller } from 'hive-stream/client';

const invoices = createContractCaller(invoiceSpec);

const createOperation = invoices.customJson('alice', 'create', {
    invoiceId: 'inv-1042',
    amount: '12.500'
});

const paymentOperation = invoices.transfer(
    'alice',
    'invoice-app',
    '12.500 HBD',
    'pay',
    { invoiceId: 'inv-1042' }
);
```

`customJson()` uses posting authority unless the action has `requiresActiveKey: true`, in which case it selects active authority. You can override this with `{ authority: 'posting' | 'active' }`; an unsafe override is rejected. Sender, recipient, and destination account names are checked before an operation is returned, and a leading `@` is removed safely.

`transfer()` accepts native Hive assets in their on-chain form: exactly three decimal places followed by `HIVE` or `HBD`. It rejects zero amounts and actions that do not allow transfer triggers.

The returned tuples can be passed to `streamer.broadcastOperations()`, a wallet, Hive Keychain, or the offline test kit. The client helpers never sign or broadcast by themselves.

## Validate without building

Use `validate()` for form feedback:

```ts
const result = invoices.validate('create', formValues);

if (!result.success) {
    for (const issue of result.issues) {
        console.error(issue.code, issue.path, issue.message);
    }
}
```

Issues have stable codes for contract mismatch, unknown action, disallowed trigger, missing active authority, invalid payload, and invalid JSON.

## Lower-level helpers

You do not need a shared spec to use the wire-format helpers:

```ts
import {
    createContractMemo,
    createContractPayload,
    createContractCustomJsonOperation,
    createContractTransferOperation,
    validateHiveAccountName
} from 'hive-stream/client';
```

These functions validate names, JSON encoding, custom JSON id length, authority shape, and native transfer amounts. They cannot check action names or Zod schemas without a contract spec.
