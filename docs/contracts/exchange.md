# exchange

An order-book exchange with deposits, withdrawals, balances, and matching.

**Category:** finance

```ts
import { createExchangeContract } from 'hive-stream';

await streamer.registerContract(createExchangeContract());
```

::: tip SQL adapter
This contract keeps its state in SQL tables and needs a SQL-capable adapter (SQLite or PostgreSQL). Registering it on MongoDB fails.
:::

## Options

| Option | Type | Required |
| --- | --- | --- |
| `name` | `string` | No |
| `account` | `string` | No |
| `feeAccount` | `string` | No |
| `makerFeeBps` | `number` | No |
| `takerFeeBps` | `number` | No |
| `basePrecision` | `number` | No |
| `quotePrecision` | `number` | No |
| `defaultAssetPrecision` | `number` | No |

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
{"hive_stream":{"contract":"exchange","action":"createPair","payload":{"base":"HIVE","quote":"HBD"}}}
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
{"hive_stream":{"contract":"exchange","action":"withdraw","payload":{"asset":"HIVE","amount":"1.000"}}}
```

### placeOrder

- **Trigger:** `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `side` | `"buy" \| "sell"` | Yes |
| `base` | `string` | Yes |
| `quote` | `string` | Yes |
| `price` | `string` | Yes |
| `amount` | `string` | Yes |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"exchange","action":"placeOrder","payload":{"side":"buy","base":"HIVE","quote":"HBD","price":"1.000","amount":"1.000"}}}
```

### cancelOrder

- **Trigger:** `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `orderId` | `string` | Yes |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"exchange","action":"cancelOrder","payload":{"orderId":"example-1"}}}
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
{"hive_stream":{"contract":"exchange","action":"snapshotOrderBook","payload":{"base":"HIVE","quote":"HBD"}}}
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
{"hive_stream":{"contract":"exchange","action":"transfer","payload":{"to":"alice","asset":"HIVE","amount":"1.000"}}}
```
