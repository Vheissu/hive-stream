# multisigtreasury

Multisig vaults, proposal approvals, and execution readiness.

```ts
import { createMultisigTreasuryContract } from 'hive-stream';

await streamer.registerContract(createMultisigTreasuryContract());
```

::: tip SQL adapter
Most built-in contracts persist state in SQL tables and require a SQL-capable adapter (SQLite or PostgreSQL).
:::

## Actions

### createVault

- **Trigger:** `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `vaultId` | `string` | Yes |
| `title` | `string` | Yes |
| `signers` | `string[]` | Yes |
| `threshold` | `number` | Yes |
| `metadata` | `record` | No |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"multisigtreasury","action":"createVault","payload":{}}}
```

### proposeTransfer

- **Trigger:** `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `vaultId` | `string` | Yes |
| `proposalId` | `string` | Yes |
| `title` | `string` | Yes |
| `to` | `string` | Yes |
| `amount` | `string` | Yes |
| `asset` | `string` | Yes |
| `memo` | `string` | No |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"multisigtreasury","action":"proposeTransfer","payload":{}}}
```

### approveProposal

- **Trigger:** `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `proposalId` | `string` | Yes |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"multisigtreasury","action":"approveProposal","payload":{}}}
```

### cancelProposal

- **Trigger:** `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `proposalId` | `string` | Yes |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"multisigtreasury","action":"cancelProposal","payload":{}}}
```

### markExecuted

- **Trigger:** `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `proposalId` | `string` | Yes |
| `txId` | `string` | No |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"multisigtreasury","action":"markExecuted","payload":{}}}
```
