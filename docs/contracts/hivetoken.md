# hivetoken

App-level token issuance, transfers, and balances.

**Category:** assets

```ts
import { createTokenContract } from 'hive-stream';

await streamer.registerContract(createTokenContract());
```

::: tip SQL adapter
Most built-in contracts persist state in SQL tables and require a SQL-capable adapter (SQLite or PostgreSQL).
:::

## Options

| Option | Type | Required |
| --- | --- | --- |
| `name` | `string` | No |

## Actions

### createToken

- **Trigger:** `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `symbol` | `string` | Yes |
| `name` | `string` | Yes |
| `url` | `string` | No |
| `precision` | `number` | No |
| `maxSupply` | `string` | Yes |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"hivetoken","action":"createToken","payload":{"symbol":"HIVE","name":"Example","maxSupply":"example-1"}}}
```

### issueTokens

- **Trigger:** `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `symbol` | `string` | Yes |
| `to` | `string` | Yes |
| `amount` | `string` | Yes |
| `memo` | `string` | No |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"hivetoken","action":"issueTokens","payload":{"symbol":"HIVE","to":"alice","amount":"1.000"}}}
```

### transferTokens

- **Trigger:** `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `symbol` | `string` | Yes |
| `to` | `string` | Yes |
| `amount` | `string` | Yes |
| `memo` | `string` | No |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"hivetoken","action":"transferTokens","payload":{"symbol":"HIVE","to":"alice","amount":"1.000"}}}
```

### getBalance

- **Trigger:** `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `account` | `string` | Yes |
| `symbol` | `string` | Yes |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"hivetoken","action":"getBalance","payload":{"account":"alice","symbol":"HIVE"}}}
```

### getTokenInfo

- **Trigger:** `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `symbol` | `string` | Yes |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"hivetoken","action":"getTokenInfo","payload":{"symbol":"HIVE"}}}
```
