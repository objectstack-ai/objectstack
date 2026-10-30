# Datasources & Federation

A **datasource** (`defineDatasource`, a `*.datasource.ts` file) is a
connection to a data store. Objects route to one via their `datasource` field
(default: `'default'`). `default` is host-reserved: the host connects it from
`OS_DATABASE_URL`, and a stack that declares a datasource named `default` is
refused. Declare a datasource under its own name only to read/write a
**separate** or **external** store.

Full field reference: `node_modules/@objectstack/spec/src/data/datasource.zod.ts`.

## `schemaMode` — who owns the schema

| Mode | Meaning |
|:--|:--|
| `managed` (default) | ObjectStack owns the schema; DDL + migrations allowed. |
| `external` | A mature external DB ObjectStack does **not** own; DDL forbidden; boot mismatch **fails**. |
| `validate-only` | Like `external`, but a mismatch **warns** instead of failing boot. |

## Federated (external) objects

An object on an external datasource binds to its remote table via `external`:

```typescript
ObjectSchema.create({
  name: 'ext_customer',
  datasource: 'warehouse',
  external: {
    remoteName: 'customers',        // remote TABLE (object name may differ)
    // remoteSchema: 'public',      // optional schema/namespace (pg/mysql)
    // columnMap: { cust_region: 'region' }, // remoteColumn → localField
    // writable: true,              // per-object write opt-in (see below)
  },
  fields: { id: { type: 'text' }, name: { type: 'text' }, region: { type: 'text' } },
});
```

### ✅ / ❌ Column mapping (ADR-0062 D7)

- ✅ Map remote columns with **`external.columnMap`**.
- ❌ **`field.columnName` does not exist — on ANY object.** Authoring it is a
  parse error everywhere, not only on a federated object.

## Auto-connect (no `onEnable`)

A declared datasource is connected, and its federated objects registered,
**automatically at boot** when it is **meaningfully addressed**:

1. it is **external** (`schemaMode !== 'managed'`), **or**
2. an object **explicitly** binds via `object.datasource === <name>`, **or**
3. it sets **`autoConnect: true`**, **or**
4. a **`datasourceMapping` rule routes at least one object to it**.

A `managed` datasource nothing routes to stays **metadata-only** (not connected).

⚠️ A `datasourceMapping` rule is **routing, not a hint**. A rule pointing at a
datasource that cannot be connected fails the boot, and a query against a mapped
object throws.

> `ctx.drivers.register(driver)` in `onEnable` is only an escape hatch for a
> runtime-built driver; idempotent with auto-connect.

## Credentials — one channel, fail-closed

Never inline a password. `external` names **one** credential channel:

- **`credentialsRef`** — a secret-store handle, resolved at connect, before the
  driver is built.
- **`connector`** — an API-backed datasource (a plugin driver such as
  `@objectstack/driver-odata`) borrows the credential of a `connectors` instance
  with a `provider` and an `auth` other than `none`:
  `schemaMode: 'external', external: { connector: 'erp_api' }`. Refused beside
  `credentialsRef`, on a built-in driver, on a `managed` datasource, and naming
  an undeclared instance (at `defineStack`, else at connect).

No secret store, an unresolvable handle, a disabled instance or no automation
service leaves the datasource **unconnected with a clear error**. A connector
credential not set yet answers `503` per request.

## Writes — double opt-in

Federation is read-only by default. To write, **both** gates must be on:
`datasource.external.allowWrites: true` **and** the object's `external.writable: true`.
Otherwise every write to the object is rejected.
