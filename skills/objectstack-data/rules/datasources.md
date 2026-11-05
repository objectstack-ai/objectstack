# Datasources & Federation

A **datasource** (`defineDatasource`, a `*.datasource.ts` file) is a
connection to a data store. Objects route to one via their `datasource` field.
`default` is host-reserved (connected from `OS_DATABASE_URL`; declaring one
named `default` is refused). Declare one under its own name only for a
**separate** or **external** store.

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
  },
  fields: { id: { type: 'text' }, name: { type: 'text' }, region: { type: 'text' } },
});
```

- ❌ **`field.columnName` does not exist — on ANY object.** Authoring it is a
  parse error everywhere, not only on a federated object.
- **Walled posture (`OS_TENANCY_POSTURE` `isolated`/`group`): every external
  object states its organization scope** — its own `organization_id` field (or
  `columnMap` onto it), `tenancy: { enabled: false }` (shared), or
  `systemFields: { tenant: false }`. None ⇒ the boot is refused by name;
  `tenancy.tenantField` is refused there too.

## Auto-connect (no `onEnable`)

A declared datasource is connected **automatically at boot** when it is
**meaningfully addressed**:

1. it is **external** (`schemaMode !== 'managed'`), **or**
2. an object **explicitly** binds via `object.datasource === <name>`, **or**
3. it sets **`autoConnect: true`**, **or**
4. a **`datasourceMapping` rule routes at least one object to it**.

⚠️ A `datasourceMapping` rule is **routing, not a hint**: a target that cannot
be connected fails the boot, and a query against a mapped object throws.

## Credentials — fail-closed

Never inline a password. A code-declared datasource reads one at connect from
`OS_DATASOURCE_<NAME>_PASSWORD` (`NAME` = the name upper-cased) while the host
switch `OS_DATASOURCE_ENV_CREDENTIALS` is `on` (`os serve`/`start`/`dev` default
it on; a library composition is off). Operator caution: an installed package
may declare a datasource of any free name and so read that variable.
`external` may instead name **one** channel, which wins and never falls back
to the variable:

- **`credentialsRef`** — a secret-store handle, resolved at connect, before the
  driver is built.
- **`connector`** — an API-backed datasource (a plugin driver such as
  `@objectstack/driver-odata`) borrows the credential of a `connectors` instance
  with a `provider` and an `auth` other than `none`:
  `schemaMode: 'external', external: { connector: 'erp_api' }`. Refused beside
  `credentialsRef`, on a built-in driver, on a `managed` datasource, and naming
  an undeclared instance.

A missing store, handle, instance or automation service leaves the datasource
**unconnected with a clear error**; an unset connector credential answers `503`.

## Writes — double opt-in

Federation is read-only by default. To write, **both** gates must be on:
`datasource.external.allowWrites: true` **and** the object's `external.writable: true`.
