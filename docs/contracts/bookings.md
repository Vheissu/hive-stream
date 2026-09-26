# bookings

Reservable listings with paid booking windows and confirmations.

**Category:** commerce

```ts
import { createBookingContract } from 'hive-stream';

await streamer.registerContract(createBookingContract());
```

::: tip SQL adapter
This contract keeps its state in SQL tables and needs a SQL-capable adapter (SQLite or PostgreSQL). Registering it on MongoDB fails.
:::

## Options

| Option | Type | Required |
| --- | --- | --- |
| `name` | `string` | No |

## Actions

### createListing

- **Trigger:** `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `listingId` | `string` | Yes |
| `title` | `string` | Yes |
| `price` | `string` | Yes |
| `asset` | `string` | Yes |
| `durationMinutes` | `number` | Yes |
| `cancellationHours` | `number` | No |
| `metadata` | `record` | No |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"bookings","action":"createListing","payload":{"listingId":"example-1","title":"Example","price":"1.000","asset":"HIVE","durationMinutes":24}}}
```

### reserve

- **Trigger:** `transfer`, `recurrent_transfer`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `listingId` | `string` | Yes |
| `reservationId` | `string` | Yes |
| `startAt` | `string` | Yes |
| `note` | `string` | No |

Send as a transfer memo:

```json
{"hive_stream":{"contract":"bookings","action":"reserve","payload":{"listingId":"example-1","reservationId":"example-1","startAt":"2030-01-01T00:00:00.000Z"}}}
```

### confirmReservation

- **Trigger:** `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `reservationId` | `string` | Yes |
| `reason` | `string` | No |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"bookings","action":"confirmReservation","payload":{"reservationId":"example-1"}}}
```

### cancelReservation

- **Trigger:** `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `reservationId` | `string` | Yes |
| `reason` | `string` | No |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"bookings","action":"cancelReservation","payload":{"reservationId":"example-1"}}}
```

### completeReservation

- **Trigger:** `custom_json`, `time`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `reservationId` | `string` | Yes |
| `reason` | `string` | No |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"bookings","action":"completeReservation","payload":{"reservationId":"example-1"}}}
```
