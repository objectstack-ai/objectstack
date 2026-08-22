---
"@objectstack/service-datasource": patch
---

Restore the introspected primary key in the persisted `external_catalog`
(#10676). `ExternalDatasourceService` reads `column.primaryKey` — the
`packages/spec` `IntrospectedColumn` spelling — but `plugin.ts` hands it the
driver's `introspectSchema()` result unmodified, and `SqlDriver` (and
`SqliteWasmDriver`, which extends it) speaks the other `IntrospectedColumn`
contract, from `packages/objectql/src/util.ts`: it sets `column.isPrimary` and
fills `table.primaryKeys`, never `column.primaryKey`.

Measured against a live SQLite database: for a table declared
`primary key (id)`, the driver's `id` column carries `isPrimary: true` and the
table carries `primaryKeys: ['id']`, while `primaryKey` is `undefined`. Because
`ExternalCatalogSchema` defaults `primaryKey` to `false`, `refreshCatalog`
persisted a catalog in which **every** column of **every** remote table claimed
not to be part of the remote key — so Studio's schema browser and the boot gate
read a catalog that shows no primary keys at all.

The seam now reads the union of all three signals (`primaryKey`, `isPrimary`,
`table.primaryKeys`) rather than any one of them. No in-tree producer uses a
`false` to negate a key another signal asserts, and taking the union means a
producer that fills only the table-level list — or only the per-column flag —
cannot lose half a composite key. No response or record shape changes: a field
that should always have carried the introspected value starts carrying it.

The regression pin drives the service off a **real** `SqlDriver.introspectSchema()`
result rather than a hand-written fixture. The pre-existing suite could not see
this defect precisely because it hand-wrote its fixture in the spec spelling, so
no test ever fed the service what a driver actually emits.

Not fixed here: `generateObjectDraft` still drops the key from the generated
object definition. Its destination is an open contract question rather than a
missing read — `fields.<name>.primaryKey` is **not** an authorable spec field
key (an object literal carrying it fails `tsc` against `ServiceObject` with
TS2353, and `ObjectSchema.safeParse` with `unrecognized_keys`), and there is no
key on `ObjectExternalBindingSchema` to hold a remote primary key either. See
#10676 for the routing decision.
