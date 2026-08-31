# Datasources & Federation

A **datasource** (`defineDatasource`, a `*.datasource.ts` metadata file) is a
connection to a data store. Objects route to one via their `datasource` field
(default: `'default'`). Most apps need only the `default` datasource; declare more
to read/write a **separate** or **external** database.

Full field reference: `node_modules/@objectstack/spec/src/data/datasource.zod.ts`.

## `schemaMode` — who owns the schema

| Mode | Meaning |
|:--|:--|
| `managed` (default) | ObjectStack owns the schema; DDL + migrations allowed. |
| `external` | A mature external DB ObjectStack does **not** own; DDL forbidden; boot mismatch **fails**. |
| `validate-only` | Like `external`, but a mismatch **warns** instead of failing boot. |

`external` settings are **required** when `schemaMode !== 'managed'`.

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

- ✅ Map remote columns with **`external.columnMap`** (`remoteColumn → localField`).
- ❌ **`field.columnName` does not exist — on ANY object.** It was removed in the
  16.x line (the SQL driver hardcodes the physical column to the field key, so a
  custom name was ignored), and authoring it is a parse error everywhere, not
  only on a federated object.

## Auto-connect (no `onEnable`)

A declared datasource is built into a live driver, connected, and its federated
objects' read metadata registered **automatically at boot** — no `onEnable` /
`ctx.drivers.register`. It auto-connects when **meaningfully addressed**:

1. it is **external** (`schemaMode !== 'managed'`), **or**
2. an object **explicitly** binds via `object.datasource === <name>`, **or**
3. it sets **`autoConnect: true`**, **or**
4. a **`datasourceMapping` rule routes at least one object to it**.

A `managed` datasource that nothing routes to stays **metadata-only** — visible but
not connected. Set `autoConnect: true` to force a live connection.

⚠️ A `datasourceMapping` rule is **routing, not a hint**. A rule pointing at a
datasource that cannot be connected fails the boot, and a query against a mapped
object throws instead of silently resolving the default store. Do not declare a
mapping you do not mean.

> `onEnable` + `ctx.drivers.register(driver)` remains supported only as an escape
> hatch for drivers built dynamically at runtime; it is idempotent with auto-connect.

## Credentials — fail-closed

Never inline a password. Use `external.credentialsRef` and store the secret in the
secret store; it is resolved **at connect, before the driver is built**. A declared
`credentialsRef` that cannot be resolved/decrypted (or no secret store configured)
leaves the datasource **unconnected with a clear error** — never connected without
the credential.

## Writes — double opt-in

Federation is read-only by default. To write, **both** gates must be on:
`datasource.external.allowWrites: true` **and** the object's `external.writable: true`.
With either off, insert/update/delete on the federated object is rejected.
