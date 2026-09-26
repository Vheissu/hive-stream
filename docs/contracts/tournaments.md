# tournaments

Game tournaments with entry fees, registration windows, oracle-submitted scores, tie handling and basis-point prize splits.

**Category:** games

```ts
import { createTournamentContract } from 'hive-stream';

await streamer.registerContract(createTournamentContract({ account: '...' }));
```

::: tip SQL adapter
Most built-in contracts persist state in SQL tables and require a SQL-capable adapter (SQLite or PostgreSQL).
:::

## Options

| Option | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | `string` | No |  |
| `account` | `string` | Yes | Account that receives entry fees and pays prizes. Entries sent elsewhere are rejected. |
| `feeBps` | `number` | No | House fee taken from the prize pool, in basis points (max 3000). |
| `feeAccount` | `string` | No | Where the house fee is sent. Defaults to keeping it in `account`. |
| `oracles` | `string[]` | No | Accounts allowed to submit scores for any tournament, in addition to each tournament's oracle. |
| `organizers` | `string[]` | No | When set, only these accounts can create tournaments. |

## Actions

### createTournament

Create a tournament with an entry fee, registration window, player limits and a basis-point prize split.

- **Trigger:** `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `tournamentId` | `string` | Yes |
| `title` | `string` | Yes |
| `asset` | `string` | Yes |
| `entryFee` | `string` | Yes |
| `registrationOpensAt` | `string` | No |
| `registrationClosesAt` | `string` | Yes |
| `endsAt` | `string` | No |
| `minPlayers` | `number` | No |
| `maxPlayers` | `number` | No |
| `prizeSplitBps` | `number[]` | Yes |
| `oracle` | `string` | No |
| `scoreOrder` | `"desc" \| "asc"` | No |
| `tieBreak` | `"split" \| "earliest"` | No |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"tournaments","action":"createTournament","payload":{}}}
```

### enter

Enter by transferring the exact entry fee; wrong assets, amounts, duplicates and closed registrations are refunded.

- **Trigger:** `transfer`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `tournamentId` | `string` | Yes |

Send as a transfer memo:

```json
{"hive_stream":{"contract":"tournaments","action":"enter","payload":{}}}
```

### submitScore

Oracle-only: record a player score after registration closes.

- **Trigger:** `custom_json`
- **Requires active key signature**

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `tournamentId` | `string` | Yes |
| `player` | `string` | Yes |
| `score` | `number \| string` | Yes |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"tournaments","action":"submitScore","payload":{}}}
```

### submitScores

Oracle-only: record up to 100 scores in one operation.

- **Trigger:** `custom_json`
- **Requires active key signature**

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `tournamentId` | `string` | Yes |
| `scores` | `object[]` | Yes |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"tournaments","action":"submitScores","payload":{}}}
```

### finalize

Rank players, take the house fee and pay prizes; under-subscribed tournaments are cancelled and refunded.

- **Trigger:** `custom_json`
- **Requires active key signature**

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `tournamentId` | `string` | Yes |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"tournaments","action":"finalize","payload":{}}}
```

### finalizeDue

Scheduled sweep that finalizes tournaments past their end time.

- **Trigger:** `time`

**Payload**

_This action takes an empty payload._

### cancelTournament

Organizer-only: cancel and refund every entry.

- **Trigger:** `custom_json`
- **Requires active key signature**

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `tournamentId` | `string` | Yes |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"tournaments","action":"cancelTournament","payload":{}}}
```
