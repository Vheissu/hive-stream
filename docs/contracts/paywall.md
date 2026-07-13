# paywall

Paid access control for gated resources and memberships.

```ts
import { createPaywallContract } from 'hive-stream';

await streamer.registerContract(createPaywallContract());
```

::: tip SQL adapter
Most built-in contracts persist state in SQL tables and require a SQL-capable adapter (SQLite or PostgreSQL).
:::

## Actions

### createResource

- **Trigger:** `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `resourceId` | `string` | Yes |
| `title` | `string` | Yes |
| `price` | `string` | Yes |
| `asset` | `string` | Yes |
| `accessDays` | `number` | Yes |
| `maxPurchasesPerAccount` | `number` | No |
| `metadata` | `record` | No |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"paywall","action":"createResource","payload":{}}}
```

### grantAccess

- **Trigger:** `transfer`, `recurrent_transfer`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `resourceId` | `string` | Yes |

Send as a transfer memo:

```json
{"hive_stream":{"contract":"paywall","action":"grantAccess","payload":{}}}
```

### revokeAccess

- **Trigger:** `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `resourceId` | `string` | Yes |
| `account` | `string` | Yes |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"paywall","action":"revokeAccess","payload":{}}}
```

### expireAccess

- **Trigger:** `custom_json`, `time`

**Payload**

_No payload validation defined for this action._

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"paywall","action":"expireAccess","payload":{}}}
```
