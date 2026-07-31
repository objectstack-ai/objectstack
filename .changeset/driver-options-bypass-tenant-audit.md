---
"@objectstack/spec": patch
"@objectstack/driver-sql": patch
"@objectstack/driver-sqlite-wasm": patch
"@objectstack/driver-memory": patch
---

fix(spec,drivers): `bypassTenantAudit` becomes a declared driver option, and `findOne` stops accepting a bare id (#4311)

Three drivers built with `tsup` and tested with `vitest`, so no `tsc` had ever
read them. Onboarding them to the #4311 type-check ratchet surfaced 292 errors,
and most of what looked like sloppy test fixtures was the types being wrong.

**`DriverOptions.bypassTenantAudit` is now declared.** It has been live for a
long time without being on the schema: `SqlDriver.auditMissingTenant` reads it
to suppress the "tenant-scoped write without `tenantId`" warning, the driver's
own warning text tells callers to set it, `ObjectQLEngine` sets it for
system-context calls, and `service-settings` / `service-datasource` pass it on
every global-scope write. Because the schema never had it, the driver read it
through `(options as any)` and no caller was type-checked. The declaration
states the limit as well: it silences a diagnostic and MUST NOT change which
rows a write touches — suppressing an audit warning is not a permission.

The same cast covered `timezone`, `tenantId`, `tenantIds` and `preserveAudit`,
all long since declared. Those reads now go through `DriverOptions`, so the next
undeclared option fails the build instead of hiding behind an existing cast.

**`SqlDriver.findOne(object, id)` is removed.** An undeclared
`typeof query === 'string' | 'number'` branch accepted a bare id. It was on no
contract, nothing outside that package's own tests used it, and the other two
drivers answered the identical call differently — `MemoryDriver` spreads the
string into `{0:'t',1:'1'}`, `MongoDBDriver` reads `query.where` as `undefined`
and returns an arbitrary row. It also bypassed the shared `findRows()` path, so
it skipped field selection, temporal coercion, unknown-column recovery and the
`singleRowLookup` ORDER BY decision. Spell an id lookup as the query it is:

```ts
- await driver.findOne('task', 't1');
+ await driver.findOne('task', { object: 'task', where: { id: 't1' } });
```

**`SqlDriver.initObjects` declares the `tenancy` it consumes.** Each object is
fed to `computeAndRecordTenantField`, which reads `obj.tenancy` to pick the
tenant column and to set or clear the sticky explicit-opt-out — but the
parameter type listed only `{ name, fields }`, so a caller that spelled the key
correctly was rejected while the driver read it anyway.
`registerExternalObject` already had it.

**`AnalyticsQueryInput` joins `AnalyticsQuery`.** `timezone` is
`.default('UTC')`, so the parsed type requires it and an authored literal does
not have it — the same two-tier split `QueryInput`/`QueryAST` already names on
the query side. `InMemoryDriver.create`/`bulkCreate` also declare their
`IDataDriver` return types; without them TS inferred the literal the method
builds and every other column of the created row disappeared from the caller's
view.

One silent runtime bug fell out of the same pass: a driver test asked for
`orderBy: [['id', 'asc']]`, the driver reads `item.field`, a tuple has none, and
the sort never reached SQL. The tuple spelling appears nowhere else.
