# badges

Non-transferable achievements and badges issued by authorised issuers or earned by payment and check-in rules.

**Category:** games

```ts
import { createBadgesContract } from 'hive-stream';

await streamer.registerContract(createBadgesContract());
```

::: tip SQL adapter
This contract keeps its state in SQL tables and needs a SQL-capable adapter (SQLite or PostgreSQL). Registering it on MongoDB fails.
:::

## Options

| Option | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | `string` | No |  |
| `account` | `string` | No | Account that receives `payment_total` rule payments. Required to use payment rules. |
| `admins` | `string[]` | No | When set, only these accounts can define badges. |

## Actions

### defineBadge

Define a non-transferable badge with issuers, optional supply cap and an optional earning rule.

- **Trigger:** `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `badgeId` | `string` | Yes |
| `title` | `string` | Yes |
| `description` | `string` | No |
| `imageUrl` | `string` | No |
| `issuers` | `string[]` | No |
| `maxSupply` | `number` | No |
| `rule` | `object \| object` | No |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"badges","action":"defineBadge","payload":{"badgeId":"example-1","title":"Example"}}}
```

### issueBadge

Issuer-only: award a badge to an account.

- **Trigger:** `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `badgeId` | `string` | Yes |
| `recipient` | `string` | Yes |
| `reason` | `string` | No |
| `evidence` | `string` | No |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"badges","action":"issueBadge","payload":{"badgeId":"example-1","recipient":"alice"}}}
```

### revokeBadge

Issuer-only: revoke a badge with a public reason.

- **Trigger:** `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `badgeId` | `string` | Yes |
| `recipient` | `string` | Yes |
| `reason` | `string` | Yes |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"badges","action":"revokeBadge","payload":{"badgeId":"example-1","recipient":"alice","reason":"Example text"}}}
```

### updateIssuers

Creator-only: add or remove issuers (the creator always remains an issuer).

- **Trigger:** `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `badgeId` | `string` | Yes |
| `add` | `string[]` | No |
| `remove` | `string[]` | No |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"badges","action":"updateIssuers","payload":{"badgeId":"example-1"}}}
```

### contribute

Count a payment toward a payment_total badge; the badge is awarded when the threshold is reached.

- **Trigger:** `transfer`, `recurrent_transfer`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `badgeId` | `string` | Yes |

Send as a transfer memo:

```json
{"hive_stream":{"contract":"badges","action":"contribute","payload":{"badgeId":"example-1"}}}
```

### checkIn

Record a periodic check-in toward a checkin_count badge (optionally requiring consecutive periods).

- **Trigger:** `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `badgeId` | `string` | Yes |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"badges","action":"checkIn","payload":{"badgeId":"example-1"}}}
```
