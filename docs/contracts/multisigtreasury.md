# multisigtreasury

Multisig vaults, proposal approvals, and execution readiness.

**Category:** governance

```ts
import { createMultisigTreasuryContract } from 'hive-stream';

await streamer.registerContract(createMultisigTreasuryContract());
```

::: tip SQL adapter
This contract keeps its state in SQL tables and needs a SQL-capable adapter (SQLite or PostgreSQL). Registering it on MongoDB fails.
:::

## Options

| Option | Type | Required |
| --- | --- | --- |
| `name` | `string` | No |

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
{"hive_stream":{"contract":"multisigtreasury","action":"createVault","payload":{"vaultId":"example-1","title":"Example","signers":["alice"],"threshold":1}}}
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
{"hive_stream":{"contract":"multisigtreasury","action":"proposeTransfer","payload":{"vaultId":"example-1","proposalId":"example-1","title":"Example","to":"alice","amount":"1.000","asset":"HIVE"}}}
```

### approveProposal

- **Trigger:** `custom_json`
- **Requires active key signature**

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `proposalId` | `string` | Yes |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"multisigtreasury","action":"approveProposal","payload":{"proposalId":"example-1"}}}
```

### cancelProposal

- **Trigger:** `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `proposalId` | `string` | Yes |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"multisigtreasury","action":"cancelProposal","payload":{"proposalId":"example-1"}}}
```

### markExecuted

- **Trigger:** `custom_json`
- **Requires active key signature**

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `proposalId` | `string` | Yes |
| `txId` | `string` | No |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"multisigtreasury","action":"markExecuted","payload":{"proposalId":"example-1"}}}
```
