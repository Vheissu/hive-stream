# bookings

Reservable listings with paid booking windows and confirmations.

**Category:** commerce

```ts
import { createBookingContract } from 'hive-stream';

await streamer.registerContract(createBookingContract());
```

::: tip SQL adapter
Most built-in contracts persist state in SQL tables and require a SQL-capable adapter (SQLite or PostgreSQL).
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
{"hive_stream":{"contract":"bookings","action":"createListing","payload":{}}}
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
{"hive_stream":{"contract":"bookings","action":"reserve","payload":{}}}
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
{"hive_stream":{"contract":"bookings","action":"confirmReservation","payload":{}}}
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
{"hive_stream":{"contract":"bookings","action":"cancelReservation","payload":{}}}
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
{"hive_stream":{"contract":"bookings","action":"completeReservation","payload":{}}}
```
