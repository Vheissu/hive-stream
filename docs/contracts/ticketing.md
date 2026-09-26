# ticketing

Event ticketing with purchases, check-ins, refunds, transfers, and resale.

**Category:** commerce

```ts
import { createTicketingContract } from 'hive-stream';

await streamer.registerContract(createTicketingContract());
```

::: tip SQL adapter
Most built-in contracts persist state in SQL tables and require a SQL-capable adapter (SQLite or PostgreSQL).
:::

## Options

| Option | Type | Required |
| --- | --- | --- |
| `name` | `string` | No |

## Actions

### createEvent

- **Trigger:** `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `eventId` | `string` | Yes |
| `title` | `string` | Yes |
| `venue` | `string` | Yes |
| `startsAt` | `string` | Yes |
| `ticketPrice` | `string` | Yes |
| `asset` | `string` | Yes |
| `capacity` | `number` | Yes |
| `metadata` | `record` | No |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"ticketing","action":"createEvent","payload":{}}}
```

### purchaseTicket

- **Trigger:** `transfer`, `recurrent_transfer`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `eventId` | `string` | Yes |
| `ticketId` | `string` | Yes |

Send as a transfer memo:

```json
{"hive_stream":{"contract":"ticketing","action":"purchaseTicket","payload":{}}}
```

### checkInTicket

- **Trigger:** `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `ticketId` | `string` | Yes |
| `note` | `string` | No |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"ticketing","action":"checkInTicket","payload":{}}}
```

### refundTicket

- **Trigger:** `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `ticketId` | `string` | Yes |
| `note` | `string` | No |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"ticketing","action":"refundTicket","payload":{}}}
```

### transferTicket

- **Trigger:** `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `ticketId` | `string` | Yes |
| `to` | `string` | Yes |
| `note` | `string` | No |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"ticketing","action":"transferTicket","payload":{}}}
```

### listTicket

- **Trigger:** `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `ticketId` | `string` | Yes |
| `price` | `string` | Yes |
| `asset` | `string` | No |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"ticketing","action":"listTicket","payload":{}}}
```

### unlistTicket

- **Trigger:** `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `ticketId` | `string` | Yes |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"ticketing","action":"unlistTicket","payload":{}}}
```

### buyTicketDirect

- **Trigger:** `transfer`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `ticketId` | `string` | Yes |

Send as a transfer memo:

```json
{"hive_stream":{"contract":"ticketing","action":"buyTicketDirect","payload":{}}}
```
