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
{"hive_stream":{"contract":"ticketing","action":"createEvent","payload":{"eventId":"example-1","title":"Example","venue":"Example text","startsAt":"2030-01-01T00:00:00.000Z","ticketPrice":"1.000","asset":"HIVE","capacity":1}}}
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
{"hive_stream":{"contract":"ticketing","action":"purchaseTicket","payload":{"eventId":"example-1","ticketId":"example-1"}}}
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
{"hive_stream":{"contract":"ticketing","action":"checkInTicket","payload":{"ticketId":"example-1"}}}
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
{"hive_stream":{"contract":"ticketing","action":"refundTicket","payload":{"ticketId":"example-1"}}}
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
{"hive_stream":{"contract":"ticketing","action":"transferTicket","payload":{"ticketId":"example-1","to":"alice"}}}
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
{"hive_stream":{"contract":"ticketing","action":"listTicket","payload":{"ticketId":"example-1","price":"1.000"}}}
```

### unlistTicket

- **Trigger:** `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `ticketId` | `string` | Yes |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"ticketing","action":"unlistTicket","payload":{"ticketId":"example-1"}}}
```

### buyTicketDirect

- **Trigger:** `transfer`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `ticketId` | `string` | Yes |

Send as a transfer memo:

```json
{"hive_stream":{"contract":"ticketing","action":"buyTicketDirect","payload":{"ticketId":"example-1"}}}
```
