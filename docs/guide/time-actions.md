# Time-Based Actions

Time-based actions are cron for your contracts: they invoke a contract action on a schedule, anchored to blockchain time, and survive restarts through your storage adapter.

```ts
import { TimeAction } from 'hive-stream';

const draw = new TimeAction('1h', 'hourly-draw', 'hivelotto', 'drawHourlyLottery');
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

After each block's operations have been processed, Hive Stream compares that block's timestamp against each action's anchor. When the interval has elapsed, the contract action runs with a `time` trigger context (`ctx.block` is the block that made it due), and the anchor resets to that timestamp — not wall-clock time — so replays, catch-up, simulations, and clock skew stay consistent.

Each tick is recorded in the idempotency ledger (action id plus block number), so replaying a block after a crash does not run a scheduled payout twice.

If a time-triggered handler throws under the default `errorPolicy: 'skip'`, its timer is not reset and the action runs again on the next block. Under `halt` and `retry` a failing scheduled action halts the streamer like any other contract error. A tick rejected by a guard or a paused contract is skipped: the timer resets but the execution count does not increase.

Persisted actions are restored when the streamer initializes, so a schedule survives a restart even before `registerAction()` is called again.

## Testing schedules

The [testing kit](./testing) advances simulated chain time, so a weekly action can be exercised in milliseconds:

```ts
await ts.streamer.registerAction(new TimeAction('week', 'weekly-payout', 'payroll', 'run', {}, ts.currentTime));
await ts.advanceTime('1w');   // fires now
```
