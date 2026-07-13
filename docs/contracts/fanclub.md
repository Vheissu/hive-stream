# fanclub

Paid fan clubs with renewals, engagement points, and perk redemptions.

```ts
import { createFanClubContract } from 'hive-stream';

await streamer.registerContract(createFanClubContract());
```

::: tip SQL adapter
Most built-in contracts persist state in SQL tables and require a SQL-capable adapter (SQLite or PostgreSQL).
:::

## Actions

### createClub

- **Trigger:** `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `clubId` | `string` | Yes |
| `title` | `string` | Yes |
| `joinPrice` | `string` | Yes |
| `asset` | `string` | Yes |
| `perks` | `object[]` | No |
| `metadata` | `record` | No |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"fanclub","action":"createClub","payload":{}}}
```

### joinClub

- **Trigger:** `transfer`, `recurrent_transfer`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `clubId` | `string` | Yes |

Send as a transfer memo:

```json
{"hive_stream":{"contract":"fanclub","action":"joinClub","payload":{}}}
```

### recordEngagement

- **Trigger:** `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `clubId` | `string` | Yes |
| `account` | `string` | Yes |
| `points` | `number` | Yes |
| `note` | `string` | No |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"fanclub","action":"recordEngagement","payload":{}}}
```

### redeemPerk

- **Trigger:** `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `clubId` | `string` | Yes |
| `perkId` | `string` | Yes |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"fanclub","action":"redeemPerk","payload":{}}}
```
