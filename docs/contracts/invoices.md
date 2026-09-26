# invoices

Invoices with partial payments, recurring payments, and overdue sweeps.

**Category:** commerce

```ts
import { createInvoiceContract } from 'hive-stream';

await streamer.registerContract(createInvoiceContract());
```

::: tip SQL adapter
Most built-in contracts persist state in SQL tables and require a SQL-capable adapter (SQLite or PostgreSQL).
:::

## Options

| Option | Type | Required |
| --- | --- | --- |
| `name` | `string` | No |

## Actions

### createInvoice

- **Trigger:** `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `invoiceId` | `string` | Yes |
| `payer` | `string` | Yes |
| `title` | `string` | Yes |
| `description` | `string` | No |
| `amount` | `string` | Yes |
| `asset` | `string` | Yes |
| `dueAt` | `string` | No |
| `allowPartial` | `boolean` | No |
| `metadata` | `record` | No |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"invoices","action":"createInvoice","payload":{"invoiceId":"example-1","payer":"alice","title":"Example","amount":"1.000","asset":"HIVE"}}}
```

### payInvoice

- **Trigger:** `transfer`, `recurrent_transfer`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `invoiceId` | `string` | Yes |

Send as a transfer memo:

```json
{"hive_stream":{"contract":"invoices","action":"payInvoice","payload":{"invoiceId":"example-1"}}}
```

### cancelInvoice

- **Trigger:** `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `invoiceId` | `string` | Yes |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"invoices","action":"cancelInvoice","payload":{"invoiceId":"example-1"}}}
```

### closeOverdueInvoices

- **Trigger:** `custom_json`, `time`

**Payload**

_No payload validation defined for this action._

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"invoices","action":"closeOverdueInvoices","payload":{}}}
```
