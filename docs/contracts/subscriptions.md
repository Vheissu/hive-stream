# subscriptions

Subscription plans renewed by transfers or recurrent transfers.

**Category:** commerce

```ts
import { createSubscriptionContract } from 'hive-stream';

await streamer.registerContract(createSubscriptionContract());
```

::: tip SQL adapter
Most built-in contracts persist state in SQL tables and require a SQL-capable adapter (SQLite or PostgreSQL).
:::

## Options

| Option | Type | Required |
| --- | --- | --- |
| `name` | `string` | No |

## Actions

### createPlan

- **Trigger:** `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `planId` | `string` | Yes |
| `title` | `string` | Yes |
| `price` | `string` | Yes |
| `asset` | `string` | Yes |
| `intervalDays` | `number` | Yes |
| `graceDays` | `number` | No |
| `metadata` | `record` | No |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"subscriptions","action":"createPlan","payload":{}}}
```

### updatePlan

- **Trigger:** `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `planId` | `string` | Yes |
| `title` | `string` | No |
| `price` | `string` | No |
| `asset` | `string` | No |
| `intervalDays` | `number` | No |
| `graceDays` | `number` | No |
| `active` | `boolean` | No |
| `metadata` | `record` | No |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"subscriptions","action":"updatePlan","payload":{}}}
```

### subscribe

- **Trigger:** `transfer`, `recurrent_transfer`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `planId` | `string` | Yes |

Send as a transfer memo:

```json
{"hive_stream":{"contract":"subscriptions","action":"subscribe","payload":{}}}
```

### cancelSubscription

- **Trigger:** `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `planId` | `string` | Yes |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"subscriptions","action":"cancelSubscription","payload":{}}}
```

### expireMemberships

- **Trigger:** `custom_json`, `time`

**Payload**

_No payload validation defined for this action._

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"subscriptions","action":"expireMemberships","payload":{}}}
```
