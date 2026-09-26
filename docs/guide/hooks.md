# Hooks & Guards

Hooks let you observe and steer the streamer without forking it: metrics, audit logs, allow-lists, kill switches, alerting. Guards are declarative checks on contract actions that run before your handler.

## Registering hooks

Pass hooks in config, add them one at a time, or bundle them as a plugin:

```ts
import { Streamer, defineHooks } from 'hive-stream';

const streamer = new Streamer({
    hooks: {
        onError: ({ error, phase, fatal }) => alerts.send(`${phase}: ${error.message}`, { fatal })
    }
});

// One handler; returns a function that removes it
const off = streamer.hook('afterContractAction', ({ contract, action, durationMs }) => {
    metrics.timing(`contract.${contract}.${action}`, durationMs);
});

// A plugin: a hooks object, or a function that receives the streamer
const auditLog = defineHooks({
    afterContractAction: ({ contract, action, context }) => {
        log.info({ contract, action, sender: context.sender, trx: context.transaction.id });
    }
});

const dispose = streamer.use(auditLog);
streamer.use((s) => ({ onStart: () => log.info('streaming as', s.getConfig().USERNAME) }));
```

Handlers are awaited in registration order. Unknown hook names throw at registration, so a typo can't silently do nothing.

## Available hooks

| Hook | When it runs | Can change the outcome? |
| --- | --- | --- |
| `onStart` / `onStop` | When `start()` is about to begin polling / after `stop()` finishes | No |
| `beforeBlock` / `afterBlock` | Around each block. `afterBlock` runs after the checkpoint is written | No |
| `beforeOperation` | Before each operation reaches subscriptions and contracts | Return `false` to skip the operation |
| `afterOperation` | After each operation | No |
| `beforeContractAction` | After validation and guards, before the handler | Return `false` to veto, or `{ payload }` to replace the payload |
| `afterContractAction` | After a handler succeeds, with `durationMs` | No |
| `onContractError` | Each time a handler throws, with `attempt` and `willRetry` | No |
| `onInvalidPayload` | A payload failed its Zod schema, with `issues` | No |
| `onActionRejected` | An action was not run, with a `reason` (see below) | No |
| `onFork` | A fork was detected (`head` mode) | No |
| `onError` | Any reported error, with `phase` and `fatal` | No |
| `onCaughtUp` | The streamer reached the target block after being behind | No |
| `onCheckpoint` | The cursor was persisted | No |

`onActionRejected` reasons: `contract_not_found`, `action_not_found`, `trigger_not_allowed`, `active_key_required`, `paused`, `sender_not_allowed`, `asset_not_allowed`, `amount_too_low`, `amount_too_high`, `rate_limited`, `vetoed`, `duplicate`.

`onError` phases: `block` (fetching), `operation` and `adapter` (storage writes), `contract`, `action` (time actions), `subscription`, `hook`, `checkpoint`, `fork`.

### When hooks throw

A hook that throws is logged and reported to `onError` with phase `hook`; processing continues. `beforeContractAction` is the exception: if it throws, the action is vetoed. A guard that crashes must not let a payout through.

### Examples

Skip operations from a spam list before any subscription sees them:

```ts
streamer.hook('beforeOperation', ({ type, data }) => {
    return !(type === 'transfer' && spamList.has(data.from));
});
```

Normalise a payload for every action of one contract:

```ts
streamer.hook('beforeContractAction', ({ contract, payload }) => {
    if (contract === 'shop' && typeof payload.sku === 'string') {
        return { payload: { ...payload, sku: payload.sku.toUpperCase() } };
    }
});
```

## Contract hooks

Contracts have their own hooks alongside `create` and `destroy`:

```ts
defineContract({
    name: 'shop',
    hooks: {
        create: async ({ adapter }) => { /* tables */ },
        beforeAction: ({ action, payload, ctx }) => ctx.sender !== 'mallory',   // false vetoes
        afterAction: ({ action, durationMs }) => metrics.timing(`shop.${action}`, durationMs),
        onError: ({ action, error, ctx }) => alerts.send(`shop.${action} failed for ${ctx.sender}: ${error.message}`)
    },
    actions: { /* ... */ }
});
```

## Guards

Guards cover the checks almost every money-handling action repeats. They run after schema validation and before `beforeContractAction`:

```ts
defineContract({
    name: 'dice',
    guards: { allowedAssets: ['HIVE', 'HBD'] },          // default for every action
    actions: {
        roll: action(handler, {
            trigger: 'transfer',
            guards: {
                minAmount: '0.100',
                maxAmount: 50,
                rateLimit: { max: 10, windowSeconds: 60 },
                blockedSenders: ['known-abuser']
            }
        }),
        adminPayout: action(handler, {
            trigger: 'custom_json',
            requiresActiveKey: true,
            guards: { allowedSenders: ['house-account'] }
        })
    }
});
```

| Guard | Rejects when |
| --- | --- |
| `allowedSenders` | The sender is not in the list |
| `blockedSenders` | The sender is in the list |
| `allowedAssets` | The transfer asset is not in the list (case-insensitive) |
| `minAmount` / `maxAmount` | The transfer amount is outside the range (inclusive) |
| `rateLimit` | The sender already made `max` calls within `windowSeconds` of blockchain time |
| `paused` | Always (maintenance mode) |

Action guards override contract guards field by field. Guards are validated in `defineContract()`, so a typo like `maxBet` throws at startup.

Things to know:

- Amount and asset guards only apply to triggers that carry an amount (`transfer`, `recurrent_transfer`). A `custom_json` call to the same action passes them. If an action must be paid for, restrict its `trigger` to `transfer`.
- Sender guards and rate limits don't apply to `time` triggers, which have no sender.
- Rate-limit counters live in memory and use block timestamps, so they are deterministic during replays but reset when the process restarts.
- A rejected transfer is not refunded automatically. Use `onActionRejected` if you want to refund, or pair the contract with `flows.autoRefundIncomingTransfers()`.

## Pausing at runtime

```ts
streamer.pauseContract('dice');            // every action
streamer.pauseContract('dice', 'roll');    // one action
streamer.resumeContract('dice');
streamer.isContractPaused('dice', 'roll');
```

Paused calls are rejected with reason `paused`. A due time action on a paused contract skips that tick without counting it as an execution.
