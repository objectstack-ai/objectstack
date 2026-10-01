---
'@objectstack/plugin-audit': minor
'@objectstack/plugin-approvals': minor
---

fix(plugin-audit,plugin-approvals)!: a query over the activity stream's value-bearing columns, the compliance ledger's before/after snapshots, or an approval request's snapshot is refused for a reader withheld a field of the record it is about, unless the query names one parent object the reader is served in full (#21154)

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) Nothing authorable changes spelling, type or shape: no packages/spec schema, object definition, export or stored metadata moves, and neither package's public exports change. What changes is which READ queries three engine middlewares answer: a filter, sort, search, grouping or aggregation that names a value-bearing column of sys_activity or sys_audit_log, or the snapshot column of sys_approval_request, is refused with 403 PERMISSION_DENIED for a non-system reader unless it names one parent object of which the reader is served every field. objectstack migrate meta has nothing to rewrite: which object a caller meant to query is the caller's decision. The other categories are closed on facts: both packages publish (not unpublished); no ADR-0087 id covers a query refusal and this diff adds none (not registered / already-registered); and the change is runtime behaviour, not a declaration (not runtime-interface-only / type-surface-only). -->

**BREAKING**: an accept-set narrowing on three engine read middlewares, shipped as `minor` under the launch-window convention.

**What was wrong.** An activity row carries field values of the record it is about in three columns: its one-line summary, its record label and its recorded change. A compliance-ledger row carries them in its before and after snapshots. An approval request carries the submitted record's snapshot. A read-time redaction narrows such values on the rows a reader is SERVED, after the driver has answered. A filter over the same columns was evaluated at rest, before that, so row presence answered whether the stored text held a value the reader is served masked or not at all, one guess at a time. A grouping by one of them handed the stored text back as the group key.

**What is refused now.** For a non-system caller, on every door that reaches these objects through the engine (the list and query doors, record export, and any other `find` / `count` / `aggregate`), a query that filters, searches, sorts, groups or aggregates by one of those columns is refused with `403 PERMISSION_DENIED`, in the engine's own words for a field the caller may not query, unless both hold:

- the query names exactly one parent object, by equality on the column that names it, at the root of its filter (or inside a root `$and`); and
- the caller is served every field of that object, as the security service answers it.

A grouping or aggregation by such a column answers the engine's aggregate refusal; every other position answers its predicate refusal. Both are followed by one sentence naming the remedy.

**Who is affected.** A caller withheld any field of the parent object (served masked, gated by a capability it does not hold, or not granted by its permission sets) can no longer filter, search, sort or group by those columns of that object's activity rows, ledger rows or approval requests. Any non-system caller, an administrator included, can no longer do so in a query that names no parent object, or names one only inside an alternative. That includes a free-text search over the activity stream or the compliance ledger that names no parent object: the searched set of both objects includes those columns. A caller served every field of the parent it names queries as before.

**One-line fix:** name one parent object by equality in the query's filter; a caller withheld a field of that object reads the rows unfiltered by those columns.

**Unchanged.** A query that names none of those columns answers as before, for every caller. System-context reads are not judged. A deployment without the security service answers as before: the columns are served whole there, so a filter over them discloses nothing the rows do not. The approvals service door's own search keeps its own rule for the snapshot.
