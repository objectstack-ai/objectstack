# @objectstack/driver-odata

An OData v4 datasource driver for ObjectStack. Declare a datasource over an OData
service (SAP S/4HANA, Dynamics 365, Dataverse, any CSDL 4.0 service), bind objects to
its entity sets, and every view, form, permission and hook works on them, live. No row
is stored on the platform side, and no code is written per entity set.

The driver is a **plugin driver**: a server plugin publishes it as the service
`driver.<name>`. Its id is not a built-in one, so the engine holds it behind its
external-driver floor and re-applies every query to the rows the service returns. The
driver pushes down what it can translate and only ever asks the service a wider
question; see [Virtual objects](https://objectstack.ai/docs/data-modeling/virtual-objects).
The guide is [OData datasources](https://objectstack.ai/docs/data-modeling/odata-datasources):
checking a service, credentials, what the service is asked, writes and failures.

## Usage

```typescript
import { defineStack } from '@objectstack/spec';
import { createODataDriverPlugin } from '@objectstack/driver-odata';

export const plugins = [
  createODataDriverPlugin({
    name: 'erp',                                   // the datasource it serves
    serviceRoot: 'https://erp.example.com/odata/v4/sales/',
    auth: { scheme: 'bearer' },                    // or { scheme: 'basic', username: 'svc_reader' }
    secrets: datasourceSecretBinder,               // the host's datasource secret store
  }),
];

export default defineStack({
  manifest: { id: 'com.example.sales', name: 'Sales', version: '1.0.0', type: 'app' },
  datasources: [{
    name: 'erp',
    driver: 'erp',
    schemaMode: 'external',
    config: {},
    external: {
      allowWrites: true,
      credentialsRef: 'sys_secret:sec_erp',        // the bearer token / basic password
      validation: { onMismatch: 'warn', checkOnBoot: false },
    },
  }],
  objects: [{
    name: 'sales_order',
    label: 'Sales order',
    datasource: 'erp',
    sharingModel: 'public_read_write',
    external: {
      remoteName: 'SalesOrders',                   // the entity set
      writable: true,
      columnMap: { SalesOrderID: 'order_number', CustomerName: 'customer_name', NetAmount: 'net_amount' },
    },
    fields: {
      order_number: { type: 'text', label: 'Order' },
      customer_name: { type: 'text', label: 'Customer' },
      net_amount: { type: 'number', label: 'Net amount' },
    },
  }],
});
```

## Config

| Key | Default | Meaning |
| :--- | :--- | :--- |
| `name` | `odata` | The datasource name, the driver name and its `driver.<name>` service suffix. |
| `serviceRoot` | — | The service root URL (http or https, no credentials, no query). |
| `version` | `4.0` | The protocol version. Only the v4 dialect ships. |
| `auth` | `{ scheme: 'none' }` | `none`, `bearer`, or `basic` with a `username`. The secret is the datasource's `external.credentialsRef`. Leave it `none` when the datasource borrows a connector instance's credential (below). |
| `pageSize` | `500` | Rows asked for per server page (`Prefer: odata.maxpagesize`). |
| `requestTimeoutMs` | `30000` | Per-request timeout. |

## Borrowing a connector instance's credential

When a connector instance already authorizes the vendor, the datasource can name it in
`external.connector` instead of binding a secret of its own (ADR-0015 amendment D7): one
credential, set under Setup → Connector credentials, serves the connector's flow actions and
the datasource's records.

```typescript
connectors: [{
  name: 'erp_api', type: 'api', provider: 'openapi', providerConfig: { spec: './erp-openapi.json' },
  auth: { type: 'bearer', credentialRef: 'erp_token' },
}],
datasources: [{
  name: 'erp', driver: 'erp', schemaMode: 'external', config: {},
  external: { connector: 'erp_api' },                // no credentialsRef: exactly one channel
}],
```

The plugin is created with `auth` left at `none`: the instance's `auth` decides how the credential
is sent (a bearer token, basic auth, or an API key as a header or a query parameter). It borrows
from the `connector-credential-source` service, which `@objectstack/service-automation`
registers, at the first request, and presents it on every request through
`callWithBorrowedCredential`: refreshed when it has expired, refreshed once and retried on a
`401`, and refused with a `503` naming the instance when the fresh one is refused too. A stack with
no automation service, an instance that cannot lend (not declared, disabled, no `auth`), an `auth`
scheme set on the plugin beside the connector, and a `credentialsRef` beside it all refuse the
request instead of sending it.

## What is pushed down

`$filter`: `$eq`, `$ne`, `$gt`, `$gte`, `$lt`, `$lte`, `$between`, `$in`, `$nin`, `$null`,
`$contains`, `$startsWith`, `$endsWith` and `$icontains` (ASCII comparands), under `$and`
and `$or`. Text ordering and negation, `$not`, `$like`, `$exists`, field references and
collection-valued properties are left to the engine. Also `$orderby`, `$select`, `$top`,
`$skip`, `@odata.nextLink` paging and `$count=true`.

## Writes

`create`, `update` and `delete` by key, with `If-Match` from the row's last read. A
refusal by the service answers `422 EXTERNAL_WRITE_REFUSED` with its message. `upsert`,
the bulk verbs and transactions are refused by name.
