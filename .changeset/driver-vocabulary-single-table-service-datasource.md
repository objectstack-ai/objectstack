---
"@objectstack/service-datasource": major
---

feat(service-datasource)!: `DRIVER_CATALOG` publishes `mongodb`, and the factory can no longer fall through to `memory` (#6345)

**BREAKING — `DRIVER_CATALOG`'s MongoDB entry publishes `id: 'mongodb'`.** That
field is documented as "used as `datasource.driver`" and it is literally what the
Studio connection form writes into a datasource row, so this is the face of
#6345's `mongo` → `mongodb` rename that reaches stored data. Rows written before
the rename carry `mongo`; the ADR-0087 D2 conversion
`datasource-driver-mongo-to-mongodb` converges them at every rehydration seam,
and `mongo` remains an accepted alias so a deployment that skipped the migration
still connects. The factory's dispatch arm renames with it (`kind === 'mongodb'`).

**A `turso` construction arm — which the rename made mandatory, not optional.**
`createDefaultDatasourceDriverFactory().supports()` is
`resolveDriverId(id) !== undefined`, so the moment `turso` gained a config
contract in `@objectstack/spec` this factory began claiming it. Before this arm,
that claim was answered by `create()`'s trailing `memory` fall-through: a libSQL
datasource would have been built as an ephemeral in-process store that accepts
writes, reports success and loses everything — the #3276 silent-wrong-engine
class with a new spelling. The arm is the same shape `mongodb` and `sqlite-wasm`
already use (lazy import, typed not-installed error), because all three ride in
optional packages and being an optional INSTALL has never meant lacking a
contract.

The CLI and standalone stack still inject their own turso factory for the
`default` datasource (#5602's host-factory seam), and an injected factory
replaces this one — so this arm serves every OTHER door: a runtime datasource
created in Setup, `testConnection`, a declared non-default datasource. Those
doors previously got `supports() === false` and degraded; they now build.

**The fall-through itself is gone.** `memory` was the last arm's *implicit*
position — no `if`, just the end of the function — so any `BuiltinDriverId` the
switch did not handle silently became an in-memory store. It is now an explicit
`kind === 'memory'` arm followed by an exhaustiveness stop typed `never`: adding
a builtin without an arm is a compile error, and if a stale published
`@objectstack/spec` ever reaches a newer consumer at run time, the result is a
named refusal rather than a different engine. This is the trap the next driver
would have inherited; turso is simply the one that found it.

**Why `major`.** The published `DRIVER_CATALOG[].id` value changes. Any consumer
that compares a stored `datasource.driver` against the catalog id — a form
pre-selecting the current driver, a grouped list, an equality filter — stops
matching pre-rename rows until the conversion has run. Nothing throws, which is
precisely why this is not a `minor`: the failure is a dropdown that silently
shows no selection, and a bump that lets it arrive unannounced would be the same
class of quiet as the defect the rename fixes.

**Not renamed, deliberately:** `SqlDialect`'s `'mongo'` member
(`data/type-compat.ts`). That is a different vocabulary — it names the type
system of an EXTERNAL schema being introspected, alongside `snowflake` and
`bigquery`, and is never a `datasource.driver`. Renaming it would have been
sympathetic magic on a matching string.

<!-- adr-0087: registered datasource-driver-mongo-to-mongodb -->
