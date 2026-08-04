---
"@objectstack/service-analytics": minor
---

fix(service-analytics): reject a dataset's cross-datasource JOIN when it is compiled, not when it is queried (#5115)

#5033 routed a dataset's raw SQL to its base object's own datasource, which
turned a JOIN whose target lives in another database into a **loud query-time
failure** — correct, but late: the dataset can still be saved, published and
put on a dashboard, and the failure lands in front of whoever opens that
dashboard, usually in another environment on another day. It is a pure metadata
error, decidable the moment the dataset is compiled: the whole dataset is
lowered into ONE statement on the base object's datasource, so a join target
bound elsewhere is simply not there.

`compileDataset` now decides it. `AnalyticsService.registerDataset` — the single
door every dataset passes through, whether pre-registered at boot, saved, or
previewed as a Studio draft — hands the compiler the datasource and federation
probes that already existed on `AnalyticsServiceConfig`, and a proven conflict
is rejected before any SQL is built. The message names both objects, both
datasources, the offending `include` path, and the two ways out (bind both
objects to the same datasource, or drop the relationship), in the same wording
family as the #5033 query-time diagnostic so the two never read as two bugs.

**Who is affected.** This is a tightening: a dataset that used to compile and
then fail (or, before #5033, silently read the wrong database) now fails at
registration. It fires only where the metadata *proves* the conflict — the base
object and a join target each declare an explicit `object.datasource` and the
two names differ. A dataset registered at boot is skipped with a WARN naming the
conflict, as before; the rest of the host's datasets still register.

**What is deliberately not rejected** ("cannot answer, do not block", the same
tiering as `isRegisteredObject` / `getObjectFieldNames`):

- a host that wires no datasource probe at all (no data engine) — compiles
  exactly as it did before;
- either side leaving `datasource` at its default. `'default'` is the schema's
  default *value*, not a routing decision: `ObjectQL.getDriver` short-circuits
  only on an explicit non-`'default'` name, then falls through to
  `datasourceMapping` rules, the ADR-0057 §3.6 lifecycle split
  (audit/telemetry/event) and the owning package's `defaultDatasource` — none of
  which are visible to the compiler. Treating `'default'` as "the primary DB"
  would reject datasets whose objects a mapping rule in fact lands on the *same*
  database;
- a federated (external) participant on either side. `NativeSQLStrategy` already
  declines such a cube (ADR-0062 D6), so the query is served by the ObjectQL
  FK-expand path, which crosses datasources by construction.

Everything not proven here keeps failing loudly at query time via #5033.
Making cross-datasource dashboards actually *work* (declining in
`NativeSQLStrategy` and serving the join with two reads) is separate and not
part of this change.
