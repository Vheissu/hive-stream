# stakingpool

Staking pools with reward-per-share accrual (per second or per block), funded reward reserves, cooldowns and claims.

**Category:** finance

```ts
import { createStakingPoolContract } from 'hive-stream';

await streamer.registerContract(createStakingPoolContract());
```

::: tip SQL adapter
This contract keeps its state in SQL tables and needs a SQL-capable adapter (SQLite or PostgreSQL). Registering it on MongoDB fails.
:::

## Options

| Option | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | `string` | No |  |
| `account` | `string` | No | Custody account that receives stakes and reward funding and pays them out. Defaults to the streamer username. |
| `admins` | `string[]` | No | Accounts allowed to create pools and change reward rates. Defaults to the custody account. |
| `accrual` | `'time' \| 'block'` | No | 'time' accrues `rewardRate` per second of block time; 'block' accrues per block. |

## Actions

### createPool

Admin-only: create a pool with stake/reward assets, a reward rate per second (or block), cooldown and optional end time.

- **Trigger:** `custom_json`
- **Requires active key signature**

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `poolId` | `string` | Yes |
| `stakeAsset` | `string` | Yes |
| `rewardAsset` | `string` | Yes |
| `rewardRate` | `string` | Yes |
| `cooldownSeconds` | `number` | No |
| `minStake` | `string` | No |
| `endsAt` | `string` | No |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"stakingpool","action":"createPool","payload":{"poolId":"example-1","stakeAsset":"HIVE","rewardAsset":"HIVE","rewardRate":"1.000"}}}
```

### fundRewards

Top up a pool's reward reserve. Rewards never accrue beyond what has been funded.

- **Trigger:** `transfer`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `poolId` | `string` | Yes |

Send as a transfer memo:

```json
{"hive_stream":{"contract":"stakingpool","action":"fundRewards","payload":{"poolId":"example-1"}}}
```

### stake

Stake by transferring the pool's stake asset; wrong assets, tiny amounts and ended pools are refunded.

- **Trigger:** `transfer`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `poolId` | `string` | Yes |

Send as a transfer memo:

```json
{"hive_stream":{"contract":"stakingpool","action":"stake","payload":{"poolId":"example-1"}}}
```

### unstake

Start unbonding part of your stake; funds are released after the pool's cooldown.

- **Trigger:** `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `poolId` | `string` | Yes |
| `amount` | `string` | Yes |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"stakingpool","action":"unstake","payload":{"poolId":"example-1","amount":"1.000"}}}
```

### withdraw

Release your matured unbonding entries.

- **Trigger:** `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `poolId` | `string` | Yes |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"stakingpool","action":"withdraw","payload":{"poolId":"example-1"}}}
```

### claim

Pay out accrued rewards (rounded down to the asset precision; the remainder stays pending).

- **Trigger:** `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `poolId` | `string` | Yes |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"stakingpool","action":"claim","payload":{"poolId":"example-1"}}}
```

### setRewardRate

Admin-only: change the reward rate after settling accruals at the old rate.

- **Trigger:** `custom_json`
- **Requires active key signature**

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `poolId` | `string` | Yes |
| `rewardRate` | `string` | Yes |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"stakingpool","action":"setRewardRate","payload":{"poolId":"example-1","rewardRate":"1.000"}}}
```

### releaseMatured

Scheduled release of every matured unbonding entry.

- **Trigger:** `time`

**Payload**

_This action takes an empty payload._
