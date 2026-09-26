# payroll

Recurring team payrolls with funded budgets and scheduled runs.

**Category:** finance

```ts
import { createPayrollContract } from 'hive-stream';

await streamer.registerContract(createPayrollContract());
```

::: tip SQL adapter
This contract keeps its state in SQL tables and needs a SQL-capable adapter (SQLite or PostgreSQL). Registering it on MongoDB fails.
:::

## Options

| Option | Type | Required |
| --- | --- | --- |
| `name` | `string` | No |

## Actions

### createPayroll

- **Trigger:** `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `payrollId` | `string` | Yes |
| `title` | `string` | Yes |
| `asset` | `string` | Yes |
| `intervalDays` | `number` | Yes |
| `metadata` | `record` | No |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"payroll","action":"createPayroll","payload":{"payrollId":"example-1","title":"Example","asset":"HIVE","intervalDays":24}}}
```

### addRecipient

- **Trigger:** `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `payrollId` | `string` | Yes |
| `account` | `string` | Yes |
| `amount` | `string` | Yes |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"payroll","action":"addRecipient","payload":{"payrollId":"example-1","account":"alice","amount":"1.000"}}}
```

### fundPayroll

- **Trigger:** `transfer`, `recurrent_transfer`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `payrollId` | `string` | Yes |

Send as a transfer memo:

```json
{"hive_stream":{"contract":"payroll","action":"fundPayroll","payload":{"payrollId":"example-1"}}}
```

### runPayroll

- **Trigger:** `custom_json`, `time`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `payrollId` | `string` | Yes |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"payroll","action":"runPayroll","payload":{"payrollId":"example-1"}}}
```

### withdrawPayroll

- **Trigger:** `custom_json`

**Payload**

_No payload validation defined for this action._

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"payroll","action":"withdrawPayroll","payload":{}}}
```
