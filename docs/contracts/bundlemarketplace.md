# bundlemarketplace

Fixed-price bundle storefronts with inventory tracking.

**Category:** commerce

```ts
import { createBundleMarketplaceContract } from 'hive-stream';

await streamer.registerContract(createBundleMarketplaceContract());
```

::: tip SQL adapter
Most built-in contracts persist state in SQL tables and require a SQL-capable adapter (SQLite or PostgreSQL).
:::

## Options

| Option | Type | Required |
| --- | --- | --- |
| `name` | `string` | No |

## Actions

### createBundle

- **Trigger:** `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `bundleId` | `string` | Yes |
| `title` | `string` | Yes |
| `price` | `string` | Yes |
| `asset` | `string` | Yes |
| `items` | `string[]` | Yes |
| `inventory` | `number` | No |
| `metadata` | `record` | No |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"bundlemarketplace","action":"createBundle","payload":{"bundleId":"example-1","title":"Example","price":"1.000","asset":"HIVE","items":["example-1"]}}}
```

### updateBundle

- **Trigger:** `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `bundleId` | `string` | Yes |
| `title` | `string` | No |
| `price` | `string` | No |
| `inventory` | `number` | No |
| `active` | `boolean` | No |
| `metadata` | `record` | No |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"bundlemarketplace","action":"updateBundle","payload":{"bundleId":"example-1"}}}
```

### buyBundle

- **Trigger:** `transfer`, `recurrent_transfer`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `bundleId` | `string` | Yes |

Send as a transfer memo:

```json
{"hive_stream":{"contract":"bundlemarketplace","action":"buyBundle","payload":{"bundleId":"example-1"}}}
```

### fulfillPurchase

- **Trigger:** `custom_json`

**Payload**

| Field | Type | Required |
| --- | --- | --- |
| `purchaseId` | `number` | Yes |
| `notes` | `string` | No |

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"bundlemarketplace","action":"fulfillPurchase","payload":{"purchaseId":1}}}
```
