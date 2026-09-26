# hivenft

NFT minting, transfers, market listings, and direct peer-to-peer sales.

**Category:** assets

```ts
import { createNFTContract } from 'hive-stream';

await streamer.registerContract(createNFTContract());
```

::: tip SQL adapter
This contract keeps its state in SQL tables and needs a SQL-capable adapter (SQLite or PostgreSQL). Registering it on MongoDB fails.
:::

## Options

| Option | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | `string` | No |  |
| `account` | `string` | No | Marketplace account that receives `buyNFT` payments and pays sellers and royalties. Defaults to the streamer's configured username. |

## Actions

### createCollection

- **Trigger:** `custom_json`

**Payload**

_No payload validation defined for this action._

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"hivenft","action":"createCollection","payload":{}}}
```

### mintNFT

- **Trigger:** `custom_json`

**Payload**

_No payload validation defined for this action._

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"hivenft","action":"mintNFT","payload":{}}}
```

### mintBatchNFT

- **Trigger:** `custom_json`

**Payload**

_No payload validation defined for this action._

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"hivenft","action":"mintBatchNFT","payload":{}}}
```

### updateNFT

- **Trigger:** `custom_json`

**Payload**

_No payload validation defined for this action._

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"hivenft","action":"updateNFT","payload":{}}}
```

### transferNFT

- **Trigger:** `custom_json`

**Payload**

_No payload validation defined for this action._

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"hivenft","action":"transferNFT","payload":{}}}
```

### burnNFT

- **Trigger:** `custom_json`

**Payload**

_No payload validation defined for this action._

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"hivenft","action":"burnNFT","payload":{}}}
```

### listNFT

- **Trigger:** `custom_json`

**Payload**

_No payload validation defined for this action._

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"hivenft","action":"listNFT","payload":{}}}
```

### unlistNFT

- **Trigger:** `custom_json`

**Payload**

_No payload validation defined for this action._

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"hivenft","action":"unlistNFT","payload":{}}}
```

### buyNFT

- **Trigger:** `transfer`

**Payload**

_No payload validation defined for this action._

Send as a transfer memo:

```json
{"hive_stream":{"contract":"hivenft","action":"buyNFT","payload":{}}}
```

### buyNFTDirect

- **Trigger:** `transfer`

**Payload**

_No payload validation defined for this action._

Send as a transfer memo:

```json
{"hive_stream":{"contract":"hivenft","action":"buyNFTDirect","payload":{}}}
```

### getTokenInfo

- **Trigger:** `custom_json`

**Payload**

_No payload validation defined for this action._

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"hivenft","action":"getTokenInfo","payload":{}}}
```

### getCollectionInfo

- **Trigger:** `custom_json`

**Payload**

_No payload validation defined for this action._

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"hivenft","action":"getCollectionInfo","payload":{}}}
```

### getUserTokens

- **Trigger:** `custom_json`

**Payload**

_No payload validation defined for this action._

Send as custom JSON (id: your configured `JSON_ID`):

```json
{"hive_stream":{"contract":"hivenft","action":"getUserTokens","payload":{}}}
```
