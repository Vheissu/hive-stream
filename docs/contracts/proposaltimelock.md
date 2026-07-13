# proposaltimelock

Timelocked governance queues with approvals and delays.

```ts
import { createProposalTimelockContract } from 'hive-stream';

await streamer.registerContract(createProposalTimelockContract());
```

::: tip SQL adapter
Most built-in contracts persist state in SQL tables and require a SQL-capable adapter (SQLite or PostgreSQL).
:::

## Actions

### createQueue

- **Trigger:** `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `queueId` | `string` | Yes |
| `title` | `string` | Yes |
| `approvers` | `string[]` | Yes |
| `threshold` | `number` | Yes |
| `minDelayHours` | `number` | Yes |
| `metadata` | `record` | No |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"proposaltimelock","action":"createQueue","payload":{}}}
```

### createProposal

- **Trigger:** `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `queueId` | `string` | Yes |
| `proposalId` | `string` | Yes |
| `title` | `string` | Yes |
| `actionType` | `string` | Yes |
| `actionPayload` | `record` | Yes |
| `note` | `string` | No |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"proposaltimelock","action":"createProposal","payload":{}}}
```

### approveProposal

- **Trigger:** `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `proposalId` | `string` | Yes |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"proposaltimelock","action":"approveProposal","payload":{}}}
```

### executeProposal

- **Trigger:** `custom_json`, `time`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `proposalId` | `string` | Yes |
| `executionRef` | `string` | No |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"proposaltimelock","action":"executeProposal","payload":{}}}
```

### cancelProposal

- **Trigger:** `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `proposalId` | `string` | Yes |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"proposaltimelock","action":"cancelProposal","payload":{}}}
```
