# giftcards

Gift card issuance, redemption, and cancellation.

**Category:** commerce

```ts
import { createGiftCardContract } from 'hive-stream';

await streamer.registerContract(createGiftCardContract());
```

::: tip SQL adapter
This contract keeps its state in SQL tables and needs a SQL-capable adapter (SQLite or PostgreSQL). Registering it on MongoDB fails.
:::

## Options

| Option | Type | Required |
| --- | --- | --- |
| `name` | `string` | No |

## Actions

### issueGiftCard

- **Trigger:** `transfer`, `recurrent_transfer`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `code` | `string` | Yes |
| `recipient` | `string` | No |
| `message` | `string` | No |
| `expiresAt` | `string` | No |

Send as a transfer memo:

```json
{"hive_stream":{"contract":"giftcards","action":"issueGiftCard","payload":{"code":"example-1"}}}
```

### redeemGiftCard

- **Trigger:** `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `code` | `string` | Yes |
| `amount` | `string` | No |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"giftcards","action":"redeemGiftCard","payload":{"code":"example-1"}}}
```

### cancelGiftCard

- **Trigger:** `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `code` | `string` | Yes |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"giftcards","action":"cancelGiftCard","payload":{"code":"example-1"}}}
```
