# proposaltimelock

Timelocked governance queues with approvals and delays.

**Category:** governance

```ts
import { createProposalTimelockContract } from 'hive-stream';

await streamer.registerContract(createProposalTimelockContract());
```

::: tip SQL adapter
This contract keeps its state in SQL tables and needs a SQL-capable adapter (SQLite or PostgreSQL). Registering it on MongoDB fails.
:::

## Options

| Option | Type | Required |
| --- | --- | --- |
| `name` | `string` | No |

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
{"hive_stream":{"contract":"proposaltimelock","action":"createQueue","payload":{"queueId":"example-1","title":"Example","approvers":["alice"],"threshold":1,"minDelayHours":24}}}
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
{"hive_stream":{"contract":"proposaltimelock","action":"createProposal","payload":{"queueId":"example-1","proposalId":"example-1","title":"Example","actionType":"example-1","actionPayload":{}}}}
```

### approveProposal

- **Trigger:** `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `proposalId` | `string` | Yes |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"proposaltimelock","action":"approveProposal","payload":{"proposalId":"example-1"}}}
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
{"hive_stream":{"contract":"proposaltimelock","action":"executeProposal","payload":{"proposalId":"example-1"}}}
```

### cancelProposal

- **Trigger:** `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `proposalId` | `string` | Yes |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"proposaltimelock","action":"cancelProposal","payload":{"proposalId":"example-1"}}}
```
