---
'@objectstack/plugin-audit': minor
'@objectstack/plugin-approvals': minor
---

fix(plugin-audit,plugin-approvals)!: a query over the activity stream's value-bearing columns, the compliance ledger's before/after snapshots, or an approval request's snapshot is refused for a reader withheld a field of the objects the query can reach — the one parent object it names, or every object when it names none (#21154)

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) Nothing authorable changes spelling, type or shape: no packages/spec schema, object definition, export or stored metadata moves, and neither package's public exports change. What changes is which READ queries three engine middlewares answer: a filter, sort, search, grouping or aggregation that names a value-bearing column of sys_activity or sys_audit_log, or the snapshot column of sys_approval_request, is refused with 403 PERMISSION_DENIED for a non-system reader withheld a field of the objects the query can reach (the one parent object it names, or every registered object when it names none). objectstack migrate meta has nothing to rewrite: which object a caller meant to query is the caller's decision. The other categories are closed on facts: both packages publish (not unpublished); no ADR-0087 id covers a query refusal and this diff adds none (not registered / already-registered); and the change is runtime behaviour, not a declaration (not runtime-interface-only / type-surface-only). -->

**BREAKING**: an accept-set narrowing on three engine read middlewares, shipped as `minor` under the launch-window convention.

**What was wrong.** An activity row carries field values of the record it is about in three columns: its one-line summary, its record label and its recorded change. A compliance-ledger row carries them in its before and after snapshots. An approval request carries the submitted record's snapshot. A read-time redaction narrows such values on the rows a reader is SERVED, after the driver has answered. A filter over the same columns was evaluated at rest, before that, so row presence answered whether the stored text held a value the reader is served masked or not at all, one guess at a time. A grouping by one of them handed the stored text back as the group key.

**What is refused now.** For a non-system caller, on every door that reaches these objects through the engine (the list and query doors, record export, and any other `find` / `count` / `aggregate`), a query that filters, searches, sorts, groups or aggregates by one of those columns is refused with `403 PERMISSION_DENIED`, in the engine's own words for a field the caller may not query, unless the caller is served every field, as the security service answers it, of the objects the query can reach:

- when the query names exactly one parent object, by equality on the column that names it, at the root of its filter (or inside a root `$and`): that object;
- when it names none: every object registered in the deployment, the set these rows can concern, read from metadata and never from the rows.

A grouping or aggregation by such a column answers the engine's aggregate refusal; every other position answers its predicate refusal. Both are followed by one sentence naming the remedy.

**Who is affected.** A caller withheld any field of the parent object (served masked, gated by a capability it does not hold, or not granted by its permission sets) can no longer filter, search, sort or group by those columns of that object's activity rows, ledger rows or approval requests. A caller withheld any field of any registered object can no longer do so in a query that names no parent object, or names one only inside an alternative — that includes a free-text search over the activity stream or the compliance ledger, whose searched sets include those columns. A caller served every field of the parent it names, or, for a query naming none, of every object (an administrator in a stock deployment), queries as before; the latter costs three security-service calls per registered object per such query.

**One-line fix:** a caller withheld some field names one parent object it is served in full, by equality in the query's filter; for a parent it is withheld a field of, it reads the rows unfiltered by those columns.

**Unchanged.** A query that names none of those columns answers as before, for every caller. System-context reads are not judged. A deployment without the security service answers as before: the columns are served whole there, so a filter over them discloses nothing the rows do not. The approvals service door's own search keeps its own rule for the snapshot.
