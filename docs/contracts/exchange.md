# exchange

An order-book exchange with deposits, withdrawals, balances, and matching.

```ts
import { createExchangeContract } from 'hive-stream';

await streamer.registerContract(createExchangeContract());
```

::: tip SQL adapter
Most built-in contracts persist state in SQL tables and require a SQL-capable adapter (SQLite or PostgreSQL).
:::

## Actions

### createPair

- **Trigger:** `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `base` | `string` | Yes |
| `quote` | `string` | Yes |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"exchange","action":"createPair","payload":{}}}
```

### deposit

- **Trigger:** `transfer`

**Payload**

_This action takes an empty payload._

Send as a transfer memo:

```json
{"hive_stream":{"contract":"exchange","action":"deposit","payload":{}}}
```

### withdraw

- **Trigger:** `custom_json`
- **Requires active key signature**

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `asset` | `string` | Yes |
| `amount` | `string` | Yes |
| `to` | `string` | No |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"exchange","action":"withdraw","payload":{}}}
```

### placeOrder

- **Trigger:** `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `side` | `"buy" | "sell"` | Yes |
| `base` | `string` | Yes |
| `quote` | `string` | Yes |
| `price` | `string` | Yes |
| `amount` | `string` | Yes |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"exchange","action":"placeOrder","payload":{}}}
```

### cancelOrder

- **Trigger:** `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `orderId` | `string` | Yes |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"exchange","action":"cancelOrder","payload":{}}}
```

### matchOrders

- **Trigger:** `time`

**Payload**

_No payload validation defined for this action._

### snapshotOrderBook

- **Trigger:** `time`, `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `base` | `string` | Yes |
| `quote` | `string` | Yes |
| `depth` | `number` | No |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"exchange","action":"snapshotOrderBook","payload":{}}}
```

### transfer

- **Trigger:** `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `to` | `string` | Yes |
| `asset` | `string` | Yes |
| `amount` | `string` | Yes |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"exchange","action":"transfer","payload":{}}}
```
