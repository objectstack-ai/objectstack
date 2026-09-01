---
"@objectstack/metadata-protocol": patch
---

fix(metadata-protocol): resolve the raw-SQL driver seam through one `execute`-first helper (#14083)

Three sites in this package resolved a raw-SQL entry point off a driver, in two
different orders: `migrations/partial-index-probe.ts` and `protocol.ts`'s
`ensureOverlayIndex` tried `raw` first, while `migrations/seed-tenancy-backfill.ts`
tried `execute` first. They now share one helper, `migrations/driver-exec.ts`,
which tries `execute` first and keeps `raw` as the fallback.

`execute` goes first because `IDataDriver` (`@objectstack/spec/contracts`,
`data-driver.ts`) declares it **non-optionally** and has never declared `raw`.
It is therefore the only raw-execution surface the contract guarantees, and any
driver satisfying the interface has it. This is the same reasoning, and the same
order, that `@objectstack/metadata`'s `migrations/driver-exec.ts` adopted; the
two modules are twins and their headers cross-reference each other.

**No behaviour change on any driver this repo ships.** No data driver here
defines `raw` — `InMemoryDriver`, `MongoDBDriver` and `SqlDriver` each declare
`execute` and none declares `raw`, and `SqliteWasmDriver` and `TursoDriver`
extend `SqlDriver` — so the `raw` limb was unreachable and `execute` was already
what ran at all three sites. The flip matters for a host or third-party driver
that defines BOTH surfaces: such a driver used to be driven through `raw` at two
sites and `execute` at the third, the same operation taking two paths in one
process. It is now driven through `execute` everywhere.

`raw` is deliberately **kept**: nothing that worked before stops working.

Two smaller consequences of routing all three through one helper:

- Bindings are now passed positionally to whichever surface is selected. The
  `raw` fallback in `seed-tenancy-backfill.ts` previously dropped its `params`
  argument entirely, which was invisible only because that limb is unreachable
  on every shipped driver.
- The capability predicate each site spelled for itself (`canRunSql` / `canRun`
  / an inline check) is now defined as the resolution succeeding, so the
  predicate and the selection cannot drift apart.

⚠️ Unchanged and explicitly not addressed here: `typeof driver.execute === 'function'`
cannot distinguish "declares the surface" from "can actually run SQL", and two
shipped drivers satisfy the declaration while executing nothing. That is a
capability-declaration question tracked separately; this change aligns the ORDER
only and does not endorse the probe.
