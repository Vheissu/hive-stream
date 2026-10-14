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

| Option | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | `string` | No |  |
| `account` | `string` | No | Account that receives reservation payments and refunds rejected ones (wrong amount or asset, overlaps, inactive listings). Refunds are signed with the app's active key, so this must be the app account. Defaults to the streamer username. |

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

Reserve a slot by paying the exact listing price; wrong amounts or assets, overlaps and inactive listings are refunded.

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

Listing owner confirms a pending reservation.

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

Owner or booker (within the cancellation window) cancels a pending or confirmed reservation.

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

Mark a pending or confirmed reservation completed (owner or scheduled).

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
