---
'@objectstack/spec': minor
'@objectstack/runtime': minor
'@objectstack/metadata-protocol': minor
'@objectstack/cloud-connection': minor
---

feat(spec)!: a seed is create-only by default — an omitted `mode` is `ignore`, so a restart, an install or an upgrade never writes a seeded value back over a customer's edit (#30081)

Clause-②: yes (narrowing) — the declared default of `Seed.mode` (and of `SeedLoaderConfig.defaultMode`, now the same field) moves from `upsert` to `ignore`. The accept set is unchanged and every authored `mode` parses exactly as before; what narrows is what a replay does for a dataset that declares no mode: it no longer updates an existing row.
Metadata-protocol: semantic

<!-- adr-0087: registered seed-mode-default-create-only -->

**BREAKING** for a seed dataset that declares no `mode` and relies on a replay to write its values back onto existing rows.

- **Before.** A seed with no `mode` replayed as `upsert`. A seed loads again on every single-tenant boot (production included, under `os start` and `os serve`), on every package install or upgrade and on every publish, so each replay wrote the shipped value back over a customer's edit to a seeded row, with no warning. Measured on a production boot before the change (card comment 6633189577): an API edit to a seeded row went back to the shipped value on the next restart, after a boot-artifact upgrade, and after an `os package install` upgrade.
- **Now.** `SeedSchema.mode` defaults to `ignore`: a replay inserts a record whose row is missing and leaves an existing row exactly as it is. A row nobody edited is not rewritten either, so its `updated_at` does not move, and a value changed in a later seed version reaches only a row the load creates. Maintainer ruling 6631016988 (option A).
- **One default, stated once.** `SeedLoaderConfig.defaultMode` is `SeedSchema`'s own `mode` field, default included. The six replay sites (`@objectstack/runtime`: the inline boot seed, the per-organization replayer, the dev hot reload and the published-seed apply; `@objectstack/metadata-protocol`: the publish batch; `@objectstack/cloud-connection`: install, reseed and the rehydrate healer) stop restating `defaultMode: 'upsert'`, and the save door reads the schema's default for a seed item that declares no mode.
- **Compiled artifacts.** `os build` stores the parsed seed, so a package built before this change carries a written `mode: "upsert"` on every dataset. The loader cannot tell that value from an authored one, and nothing converts it: such a package keeps today's replay until it is rebuilt.
- **Unchanged.** An explicit `mode: 'upsert'` still writes every declared column back on each replay, and `columns: { FIELD: { applyOn: 'create' } }` still exempts the columns a customer or a job owns. `insert`, `update` and `replace` behave as before.

**The remedy.** Rebuild every package so its compiled artifact carries the mode its source declares. For a dataset that is reference data the package must keep current, declare `mode: 'upsert'`, and mark the columns the customer or a job owns `applyOn: 'create'`. Leave `mode` unset for business and starter data the customer owns once it is loaded.
