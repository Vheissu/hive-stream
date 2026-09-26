# domains

App-level namespaces with registrations, renewals, and transfers.

**Category:** assets

```ts
import { createDomainRegistryContract } from 'hive-stream';

await streamer.registerContract(createDomainRegistryContract());
```

::: tip SQL adapter
Most built-in contracts persist state in SQL tables and require a SQL-capable adapter (SQLite or PostgreSQL).
:::

## Options

| Option | Type | Required |
| --- | --- | --- |
| `name` | `string` | No |

## Actions

### createNamespace

- **Trigger:** `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `namespace` | `string` | Yes |
| `title` | `string` | Yes |
| `registrationPrice` | `string` | Yes |
| `asset` | `string` | Yes |
| `renewalDays` | `number` | Yes |
| `metadata` | `record` | No |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"domains","action":"createNamespace","payload":{}}}
```

### registerName

- **Trigger:** `transfer`, `recurrent_transfer`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `namespace` | `string` | Yes |
| `label` | `string` | Yes |
| `target` | `string` | Yes |
| `years` | `number` | No |
| `metadata` | `record` | No |

Send as a transfer memo:

```json
{"hive_stream":{"contract":"domains","action":"registerName","payload":{}}}
```

### renewName

- **Trigger:** `transfer`, `recurrent_transfer`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `namespace` | `string` | Yes |
| `label` | `string` | Yes |
| `target` | `string` | Yes |
| `years` | `number` | No |
| `metadata` | `record` | No |

Send as a transfer memo:

```json
{"hive_stream":{"contract":"domains","action":"renewName","payload":{}}}
```

### transferName

- **Trigger:** `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `namespace` | `string` | Yes |
| `label` | `string` | Yes |
| `to` | `string` | Yes |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"domains","action":"transferName","payload":{}}}
```

### expireNames

- **Trigger:** `custom_json`, `time`

**Payload**

_No payload validation defined for this action._

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"domains","action":"expireNames","payload":{}}}
```
