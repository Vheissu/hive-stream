# Time-Based Actions

Time-based actions are cron for your contracts: they invoke a contract action on a schedule, anchored to blockchain time, and survive restarts through your storage adapter.

```ts
import { TimeAction } from 'hive-stream';

const draw = new TimeAction('1h', 'hourly-draw', 'hivelotto', 'draw');
await streamer.registerAction(draw);
```

The target action must declare `trigger: 'time'`.

## Constructor

```ts
new TimeAction(timeValue, id, contractName, contractAction, payload?, date?, enabled?, executionCount?, maxExecutions?, timezone?)
```

- `timeValue` — the schedule (see below)
- `id` — unique identifier, used for management and persistence
- `contractName` / `contractAction` — what to invoke
- `payload` — passed to the handler on every execution
- `date` — anchor time; executions are measured from here (defaults to now)
- `maxExecutions` — optional cap; the action is removed once reached

## Valid time values

| Value | Interval |
| --- | --- |
| `3s` or `block` | Every block (~3 seconds) |
| `10s`, `30s` | Every 10 / 30 seconds |
| `1m` or `minute`, `5m` | Every 1 / 5 minutes |
| `15m` or `quarter`, `30m` or `halfhour` | Every 15 / 30 minutes |
| `1h` or `hourly` | Every hour |
| `12h` or `halfday`, `24h`/`day`/`daily` | Every 12 / 24 hours |
| `week` or `weekly` | Every 7 days |

## Managing actions

```ts
streamer.getActions();                        // all registered TimeActions
streamer.getAction('hourly-draw');            // one by id
await streamer.setActionEnabled('hourly-draw', false);
await streamer.resetAction('hourly-draw');    // re-anchor to now
await streamer.removeAction('hourly-draw');
```

Actions persist through the adapter, so schedules resume after a restart with their execution counts intact.

## How execution works

On each new block, Hive Stream compares the current blockchain time against each action's anchor. When the interval has elapsed, the contract action runs with a `time` trigger context, and the anchor resets to blockchain time — not wall-clock time — so replays, simulations, and clock skew stay consistent.

Errors thrown by time-triggered handlers propagate (unlike other triggers), so a failing scheduled task does not silently reset its timer.

## Testing schedules

The [testing kit](./testing) advances simulated chain time, so a weekly action can be exercised in milliseconds:

```ts
await ts.streamer.registerAction(new TimeAction('week', 'weekly-payout', 'payroll', 'run', {}, ts.currentTime));
await ts.advanceTime('1w');   // fires now
```
