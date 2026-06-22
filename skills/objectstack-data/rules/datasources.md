# Datasources & Federation

A **datasource** (`defineDatasource`, a `*.datasource.ts` metadata file) is a
connection to a data store. Objects route to one via their `datasource` field
(default: `'default'`). Most apps need only the `default` datasource; declare more
to read/write a **separate** or **external** database.

Full field reference: `node_modules/@objectstack/spec/src/data/datasource.zod.ts`.
Narrative guide: `content/docs/guides/external-datasources.mdx`.

## `schemaMode` — who owns the schema

| Mode | Meaning |
|:--|:--|
| `managed` (default) | ObjectStack owns the schema; DDL + migrations allowed. |
| `external` | A mature external DB ObjectStack does **not** own; DDL forbidden; boot mismatch **fails**. |
| `validate-only` | Like `external`, but a mismatch **warns** instead of failing boot. |

`external` settings are required iff `schemaMode !== 'managed'` (and forbidden otherwise).

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
- ❌ **Never set `field.columnName` on an external object.** The driver's query
  pipeline ignores it for federated objects, so it is a silent dual-source trap.
  `os build` / `os validate` **rejects** it with a clear error. (`field.columnName`
  on **managed** objects is unaffected.)

## Auto-connect (no `onEnable`)

A declared datasource is built into a live driver, connected, and its federated
objects' read metadata registered **automatically at boot** — no `onEnable` /
`ctx.drivers.register`. It auto-connects when **meaningfully addressed**:

1. it is **external** (`schemaMode !== 'managed'`), **or**
2. an object **explicitly** binds via `object.datasource === <name>`, **or**
3. it sets **`autoConnect: true`**.

A `managed` datasource that nothing explicitly binds (e.g. only referenced by a
`datasourceMapping` rule) stays **metadata-only** — visible but not connected — so
existing apps are unchanged. Set `autoConnect: true` to force a live connection.

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
